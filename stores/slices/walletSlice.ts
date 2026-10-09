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
import { recalcGroupTotals } from "../recalcGroupTotals";
import { fmtCurrency, round2 } from "../../utils/theme";
import {
  identifyLinkedParent,
  buildLoanPatchFromWalletEdit,
  buildContributionPatchFromWalletEdit,
  buildInvestmentPatchFromWalletEdit,
} from "../../utils/linkedWalletSync";
import type {
  OverdueContribution,
  OverdueGoalFee,
  OverdueInstallment,
} from "../../utils/lateFees";

export const createWalletSlice = (
  set: SetFn,
  get: GetFn
): Pick<
  StoreState,
  | "addWalletTxLocal"
  | "applyContributionLateFee"
  | "applyGoalLateFee"
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
      (t: WalletTransaction) => t.id === transactionId
    );

    if (!existingTx) {
      throw new Error("Transaction not found");
    }

    // ── Sanitize: keep system fields under app control ───────────────
    const {
      id: _id,
      groupId: _groupId,
      createdAt: _createdAt,
      createdBy: _createdBy,
      ...editableData
    } = data;
    void _id;
    void _groupId;
    void _createdAt;
    void _createdBy;

    const sanitizedData: Partial<WalletTransaction> = { ...editableData };
    if (
      sanitizedData.amount !== undefined &&
      typeof sanitizedData.amount === "number"
    ) {
      sanitizedData.amount = round2(sanitizedData.amount);
    }

    // ── Identify the linked parent (shared detection) ───────────────
    const { kind: linkedKind, id: linkedId } = identifyLinkedParent(existingTx);

    const linkedLoan =
      linkedKind === "loan"
        ? loans.find((l: Loan) => l.id === linkedId)
        : null;
    const linkedContribution =
      linkedKind === "contribution"
        ? contributions.find((c) => c.id === linkedId)
        : null;
    const linkedInvestment =
      linkedKind === "investment"
        ? investments?.find((i) => i.id === linkedId)
        : null;

    // Meeting penalties aren't a top-level linked record the way
    // loans / contributions / investments are — they're one attendee's
    // field inside a larger meeting doc — so they get their own
    // narrow handling below rather than a patch builder in
    // linkedWalletSync.ts.
    const isMeetingPenalty = existingTx.id.startsWith("meeting-penalty-");
    let linkedMeeting: Meeting | null = null;
    let meetingMemberId: string | undefined;
    if (isMeetingPenalty) {
      const parts = existingTx.id.split("-");
      const meetingId = parts[2];
      meetingMemberId = parts[3] || existingTx.memberId;
      linkedMeeting = meetings?.find((m) => m.id === meetingId) ?? null;
    }

    // ── Build linked-parent patches via the SHARED helpers ──────────
    // Same functions updateLoanAndSync / updateContributionAndSync /
    // updateInvestmentAndSync use in the other direction, so the
    // field-mapping rules and the loan accrued-interest re-anchoring
    // logic live in exactly one place (utils/linkedWalletSync.ts).
    const walletEditChanged = {
      description: sanitizedData.description,
      amount: sanitizedData.amount,
      date: sanitizedData.date,
    };

    let loanPatch: Partial<Loan> | null = null;
    let contributionPatch: Partial<Contribution> | null = null;
    let investmentPatch: Partial<Investment> | null = null;
    let meetingPatch: Partial<Meeting> | null = null;

    if (
      linkedLoan &&
      (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)
    ) {
      const p = buildLoanPatchFromWalletEdit(linkedLoan, walletEditChanged);
      if (Object.keys(p).length > 0) loanPatch = p;
    }

    if (
      linkedContribution &&
      (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)
    ) {
      const p = buildContributionPatchFromWalletEdit(walletEditChanged);
      if (Object.keys(p).length > 0) contributionPatch = p;
    }

    if (
      linkedInvestment &&
      (sanitizedData.date !== undefined || sanitizedData.amount !== undefined)
    ) {
      const p = buildInvestmentPatchFromWalletEdit(walletEditChanged);
      if (Object.keys(p).length > 0) investmentPatch = p;
    }

    if (linkedMeeting && meetingMemberId && sanitizedData.amount !== undefined) {
      const updatedAttendees = (linkedMeeting.attendees || []).map((att: any) =>
        att.memberId === meetingMemberId
          ? { ...att, penaltyAmount: Math.abs(sanitizedData.amount!) }
          : att
      );
      meetingPatch = { attendees: updatedAttendees } as Partial<Meeting>;
    }

    // ── One descriptor per linked parent, applied in three phases ───
    //
    // Previously this was three near-identical blocks (optimistic
    // update, remote write, rollback), each with its own four-branch
    // if-chain — twelve copies of the same shape. The array below
    // carries the same information once; the loops apply it in each
    // of the three phases.
    type LinkedSync = {
      applyLocal: (s: StoreState) => Partial<StoreState>;
      revertLocal: (s: StoreState) => Partial<StoreState>;
      // Promise<unknown>: updateLoan resolves to the updated
      // Loan while the other three resolve to void. The await
      // loop discards the resolved value — only rejection matters.
      applyRemote: (gId: string) => Promise<unknown>;
    };

    const syncs: LinkedSync[] = [];

    if (linkedLoan && loanPatch) {
      const prevLoan = { ...linkedLoan };
      const targetId = linkedLoan.id;
      const patch = loanPatch;
      syncs.push({
        applyLocal: (s) => ({
          loans: s.loans.map((l: Loan) =>
            l.id === targetId ? { ...l, ...patch } : l
          ),
        }),
        revertLocal: (s) => ({
          loans: s.loans.map((l: Loan) =>
            l.id === targetId ? (prevLoan as Loan) : l
          ),
        }),
        applyRemote: (gId) => FS.updateLoan(gId, targetId, patch),
      });
    }

    if (linkedContribution && contributionPatch) {
      const prevContribution = { ...linkedContribution };
      const targetId = linkedContribution.id;
      const patch = contributionPatch;
      syncs.push({
        applyLocal: (s) => ({
          contributions: s.contributions.map((c) =>
            c.id === targetId ? { ...c, ...patch } : c
          ),
        }),
        revertLocal: (s) => ({
          contributions: s.contributions.map((c) =>
            c.id === targetId ? (prevContribution as Contribution) : c
          ),
        }),
        applyRemote: (gId) => FS.updateContribution(gId, targetId, patch),
      });
    }

    if (linkedInvestment && investmentPatch) {
      const prevInvestment = { ...linkedInvestment };
      const targetId = linkedInvestment.id;
      const patch = investmentPatch;
      syncs.push({
        applyLocal: (s) => ({
          investments: (s.investments ?? []).map((i) =>
            i.id === targetId ? { ...i, ...patch } : i
          ),
        }),
        revertLocal: (s) => ({
          investments: (s.investments ?? []).map((i) =>
            i.id === targetId ? (prevInvestment as Investment) : i
          ),
        }),
        applyRemote: (gId) => FS.updateInvestment(gId, targetId, patch),
      });
    }

    if (linkedMeeting && meetingPatch) {
      const prevMeeting = { ...linkedMeeting };
      const targetId = linkedMeeting.id;
      const patch = meetingPatch;
      syncs.push({
        applyLocal: (s) => ({
          meetings: (s.meetings ?? []).map((m) =>
            m.id === targetId ? { ...m, ...patch } : m
          ),
        }),
        revertLocal: (s) => ({
          meetings: (s.meetings ?? []).map((m) =>
            m.id === targetId ? (prevMeeting as Meeting) : m
          ),
        }),
        applyRemote: (gId) => FS.updateMeeting(gId, targetId, patch),
      });
    }

    // ── Phase 1: optimistic local update ────────────────────────────
    get().updateWalletTxLocal(transactionId, sanitizedData);
    for (const s of syncs) {
      set((state: StoreState) => s.applyLocal(state));
    }
    set((s: StoreState) => recalcGroupTotals(s));

    try {
      get().setSyncStatus("pending");

      // ── Phase 2: remote write ─────────────────────────────────────
      await FS.updateWalletTx(activeGroupId, transactionId, sanitizedData);
      for (const s of syncs) {
        await s.applyRemote(activeGroupId);
      }

      get().recalcTotals();
      get().setSyncStatus("synced");
    } catch (e) {
      // ── Phase 3: rollback (wallet tx + every linked parent) ───────
      get().updateWalletTxLocal(transactionId, existingTx);
      for (const s of syncs) {
        set((state: StoreState) => s.revertLocal(state));
      }
      get().recalcTotals();

      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to update transaction"
      );

      throw e;
    }
  },

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


  // ═══════════════════════════════════════════════════════════════════
  // GOAL-COMPLIANCE LATE FEE
  // ═══════════════════════════════════════════════════════════════════
  //
  // Writes a single `late_fee` wallet tx for a goal-compliance
  // shortfall. The tx ID is deterministic (see
  // findGoalComplianceFees), so calling this twice for the same
  // (member, period, kind) is a no-op.
  applyGoalLateFee: async (overdue, customAmount) => {
    const { activeGroupId, authUid } = get();
    if (!activeGroupId) throw new Error("No active group");

    const chargeAmount =
      customAmount != null && customAmount > 0
        ? round2(customAmount)
        : overdue.feeAmount;

    // Guard: don't apply a partial against a full-amount fee
    // under the canonical id, since that would block the rest.
    const isPartial =
      customAmount != null &&
      Math.abs(customAmount - overdue.feeAmount) > 0.01;

    const txId = isPartial
      ? `${overdue.feeTxId}-partial-${Date.now()}`
      : overdue.feeTxId;

    if (!isPartial) {
      const existing = get().walletTransactions.find(
        (t) => t.id === overdue.feeTxId,
      );
      if (existing) return;
    }

    const now = new Date().toISOString();
    const label = overdue.kind === "mid" ? "Half-target" : "Full-target";
    const tx: WalletTransaction = {
      id: txId,
      groupId: activeGroupId,
      type: "late_fee",
      sourceType: "manual",
      sourceId: overdue.memberId,
      amount: chargeAmount,
      description: `Goal ${label} compliance fee — ${overdue.periodLabel} (${fmtCurrency(overdue.shortfall)} shortfall)`,
      date: now,
      memberId: overdue.memberId,
      createdAt: now,
      createdBy: authUid ?? undefined,
      feePaid: false,
    };

    get().addWalletTxLocal(tx);
    get().recalcTotals();

    try {
      get().setSyncStatus("pending");
      await FS.addWalletTx(activeGroupId, tx);
      get().setSyncStatus("synced");

      const { members } = get();
      const member = members.find((m) => m.id === overdue.memberId);
      if (member?.userId) {
        FS.addNotification(
          member.userId,
          {
            userId: member.userId,
            groupId: activeGroupId,
            type: "contribution_late_fee",
            title: "Contribution Goal Missed",
            message: `${label} shortfall of ${fmtCurrency(overdue.shortfall)} for ${overdue.periodLabel} — a fee of ${fmtCurrency(chargeAmount)} has been applied.`,
            read: false,
            metadata: { goalFeeTxId: txId, kind: overdue.kind },
            createdAt: now,
          },
          member.email,
        ).catch(console.warn);
      }
    } catch (e) {
      get().deleteWalletTxLocal(txId);
      get().recalcTotals();
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to apply goal fee",
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