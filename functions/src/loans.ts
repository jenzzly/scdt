// functions/src/loans.ts
//
// Server-side ledger authority for loans. These two callables replace the
// client-computed disbursement/repayment logic that used to live in
// stores/slices/loanSlice.ts (disburseLoan, recordRepayment). The client
// now just calls these and trusts whatever they return — it never computes
// a balance or writes one directly.
import * as admin from "firebase-admin";
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { requireAuth, requireRole, ROLES_THAT_CAN_DISBURSE, ROLES_THAT_CAN_RECORD_REPAYMENT } from "./authz";
import { splitRepayment, round2, fmtCurrency } from "./loanMath";

const db = admin.firestore();

interface DisburseLoanInput {
  groupId: string;
  loanId: string;
}

interface RecordRepaymentInput {
  groupId: string;
  loanId: string;
  amount: number;
  date?: string;
}

export const disburseLoan = onCall(async (request: CallableRequest<DisburseLoanInput>) => {
  const uid = requireAuth(request);
  const { groupId, loanId } = request.data || ({} as DisburseLoanInput);
  if (!groupId || !loanId) {
    throw new HttpsError("invalid-argument", "groupId and loanId are required.");
  }

  await requireRole(db, groupId, uid, ROLES_THAT_CAN_DISBURSE);

  const loanRef = db.collection("groups").doc(groupId).collection("loans").doc(loanId);
  const groupRef = db.collection("groups").doc(groupId);

  return db.runTransaction(async (tx) => {
    const [loanSnap, groupSnap] = await Promise.all([tx.get(loanRef), tx.get(groupRef)]);
    if (!loanSnap.exists) throw new HttpsError("not-found", "Loan not found.");
    const loan = loanSnap.data()!;
    const currency = (groupSnap.data()?.currency as string) || "RWF";

    if (loan.status !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        `Loan must be fully approved before disbursement (current status: ${loan.status}).`,
      );
    }

    const now = new Date().toISOString();
    const walletTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
    const auditRef = db.collection("groups").doc(groupId).collection("auditLogs").doc();

    const loanUpdate = {
      status: "disbursed",
      disbursementDate: now,
      updatedAt: now,
      updatedBy: uid,
    };
    tx.update(loanRef, loanUpdate);

    const walletTx = {
      id: walletTxRef.id,
      groupId,
      type: "loan_disbursement",
      amount: -round2(loan.amount),
      description: `Loan disbursement (${fmtCurrency(loan.amount, currency)})`,
      date: now,
      memberId: loan.memberId,
      loanId,
      createdAt: now,
      createdBy: uid,
    };
    tx.set(walletTxRef, walletTx);

    tx.set(auditRef, {
      id: auditRef.id,
      groupId,
      userId: uid,
      userName: request.auth?.token?.name || request.auth?.token?.email || "Unknown",
      action: "disbursed",
      entityType: "loan",
      entityId: loanId,
      before: loan,
      after: { ...loan, ...loanUpdate },
      reason: "Loan disbursed",
      timestamp: now,
    });

    return { loan: { ...loan, ...loanUpdate, id: loanId }, walletTx };
  });
});

