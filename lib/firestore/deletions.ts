// lib/firestore/deletions.ts
//
// Deletion-history bookkeeping plus the cascade-delete helpers that remove
// an entity and any records derived from it (e.g. deleting a contribution
// also removes the wallet transaction it generated).
import {
  doc, getDoc, getDocs, deleteDoc, setDoc, updateDoc, query, where, orderBy, onSnapshot,
  deletionsCol, contribsCol, walletCol, loansCol, meetingsCol, expensesCol, membersCol,
  getCurrentUserInfo, logError, fromSnap, round2,
} from "./core";
import type { DeletionRecord, Contribution, WalletTransaction, Loan, Meeting, Expense } from "./core";
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

    const deletionRecord: DeletionRecord = {
      id: dRef.id,
      groupId: gId,
      entityType,
      entityId,
      entityData,
      deletedBy: userInfo.userId,
      deletedByName: userInfo.userName,
      deletedAt: now,
      reason,
    };

    await setDoc(dRef, deletionRecord);
  } catch (error) {
    logError("recordDeletion", "deletion_record", error, { groupId: gId, entityType, entityId });
    throw error;
  }
}

export async function getDeletionHistory(gId: string): Promise<DeletionRecord[]> {
  try {
    const snap = await getDocs(
      query(deletionsCol(gId), orderBy("deletedAt", "desc")),
    );
    return snap.docs.map((s) => fromSnap<DeletionRecord>(s));
  } catch (error) {
    logError("getDeletionHistory", "deletion_records", error, { groupId: gId });
    return [];
  }
}

