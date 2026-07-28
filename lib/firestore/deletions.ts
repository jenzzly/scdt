// lib/firestore/deletions.ts
//
// Deletion-history bookkeeping plus the cascade-delete helpers that remove
// an entity and any records derived from it (e.g. deleting a contribution
// also removes the wallet transaction it generated).
//
// ALL cascade deletes below use writeBatch so the parent entity and every
// related wallet transaction are removed atomically — either everything
// succeeds, or nothing changes. No partial-delete state is possible.
import {
  doc, getDoc, getDocs, deleteDoc, setDoc, updateDoc, query, where, orderBy, onSnapshot, writeBatch,
  deletionsCol, contribsCol, walletCol, loansCol, investCol, meetingsCol, expensesCol, membersCol,
  getCurrentUserInfo, logError, fromSnap, round2,
} from "./core";
import type { DeletionRecord, Contribution, WalletTransaction, Loan, Investment, Meeting, Expense } from "./core";
import { writeAuditLog } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Deletion Records
// ─────────────────────────────────────────────────────────────────────────────
export async function recordDeletion(
  gId: string,
  entityType: DeletionRecord["entityType"],
  entityId: string,
  entityData: Record<string, unknown>,
  reason: string,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const dRef = doc(deletionsCol(gId));
    const now = new Date().toISOString();

    const record: DeletionRecord = {
      id: dRef.id,
      groupId: gId,
      entityType,
      entityId,
      entityData,
      reason,
      deletedBy: userInfo.userId,
      deletedByName: userInfo.userName,
      deletedAt: now,
    };

    await setDoc(dRef, record);
  } catch (error) {
    logError("recordDeletion", entityType, error, { groupId: gId, entityId });
    throw error;
  }
}

/**
 * Append a batched recordDeletion-style write for a wallet transaction into
 * an existing writeBatch, instead of awaiting a separate Firestore call.
 * Keeps the cascade truly atomic with the rest of the batch.
 */
function batchRecordDeletion(
  batch: ReturnType<typeof writeBatch>,
  gId: string,
  entityType: DeletionRecord["entityType"],
  entityId: string,
  entityData: Record<string, unknown>,
  reason: string,
  userId: string,
  userName: string,
) {
  const dRef = doc(deletionsCol(gId));
  const now = new Date().toISOString();
  const record: DeletionRecord = {
    id: dRef.id,
    groupId: gId,
    entityType,
    entityId,
    entityData,
    reason,
    deletedBy: userId,
    deletedByName: userName,
    deletedAt: now,
  };
  batch.set(dRef, record);
}

