// lib/firestore/loans.ts
//
// INTEREST MODEL: Daily-accrual reducing balance (for reducing_balance loans)
//   • Group settings define whether interestRate is per-MONTH or per-ANNUM
//     (Group.loanInterestRatePeriod, snapshotted onto Loan.interestRatePeriod)
//   • The stored rate is always converted to an ANNUAL rate first, then to
//     a daily rate: dailyRate = annualRate / 365
//       - period "annual":  annualRate = interestRate
//       - period "monthly": annualRate = interestRate × 12
//   • On every repayment, interest is first accrued for exact days since
//     lastAccrualDate using the outstanding principal balance
//   • Payment is applied: interest first, remainder reduces principal
//   • Multiple payments per month, partial payments, and mid-month payments
//     are all handled correctly — no 30-day approximations, no fixed
//     "30-day month" assumptions, no multiplier
//
// FLAT loans retain the original proportional-split model (unchanged).
//
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, query, orderBy,
  onSnapshot, writeBatch,
  loansCol, walletCol, groupDoc, membershipsCol,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2, getMembershipId,
} from "./core";
import type { Loan, NewRecord, WalletTransaction } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtCurrency(n: number, currency = "RWF") {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convert a stored loan interest rate to its ANNUAL equivalent, based on period. */
function toAnnualRate(ratePercent: number, period?: "monthly" | "annual"): number {
  return period === "monthly" ? ratePercent * 12 : ratePercent;
}

/** Exact calendar days between two ISO date strings (date part only). */
function daysBetween(fromIso: string, toIso: string): number {
  const msPerDay = 86_400_000;
  const a = new Date(fromIso.slice(0, 10)).getTime();
  const b = new Date(toIso.slice(0, 10)).getTime();
  return Math.max(0, Math.round((b - a) / msPerDay));
}

// ─────────────────────────────────────────────────────────────────────────────
// RepaymentSplit — the canonical result of processing one payment
// ─────────────────────────────────────────────────────────────────────────────
export interface RepaymentSplit {
  // How the cash was applied
  interestPortion: number;       // cash applied to interest
  principalPortion: number;      // cash applied to principal
  overpaidAmount: number;        // cash returned / credited (overpayment)
  isOverpaid: boolean;

  // Accrual details (reducing-balance only)
  daysAccrued: number;           // calendar days since last accrual
  dailyRate: number;             // annualRate / 365
  newInterestAccrued: number;    // interest that accrued this period
  accruedInterestBefore: number; // running accrued balance before this payment
  accruedInterestAfter: number;  // running accrued balance after payment

  // Updated loan state
  newBalance: number;            // remaining principal
  newAmountRepaid: number;       // cumulative cash received
  newTotalInterestPaid: number;  // cumulative interest paid
  newLastAccrualDate: string;    // ISO date — set to payment date
  isRepaid: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// splitRepayment — single source of truth for all payment math
// ─────────────────────────────────────────────────────────────────────────────
export function splitRepayment(
  loan: {
    amount: number;
    interestRate: number;             // stored % — could be monthly or annual, see interestRatePeriod
    interestMethod?: "flat" | "reducing_balance";
    interestRatePeriod?: "monthly" | "annual"; // how interestRate should be interpreted
    totalInterest: number;
    totalRepayable: number;
    amountRepaid: number;
    balance: number;
    accruedInterest?: number;         // only used for reducing_balance
    lastAccrualDate?: string;         // ISO — date of disbursement or last payment
    totalInterestPaid?: number;
  },
  payment: number,
  paymentDate: string,                // ISO date of this payment
): RepaymentSplit {
  const p     = round2(payment);
  const method = loan.interestMethod || "flat";

  // ── REDUCING BALANCE — daily accrual ──────────────────────────────────────
  if (method === "reducing_balance") {
    // Always normalise to an ANNUAL rate first, then derive the daily rate.
    // No fixed 30-day-per-month assumption and no multiplier anywhere here.
    const annualRate  = toAnnualRate(loan.interestRate, loan.interestRatePeriod);
    const dailyRate   = annualRate / 100 / 365;

    // 1. How many days since last accrual?
    const fromDate    = loan.lastAccrualDate ?? paymentDate;
    const days        = daysBetween(fromDate, paymentDate);

    // 2. Accrue interest on the CURRENT outstanding principal
    const newInterestAccrued  = round2(loan.balance * dailyRate * days);
    const priorAccrued        = round2(loan.accruedInterest ?? 0);
    const totalAccrued        = round2(priorAccrued + newInterestAccrued);

    // 3. Total currently owed = outstanding principal + all accrued interest
    const totalDue = round2(loan.balance + totalAccrued);

    const isOverpaid    = p > totalDue;
    const overpaidAmount= isOverpaid ? round2(p - totalDue) : 0;
    const effectiveAmt  = isOverpaid ? totalDue : p;

    // 4. Payment: interest first, remainder reduces principal
    const interestPortion   = Math.min(effectiveAmt, totalAccrued);
    const principalPortion  = round2(effectiveAmt - interestPortion);
    const accruedAfter      = round2(totalAccrued - interestPortion);
    const newBalance        = Math.max(0, round2(loan.balance - principalPortion));
    const newAmountRepaid   = round2((loan.amountRepaid || 0) + effectiveAmt);
    const newTotalInterestPaid = round2((loan.totalInterestPaid || 0) + interestPortion);
    const isRepaid          = newBalance === 0 && accruedAfter === 0;

    return {
      interestPortion:      round2(interestPortion),
      principalPortion,
      overpaidAmount,
      isOverpaid,
      daysAccrued:          days,
      dailyRate,
      newInterestAccrued,
      accruedInterestBefore: totalAccrued,
      accruedInterestAfter:  accruedAfter,
      newBalance,
      newAmountRepaid,
      newTotalInterestPaid,
      newLastAccrualDate:   paymentDate.slice(0, 10),
      isRepaid,
    };
  }

  // ── FLAT — proportional split (unchanged) ─────────────────────────────────
  const amountRepaid   = loan.amountRepaid || 0;
  const remaining      = round2(loan.totalRepayable - amountRepaid);
  const isOverpaid     = p > remaining;
  const overpaidAmount = isOverpaid ? round2(p - remaining) : 0;
  const effectiveAmt   = isOverpaid ? remaining : p;

  const interestRatio    = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
  const interestPortion  = round2(effectiveAmt * interestRatio);
  const principalPortion = round2(effectiveAmt - interestPortion);
  const newAmountRepaid  = round2(amountRepaid + effectiveAmt);
  const newBalance       = isOverpaid || round2(newAmountRepaid) >= round2(loan.totalRepayable)
    ? 0
    : Math.max(0, round2(loan.balance - principalPortion));
  const isRepaid         = round2(newAmountRepaid) >= round2(loan.totalRepayable);

  return {
    interestPortion,
    principalPortion,
    overpaidAmount,
    isOverpaid,
    daysAccrued:           0,
    dailyRate:             0,
    newInterestAccrued:    0,
    accruedInterestBefore: 0,
    accruedInterestAfter:  0,
    newBalance:            isRepaid ? 0 : newBalance,
    newAmountRepaid,
    newTotalInterestPaid:  round2((loan.totalInterestPaid || 0) + interestPortion),
    newLastAccrualDate:    paymentDate.slice(0, 10),
    isRepaid,
  };
}

/** Project how much interest will accrue by a future date (for display only). */
export function projectAccruedInterest(
  loan: { balance: number; interestRate: number; interestMethod?: string; interestRatePeriod?: "monthly" | "annual"; accruedInterest?: number; lastAccrualDate?: string },
  asOfDate: string = new Date().toISOString(),
): { days: number; accrued: number; total: number } {
  if (loan.interestMethod !== "reducing_balance") return { days: 0, accrued: 0, total: 0 };
  const days    = daysBetween(loan.lastAccrualDate ?? asOfDate, asOfDate);
  const annual  = toAnnualRate(loan.interestRate, loan.interestRatePeriod);
  const daily   = annual / 100 / 365;
  const accrued = round2(loan.balance * daily * days);
  const total   = round2((loan.accruedInterest ?? 0) + accrued);
  return { days, accrued, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disbursement — atomic batch: loan + wallet debit
// Sets lastAccrualDate = disbursement date so first payment accrual is correct.
// ─────────────────────────────────────────────────────────────────────────────
export interface DisburseLoanResult {
  loan: Loan;
  walletTx: WalletTransaction;
}

export async function disburseLoanServer(groupId: string, loanId: string): Promise<DisburseLoanResult> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const loanRef  = doc(loansCol(groupId), loanId);
    const groupRef = groupDoc(groupId);
    const [loanSnap, groupSnap] = await Promise.all([getDoc(loanRef), getDoc(groupRef)]);
    if (!loanSnap.exists()) throw new Error("Loan not found");

    const loan     = fromSnap<Loan>(loanSnap);
    const currency = (groupSnap.data()?.currency as string) || "RWF";
    if (loan.status !== "approved") throw new Error(`Loan must be approved (status: ${loan.status})`);

    const now         = new Date().toISOString();
    const todayDate   = now.slice(0, 10);
    const walletTxRef = doc(walletCol(groupId));

    const walletTx: WalletTransaction = {
      id:          walletTxRef.id,
      groupId,
      type:        "loan_disbursement",
      sourceType:  "loan",
      sourceId:    loanId,
      amount:      -round2(loan.amount),
      description: `Loan disbursement — ${fmtCurrency(loan.amount, currency)}`,
      date:        now,
      memberId:    loan.memberId,
      loanId,
      createdAt:   now,
      createdBy:   userInfo.userId,
    };

    const loanUpdate = {
      status:           "disbursed" as const,
      disbursementDate: now,
      // Initialise daily-accrual tracking fields
      accruedInterest:    0,
      lastAccrualDate:    todayDate,
      totalInterestPaid:  0,
      updatedAt:          now,
      updatedBy:          userInfo.userId,
    };

    const batch = writeBatch((walletTxRef as any).firestore);
    batch.update(loanRef, loanUpdate);
    batch.set(walletTxRef, walletTx);
    await batch.commit();

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
// Repayment — daily-accrual interest first, then principal
//
// Writes THREE wallet transactions atomically:
//   1. loan_interest_income    → +interestPortion
//   2. loan_principal_recovery → +principalPortion
//   3. other_credit            → +overpaid (only when overpaid)
//
// All docs written in one writeBatch with the loan update.
// ─────────────────────────────────────────────────────────────────────────────
export interface RecordRepaymentResult {
  loan:            Loan;
  interestTx:      WalletTransaction;
  principalTx:     WalletTransaction;
  creditTx:        WalletTransaction | null;
  split:           RepaymentSplit;
  overpaidAmount:  number;
  repaymentTx:     WalletTransaction; // compat alias → interestTx
}

export async function recordRepaymentServer(
  groupId:  string,
  loanId:   string,
  amount:   number,
  date?:    string,
): Promise<RecordRepaymentResult> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const loanRef  = doc(loansCol(groupId), loanId);
    const groupRef = groupDoc(groupId);
    const [loanSnap, groupSnap] = await Promise.all([getDoc(loanRef), getDoc(groupRef)]);
    if (!loanSnap.exists()) throw new Error("Loan not found");

    const loan     = fromSnap<Loan>(loanSnap);
    const currency = (groupSnap.data()?.currency as string) || "RWF";
    if (loan.status !== "disbursed") throw new Error(`Loan must be disbursed (status: ${loan.status})`);

    const paymentDate = (date ?? new Date().toISOString()).slice(0, 10);
    const now         = date ?? new Date().toISOString();

    const split = splitRepayment(
      {
        amount:              loan.amount,
        interestRate:        loan.interestRate,
        interestMethod:      loan.interestMethod,
        interestRatePeriod:  (loan as any).interestRatePeriod ?? "monthly",
        totalInterest:       loan.totalInterest,
        totalRepayable:      loan.totalRepayable,
        amountRepaid:        loan.amountRepaid      || 0,
        balance:             loan.balance,
        accruedInterest:     (loan as any).accruedInterest  ?? 0,
        lastAccrualDate:     (loan as any).lastAccrualDate  ?? paymentDate,
        totalInterestPaid:   (loan as any).totalInterestPaid ?? 0,
      },
      amount,
      paymentDate,
    );

    // Build a human-readable description for the transaction
    const isRB = loan.interestMethod === "reducing_balance";
    const interestDesc = isRB
      ? `Interest (${split.daysAccrued}d @ ${(split.dailyRate * 365 * 100).toFixed(2)}% p.a.) — ${fmtCurrency(split.interestPortion, currency)}`
      : `Interest portion — ${fmtCurrency(split.interestPortion, currency)}`;
    const principalDesc = `Principal recovery — ${fmtCurrency(split.principalPortion, currency)} (balance → ${fmtCurrency(split.newBalance, currency)})`;

    // Pre-generate refs before any await
    const interestTxRef  = doc(walletCol(groupId));
    const principalTxRef = doc(walletCol(groupId));

    const interestTx: WalletTransaction = {
      id:          interestTxRef.id,
      groupId,
      type:        "loan_interest_income",
      sourceType:  "loan",
      sourceId:    loanId,
      amount:      split.interestPortion,
      description: interestDesc,
      date:        now,
      memberId:    loan.memberId,
      loanId,
      createdAt:   now,
      createdBy:   userInfo.userId,
      // Extra audit fields for daily-accrual
      meta: isRB ? {
        daysAccrued:          split.daysAccrued,
        dailyRatePct:         round2(split.dailyRate * 365 * 100),
        balanceAtAccrual:     loan.balance,
        priorAccruedInterest: split.accruedInterestBefore,
        newAccruedThisPeriod: split.newInterestAccrued,
      } : undefined,
    } as WalletTransaction & { meta?: object };

    const principalTx: WalletTransaction = {
      id:          principalTxRef.id,
      groupId,
      type:        "loan_principal_recovery",
      sourceType:  "loan",
      sourceId:    loanId,
      amount:      split.principalPortion,
      description: principalDesc,
      date:        now,
      memberId:    loan.memberId,
      loanId,
      createdAt:   now,
      createdBy:   userInfo.userId,
    };

    const loanUpdate: Partial<Loan> & Record<string, unknown> = {
      amountRepaid:       split.newAmountRepaid,
      balance:            split.newBalance,
      accruedInterest:    split.accruedInterestAfter,
      lastAccrualDate:    split.newLastAccrualDate,
      totalInterestPaid:  split.newTotalInterestPaid,
      status:             split.isRepaid ? "repaid" : "disbursed",
      updatedAt:          now,
      updatedBy:          userInfo.userId,
    };
    if (split.isRepaid) loanUpdate.completionDate = now;

    const batch = writeBatch((interestTxRef as any).firestore);
    batch.update(loanRef, loanUpdate);
    batch.set(interestTxRef, interestTx);
    batch.set(principalTxRef, principalTx);

    let creditTx: WalletTransaction | null = null;
    if (split.isOverpaid && split.overpaidAmount > 0) {
      const creditTxRef = doc(walletCol(groupId));
      creditTx = {
        id:          creditTxRef.id,
        groupId,
        type:        "other_credit",
        sourceType:  "loan",
        sourceId:    loanId,
        amount:      split.overpaidAmount,
        description: `Loan overpayment credit — ${fmtCurrency(split.overpaidAmount, currency)}`,
        date:        now,
        memberId:    loan.memberId,
        loanId,
        createdAt:   now,
        createdBy:   userInfo.userId,
      };
      batch.set(creditTxRef, creditTx);
    }

    await batch.commit();

    const auditReason = isRB
      ? `Payment of ${fmtCurrency(amount, currency)} on ${paymentDate} — ` +
        `${split.daysAccrued} days accrued, ` +
        `interest: ${fmtCurrency(split.interestPortion, currency)}, ` +
        `principal: ${fmtCurrency(split.principalPortion, currency)}, ` +
        `remaining balance: ${fmtCurrency(split.newBalance, currency)}`
      : `Repayment ${fmtCurrency(amount, currency)} — ` +
        `interest: ${fmtCurrency(split.interestPortion, currency)}, ` +
        `principal: ${fmtCurrency(split.principalPortion, currency)}`;

    await writeAuditLog(groupId, {
      groupId, userId: userInfo.userId, userName: userInfo.userName,
      action: "updated", entityType: "loan", entityId: loanId,
      before: loan as any,
      after: { ...loan, ...loanUpdate },
      reason: auditReason,
    });

    return {
      loan:           { ...loan, ...loanUpdate } as Loan,
      interestTx,
      principalTx,
      creditTx,
      split,
      overpaidAmount: split.overpaidAmount,
      repaymentTx:    interestTx,
    };
  } catch (error) {
    logError("recordRepaymentServer", "loan", error, { groupId, loanId, amount });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard CRUD — unchanged
// ─────────────────────────────────────────────────────────────────────────────
export async function addLoan(gId: string, data: NewRecord<Loan>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(loansCol(gId), data.id) : doc(loansCol(gId));
    const now  = new Date().toISOString();
    const loanData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      accruedInterest:    0,
      totalInterestPaid:  0,
      lastAccrualDate:    now.slice(0, 10),
      createdAt: now, createdBy: userInfo?.userId, updatedAt: now,
    };
    await setDoc(dRef, loanData);
    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId, userId: userInfo.userId, userName: userInfo.userName,
        action: "created", entityType: "loan", entityId: dRef.id,
        after: loanData, reason: data.purpose || "Loan application created",
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
    const updateData = { ...stripUndefined(data as any), updatedAt: now, updatedBy: userInfo?.userId };
    await updateDoc(doc(loansCol(gId), id), updateData);
    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId, userId: userInfo.userId, userName: userInfo.userName,
        action: "updated", entityType: "loan", entityId: id,
        before, after: { ...before, ...updateData }, reason: data.purpose || "Loan updated",
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
    const currentSnap = await getDoc(doc(loansCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Loan not found");
    const loan = fromSnap<Loan>(currentSnap);
    const membershipId  = getMembershipId(gId, userInfo.userId);
    const membershipSnap = await getDoc(doc(membershipsCol, membershipId));
    const isAdmin = membershipSnap.exists() && membershipSnap.data().role === "admin";
    if (!isAdmin) {
      const pendingStatuses = ["pending_loan_officer", "pending_committee", "pending_accountant"];
      if (!pendingStatuses.includes(loan.status)) throw new Error("Only admins can delete non-pending loans");
    }
    await recordDeletion(gId, "loan", id, loan as unknown as Record<string, unknown>, reason);
    await writeAuditLog(gId, {
      groupId: gId, userId: userInfo.userId, userName: userInfo.userName,
      action: "deleted", entityType: "loan", entityId: id,
      before: loan as unknown as Record<string, unknown>, reason,
    });
    await deleteDoc(doc(loansCol(gId), id));
  } catch (error) {
    logError("deleteLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

export function subscribeLoans(gId: string, cb: (ls: Loan[]) => void, onError?: (e: unknown) => void): () => void {
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
    await updateDoc(doc(loansCol(gId), id), { status: "approved", approvedBy: userInfo.userId, approvedAt: now, approvalDate: now });
    await writeAuditLog(gId, {
      groupId: gId, userId: userInfo.userId, userName: userInfo.userName,
      action: "approved", entityType: "loan", entityId: id,
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
    await updateDoc(doc(loansCol(gId), id), { status: "rejected", rejectedBy: userInfo.userId, rejectedAt: now, rejectionReason });
    await writeAuditLog(gId, {
      groupId: gId, userId: userInfo.userId, userName: userInfo.userName,
      action: "rejected", entityType: "loan", entityId: id,
      before: loan as unknown as Record<string, unknown>,
      after: { ...loan, status: "rejected", rejectedBy: userInfo.userId, rejectedAt: now, rejectionReason },
      reason: rejectionReason,
    });
  } catch (error) {
    logError("rejectLoan", "loan", error, { groupId: gId, id });
    throw error;
  }
}

// Note: writeFailedAuditLog is exported from audit.ts — use that directly