export function subscribeDeletionHistory(
  gId: string,
  cb: (records: DeletionRecord[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(deletionsCol(gId), orderBy("deletedAt", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<DeletionRecord>(s))),
    onError,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade Delete Functions
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteContributionWithRelations(gId: string, contributionId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const contributionRef = doc(contribsCol(gId), contributionId);
    const contributionSnap = await getDoc(contributionRef);
    if (!contributionSnap.exists()) throw new Error("Contribution not found");
    const contribution = fromSnap<Contribution>(contributionSnap);

    const walletQuery = query(walletCol(gId), where("contributionId", "==", contributionId));
    const walletSnap = await getDocs(walletQuery);
    
    await recordDeletion(gId, "contribution", contributionId, contribution as unknown as Record<string, unknown>, reason);
    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "contribution",
      entityId: contributionId,
      before: contribution as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(contributionRef);
    
    for (const walletDoc of walletSnap.docs) {
      await deleteDoc(walletDoc.ref);
      await recordDeletion(gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason);
    }
    
    const memberId = contribution.memberId;
    const remainingContributions = await getDocs(
      query(contribsCol(gId), where("memberId", "==", memberId), where("status", "==", "approved"))
    );
    
    const totalAmount = remainingContributions.docs.reduce((sum, doc) => {
      const data = doc.data();
      return sum + (data.amount || 0);
    }, 0);
    
    await updateDoc(doc(membersCol(gId), memberId), {
      totalContributions: totalAmount,
      totalSavings: totalAmount,
      updatedAt: new Date().toISOString(),
    });
    
  } catch (error) {
    logError("deleteContributionWithRelations", "contribution", error, { groupId: gId, id: contributionId });
    throw error;
  }
}

export async function deleteWalletTransactionWithRelations(gId: string, transactionId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const walletRef = doc(walletCol(gId), transactionId);
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) throw new Error("Wallet transaction not found");
    const walletTx = fromSnap<WalletTransaction>(walletSnap);

    await recordDeletion(gId, "wallet_transaction", transactionId, walletTx as unknown as Record<string, unknown>, reason);
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

    await deleteDoc(walletRef);

    if (walletTx.contributionId) {
      const contributionRef = doc(contribsCol(gId), walletTx.contributionId);
      const contributionSnap = await getDoc(contributionRef);
      if (contributionSnap.exists()) {
        const contribution = fromSnap<Contribution>(contributionSnap);
        await recordDeletion(gId, "contribution", walletTx.contributionId, contribution as unknown as Record<string, unknown>, reason);
        await deleteDoc(contributionRef);
        
        const remainingContributions = await getDocs(
          query(contribsCol(gId), where("memberId", "==", contribution.memberId), where("status", "==", "approved"))
        );
        const totalAmount = remainingContributions.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
        await updateDoc(doc(membersCol(gId), contribution.memberId), {
          totalContributions: totalAmount,
          totalSavings: totalAmount,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    
    if (walletTx.loanId && (walletTx.type === "loan_repayment" || walletTx.type === "interest")) {
      const loanRef = doc(loansCol(gId), walletTx.loanId);
      const loanSnap = await getDoc(loanRef);
      if (loanSnap.exists()) {
        const loan = fromSnap<Loan>(loanSnap);
        const newAmountRepaid = Math.max(0, loan.amountRepaid - walletTx.amount);
        
        const ratio = loan.totalRepayable > 0 ? (loan.totalInterest / loan.totalRepayable) : 0;
        const newInterestRepaid = round2(newAmountRepaid * ratio);
        const newPrincipalRepaid = newAmountRepaid - newInterestRepaid;
        const newBalance = Math.max(0, round2(loan.amount - newPrincipalRepaid));
        const newStatus = newBalance === 0 || newAmountRepaid >= loan.totalRepayable ? "repaid" : "disbursed";
        
        const updates: any = {
          amountRepaid: newAmountRepaid,
          balance: newBalance,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
        if (newStatus === "repaid") {
          updates.completionDate = loan.completionDate || new Date().toISOString();
        } else {
          updates.completionDate = null;
        }
        await updateDoc(loanRef, updates);
      }
    }
    
  } catch (error) {
    logError("deleteWalletTransactionWithRelations", "wallet_transaction", error, { groupId: gId, id: transactionId });
    throw error;
  }
}

export async function deleteLoanWithRelations(gId: string, loanId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const loanRef = doc(loansCol(gId), loanId);
    const loanSnap = await getDoc(loanRef);
    if (!loanSnap.exists()) throw new Error("Loan not found");
    const loan = fromSnap<Loan>(loanSnap);

    const walletQuery = query(walletCol(gId), where("loanId", "==", loanId));
    const walletSnap = await getDocs(walletQuery);
    
    await recordDeletion(gId, "loan", loanId, loan as unknown as Record<string, unknown>, reason);
    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "loan",
      entityId: loanId,
      before: loan as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(loanRef);
    
    for (const walletDoc of walletSnap.docs) {
      await deleteDoc(walletDoc.ref);
      await recordDeletion(gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason);
    }
    
  } catch (error) {
    logError("deleteLoanWithRelations", "loan", error, { groupId: gId, id: loanId });
    throw error;
  }
}

export async function deleteMeetingWithRelations(gId: string, meetingId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const meetingRef = doc(meetingsCol(gId), meetingId);
    const meetingSnap = await getDoc(meetingRef);
    if (!meetingSnap.exists()) throw new Error("Meeting not found");
    const meeting = fromSnap<Meeting>(meetingSnap);

    const penaltyTransactions = [];
    for (const attendee of meeting.attendees) {
      if (attendee.penaltyAmount && attendee.penaltyAmount > 0) {
        const penaltyTxId = `meeting-penalty-${meetingId}-${attendee.memberId}`;
        const penaltyTxRef = doc(walletCol(gId), penaltyTxId);
        const penaltyTxSnap = await getDoc(penaltyTxRef);
        if (penaltyTxSnap.exists()) {
          penaltyTransactions.push(penaltyTxRef);
        }
      }
    }
    
    await recordDeletion(gId, "meeting", meetingId, meeting as unknown as Record<string, unknown>, reason);
    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "meeting",
      entityId: meetingId,
      before: meeting as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(meetingRef);
    
    for (const penaltyRef of penaltyTransactions) {
      await deleteDoc(penaltyRef);
      await recordDeletion(gId, "wallet_transaction", penaltyRef.id, {}, reason);
    }
    
  } catch (error) {
    logError("deleteMeetingWithRelations", "meeting", error, { groupId: gId, id: meetingId });
    throw error;
  }
}

export async function deleteExpenseWithRelations(gId: string, expenseId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const expenseRef = doc(expensesCol(gId), expenseId);
    const expenseSnap = await getDoc(expenseRef);
    if (!expenseSnap.exists()) throw new Error("Expense not found");
    const expense = fromSnap<Expense>(expenseSnap);

    const walletQuery = query(
      walletCol(gId),
      where("description", "==", expense.description),
      where("type", "==", "other_debit")
    );
    const walletSnap = await getDocs(walletQuery);
    
    await recordDeletion(gId, "expense", expenseId, expense as unknown as Record<string, unknown>, reason);
    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "expense",
      entityId: expenseId,
      before: expense as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(expenseRef);
    
    for (const walletDoc of walletSnap.docs) {
      await deleteDoc(walletDoc.ref);
      await recordDeletion(gId, "wallet_transaction", walletDoc.id, walletDoc.data() as Record<string, unknown>, reason);
    }
    
  } catch (error) {
    logError("deleteExpenseWithRelations", "expense", error, { groupId: gId, id: expenseId });
    throw error;
  }
}