export const recordRepayment = onCall(async (request: CallableRequest<RecordRepaymentInput>) => {
  const uid = requireAuth(request);
  const { groupId, loanId, amount, date } = request.data || ({} as RecordRepaymentInput);
  if (!groupId || !loanId || typeof amount !== "number" || amount <= 0) {
    throw new HttpsError("invalid-argument", "groupId, loanId, and a positive amount are required.");
  }

  await requireRole(db, groupId, uid, ROLES_THAT_CAN_RECORD_REPAYMENT);

  const loanRef = db.collection("groups").doc(groupId).collection("loans").doc(loanId);
  const groupRef = db.collection("groups").doc(groupId);
  const memberCol = db.collection("groups").doc(groupId).collection("members");

  return db.runTransaction(async (tx) => {
    const [loanSnap, groupSnap] = await Promise.all([tx.get(loanRef), tx.get(groupRef)]);
    if (!loanSnap.exists) throw new HttpsError("not-found", "Loan not found.");
    const loan = loanSnap.data()!;
    const currency = (groupSnap.data()?.currency as string) || "RWF";

    if (loan.status !== "disbursed") {
      throw new HttpsError(
        "failed-precondition",
        `Repayments can only be recorded against a disbursed loan (current status: ${loan.status}).`,
      );
    }

    const split = splitRepayment(
      {
        amount: loan.amount,
        interestRate: loan.interestRate,
        interestMethod: loan.interestMethod || "flat",
        totalInterest: loan.totalInterest,
        totalRepayable: loan.totalRepayable,
        amountRepaid: loan.amountRepaid || 0,
        balance: loan.balance,
      },
      amount,
    );

    const now = date || new Date().toISOString();
    const loanUpdate: Record<string, unknown> = {
      amountRepaid: split.newAmountRepaid,
      balance: split.newBalance,
      status: split.isRepaid ? "repaid" : "disbursed",
      updatedAt: now,
      updatedBy: uid,
    };
    if (split.isRepaid) loanUpdate.completionDate = now;
    tx.update(loanRef, loanUpdate);

    const repaymentTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
    const repaymentTx = {
      id: repaymentTxRef.id,
      groupId,
      type: "loan_repayment",
      amount: round2(amount - split.overpaidAmount),
      description: `Loan repayment (Principal: ${fmtCurrency(split.principalPortion, currency)}, Interest: ${fmtCurrency(split.interestPortion, currency)})`,
      date: now,
      memberId: loan.memberId,
      loanId,
      createdAt: now,
      createdBy: uid,
    };
    tx.set(repaymentTxRef, repaymentTx);

    let creditTx: Record<string, unknown> | null = null;
    if (split.isOverpaid && split.overpaidAmount > 0) {
      const creditTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
      creditTx = {
        id: creditTxRef.id,
        groupId,
        type: "other_credit",
        amount: split.overpaidAmount,
        description: "Overpayment credit from loan - can be used for future contributions",
        date: now,
        memberId: loan.memberId,
        loanId,
        createdAt: now,
        createdBy: uid,
      };
      tx.set(creditTxRef, creditTx);
    }

    const auditRef = db.collection("groups").doc(groupId).collection("auditLogs").doc();
    tx.set(auditRef, {
      id: auditRef.id,
      groupId,
      userId: uid,
      userName: request.auth?.token?.name || request.auth?.token?.email || "Unknown",
      action: "updated",
      entityType: "loan",
      entityId: loanId,
      before: loan,
      after: { ...loan, ...loanUpdate },
      reason: `Repayment of ${fmtCurrency(amount, currency)} recorded`,
      timestamp: now,
    });

    return {
      loan: { ...loan, ...loanUpdate, id: loanId },
      repaymentTx,
      creditTx,
      memberId: loan.memberId,
      overpaidAmount: split.overpaidAmount,
      currency,
    };
  }).then(async (result) => {
    // Notification is sent outside the transaction since it's not part of
    // the ledger and shouldn't roll the financial write back if it fails.
    if (result.overpaidAmount > 0) {
      const memberSnap = await memberCol.doc(String(result.memberId)).get();
      const userId = memberSnap.data()?.userId;
      if (userId) {
        await db.collection("users").doc(userId).collection("notifications").add({
          userId,
          groupId,
          type: "overpayment_credit",
          title: "Loan Overpayment Credit",
          message: `Your loan overpayment of ${fmtCurrency(result.overpaidAmount, result.currency)} has been credited to your account.`,
          read: false,
          metadata: { loanId, amount: result.overpaidAmount },
          createdAt: new Date().toISOString(),
        }).catch((err) => console.warn("[recordRepayment] notification failed (non-fatal):", err));
      }
    }
    return result;
  });
});
