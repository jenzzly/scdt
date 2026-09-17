// stores/slices/walletSlice.ts
//
// ═══════════════════════════════════════════════════════════════════════
// FIXED: "can't save changes on edit wallet transactions"
// ═══════════════════════════════════════════════════════════════════════
//
// Root cause: this file imported `FS` from "../../lib/firestore/core":
//
//   import * as FS from "../../lib/firestore/core";
//
// core.ts only exports shared Firestore primitives (doc, getDoc,
// walletCol, loansCol, getCurrentUserInfo, stripUndefined, fromSnap,
// round2, etc) — it does NOT export addWalletTx, updateWalletTx,
// updateLoan, or projectAccruedInterest. Those live in
// lib/firestore/wallet.ts and lib/firestore/loans.ts respectively, and
// are re-exported together through the barrel file
// "../../lib/firestore" (which is what every OTHER slice — loanSlice.ts,
// contributionSlice.ts — already imports `FS` from).
//
// So every `FS.addWalletTx(...)`, `FS.updateWalletTx(...)`,
// `FS.updateLoan(...)`, and `FS.projectAccruedInterest(...)` call in this
// file was calling `undefined(...)` at runtime — a TypeError thrown the
// moment any save ran, which is exactly what "not able to save changes"
// looks like from the UI (the try/catch below rolls back the optimistic
// update and calls setSyncStatus("failed", ...), so it likely just
// looked like a generic failed-save toast).
//
// FIX: import FS from the barrel, same as every other slice.
//
// ═══════════════════════════════════════════════════════════════════════
// REUSABILITY: consolidated onto utils/linkedWalletSync.ts
// ═══════════════════════════════════════════════════════════════════════
//
// The previous version of updateWalletTransaction below implemented the
// "sync the linked parent record" logic inline, separately, for loans,
// contributions, investments, and meetings — including a second,
// independent copy of the reducing-balance accrued-interest math that
// could drift from lib/firestore/loans.ts's own projectAccruedInterest.
// That logic now lives once, in utils/linkedWalletSync.ts
// (buildLoanPatchFromWalletEdit / buildContributionPatchFromWalletEdit /
// buildInvestmentPatchFromWalletEdit / identifyLinkedParent), shared with
// the reverse-direction sync (updateLoanAndSync, updateContributionAndSync,
// updateInvestmentAndSync in their own slices) so there's exactly one
// place that knows "a wallet tx's amount maps to a loan's amount, a
// contribution's amount, or an investment's investmentAmount" and one
// place that knows how loan accrual re-anchoring actually works.

import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type {
  ID,
  WalletTransaction,
  Contribution,
  Loan,
  Investment,
  Meeting,
  Member,
} from "../../types";
import * as FS from "../../lib/firestore";
import { updateMeeting as FSUpdateMeeting } from "../../lib/firestore/meetings";
import { recalcGroupTotals } from "../recalcGroupTotals";
import { round2 } from "../../utils/theme";
import {
  identifyLinkedParent,
  buildLoanPatchFromWalletEdit,
  buildContributionPatchFromWalletEdit,
  buildInvestmentPatchFromWalletEdit,
} from "../../utils/linkedWalletSync";
import type {
  OverdueContribution,
  OverdueInstallment,
} from "../../utils/lateFees";

export const createWalletSlice = (
  set: SetFn,
  get: GetFn
): Pick<
  StoreState,
  | "addWalletTxLocal"
  | "applyContributionLateFee"
  | "applyLoanLateFee"
  | "clearStandaloneLateFee"
  | "deleteWalletTransaction"
  | "deleteWalletTx"
  | "deleteWalletTxLocal"
  | "clearWalletTxs"
  | "setWalletTxs"
  | "updateWalletTxLocal"
  | "updateWalletTransaction"