export function subscribeDeletionHistory(
  gId: string,
  cb: (records: DeletionRecord[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(deletionsCol(gId), orderBy("deletedAt", "desc")),
    (snap) => cb(snap.docs.map((s) => s.data() as DeletionRecord)),
    onError,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contribution — cascades to: every wallet tx with contributionId === id
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteContributionWithRelations(gId: string, contributionId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const contributionRef = doc(contribsCol(gId), contributionId);
    const contributionSnap = await getDoc(contributionRef);
    if (!contributionSnap.exists()) throw new Error("Contribution not found");
    const contribution = fromSnap<Contribution>(contributionSnap);

    // Find ALL related wallet transactions before touching anything
    const walletSnap = await getDocs(query(walletCol(gId), where("contributionId", "==", contributionId)));

    const batch = writeBatch((contributionRef as any).firestore);

    // 1. Delete the contribution itself
    batch.delete(contributionRef);
    batchRecordDeletion(batch, gId, "contribution", contributionId, contribution as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    // 2. Delete every related wallet transaction
    walletSnap.docs.forEach((walletDoc) => {
      batch.delete(walletDoc.ref);
      batchRecordDeletion(batch, gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
    });

    // 3. Recompute the member's total contributions (excluding the deleted one)
    const memberId = contribution.memberId;
    const remainingContributions = await getDocs(
      query(contribsCol(gId), where("memberId", "==", memberId), where("status", "==", "approved"))
    );
    const totalAmount = round2(
      remainingContributions.docs.reduce((sum, d) => {
        if (d.id === contributionId) return sum; // safety: exclude self if not yet removed from query cache
        return sum + (d.data().amount || 0);
      }, 0)
    );
    batch.update(doc(membersCol(gId), memberId), {
      totalContributions: totalAmount,
      totalSavings: totalAmount,
      updatedAt: new Date().toISOString(),
    });

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "contribution",
      entityId: contributionId,
      before: contribution as unknown as Record<string, unknown>,
      reason: `${reason} (cascaded to ${walletSnap.docs.length} wallet transaction${walletSnap.docs.length !== 1 ? "s" : ""})`,
    });
  } catch (error) {
    logError("deleteContributionWithRelations", "contribution", error, { groupId: gId, id: contributionId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Investment — cascades to: every wallet tx with investmentId === id
// (investment_disbursement on creation, investment_return on closing, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteInvestmentWithRelations(gId: string, investmentId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const investmentRef = doc(investCol(gId), investmentId);
    const investmentSnap = await getDoc(investmentRef);
    if (!investmentSnap.exists()) throw new Error("Investment not found");
    const investment = fromSnap<Investment>(investmentSnap);

    if (!["open", "pending", "pending_committee", "matured", "closed"].includes(investment.status)) {
      throw new Error(`Cannot delete investment with status: ${investment.status}`);
    }

    const walletSnap = await getDocs(query(walletCol(gId), where("investmentId", "==", investmentId)));

    const batch = writeBatch((investmentRef as any).firestore);

    batch.delete(investmentRef);
    batchRecordDeletion(batch, gId, "investment", investmentId, investment as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    walletSnap.docs.forEach((walletDoc) => {
      batch.delete(walletDoc.ref);
      batchRecordDeletion(batch, gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
    });

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "investment",
      entityId: investmentId,
      before: investment as unknown as Record<string, unknown>,
      reason: `${reason} (cascaded to ${walletSnap.docs.length} wallet transaction${walletSnap.docs.length !== 1 ? "s" : ""})`,
    });
  } catch (error) {
    logError("deleteInvestmentWithRelations", "investment", error, { groupId: gId, id: investmentId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet transaction — cascades to the contribution it spawned (if any), or
// recomputes the loan it was applied to (if it was a repayment/interest tx)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteWalletTransactionWithRelations(gId: string, transactionId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const walletRef = doc(walletCol(gId), transactionId);
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) throw new Error("Wallet transaction not found");
    const walletTx = fromSnap<WalletTransaction>(walletSnap);

    const batch = writeBatch((walletRef as any).firestore);

    batch.delete(walletRef);
    batchRecordDeletion(batch, gId, "wallet_transaction", transactionId, walletTx as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    // ── Cascade: if this tx funded a contribution, delete it too and recompute totals ──
    if (walletTx.contributionId) {
      const contributionRef = doc(contribsCol(gId), walletTx.contributionId);
      const contributionSnap = await getDoc(contributionRef);
      if (contributionSnap.exists()) {
        const contribution = fromSnap<Contribution>(contributionSnap);
        batch.delete(contributionRef);
        batchRecordDeletion(batch, gId, "contribution", walletTx.contributionId, contribution as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

        const remainingContributions = await getDocs(
          query(contribsCol(gId), where("memberId", "==", contribution.memberId), where("status", "==", "approved"))
        );
        const totalAmount = round2(
          remainingContributions.docs.reduce((sum, d) => {
            if (d.id === walletTx.contributionId) return sum;
            return sum + (d.data().amount || 0);
          }, 0)
        );
        batch.update(doc(membersCol(gId), contribution.memberId), {
          totalContributions: totalAmount,
          totalSavings: totalAmount,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // ── Cascade: if this tx funded an investment, delete it too ──
    if (walletTx.investmentId) {
      const investRef = doc(investCol(gId), walletTx.investmentId);
      const investSnap = await getDoc(investRef);
      if (investSnap.exists()) {
        const investment = fromSnap<Investment>(investSnap);
        batch.delete(investRef);
        batchRecordDeletion(batch, gId, "investment", walletTx.investmentId, investment as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
      }
    }

    // ── If this tx was applied to a loan, recompute the loan's repayment state ──
    const loanRepaymentTypes = ["loan_repayment", "loan_interest_income", "loan_principal_recovery", "interest"];
    if (walletTx.loanId && loanRepaymentTypes.includes(walletTx.type)) {
      const loanRef = doc(loansCol(gId), walletTx.loanId);
      const loanSnap = await getDoc(loanRef);
      if (loanSnap.exists()) {
        const loan = fromSnap<Loan>(loanSnap);

        if (walletTx.type === "loan_principal_recovery") {
          // Principal-only tx: reverse directly against balance
          const newBalance = round2(loan.balance + walletTx.amount);
          const newAmountRepaid = Math.max(0, round2(loan.amountRepaid - walletTx.amount));
          batch.update(loanRef, {
            balance: newBalance,
            amountRepaid: newAmountRepaid,
            status: "disbursed",
            completionDate: null,
            updatedAt: new Date().toISOString(),
          });
        } else if (walletTx.type === "loan_interest_income") {
          // Interest-only tx: reverse against amountRepaid and totalInterestPaid;
          // re-add the reversed amount back into accruedInterest so it's not lost
          const newAmountRepaid = Math.max(0, round2(loan.amountRepaid - walletTx.amount));
          const newTotalInterestPaid = Math.max(0, round2(((loan as any).totalInterestPaid || 0) - walletTx.amount));
          const newAccrued = round2(((loan as any).accruedInterest || 0) + walletTx.amount);
          batch.update(loanRef, {
            amountRepaid: newAmountRepaid,
            totalInterestPaid: newTotalInterestPaid,
            accruedInterest: newAccrued,
            status: "disbursed",
            completionDate: null,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Legacy combined loan_repayment / interest tx — reverse proportionally
          const newAmountRepaid = Math.max(0, round2(loan.amountRepaid - walletTx.amount));
          const ratio = loan.totalRepayable > 0 ? (loan.totalInterest / loan.totalRepayable) : 0;
          const newInterestRepaid = round2(newAmountRepaid * ratio);
          const newPrincipalRepaid = round2(newAmountRepaid - newInterestRepaid);
          const newBalance = Math.max(0, round2(loan.amount - newPrincipalRepaid));
          batch.update(loanRef, {
            amountRepaid: newAmountRepaid,
            balance: newBalance,
            status: "disbursed",
            completionDate: null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "wallet_transaction",
      entityId: transactionId,
      before: walletTx as unknown as Record<string, unknown>,
      reason,
    });
  } catch (error) {
    logError("deleteWalletTransactionWithRelations", "wallet_transaction", error, { groupId: gId, id: transactionId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loan — cascades to every wallet tx tied to the loan (disbursement,
// interest, principal recovery, overpayment credits)
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteLoanWithRelations(gId: string, loanId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const loanRef = doc(loansCol(gId), loanId);
    const loanSnap = await getDoc(loanRef);
    if (!loanSnap.exists()) throw new Error("Loan not found");
    const loan = fromSnap<Loan>(loanSnap);

    const walletSnap = await getDocs(query(walletCol(gId), where("loanId", "==", loanId)));

    const batch = writeBatch((loanRef as any).firestore);

    batch.delete(loanRef);
    batchRecordDeletion(batch, gId, "loan", loanId, loan as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    walletSnap.docs.forEach((walletDoc) => {
      batch.delete(walletDoc.ref);
      batchRecordDeletion(batch, gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
    });

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "loan",
      entityId: loanId,
      before: loan as unknown as Record<string, unknown>,
      reason: `${reason} (cascaded to ${walletSnap.docs.length} wallet transaction${walletSnap.docs.length !== 1 ? "s" : ""})`,
    });
  } catch (error) {
    logError("deleteLoanWithRelations", "loan", error, { groupId: gId, id: loanId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Meeting — cascades to penalty wallet transactions recorded for attendees
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteMeetingWithRelations(gId: string, meetingId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const meetingRef = doc(meetingsCol(gId), meetingId);
    const meetingSnap = await getDoc(meetingRef);
    if (!meetingSnap.exists()) throw new Error("Meeting not found");
    const meeting = fromSnap<Meeting>(meetingSnap);

    // Find penalty transactions by deterministic ID pattern AND by sourceId match
    const penaltyRefs: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = [];
    for (const attendee of meeting.attendees || []) {
      if (attendee.penaltyAmount && attendee.penaltyAmount > 0) {
        const penaltyTxId = `meeting-penalty-${meetingId}-${attendee.memberId}`;
        const penaltyTxRef = doc(walletCol(gId), penaltyTxId);
        const penaltyTxSnap = await getDoc(penaltyTxRef);
        if (penaltyTxSnap.exists()) {
          penaltyRefs.push({ ref: penaltyTxRef, data: penaltyTxSnap.data() as Record<string, unknown> });
        }
      }
    }
    // Also catch any wallet tx that references this meeting via sourceId, in case
    // the ID convention above ever changes
    const bySourceSnap = await getDocs(query(walletCol(gId), where("sourceId", "==", meetingId)));
    bySourceSnap.docs.forEach((d) => {
      if (!penaltyRefs.some((p) => p.ref.id === d.id)) {
        penaltyRefs.push({ ref: d.ref, data: d.data() as Record<string, unknown> });
      }
    });

    const batch = writeBatch((meetingRef as any).firestore);

    batch.delete(meetingRef);
    batchRecordDeletion(batch, gId, "meeting", meetingId, meeting as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    penaltyRefs.forEach(({ ref, data }) => {
      batch.delete(ref);
      batchRecordDeletion(batch, gId, "wallet_transaction", ref.id, data, reason, userInfo.userId, userInfo.userName);
    });

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "meeting",
      entityId: meetingId,
      before: meeting as unknown as Record<string, unknown>,
      reason: `${reason} (cascaded to ${penaltyRefs.length} penalty transaction${penaltyRefs.length !== 1 ? "s" : ""})`,
    });
  } catch (error) {
    logError("deleteMeetingWithRelations", "meeting", error, { groupId: gId, id: meetingId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expense — cascades to the wallet debit tx it generated
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteExpenseWithRelations(gId: string, expenseId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const expenseRef = doc(expensesCol(gId), expenseId);
    const expenseSnap = await getDoc(expenseRef);
    if (!expenseSnap.exists()) throw new Error("Expense not found");
    const expense = fromSnap<Expense>(expenseSnap);

    // Prefer an explicit sourceId link; fall back to description+type match
    // for legacy expenses created before sourceId tracking existed.
    let walletSnap = await getDocs(query(walletCol(gId), where("sourceId", "==", expenseId)));
    if (walletSnap.empty) {
      walletSnap = await getDocs(
        query(walletCol(gId), where("description", "==", expense.description), where("type", "==", "other_debit"))
      );
    }

    const batch = writeBatch((expenseRef as any).firestore);

    batch.delete(expenseRef);
    batchRecordDeletion(batch, gId, "expense", expenseId, expense as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    walletSnap.docs.forEach((walletDoc) => {
      batch.delete(walletDoc.ref);
      batchRecordDeletion(batch, gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
    });

    await batch.commit();

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "expense",
      entityId: expenseId,
      before: expense as unknown as Record<string, unknown>,
      reason: `${reason} (cascaded to ${walletSnap.docs.length} wallet transaction${walletSnap.docs.length !== 1 ? "s" : ""})`,
    });
  } catch (error) {
    logError("deleteExpenseWithRelations", "expense", error, { groupId: gId, id: expenseId });
    throw error;
  }
}
