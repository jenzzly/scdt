// stores/slices/walletSlice.ts

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
import { round2 } from "../../utils/theme";
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
  // 2. Save previous transaction for rollback.
  // 3. Sanitize immutable fields.
  // 4. Optimistically update Zustand.
  // 5. Recalculate totals.
  // 6. Update Firestore.
  // 7. Mark sync as synced.
  // 8. Roll back everything if Firestore fails.
  //

  updateWalletTransaction: async (
    transactionId: ID,
    data: Partial<WalletTransaction>
  ) => {
    const {
      activeGroupId,
      walletTransactions,
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
    // Save previous state for rollback.
    // -------------------------------------------------------------------------

    const previousTx = {
      ...existingTx,
    };

    // -------------------------------------------------------------------------
    // Optimistic update.
    // -------------------------------------------------------------------------

    get().updateWalletTxLocal(
      transactionId,
      sanitizedData
    );

    try {
      get().setSyncStatus("pending");

      // -----------------------------------------------------------------------
      // Firestore update.
      //
      // FS.updateWalletTx already exists because it is used by
      // clearStandaloneLateFee().
      // -----------------------------------------------------------------------

      await FS.updateWalletTx(
        activeGroupId,
        transactionId,
        sanitizedData
      );

      get().recalcTotals();
      get().setSyncStatus("synced");
    } catch (e) {
      // -----------------------------------------------------------------------
      // Rollback optimistic update.
      // -----------------------------------------------------------------------

      get().updateWalletTxLocal(
        transactionId,
        previousTx
      );

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
    overdue: OverdueContribution
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

    const existing =
      get().walletTransactions.find(
        (t) =>
          t.id ===
          overdue.feeTxId
      );

    if (existing) {
      return;
    }

    const now =
      new Date().toISOString();

    const tx: WalletTransaction = {
      id: overdue.feeTxId,
      groupId: activeGroupId,
      type: "late_fee",
      sourceType: "manual",
      sourceId: overdue.memberId,
      amount: overdue.feeAmount,
      description:
        `Late contribution fee — ${overdue.periodLabel} ` +
        `(${overdue.daysLate}d late)`,
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
              } late — a fee of ${overdue.feeAmount} RWF has been applied`,
            read: false,
            metadata: {
              periodLabel:
                overdue.periodLabel,
              daysLate:
                overdue.daysLate,
              feeAmount:
                overdue.feeAmount,
            },
            createdAt:
              now,
          },
          member.email
        ).catch(console.warn);
      }
    } catch (e) {
      get().deleteWalletTxLocal(
        overdue.feeTxId
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
    overdue: OverdueInstallment
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

    const existing =
      get().walletTransactions.find(
        (t) =>
          t.id ===
          overdue.feeTxId
      );

    if (existing) {
      return;
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

    const now =
      new Date().toISOString();

    const tx: WalletTransaction = {
      id: overdue.feeTxId,
      groupId: activeGroupId,
      type: "late_fee",
      sourceType: "loan",
      sourceId:
        overdue.loanId,
      amount:
        overdue.feeAmount,
      description:
        `Late repayment fee — installment #${
          overdue.installmentIndex +
          1
        } (${overdue.daysLate}d late)`,
      date: now,
      memberId:
        overdue.memberId,
      loanId:
        overdue.loanId,
      createdAt: now,
      createdBy:
        authUid ?? undefined,
    };

    const newLateFees =
      round2(
        (loan.lateFees || 0) +
          overdue.feeAmount
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
              } late — a fee of ${overdue.feeAmount} RWF has been applied`,
            read: false,
            metadata: {
              loanId:
                overdue.loanId,
              installmentIndex:
                overdue.installmentIndex,
              daysLate:
                overdue.daysLate,
              feeAmount:
                overdue.feeAmount,
            },
            createdAt:
              now,
          },
          member.email
        ).catch(console.warn);
      }
    } catch (e) {
      get().deleteWalletTxLocal(
        overdue.feeTxId
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