> => ({
  // ===========================================================================
  // FIRESTORE WALLET SNAPSHOT
  // ===========================================================================

  setWalletTxs: (txs) =>
    set((s: StoreState) => {
      const sorted = [...txs].sort(
        (a, b) =>
          new Date(b.createdAt ?? b.date).getTime() -
          new Date(a.createdAt ?? a.date).getTime()
      );

      return {
        walletTransactions: sorted,
        ...recalcGroupTotals({
          ...s,
          walletTransactions: sorted,
        }),
      };
    }),

  // ===========================================================================
  // CLEAR ALL WALLET STATE
  // ===========================================================================

  clearWalletTxs: () =>
    set((s: StoreState) => ({
      walletTransactions: [],
      ...recalcGroupTotals({
        ...s,
        walletTransactions: [],
      }),
    })),

  // ===========================================================================
  // OPTIMISTIC ADD
  // ===========================================================================

  addWalletTxLocal: (tx) =>
    set((s: StoreState) => {
      if (s.walletTransactions.some((t) => t.id === tx.id)) {
        return s;
      }

      const newTxs = [tx, ...s.walletTransactions];

      const updates = recalcGroupTotals({
        ...s,
        walletTransactions: newTxs,
      });

      return {
        walletTransactions: newTxs,
        ...updates,
      };
    }),

  // ===========================================================================
  // OPTIMISTIC UPDATE
  // ===========================================================================

  updateWalletTxLocal: (id, data) =>
    set((s: StoreState) => {
      const updatedTxs = s.walletTransactions.map(
        (t: WalletTransaction) =>
          t.id === id
            ? {
                ...t,
                ...data,
              }
            : t
      );

      const updates = recalcGroupTotals({
        ...s,
        walletTransactions: updatedTxs,
      });

      return {
        walletTransactions: updatedTxs,
        ...updates,
      };
    }),

  // ===========================================================================
  // UPDATE WALLET TRANSACTION
  // ===========================================================================
  //
  // High-level Firestore update.
  //
  // Flow:
  // 1. Validate group and transaction.
  // 2. Identify which parent record (loan/contribution/investment/meeting),
  //    if any, this transaction is linked to, using the shared
  //    identifyLinkedParent() helper (utils/linkedWalletSync.ts) — same
  //    detection logic the reverse-direction sync actions rely on.
  // 3. Save previous state for rollback (tx + linked parent).
  // 4. Sanitize immutable fields.
  // 5. Build the linked-parent patch via the shared builder functions —
  //    NOT inline logic — so loan/contribution/investment share exactly
  //    one implementation with updateLoanAndSync / updateContributionAndSync
  //    / updateInvestmentAndSync.
  // 6. Optimistically update Zustand (tx + parent).
  // 7. Recalculate totals.
  // 8. Update Firestore (tx + parent, via the correctly-imported FS barrel).
  // 9. Mark sync as synced.
  // 10. Roll back everything if Firestore fails.
  //
  // Meeting-penalty sync is handled separately below (kept inline,
  // narrowly) since meetings aren't part of the shared parent-sync
  // triad (loan/contribution/investment) the other slices use — a
  // meeting "penalty" isn't a whole linked record the way a
  // contribution/investment/loan is, just one attendee's field inside
  // a larger document.

  updateWalletTransaction: async (
    transactionId: ID,
    data: Partial<WalletTransaction>,
    reason?: string
  ) => {
    const {
      activeGroupId,
      walletTransactions,
      loans,
      contributions,
      investments,
      meetings,
    } = get();

    if (!activeGroupId) {
      throw new Error("No active group");
    }

    const existingTx = walletTransactions.find(
      (t: WalletTransaction) =>
        t.id === transactionId
    );

    if (!existingTx) {
      throw new Error("Transaction not found");
    }

    // -------------------------------------------------------------------------
    // Keep immutable/system fields under application control.
    //
    // These should never be changed by an edit form.
    // -------------------------------------------------------------------------

    const {
      id: _id,
      groupId: _groupId,
      createdAt: _createdAt,
      createdBy: _createdBy,
      ...editableData
    } = data;

    // Avoid unused-variable warnings while making the intention explicit.
    void _id;
    void _groupId;
    void _createdAt;
    void _createdBy;

    // -------------------------------------------------------------------------
    // Normalize numeric values.
    //
    // Amounts should remain consistently rounded.
    // -------------------------------------------------------------------------

    const sanitizedData: Partial<WalletTransaction> = {
      ...editableData,
    };

    if (
      sanitizedData.amount !== undefined &&
      typeof sanitizedData.amount === "number"
    ) {
      sanitizedData.amount = round2(
        sanitizedData.amount
      );
    }

    // -------------------------------------------------------------------------
    // Identify linked parent record (shared logic).
    // -------------------------------------------------------------------------

    const { kind: linkedKind, id: linkedId } = identifyLinkedParent(existingTx);

    const linkedLoan =
      linkedKind === "loan" ? loans.find((l: Loan) => l.id === linkedId) : null;
    const linkedContribution =
      linkedKind === "contribution"
        ? contributions.find((c) => c.id === linkedId)
        : null;
    const linkedInvestment =
      linkedKind === "investment"
        ? investments?.find((i) => i.id === linkedId)
        : null;

    const isMeetingPenalty = existingTx.id.startsWith("meeting-penalty-");
    let linkedMeeting: Meeting | null = null;
    let meetingMemberId: string | undefined;
    if (isMeetingPenalty) {
      const parts = existingTx.id.split("-");
      const meetingId = parts[2];
      meetingMemberId = parts[3] || existingTx.memberId;
      linkedMeeting = meetings?.find((m) => m.id === meetingId) ?? null;
    }

    // -------------------------------------------------------------------------
    // Save previous state for rollback.
    // -------------------------------------------------------------------------

    const previousTx = { ...existingTx };
    const previousLoan = linkedLoan ? { ...linkedLoan } : null;
    const previousContribution = linkedContribution ? { ...linkedContribution } : null;
    const previousInvestment = linkedInvestment ? { ...linkedInvestment } : null;
    const previousMeeting = linkedMeeting ? { ...linkedMeeting } : null;

    // -------------------------------------------------------------------------
    // Build linked-parent patches via the SHARED helpers — same functions
    // updateLoanAndSync / updateContributionAndSync / updateInvestmentAndSync
    // use in the other direction, so the field-mapping rules and the loan
    // accrued-interest re-anchoring logic live in exactly one place
    // (utils/linkedWalletSync.ts).
    // -------------------------------------------------------------------------

    const walletEditChanged = {
      description: sanitizedData.description,
      amount: sanitizedData.amount,
      date: sanitizedData.date,
    };

    let loanPatch: Partial<Loan> | null = null;
    let contributionPatch: Partial<Contribution> | null = null;
    let investmentPatch: Partial<Investment> | null = null;
    let meetingPatch: Partial<Meeting> | null = null;

    if (linkedLoan && (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)) {
      loanPatch = buildLoanPatchFromWalletEdit(linkedLoan, walletEditChanged);
      if (Object.keys(loanPatch).length === 0) loanPatch = null;
    }

    if (linkedContribution && (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)) {
      contributionPatch = buildContributionPatchFromWalletEdit(walletEditChanged);
      if (Object.keys(contributionPatch).length === 0) contributionPatch = null;
    }

    if (linkedInvestment && (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)) {
      investmentPatch = buildInvestmentPatchFromWalletEdit(walletEditChanged);
      if (Object.keys(investmentPatch).length === 0) investmentPatch = null;
    }

    if (linkedMeeting && meetingMemberId && sanitizedData.amount !== undefined) {
      const updatedAttendees = (linkedMeeting.attendees || []).map((att: any) =>
        att.memberId === meetingMemberId
          ? { ...att, penaltyAmount: Math.abs(sanitizedData.amount!) }
          : att
      );
      meetingPatch = { attendees: updatedAttendees } as Partial<Meeting>;
    }

    // -------------------------------------------------------------------------
    // Optimistic update — tx + linked parent(s), all locally first.
    // -------------------------------------------------------------------------

    get().updateWalletTxLocal(transactionId, sanitizedData);

    if (linkedLoan && loanPatch) {
      set((s: StoreState) => ({
        loans: s.loans.map((l: Loan) =>
          l.id === linkedLoan.id ? { ...l, ...loanPatch } : l
        ),
      }));
    }
    if (linkedContribution && contributionPatch) {
      set((s: StoreState) => ({
        contributions: s.contributions.map((c) =>
          c.id === linkedContribution.id ? { ...c, ...contributionPatch } : c
        ),
      }));
    }
    if (linkedInvestment && investmentPatch) {
      set((s: StoreState) => ({
        investments: (s.investments ?? []).map((i) =>
          i.id === linkedInvestment.id ? { ...i, ...investmentPatch } : i
        ),
      }));
    }
    if (linkedMeeting && meetingPatch) {
      set((s: StoreState) => ({
        meetings: (s.meetings ?? []).map((m) =>
          m.id === linkedMeeting.id ? { ...m, ...meetingPatch } : m
        ),
      }));
    }

    set((s: StoreState) => recalcGroupTotals(s));

    try {
      get().setSyncStatus("pending");

      // -----------------------------------------------------------------------
      // Firestore update — FS now correctly resolves to the barrel
      // (../../lib/firestore), which re-exports addWalletTx, updateWalletTx,
      // updateLoan, and everything else used below. This is the actual fix
      // for "not able to save changes."
      // -----------------------------------------------------------------------

      await FS.updateWalletTx(
        activeGroupId,
        transactionId,
        sanitizedData
      );

      if (linkedLoan && loanPatch) {
        await FS.updateLoan(activeGroupId, linkedLoan.id, loanPatch);
      }
      if (linkedContribution && contributionPatch) {
        await FS.updateContribution(activeGroupId, linkedContribution.id, contributionPatch);
      }
      if (linkedInvestment && investmentPatch) {
        await FS.updateInvestment(activeGroupId, linkedInvestment.id, investmentPatch);
      }
      if (linkedMeeting && meetingPatch) {
        await FSUpdateMeeting(activeGroupId, linkedMeeting.id, meetingPatch);
      }

      get().recalcTotals();
      get().setSyncStatus("synced");
    } catch (e) {
      // -----------------------------------------------------------------------
      // Rollback optimistic update.
      // -----------------------------------------------------------------------

      get().updateWalletTxLocal(transactionId, previousTx);

      if (linkedLoan && previousLoan) {
        set((s: StoreState) => ({
          loans: s.loans.map((l: Loan) =>
            l.id === linkedLoan.id ? (previousLoan as Loan) : l
          ),
        }));
      }
      if (linkedContribution && previousContribution) {
        set((s: StoreState) => ({
          contributions: s.contributions.map((c) =>
            c.id === linkedContribution.id ? (previousContribution as Contribution) : c
          ),
        }));
      }
      if (linkedInvestment && previousInvestment) {
        set((s: StoreState) => ({
          investments: (s.investments ?? []).map((i) =>
            i.id === linkedInvestment.id ? (previousInvestment as Investment) : i
          ),
        }));
      }
      if (linkedMeeting && previousMeeting) {
        set((s: StoreState) => ({
          meetings: (s.meetings ?? []).map((m) =>
            m.id === linkedMeeting.id ? (previousMeeting as Meeting) : m
          ),
        }));
      }

      get().recalcTotals();

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to update transaction"
      );

      throw e;
    }
  },

  // ===========================================================================
  // OPTIMISTIC DELETE
  // ===========================================================================

  deleteWalletTxLocal: (id) =>
    set((s: StoreState) => {
      const remainingTxs =
        s.walletTransactions.filter(
          (t: WalletTransaction) =>
            t.id !== id
        );

      const updates = recalcGroupTotals({
        ...s,
        walletTransactions: remainingTxs,
      });

      return {
        walletTransactions: remainingTxs,
        ...updates,
      };
    }),

  // ===========================================================================
  // DELETE WALLET TRANSACTION
  // ===========================================================================

  deleteWalletTransaction: async (
    transactionId: ID,
    reason: string
  ) => {
    const {
      activeGroupId,
      walletTransactions,
      contributions,
      loans,
      investments,
      meetings,
      expenses,
      members,
    } = get();

    if (!activeGroupId) {
      throw new Error("No active group");
    }

    const tx = walletTransactions.find(
      (t: WalletTransaction) =>
        t.id === transactionId
    );

    if (!tx) {
      throw new Error("Transaction not found");
    }

    const previousTxs = [
      ...walletTransactions,
    ];

    const previousContributions = [
      ...contributions,
    ];

    const previousLoans = [
      ...loans,
    ];

    const previousInvestments = [
      ...(investments || []),
    ];

    const previousMeetings = [
      ...(meetings || []),
    ];

    const previousExpenses = [
      ...(expenses || []),
    ];

    const previousMembers = [
      ...(members || []),
    ];

    const loanId =
      tx.loanId ||
      (tx.sourceType === "loan"
        ? tx.sourceId
        : undefined);

    const contributionId =
      tx.contributionId ||
      (tx.sourceType === "contribution"
        ? tx.sourceId
        : undefined);

    const investmentId =
      tx.investmentId ||
      (tx.sourceType === "investment"
        ? tx.sourceId
        : undefined);

    // =========================================================================
    // Meeting penalty detection
    // =========================================================================

    let meetingId: string | undefined;
    let meetingMemberId = tx.memberId;

    if (
      tx.id.startsWith(
        "meeting-penalty-"
      )
    ) {
      const parts = tx.id.split("-");

      meetingId = parts[2];

      if (parts[3]) {
        meetingMemberId = parts[3];
      }
    }

    // =========================================================================
    // Expense detection
    // =========================================================================

    let expenseId: string | undefined;

    if (
      tx.sourceId &&
      !loanId &&
      !contributionId &&
      !investmentId &&
      !meetingId
    ) {
      expenseId = tx.sourceId;
    }

    // =========================================================================
    // Optimistic local deletion
    // =========================================================================

    let remainingTxs =
      walletTransactions.filter(
        (t: WalletTransaction) =>
          t.id !== transactionId
      );

    // =========================================================================
    // Loan cascade
    // =========================================================================

    if (loanId) {
      remainingTxs =
        remainingTxs.filter(
          (t: WalletTransaction) =>
            t.loanId !== loanId &&
            t.sourceId !== loanId
        );

      get().deleteLoanLocal(
        loanId
      );
    }

    // =========================================================================
    // Contribution cascade
    // =========================================================================

    if (contributionId) {
      remainingTxs =
        remainingTxs.filter(
          (t: WalletTransaction) =>
            t.contributionId !==
              contributionId &&
            t.sourceId !==
              contributionId
        );

      get().deleteContributionLocal(
        contributionId
      );

      if (tx.memberId) {
        const memberRemaining =
          (contributions || [])
            .filter(
              (c: Contribution) =>
                c.memberId ===
                  tx.memberId &&
                c.id !==
                  contributionId &&
                c.status ===
                  "approved"
            )
            .reduce(
              (
                sum: number,
                c: Contribution
              ) =>
                sum +
                (c.amount || 0),
              0
            );

        get().updateMemberLocal(
          tx.memberId,
          {
            totalContributions:
              memberRemaining,
            totalSavings:
              memberRemaining,
          }
        );
      }
    }

    // =========================================================================
    // Investment cascade
    // =========================================================================

    if (investmentId) {
      remainingTxs =
        remainingTxs.filter(
          (t: WalletTransaction) =>
            t.investmentId !==
              investmentId &&
            t.sourceId !==
              investmentId
        );

      get().deleteInvestmentLocal(
        investmentId
      );
    }

    // =========================================================================
    // Meeting penalty cleanup
    // =========================================================================

    if (
      meetingId &&
      meetingMemberId
    ) {
      const meeting =
        (meetings || []).find(
          (m: Meeting) =>
            m.id === meetingId
        );

      if (meeting) {
        const updatedAttendees =
          (
            meeting.attendees ||
            []
          ).map((att) =>
            att.memberId ===
            meetingMemberId
              ? {
                  ...att,
                  penaltyAmount: 0,
                  penaltyPaid: false,
                }
              : att
          );

        get().updateMeetingLocal(
          meetingId,
          {
            attendees:
              updatedAttendees,
          }
        );
      }
    }

    // =========================================================================
    // Expense cleanup
    // =========================================================================

    if (expenseId) {
      remainingTxs =
        remainingTxs.filter(
          (t: WalletTransaction) =>
            t.sourceId !==
            expenseId
        );

      get().deleteExpenseLocal(
        expenseId
      );
    }

    // =========================================================================
    // Update Zustand optimistically
    // =========================================================================

    set((s: StoreState) => ({
      walletTransactions:
        remainingTxs,
      ...recalcGroupTotals({
        ...s,
        walletTransactions:
          remainingTxs,
      }),
    }));

    // =========================================================================
    // Delete from Firestore
    // =========================================================================

    try {
      get().setSyncStatus(
        "pending"
      );

      await FS.deleteWalletTransactionWithRelations(
        activeGroupId,
        transactionId,
        reason
      );

      get().recalcTotals();
      get().setSyncStatus(
        "synced"
      );
    } catch (e) {
      // =======================================================================
      // Rollback
      // =======================================================================

      set((s: StoreState) => ({
        walletTransactions:
          previousTxs,
        contributions:
          previousContributions,
        loans:
          previousLoans,
        investments:
          previousInvestments,
        meetings:
          previousMeetings,
        expenses:
          previousExpenses,
        members:
          previousMembers,

        ...recalcGroupTotals({
          ...s,
          walletTransactions:
            previousTxs,
          contributions:
            previousContributions,
          loans:
            previousLoans,
          investments:
            previousInvestments,
          expenses:
            previousExpenses,
        }),
      }));

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to delete transaction"
      );

      throw e;
    }
  },

  // ===========================================================================
  // HIGH-LEVEL DELETE ALIAS
  // ===========================================================================

  deleteWalletTx: async (
    id,
    reason
  ) => {
    return get().deleteWalletTransaction(
      id,
      reason
    );
  },

  // ===========================================================================
  // CONTRIBUTION LATE FEE
  // ===========================================================================

  applyContributionLateFee: async (
    overdue: OverdueContribution,
    customAmount?: number,
  ) => {
    const {
      activeGroupId,
      authUid,
    } = get();

    if (!activeGroupId) {
      throw new Error(
        "No active group"
      );
    }

    // Determine the amount to charge — either a custom partial amount or the
    // full accrued fee. If a partial payment already exists for this feeTxId,
    // we generate a new unique ID so the partial tx doesn't block future charges.
    const chargeAmount =
      customAmount != null && customAmount > 0
        ? round2(customAmount)
        : overdue.feeAmount;

    // For full-amount applications, block duplicates using the canonical feeTxId.
    // For partial payments, append a timestamp so multiple partials can coexist.
    const isPartial =
      customAmount != null &&
      Math.abs(customAmount - overdue.feeAmount) > 0.01;

    const txId = isPartial
      ? `${overdue.feeTxId}-partial-${Date.now()}`
      : overdue.feeTxId;

    if (!isPartial) {
      const existing =
        get().walletTransactions.find(
          (t) =>
            t.id ===
            overdue.feeTxId
        );

      if (existing) {
        return;
      }
    }

    const now =
      new Date().toISOString();

    const tx: WalletTransaction = {
      id: txId,
      groupId: activeGroupId,
      type: "late_fee",
      sourceType: "manual",
      sourceId: overdue.memberId,
      amount: chargeAmount,
      description:
        `Late contribution fee — ${overdue.periodLabel} ` +
        `(${overdue.daysLate}d late` +
        (isPartial ? ` · partial payment of ${chargeAmount}` : "") +
        `)`,
      date: now,
      memberId:
        overdue.memberId,
      createdAt: now,
      createdBy:
        authUid ?? undefined,
      feePaid: false,
    };

    get().addWalletTxLocal(tx);
    get().recalcTotals();

    try {
      get().setSyncStatus(
        "pending"
      );

      await FS.addWalletTx(
        activeGroupId,
        tx
      );

      get().setSyncStatus(
        "synced"
      );

      const { members } =
        get();

      const member =
        members.find(
          (m: Member) =>
            m.id ===
            overdue.memberId
        );

      if (member?.userId) {
        FS.addNotification(
          member.userId,
          {
            userId:
              member.userId,
            groupId:
              activeGroupId,
            type:
              "contribution_late_fee",
            title:
              "Contribution Payment Overdue",
            message:
              `Your ${overdue.periodLabel} contribution is ` +
              `${overdue.daysLate} day${
                overdue.daysLate !==
                1
                  ? "s"
                  : ""
              } late — a fee of ${chargeAmount} RWF has been applied`,
            read: false,
            metadata: {
              periodLabel:
                overdue.periodLabel,
              daysLate:
                overdue.daysLate,
              feeAmount:
                chargeAmount,
            },
            createdAt:
              now,
          },
          member.email
        ).catch(console.warn);
      }
    } catch (e) {
      get().deleteWalletTxLocal(
        txId
      );

      get().recalcTotals();

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to apply late fee"
      );

      throw e;
    }
  },


  // ===========================================================================
  // LOAN LATE FEE
  // ===========================================================================

  applyLoanLateFee: async (
    overdue: OverdueInstallment,
    customAmount?: number,
  ) => {
    const {
      activeGroupId,
      authUid,
      loans,
    } = get();

    if (!activeGroupId) {
      throw new Error(
        "No active group"
      );
    }

    const loan = loans.find(
      (l: Loan) =>
        l.id ===
        overdue.loanId
    );

    if (!loan) {
      throw new Error(
        "Loan not found"
      );
    }

    // Determine charge amount — partial or full.
    const chargeAmount =
      customAmount != null && customAmount > 0
        ? round2(customAmount)
        : overdue.feeAmount;

    const isPartial =
      customAmount != null &&
      Math.abs(customAmount - overdue.feeAmount) > 0.01;

    // Partial payments get unique tx IDs so they can stack.
    // Full payments use the canonical feeTxId to block duplicates.
    const txId = isPartial
      ? `${overdue.feeTxId}-partial-${Date.now()}`
      : overdue.feeTxId;

    if (!isPartial) {
      const existing =
        get().walletTransactions.find(
          (t) =>
            t.id ===
            overdue.feeTxId
        );

      if (existing) {
        return;
      }
    }

    const now =
      new Date().toISOString();

    const tx: WalletTransaction = {
      id: txId,
      groupId: activeGroupId,
      type: "late_fee",
      sourceType: "loan",
      sourceId:
        overdue.loanId,
      amount:
        chargeAmount,
      description:
        `Late repayment fee — installment #${
          overdue.installmentIndex +
          1
        } (${overdue.daysLate}d late${isPartial ? ` · partial ${chargeAmount}` : ""})`,
      date: now,
      memberId:
        overdue.memberId,
      loanId:
        overdue.loanId,
      createdAt: now,
      createdBy:
        authUid ?? undefined,
      feePaid: false,
    };

    const newLateFees =
      round2(
        (loan.lateFees || 0) +
          chargeAmount
      );

    get().addWalletTxLocal(tx);

    get().updateLoanLocal(
      overdue.loanId,
      {
        lateFees:
          newLateFees,
      }
    );

    get().recalcTotals();

    try {
      get().setSyncStatus(
        "pending"
      );

      await FS.addWalletTx(
        activeGroupId,
        tx
      );

      await FS.updateLoan(
        activeGroupId,
        overdue.loanId,
        {
          lateFees:
            newLateFees,
        }
      );

      get().setSyncStatus(
        "synced"
      );

      const { members } =
        get();

      const member =
        members.find(
          (m: Member) =>
            m.id ===
            overdue.memberId
        );

      if (member?.userId) {
        FS.addNotification(
          member.userId,
          {
            userId:
              member.userId,
            groupId:
              activeGroupId,
            type:
              "loan_late_fee",
            title:
              "Loan Payment Overdue",
            message:
              `Installment #${
                overdue.installmentIndex +
                1
              } is ${overdue.daysLate} day${
                overdue.daysLate !==
                1
                  ? "s"
                  : ""
              } late — a fee of ${chargeAmount} RWF has been applied`,
            read: false,
            metadata: {
              loanId:
                overdue.loanId,
              installmentIndex:
                overdue.installmentIndex,
              daysLate:
                overdue.daysLate,
              feeAmount:
                chargeAmount,
            },
            createdAt:
              now,
          },
          member.email
        ).catch(console.warn);
      }
    } catch (e) {
      get().deleteWalletTxLocal(
        txId
      );

      get().updateLoanLocal(
        overdue.loanId,
        {
          lateFees:
            loan.lateFees || 0,
        }
      );

      get().recalcTotals();

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to apply late fee"
      );

      throw e;
    }
  },


  // ===========================================================================
  // CLEAR STANDALONE LATE FEE
  // ===========================================================================

  clearStandaloneLateFee: async (
    transactionId: ID
  ) => {
    const {
      activeGroupId,
      authUid,
      members,
    } = get();

    if (!activeGroupId) {
      throw new Error(
        "No active group"
      );
    }

    const role = members.find(
      (member) =>
        member.userId ===
        authUid
    )?.role;

    if (
      !role ||
      ![
        "admin",
        "accountant",
        "loan_officer",
      ].includes(role)
    ) {
      throw new Error(
        "Only an admin, accountant, or loan officer can clear late fees"
      );
    }

    const tx =
      get().walletTransactions.find(
        (t) =>
          t.id ===
          transactionId
      );

    if (!tx) {
      throw new Error(
        "Fee not found"
      );
    }

    if (
      tx.type !==
      "late_fee"
    ) {
      throw new Error(
        "Not a late fee transaction"
      );
    }

    const previousFeePaid =
      tx.feePaid;

    get().updateWalletTxLocal(
      transactionId,
      {
        feePaid: true,
      }
    );

    try {
      get().setSyncStatus(
        "pending"
      );

      await FS.updateWalletTx(
        activeGroupId,
        transactionId,
        {
          feePaid: true,
        }
      );

      get().setSyncStatus(
        "synced"
      );
    } catch (e) {
      get().updateWalletTxLocal(
        transactionId,
        {
          feePaid:
            previousFeePaid,
        }
      );

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to clear fee"
      );

      throw e;
    }
  },
});