import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  membersCol, loansCol, walletCol, groupDoc, membershipsCol,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2, getMembershipId,
} from "./core";
import type { Loan, NewRecord, WalletTransaction } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Loan ledger math (mirrors functions/src/loanMath.ts — no Cloud Function needed)
// ─────────────────────────────────────────────────────────────────────────────
function splitRepayment(
  loan: {
    amount: number; interestRate: number; interestMethod?: "flat" | "reducing_balance";
    totalInterest: number; totalRepayable: number; amountRepaid: number; balance: number;
  },
  amount: number,
) {
  const amountNum = round2(amount);
  const method = loan.interestMethod || "flat";

  if (method === "reducing_balance") {
    const periodicRate = loan.interestRate / 100;
    const interestDue = round2(loan.balance * periodicRate);
    const remainingTotal = round2(loan.balance + interestDue);
    const isOverpaid = amountNum > remainingTotal;
    const overpaidAmount = isOverpaid ? round2(amountNum - remainingTotal) : 0;
    let interestPortion: number, principalPortion: number;
    if (amountNum >= remainingTotal) { interestPortion = interestDue; principalPortion = loan.balance; }
    else if (amountNum <= interestDue) { interestPortion = amountNum; principalPortion = 0; }
    else { interestPortion = interestDue; principalPortion = round2(amountNum - interestDue); }
    const newAmountRepaid = round2(loan.amountRepaid + (amountNum - overpaidAmount));
    const newBalance = Math.max(0, round2(loan.balance - principalPortion));
    return { interestPortion, principalPortion, overpaidAmount, isOverpaid, newAmountRepaid, newBalance, isRepaid: newBalance === 0 };
  }

  // flat
  const ratio = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
  const remaining = round2(loan.totalRepayable - loan.amountRepaid);
  const isOverpaid = amountNum > remaining;
  const overpaidAmount = isOverpaid ? round2(amountNum - remaining) : 0;
  const effectiveAmt = isOverpaid ? remaining : amountNum;
  const interestPortion = round2(effectiveAmt * ratio);
  const principalPortion = round2(effectiveAmt - interestPortion);
  const newAmountRepaid = round2(loan.amountRepaid + effectiveAmt);
  const newBalance = Math.max(0, round2(loan.balance - principalPortion));
  return { interestPortion, principalPortion, overpaidAmount, isOverpaid, newAmountRepaid, newBalance, isRepaid: newBalance === 0 };
}

