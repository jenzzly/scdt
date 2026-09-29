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
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  deletionsCol,
  contribsCol,
  walletCol,
  loansCol,
  investCol,
  meetingsCol,
  expensesCol,
  membersCol,
  getCurrentUserInfo,
  logError,
  fromSnap,
  round2,
  stripUndefined,
  groupDoc,
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

// Compute the exclusive end of the contribution period that starts at
// `periodStartYmd`, mirroring nextPeriod() in utils/lateFees.ts so the
// "does this contribution date fall in this fee's period?" check uses
// the same boundaries the fee was generated under. Returns YYYY-MM-DD.
function contributionPeriodEnd(
  periodStartYmd: string,
  frequency: string,
): string {
  const d = new Date(`${periodStartYmd}T00:00:00Z`);
  const f = String(frequency ?? "monthly").toLowerCase();
  switch (f) {
    case "daily":     d.setUTCDate(d.getUTCDate() + 1); break;
    case "weekly":    d.setUTCDate(d.getUTCDate() + 7); break;
    case "biweekly":  d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly":   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "yearly":
    case "annual":    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:          d.setUTCMonth(d.getUTCMonth() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

// Resolve the member-doc id from either key a contribution might carry.
//
// Legacy contributions were written with memberId = auth uid; newer ones
// with memberId = member-doc id. Contribution late-fee txs are ALWAYS
// keyed by the member-doc id (findOverdueContributions walks members[]
// and reads member.id). So the fee's prefix must be built from the
// canonical doc id, regardless of what the contribution carries.
//
// Returns the doc id when a member matches either key, otherwise the
// input unchanged — preserves the current behavior when there's nothing
// to reconcile against.
async function resolveCanonicalMemberId(
  gId: string,
  rawMemberId: string,
): Promise<string> {
  try {
    const byDocId = await getDoc(doc(membersCol(gId), rawMemberId));
    if (byDocId.exists()) return rawMemberId;

    const byUserIdSnap = await getDocs(
      query(membersCol(gId), where("userId", "==", rawMemberId)),
    );
    if (!byUserIdSnap.empty) return byUserIdSnap.docs[0].id;
  } catch (e) {
    console.warn(
      "[resolveCanonicalMemberId] lookup failed, using raw id:",
      e,
    );
  }
  return rawMemberId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contribution — cascades to:
//   • every wallet tx with contributionId === id
//   • any UNPAID contribution late-fee tx for the same member whose
//     encoded period contains the deleted contribution's date
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteContributionWithRelations(gId: string, contributionId: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const contributionRef = doc(contribsCol(gId), contributionId);
    const contributionSnap = await getDoc(contributionRef);
    if (!contributionSnap.exists()) throw new Error("Contribution not found");
    const contribution = fromSnap<Contribution>(contributionSnap);

    // ── Every wallet tx tied to this contribution ─────────────────
    //
    // Two sources:
    //
    //   1. Direct — txs written with contributionId set (the
    //      "contribution"-type wallet tx recordContribution creates).
    //
    //   2. Contribution late fees — written by
    //      applyContributionLateFee with a deterministic ID of the
    //      form `late-fee-contrib-{memberId}-{periodStart}-d{days}`
    //      and sourceId = memberId. They carry NO contributionId, so
    //      the direct query never returns them; they must be matched
    //      separately by member + period.
    //
    // Only the fee covering the deleted contribution's own period is
    // removed. Fees for other periods stay. Paid fees are left in
    // place — the money was collected and the ledger should say so.
    const directWalletSnap = await getDocs(
      query(walletCol(gId), where("contributionId", "==", contributionId)),
    );

    const groupSnap = await getDoc(groupDoc(gId));
    const groupFrequency = String(
      (groupSnap.exists() ? groupSnap.data()?.contributionFrequency : null) ??
        "monthly",
    );

    const canonicalMemberId = await resolveCanonicalMemberId(
      gId,
      contribution.memberId,
    );
    const memberFeePrefix = `late-fee-contrib-${canonicalMemberId}-`;
    const contributionYmd = String(contribution.date ?? "").slice(0, 10);

    const memberLateFeeSnap = await getDocs(
      query(walletCol(gId), where("sourceId", "==", canonicalMemberId)),
    );

    const matchedLateFeeDocs = memberLateFeeSnap.docs.filter((d) => {
      if (!d.id.startsWith(memberFeePrefix)) return false;

      const data = d.data() as Record<string, unknown>;
      if (data.type !== "late_fee") return false;
      if ((data as any).feePaid === true) return false;

      // Period start is encoded in the ID right after the member
      // prefix: `late-fee-contrib-{memberId}-YYYY-MM-DD-d{N}`.
      const periodStartYmd = d.id.slice(
        memberFeePrefix.length,
        memberFeePrefix.length + 10,
      );
      const periodEndYmd = contributionPeriodEnd(
        periodStartYmd,
        groupFrequency,
      );

      return (
        contributionYmd >= periodStartYmd &&
        contributionYmd < periodEndYmd
      );
    });

    // Dedupe: a late fee should never overlap with the direct query,
    // but Map by id makes that impossible to get wrong.
    const walletDocsById = new Map<string, any>();
    for (const d of directWalletSnap.docs) walletDocsById.set(d.id, d);
    for (const d of matchedLateFeeDocs) walletDocsById.set(d.id, d);
    const allWalletDocs = [...walletDocsById.values()];

    const batch = writeBatch((contributionRef as any).firestore);

    // 1. Delete the contribution itself
    batch.delete(contributionRef);
    batchRecordDeletion(batch, gId, "contribution", contributionId, contribution as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

    // 2. Delete every related wallet transaction (direct + period-matched fees)
    allWalletDocs.forEach((walletDoc) => {
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
      reason: `${reason} (cascaded to ${allWalletDocs.length} wallet transaction${allWalletDocs.length !== 1 ? "s" : ""})`,
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
// ─────────────────────────────────────────────────────────────────────────────
// Wallet transaction — cascades to linked parent entities (loans, contributions,
// investments, meetings, expenses) and all sibling transactions for that entity
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

    // Track deleted tx IDs to avoid duplicate deletion calls in batch
    const deletedTxIds = new Set<string>([transactionId]);

    const loanId = walletTx.loanId || (walletTx.sourceType === "loan" ? walletTx.sourceId : undefined);
    const contributionId = walletTx.contributionId || (walletTx.sourceType === "contribution" ? walletTx.sourceId : undefined);
    const investmentId = walletTx.investmentId || (walletTx.sourceType === "investment" ? walletTx.sourceId : undefined);

    // Collected as the cascade runs; written as separate audit entries
    // after batch.commit() so reverting each restores each.
    const cascadeAuditEntries: Array<{
      entityType: string;
      entityId: string;
      before: Record<string, unknown>;
      // Defaults to "deleted" at write time. The loan-counter rollback
      // below uses "updated" because the loan doc itself survives — its
      // counters just change.
      action?: string;
    }> = [];

    // ── Cascade: if this tx is tied to a loan ──────────────────────
    //
    // Only the loan DISBURSEMENT tx is the loan's origin event —
    // deleting it cascades to the loan document and every one of the
    // loan's transactions. Every other loan-linked tx (a repayment
    // leg, interest, principal, or loan late fee) is a downstream
    // event: deleting it removes only the tx itself plus any sibling
    // leg written in the same Firestore batch, and leaves the loan
    // intact.
    //
    // The previous version cascaded unconditionally, so deleting a
    // single repayment wiped the whole loan — which made reverting
    // awkward, since the audit trail only recorded the wallet-tx
    // deletion and had no loan entry to restore from.
    if (loanId) {
      const isLoanDisbursement = walletTx.type === "loan_disbursement";

      if (isLoanDisbursement) {
        const loanRef = doc(loansCol(gId), loanId);
        const loanSnap = await getDoc(loanRef);
        if (loanSnap.exists()) {
          const loan = fromSnap<Loan>(loanSnap);
          batch.delete(loanRef);
          batchRecordDeletion(batch, gId, "loan", loanId, loan as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
          cascadeAuditEntries.push({
            entityType: "loan",
            entityId: loanId,
            before: loan as unknown as Record<string, unknown>,
          });
        }

        // Find and delete all wallet transactions tied to this loan
        const [byLoanIdSnap, bySourceSnap] = await Promise.all([
          getDocs(query(walletCol(gId), where("loanId", "==", loanId))),
          getDocs(query(walletCol(gId), where("sourceId", "==", loanId))),
        ]);

        const allLoanTxDocs = [...byLoanIdSnap.docs, ...bySourceSnap.docs];
        for (const d of allLoanTxDocs) {
          if (!deletedTxIds.has(d.id)) {
            deletedTxIds.add(d.id);
            batch.delete(d.ref);
            batchRecordDeletion(batch, gId, "wallet_transaction", d.id, d.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
            cascadeAuditEntries.push({
              entityType: "wallet_transaction",
              entityId: d.id,
              before: d.data() as Record<string, unknown>,
            });
          }
        }
      } else {
        // Repayment / interest / principal / loan late fee. The loan
        // doc stays. Two things happen here:
        //
        //   1. Sibling legs written in the same Firestore batch (e.g.
        //      the interest leg paired with a principal leg) are
        //      collected for deletion alongside this tx.
        //
        //   2. If the tx is a repayment-type event, the loan's
        //      counters are rolled back so they no longer reflect the
        //      repayment(s) being removed.
        const siblingSnap = await getDocs(
          query(walletCol(gId), where("loanId", "==", loanId)),
        );

        const myCreatedAt = String((walletTx as any).createdAt ?? "");
        const myKey = myCreatedAt ? myCreatedAt.slice(0, 19) : "";
        const myDate = (walletTx as any).date;

        // Collect siblings first so the rollback can exclude them from
        // the surviving-tx computation. Nothing is applied to the
        // batch until after the rollback math runs.
        const siblingDeletes: Array<{
          id: string;
          ref: any;
          data: Record<string, unknown>;
        }> = [];

        for (const d of siblingSnap.docs) {
          if (d.id === transactionId) continue;
          if (deletedTxIds.has(d.id)) continue;

          const sibData = d.data() as Record<string, unknown>;
          const sibCreatedAt = String((sibData as any).createdAt ?? "");
          const sibKey = sibCreatedAt ? sibCreatedAt.slice(0, 19) : "";
          const sibDate = (sibData as any).date;

          const samePaymentEvent =
            (myKey && sibKey && myKey === sibKey) ||
            (!myKey &&
              !sibKey &&
              myDate &&
              sibDate === myDate &&
              ["loan_interest_income", "loan_principal_recovery", "loan_repayment"].includes(
                String((sibData as any).type),
              ));

          if (samePaymentEvent) {
            siblingDeletes.push({ id: d.id, ref: d.ref, data: sibData });
          }
        }

        // ── Roll back the loan's repayment counters ──────────────
        //
        // amountRepaid / totalInterestPaid / balance / schedule[].paid
        // are recomputed from the SURVIVING repayment txs (every
        // repayment-type tx with this loanId that is not being
        // deleted). Legacy combined `loan_repayment` txs are prorated
        // by the loan's interest-to-repayable ratio — same rule
        // recordRepaymentServer applies when writing them.
        //
        // Late-fee deletions skip this block: they don't touch any of
        // the loan's repayment counters.
        const isRepaymentTx = [
          "loan_interest_income",
          "loan_principal_recovery",
          "loan_repayment",
        ].includes(walletTx.type);

        if (isRepaymentTx) {
          const loanRef = doc(loansCol(gId), loanId);
          const loanSnap = await getDoc(loanRef);

          if (loanSnap.exists()) {
            const loan = fromSnap<Loan>(loanSnap);

            const deleting = new Set<string>([
              transactionId,
              ...siblingDeletes.map((s) => s.id),
            ]);

            const ratio =
              loan.totalRepayable > 0
                ? loan.totalInterest / loan.totalRepayable
                : 0;

            let newInterestPaid = 0;
            let newPrincipalPaid = 0;

            for (const d of siblingSnap.docs) {
              if (deleting.has(d.id)) continue;
              const t = d.data() as any;
              const amt = Number(t.amount) || 0;

              if (t.type === "loan_interest_income") {
                newInterestPaid += amt;
              } else if (t.type === "loan_principal_recovery") {
                newPrincipalPaid += amt;
              } else if (t.type === "loan_repayment") {
                const interestPart = round2(amt * ratio);
                newInterestPaid += interestPart;
                newPrincipalPaid += amt - interestPart;
              }
            }

            newInterestPaid = round2(newInterestPaid);
            newPrincipalPaid = round2(newPrincipalPaid);
            const newAmountRepaid = round2(
              newInterestPaid + newPrincipalPaid,
            );
            const newBalance = round2(
              Math.max(0, (loan.amount || 0) - newPrincipalPaid),
            );

            // Un-mark any installment whose cumulative total is no
            // longer covered by the reduced amountRepaid. Only
            // un-marking is possible here — a deletion can only
            // reduce amountRepaid, never increase it.
            let cumulative = 0;
            const newSchedule = (loan.schedule || []).map((item) => {
              cumulative = round2(cumulative + (item.total || 0));
              const isCovered = newAmountRepaid + 0.01 >= cumulative;
              if (item.paid && !isCovered) {
                return { ...item, paid: false, paidDate: undefined };
              }
              return item;
            });

            const previousStatus = loan.status;
            const newStatus =
              newBalance <= 0 && newAmountRepaid > 0
                ? "repaid"
                : previousStatus === "repaid"
                  ? "disbursed"
                  : previousStatus;

            const loanUpdate = stripUndefined({
              amountRepaid: newAmountRepaid,
              totalInterestPaid: newInterestPaid,
              balance: newBalance,
              schedule: newSchedule,
              status: newStatus,
              completionDate:
                newStatus === "repaid"
                  ? (loan as any).completionDate
                  : undefined,
              updatedAt: new Date().toISOString(),
            });

            batch.update(loanRef, loanUpdate);

            // Audit entry with action "updated" — the loan survives
            // the transaction; only its counters change. Reverting
            // restores the pre-rollback state via revertAuditLog's
            // default (non-delete) branch.
            cascadeAuditEntries.push({
              entityType: "loan",
              entityId: loanId,
              before: loan as unknown as Record<string, unknown>,
              action: "updated",
            });
          }
        }

        // Apply sibling deletions to the batch.
        for (const sib of siblingDeletes) {
          deletedTxIds.add(sib.id);
          batch.delete(sib.ref);
          batchRecordDeletion(
            batch,
            gId,
            "wallet_transaction",
            sib.id,
            sib.data,
            reason,
            userInfo.userId,
            userInfo.userName,
          );
          cascadeAuditEntries.push({
            entityType: "wallet_transaction",
            entityId: sib.id,
            before: sib.data,
          });
        }
      }
    }

    // ── Cascade: if this tx is tied to a contribution, delete it, sibling txs, and recompute savings ──
    if (contributionId) {
      const contributionRef = doc(contribsCol(gId), contributionId);
      const contributionSnap = await getDoc(contributionRef);
      if (contributionSnap.exists()) {
        const contribution = fromSnap<Contribution>(contributionSnap);
        batch.delete(contributionRef);
        batchRecordDeletion(batch, gId, "contribution", contributionId, contribution as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

        const remainingContributions = await getDocs(
          query(contribsCol(gId), where("memberId", "==", contribution.memberId), where("status", "==", "approved"))
        );
        const totalAmount = round2(
          remainingContributions.docs.reduce((sum, d) => {
            if (d.id === contributionId) return sum;
            return sum + (d.data().amount || 0);
          }, 0)
        );
        batch.update(doc(membersCol(gId), contribution.memberId), {
          totalContributions: totalAmount,
          totalSavings: totalAmount,
          updatedAt: new Date().toISOString(),
        });
      }

      // Delete any sibling transactions linked to this contribution
      const [byContribIdSnap, bySourceSnap] = await Promise.all([
        getDocs(query(walletCol(gId), where("contributionId", "==", contributionId))),
        getDocs(query(walletCol(gId), where("sourceId", "==", contributionId))),
      ]);

      const allContribTxDocs = [...byContribIdSnap.docs, ...bySourceSnap.docs];
      for (const d of allContribTxDocs) {
        if (!deletedTxIds.has(d.id)) {
          deletedTxIds.add(d.id);
          batch.delete(d.ref);
          batchRecordDeletion(batch, gId, "wallet_transaction", d.id, d.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
        }
      }
    }

    // ── Cascade: if this tx is tied to an investment, delete the investment and all its transactions ──
    if (investmentId) {
      const investRef = doc(investCol(gId), investmentId);
      const investSnap = await getDoc(investRef);
      if (investSnap.exists()) {
        const investment = fromSnap<Investment>(investSnap);
        batch.delete(investRef);
        batchRecordDeletion(batch, gId, "investment", investmentId, investment as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
      }

      const [byInvestIdSnap, bySourceSnap] = await Promise.all([
        getDocs(query(walletCol(gId), where("investmentId", "==", investmentId))),
        getDocs(query(walletCol(gId), where("sourceId", "==", investmentId))),
      ]);

      const allInvestTxDocs = [...byInvestIdSnap.docs, ...bySourceSnap.docs];
      for (const d of allInvestTxDocs) {
        if (!deletedTxIds.has(d.id)) {
          deletedTxIds.add(d.id);
          batch.delete(d.ref);
          batchRecordDeletion(batch, gId, "wallet_transaction", d.id, d.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
        }
      }
    }

    // ── Cascade: if this tx is a meeting fee/penalty, clear the attendee penalty on the meeting ──
    let meetingId: string | undefined;
    let meetingMemberId = walletTx.memberId;
    if (walletTx.id.startsWith("meeting-penalty-")) {
      const parts = walletTx.id.split("-");
      meetingId = parts[2];
      if (parts[3]) meetingMemberId = parts[3];
    } else if (walletTx.sourceId && walletTx.type === "late_fee") {
      meetingId = walletTx.sourceId;
    }

    if (meetingId) {
      const meetingRef = doc(meetingsCol(gId), meetingId);
      const meetingSnap = await getDoc(meetingRef);
      if (meetingSnap.exists()) {
        const meeting = fromSnap<Meeting>(meetingSnap);
        const updatedAttendees = (meeting.attendees || []).map((att) => {
          if (att.memberId === meetingMemberId) {
            return { ...att, penaltyAmount: 0, penaltyPaid: false };
          }
          return att;
        });
        batch.update(meetingRef, {
          attendees: updatedAttendees,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // ── Cascade: if this tx is linked to an expense, delete the expense ──
    if (walletTx.sourceId && !loanId && !contributionId && !investmentId && !meetingId) {
      const expenseRef = doc(expensesCol(gId), walletTx.sourceId);
      const expenseSnap = await getDoc(expenseRef);
      if (expenseSnap.exists()) {
        const expense = fromSnap<Expense>(expenseSnap);
        batch.delete(expenseRef);
        batchRecordDeletion(batch, gId, "expense", walletTx.sourceId, expense as unknown as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);

        const otherSnap = await getDocs(query(walletCol(gId), where("sourceId", "==", walletTx.sourceId)));
        for (const d of otherSnap.docs) {
          if (!deletedTxIds.has(d.id)) {
            deletedTxIds.add(d.id);
            batch.delete(d.ref);
            batchRecordDeletion(batch, gId, "wallet_transaction", d.id, d.data() as Record<string, unknown>, reason, userInfo.userId, userInfo.userName);
          }
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

    // One audit entry per cascade-deleted entity. Without these, a
    // revert of the top-level tx left the cascade-deleted loan (or
    // sibling repayment leg) gone — the exact partial-revert behavior
    // this migration fixes.
    for (const entry of cascadeAuditEntries) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: entry.action ?? "deleted",
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before,
        reason: `${reason} (cascade)`,
      });
    }
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