function fmtCurrency(n: number, currency = "RWF") {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disbursement — direct Firestore write (no Cloud Function required)
// ─────────────────────────────────────────────────────────────────────────────
export interface DisburseLoanResult {
  loan: Loan;
  walletTx: WalletTransaction;
}

export async function disburseLoanServer(groupId: string, loanId: string): Promise<DisburseLoanResult> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");
    const loanRef = doc(loansCol(groupId), loanId);
    const groupRef = groupDoc(groupId);
    const [loanSnap, groupSnap] = await Promise.all([getDoc(loanRef), getDoc(groupRef)]);
    if (!loanSnap.exists()) throw new Error("Loan not found");
    const loan = fromSnap<Loan>(loanSnap);
    const currency = (groupSnap.data()?.currency as string) || "RWF";
    if (loan.status !== "approved") throw new Error(`Loan must be fully approved before disbursement (current status: ${loan.status})`);
    const now = new Date().toISOString();
    const walletTxRef = doc(walletCol(groupId));
    const loanUpdate = { status: "disbursed" as const, disbursementDate: now, updatedAt: now, updatedBy: userInfo.userId };
    const walletTx: WalletTransaction = {
      id: walletTxRef.id, groupId, type: "loan_disbursement",
      amount: -round2(loan.amount),
      description: `Loan disbursement (${fmtCurrency(loan.amount, currency)})`,
      date: now, memberId: loan.memberId, loanId, createdAt: now, createdBy: userInfo.userId,
    };
    await updateDoc(loanRef, loanUpdate);
    await setDoc(walletTxRef, walletTx);
    await writeAuditLog(groupId, {
      groupId, userId: userInfo.userId, userName: userInfo.userName,
      action: "disbursed", entityType: "loan", entityId: loanId,
      before: loan as any, after: { ...loan, ...loanUpdate }, reason: "Loan disbursed",
    });
    return { loan: { ...loan, ...loanUpdate }, walletTx };
  } catch (error) {
    logError("disburseLoanServer", "loan", error, { groupId, loanId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repayment — direct Firestore write (no Cloud Function required)
// ─────────────────────────────────────────────────────────────────────────────
export interface RecordRepaymentResult {
  loan: Loan;
  repaymentTx: WalletTransaction;
  creditTx: WalletTransaction | null;
  overpaidAmount: number;
}

export async function recordRepaymentServer(
  groupId: string, loanId: string, amount: number, date?: string,
): Promise<RecordRepaymentResult> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");
    const loanRef = doc(loansCol(groupId), loanId);
    const groupRef = groupDoc(groupId);
    const [loanSnap, groupSnap] = await Promise.all([getDoc(loanRef), getDoc(groupRef)]);
    if (!loanSnap.exists()) throw new Error("Loan not found");
    const loan = fromSnap<Loan>(loanSnap);
    const currency = (groupSnap.data()?.currency as string) || "RWF";
    if (loan.status !== "disbursed") throw new Error(`Repayments can only be recorded against a disbursed loan (current status: ${loan.status})`);
    const split = splitRepayment({ amount: loan.amount, interestRate: loan.interestRate, interestMethod: loan.interestMethod, totalInterest: loan.totalInterest, totalRepayable: loan.totalRepayable, amountRepaid: loan.amountRepaid || 0, balance: loan.balance }, amount);
    const now = date || new Date().toISOString();
    const loanUpdate: Partial<Loan> & Record<string, unknown> = {
      amountRepaid: split.newAmountRepaid, balance: split.newBalance,
      status: split.isRepaid ? "repaid" : "disbursed", updatedAt: now, updatedBy: userInfo.userId,
    };
    if (split.isRepaid) loanUpdate.completionDate = now;
    await updateDoc(loanRef, loanUpdate);

    // Create wallet doc refs BEFORE any await so IDs are fixed for this call —
    // prevents duplicate documents if the client retries after a network hiccup.
    const repayTxRef = doc(walletCol(groupId));
    const repayTxId  = repayTxRef.id;
    const repaymentTx: WalletTransaction = {
      id: repayTxId, groupId, type: "loan_repayment",
      amount: round2(amount - split.overpaidAmount),
      description: `Loan repayment — Principal: ${fmtCurrency(split.principalPortion, currency)}, Interest: ${fmtCurrency(split.interestPortion, currency)}`,
      date: now, memberId: loan.memberId, loanId, createdAt: now, createdBy: userInfo.userId,
    };
    await setDoc(repayTxRef, repaymentTx);
    let creditTx: WalletTransaction | null = null;
    if (split.isOverpaid && split.overpaidAmount > 0) {
      const creditTxRef = doc(walletCol(groupId));
      creditTx = {
        id: creditTxRef.id, groupId, type: "other_credit",
        amount: split.overpaidAmount,
        description: "Overpayment credit — can be applied to future contributions",
        date: now, memberId: loan.memberId, loanId, createdAt: now, createdBy: userInfo.userId,
      };
      await setDoc(creditTxRef, creditTx);
    }
    await writeAuditLog(groupId, {
      groupId, userId: userInfo.userId, userName: userInfo.userName,
      action: "updated", entityType: "loan", entityId: loanId,
      before: loan as any, after: { ...loan, ...loanUpdate },
      reason: `Repayment of ${fmtCurrency(amount, currency)} recorded`,
    });
    return { loan: { ...loan, ...loanUpdate } as Loan, repaymentTx, creditTx, overpaidAmount: split.overpaidAmount };
  } catch (error) {
    logError("recordRepaymentServer", "loan", error, { groupId, loanId, amount });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loans
// ─────────────────────────────────────────────────────────────────────────────
export async function addLoan(gId: string, data: NewRecord<Loan>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(loansCol(gId), data.id) : doc(loansCol(gId));
    const now = new Date().toISOString();

    const loanData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      createdAt: now,
      createdBy: userInfo?.userId,
      updatedAt: now,
    };

    await setDoc(dRef, loanData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "loan",
        entityId: dRef.id,
        after: loanData,
        reason: data.purpose || "Loan application created",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addLoan", "loan", error, { groupId: gId });
    throw error;
  }
}

export async function updateLoan(gId: string, id: string, data: Partial<Loan>): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(loansCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const updateData = {
      ...stripUndefined(data as any),
      updatedAt: now,
      updatedBy: userInfo?.userId,
    };

    await updateDoc(doc(loansCol(gId), id), updateData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "loan",
        entityId: id,
        before,
        after: { ...before, ...updateData },
        reason: data.purpose || "Loan updated",
      });
    }
  } catch (error) {
    logError("updateLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteLoan(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(loansCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Loan not found");

    const loan = fromSnap<Loan>(currentSnap);

    const membershipId = getMembershipId(gId, userInfo.userId);
    const membershipSnap = await getDoc(doc(membershipsCol, membershipId));
    const isAdmin = membershipSnap.exists() && membershipSnap.data().role === "admin";

    if (!isAdmin) {
      const pendingStatuses = ["pending_loan_officer", "pending_committee", "pending_accountant"];
      if (!pendingStatuses.includes(loan.status)) {
        throw new Error("Only admins can delete non-pending loans");
      }
    }

    await recordDeletion(gId, "loan", id, loan as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "loan",
      entityId: id,
      before: loan as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(loansCol(gId), id));
  } catch (error) {
    logError("deleteLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

export function subscribeLoans(
  gId: string,
  cb: (ls: Loan[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(loansCol(gId), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Loan>(s))),
    onError,
  );
}

export async function approveLoan(gId: string, id: string, reason?: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(loansCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Loan not found");

    const loan = fromSnap<Loan>(currentSnap);

    await updateDoc(doc(loansCol(gId), id), {
      status: "approved",
      approvedBy: userInfo.userId,
      approvedAt: now,
      approvalDate: now,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "approved",
      entityType: "loan",
      entityId: id,
      before: loan as unknown as Record<string, unknown>,
      after: { ...loan, status: "approved", approvedBy: userInfo.userId, approvedAt: now },
      reason: reason || "Loan approved",
    });
  } catch (error) {
    logError("approveLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

export async function rejectLoan(gId: string, id: string, rejectionReason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(loansCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Loan not found");

    const loan = fromSnap<Loan>(currentSnap);

    await updateDoc(doc(loansCol(gId), id), {
      status: "rejected",
      rejectedBy: userInfo.userId,
      rejectedAt: now,
      rejectionReason,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "rejected",
      entityType: "loan",
      entityId: id,
      before: loan as unknown as Record<string, unknown>,
      after: { ...loan, status: "rejected", rejectedBy: userInfo.userId, rejectedAt: now, rejectionReason },
      reason: rejectionReason,
    });
  } catch (error) {
    logError("rejectLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

