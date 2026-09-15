// stores/slices/loanSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, Loan, LoanApprovals, Group, Member } from "../../types";
import * as FS from "../../lib/firestore";
import { uid, loanSchedule, round2 } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";
import {
  findLoanDisbursementWalletTx,
  buildLinkedTxPatch,
} from "../../utils/linkedWalletSync";

export const createLoanSlice = (
  set: SetFn,
  get: GetFn,
): Pick<
  StoreState,
  | "addLoanLocal"
  | "approveLoanStep"
  | "deleteLoan"
  | "deleteLoanLocal"
  | "disburseLoan"
  | "recordRepayment"
  | "rejectLoan"
  | "rescheduleLoanInstallment"
  | "setLoans"
  | "submitLoan"
  | "updateLoan"
  | "updateLoanAndSync"
  | "updateLoanLocal"
> => ({
  setLoans: (loans) => set({ loans }),
  addLoanLocal: (loan) =>
    set((s: StoreState) => ({ loans: [loan, ...s.loans] })),
  updateLoanLocal: (id, data) =>
    set((s) => ({
      loans: s.loans.map((l: Loan) =>
        l.id === id ? { ...l, ...data } : l,
      ),
    })),
  deleteLoanLocal: (id) =>
    set((s: StoreState) => ({
      loans: s.loans.filter((l: Loan) => l.id !== id),
    })),

  deleteLoan: async (loanId: ID, reason: string) => {
    const { activeGroupId, loans, walletTransactions } = get();
    const loan = loans.find((l: Loan) => l.id === loanId);
    if (!loan) throw new Error("Loan not found");
    if (!activeGroupId) throw new Error("No active group");

    const previousLoans = [...loans];
    const previousWalletTxs = [...walletTransactions];

    get().deleteLoanLocal(loanId);

    const associatedTxs = walletTransactions.filter((tx) => tx.loanId === loanId);
    associatedTxs.forEach((tx) => {
      get().deleteWalletTxLocal(tx.id);
    });

    try {
      get().setSyncStatus("pending");
      await FS.deleteLoanWithRelations(activeGroupId, loanId, reason);
      get().recalcTotals();
      get().setSyncStatus("synced");
    } catch (e) {
      set((s) => ({
        loans: previousLoans,
        walletTransactions: previousWalletTxs,
        ...recalcGroupTotals({
          ...s,
          loans: previousLoans,
          walletTransactions: previousWalletTxs,
        }),
      }));
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to delete loan",
      );
      throw e;
    }
  },

  submitLoan: async (data) => {
    const { activeGroupId, members, groups } = get();
    if (!activeGroupId) throw new Error("No active group");
    const now = new Date().toISOString();
    const group = groups.find((g: Group) => g.id === activeGroupId);
    const interestMethod = group?.loanInterestMethod || "flat";
    const interestRatePeriod =
      (data as any).interestRatePeriod ??
      group?.loanInterestRatePeriod ??
      "monthly";
    const lateFeeRatePct =
      (data as any).lateFeeRatePct ?? group?.loanLateFeeRatePct;
    const lateFeeGraceDays =
      (data as any).lateFeeGraceDays ?? group?.loanLateFeeGraceDays;

    const {
      schedule,
      monthlyPayment,
      totalInterest: rawTI,
      totalRepayable: rawTR,
    } = loanSchedule(
      {
        amount: data.amount,
        interestRate: data.interestRate,
        repaymentMonths: data.repaymentMonths,
        firstPaymentDate: data.firstPaymentDate,
      },
      interestMethod,
      interestRatePeriod,
    );

    const totalInterest = round2(rawTI);
    const totalRepayable = round2(rawTR);

    const defaultApprovals: LoanApprovals = {
      loanOfficer: { approved: false },
      committee: { approved: false },
      accountant: { approved: false },
    };

    const loan: Loan = {
      ...data,
      id: uid(),
      interestMethod,
      interestRatePeriod,
      lateFeeRatePct,
      lateFeeGraceDays,
      schedule,
      monthlyPayment,
      totalInterest,
      totalRepayable,
      amountRepaid: 0,
      balance: data.amount,
      accruedInterest: 0,
      totalInterestPaid: 0,
      lastAccrualDate: String((data as any).applicationDate ?? now).slice(0, 10),
      lateFees: 0,
      status: "pending_loan_officer",
      approvals: defaultApprovals,
      createdAt: now,
      updatedAt: now,
    };

    get().addLoanLocal(loan);
    FS.addLoan(activeGroupId, loan).catch(console.warn);

    const loanOfficer = members.find(
      (m) =>
        m.role === "loan_officer" &&
        m.status === "active" &&
        m.groupId === activeGroupId,
    );

    if (loanOfficer?.userId) {
      FS.addNotification(
        loanOfficer.userId,
        {
          userId: loanOfficer.userId,
          groupId: activeGroupId,
          type: "loan_approval",
          title: "New Loan Application",
          message: `A loan application for ${loan.amount} RWF awaits your review`,
          read: false,
          metadata: { loanId: loan.id },
          createdAt: now,
        },
        loanOfficer.email,
      ).catch(console.warn);
    }

    return loan.id;
  },

  approveLoanStep: async (loanId, step, approved, comment) => {
    const { activeGroupId, loans, members, authUid } = get();
    if (!activeGroupId) throw new Error("No active group");
    const loan = loans.find((l: Loan) => l.id === loanId);
    if (!loan) throw new Error("Loan not found");

    const approvalKey = step === "loan_officer" ? "loanOfficer" : step;

    const updatedApprovals: LoanApprovals = {
      ...loan.approvals,
      [approvalKey]: {
        approved,
        date: new Date().toISOString(),
        comment,
        userId: authUid ?? undefined,
      },
    };

    let newStatus = loan.status;
    if (!approved) {
      newStatus = "rejected";
    } else if (step === "loan_officer") {
      newStatus = "pending_committee";
    } else if (step === "committee") {
      newStatus = "approved";
    }

    get().updateLoanLocal(loanId, {
      approvals: updatedApprovals,
      status: newStatus,
      updatedAt: new Date().toISOString(),
      ...(newStatus === "rejected" ? { rejectionReason: comment } : {}),
    });

    FS.updateLoan(activeGroupId, loanId, {
      approvals: updatedApprovals,
      status: newStatus,
      ...(newStatus === "rejected" ? { rejectionReason: comment } : {}),
    }).catch(console.warn);

    if (newStatus === "rejected") {
      const loanMember = members.find((m: Member) => m.id === loan.memberId);
      if (loanMember?.userId) {
        FS.addNotification(
          loanMember.userId,
          {
            userId: loanMember.userId,
            groupId: activeGroupId,
            type: "loan_rejected",
            title: "Loan Application Rejected",
            message: `Your loan application for ${
              loan.amount
            } RWF was rejected${comment ? `: ${comment}` : ""}. You can edit and resubmit your application.`,
            read: false,
            metadata: { loanId, rejectionReason: comment },
            createdAt: new Date().toISOString(),
          },
          loanMember.email,
        ).catch(console.warn);
      }
    }

    if (approved && newStatus !== "approved" && newStatus !== "rejected") {
      const nextRoleMap: Record<string, string> = {
        pending_committee: "committee",
      };
      const nextRole = nextRoleMap[newStatus];
      if (nextRole) {
        const nextApprover = members.find(
          (m) =>
            m.role === nextRole &&
            m.status === "active" &&
            m.groupId === activeGroupId,
        );
        if (nextApprover?.userId) {
          FS.addNotification(
            nextApprover.userId,
            {
              userId: nextApprover.userId,
              groupId: activeGroupId,
              type: "loan_approval",
              title: "Loan Requires Your Approval",
              message: `A loan application for ${loan.amount} RWF needs your review`,
              read: false,
              metadata: { loanId },
              createdAt: new Date().toISOString(),
            },
            nextApprover.email,
          ).catch(console.warn);
        }
      }
    }

    if (newStatus === "approved") {
      const disbursers = members.filter(
        (m) =>
          (m.role === "accountant" || m.role === "admin") &&
          m.status === "active" &&
          m.groupId === activeGroupId,
      );
      for (const disburser of disbursers) {
        if (disburser.userId) {
          FS.addNotification(
            disburser.userId,
            {
              userId: disburser.userId,
              groupId: activeGroupId,
              type: "loan_ready_to_disburse",
              title: "Loan Ready for Disbursement",
              message: `Loan of ${loan.amount} RWF has been fully approved and is ready to disburse`,
              read: false,
              metadata: { loanId },
              createdAt: new Date().toISOString(),
            },
            disburser.email,
          ).catch(console.warn);
        }
      }
    }
  },

  rejectLoan: async (loanId, reason) => {
    const { activeGroupId, loans, members } = get();
    const loan = loans.find((l: Loan) => l.id === loanId);
    const now = new Date().toISOString();

    get().updateLoanLocal(loanId, {
      status: "rejected",
      rejectionReason: reason,
      updatedAt: now,
    });

    if (activeGroupId) {
      FS.updateLoan(activeGroupId, loanId, {
        status: "rejected",
        rejectionReason: reason,
      }).catch(console.warn);

      const loanMember = members.find((m: Member) => m.id === loan?.memberId);
      if (loanMember?.userId) {
        FS.addNotification(
          loanMember.userId,
          {
            userId: loanMember.userId,
            groupId: activeGroupId,
            type: "loan_rejected",
            title: "Loan application rejected",
            message: `Your loan application for ${
              loan?.amount ?? "N/A"
            } RWF was rejected`,
            read: false,
            metadata: { loanId },
            createdAt: now,
          },
          loanMember.email,
        ).catch(console.warn);
      }
    }
  },

  updateLoan: async (loanId, data) => {
    const { activeGroupId } = get();
    get().updateLoanLocal(loanId, data);
    if (activeGroupId) {
      await FS.updateLoan(activeGroupId, loanId, data).catch(console.warn);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EDIT LOAN + SYNC DISBURSEMENT WALLET TX
  // ═══════════════════════════════════════════════════════════════════════
  //
  // FIX: for a loan that's already been disbursed (or repaid / defaulted),
  // the "date" field the user is editing is the DISBURSEMENT date —
  // because that's the date that drives interest accrual, wallet
  // reconciliation, and late-fee evaluation. The original applicationDate
  // was captured at submission and must NOT be silently overwritten by a
  // later date correction.
  //
  // For a loan that has not been disbursed yet, there's no disbursement
  // date, so a date edit still correctly updates the application date.
  updateLoanAndSync: async (loanId, data) => {
    const { activeGroupId, loans, walletTransactions } = get();
    if (!activeGroupId) throw new Error("No active group");

    const loan = loans.find((l: Loan) => l.id === loanId);
    if (!loan) throw new Error("Loan not found");

    const isDisbursed =
      loan.status === "disbursed" ||
      loan.status === "repaid" ||
      loan.status === "defaulted";

    const loanPatch: Partial<Loan> = {};

    if (data.amount !== undefined) {
      loanPatch.amount = data.amount;
    }

    if (data.description !== undefined) {
      loanPatch.purpose = data.description;
    }

    if (data.date !== undefined) {
      if (isDisbursed) {
        loanPatch.disbursementDate = data.date;
      } else {
        loanPatch.applicationDate = data.date;
      }

      if (loan.interestMethod === "reducing_balance") {
        const oldDisbursementDateOnly = (loan as any).disbursementDate
          ? String((loan as any).disbursementDate).slice(0, 10)
          : undefined;

        const anchorDate =
          (loan as any).lastAccrualDate ||
          oldDisbursementDateOnly ||
          loan.applicationDate ||
          data.date;

        const projection = FS.projectAccruedInterest(
          {
            balance: loan.balance,
            interestRate: loan.interestRate,
            interestMethod: loan.interestMethod,
            interestRatePeriod: (loan as any).interestRatePeriod,
            accruedInterest: (loan as any).accruedInterest || 0,
            lastAccrualDate: anchorDate,
          },
          data.date + "T00:00:00.000Z",
        );

        loanPatch.accruedInterest = projection.total;
        loanPatch.lastAccrualDate = data.date;
      }
    }

    const previousLoan = { ...loan };
    const linkedTx = findLoanDisbursementWalletTx(walletTransactions, loanId);
    const previousTx = linkedTx ? { ...linkedTx } : null;

    const txChanged = {
      amount: data.amount,
      date: data.date,
      description: data.description,
    };

    get().updateLoanLocal(loanId, loanPatch);

    if (linkedTx) {
      const txPatch = buildLinkedTxPatch(linkedTx, txChanged);
      get().updateWalletTxLocal(linkedTx.id, txPatch);
    }

    set((s) => recalcGroupTotals(s));

    try {
      get().setSyncStatus("pending");

      await FS.updateLoan(activeGroupId, loanId, loanPatch);

      if (linkedTx) {
        const txPatch = buildLinkedTxPatch(linkedTx, txChanged);
        await FS.updateWalletTx(activeGroupId, linkedTx.id, txPatch);
      }

      get().recalcTotals();
      get().setSyncStatus("synced");
    } catch (e) {
      get().updateLoanLocal(loanId, previousLoan);
      if (linkedTx && previousTx) {
        get().updateWalletTxLocal(linkedTx.id, previousTx);
      }
      set((s) => recalcGroupTotals(s));

      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to update loan",
      );
      throw e;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESCHEDULE AN INSTALLMENT'S DUE DATE
  // ═══════════════════════════════════════════════════════════════════════
  rescheduleLoanInstallment: async (loanId, installmentIndex, newDueDate) => {
    const { activeGroupId, loans } = get();
    if (!activeGroupId) throw new Error("No active group");

    const loan = loans.find((l: Loan) => l.id === loanId);
    if (!loan) throw new Error("Loan not found");
    if (!loan.schedule || !loan.schedule[installmentIndex]) {
      throw new Error("Installment not found");
    }
    if (loan.schedule[installmentIndex].paid) {
      throw new Error("Cannot reschedule a paid installment");
    }

    const previousSchedule = loan.schedule.map((item) => ({ ...item }));

    const newSchedule = loan.schedule.map((item, i) =>
      i === installmentIndex ? { ...item, dueDate: newDueDate } : item,
    );

    get().updateLoanLocal(loanId, { schedule: newSchedule });

    try {
      get().setSyncStatus("pending");
      await FS.updateLoan(activeGroupId, loanId, { schedule: newSchedule });
      get().setSyncStatus("synced");
    } catch (e) {
      get().updateLoanLocal(loanId, { schedule: previousSchedule });
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to reschedule installment",
      );
      throw e;
    }
  },

  // ============================================================
  // Disburse loan
  // ============================================================
  //
  // `disbursementDate` is the date the money actually left the wallet.
  // It anchors reducing-balance interest, appears on the loan as
  // disbursementDate, and stamps the linked wallet transaction. It does
  // NOT touch the loan's applicationDate (that was set at submission).
  disburseLoan: async (loanId, disbursementDate) => {
    const { activeGroupId } = get();

    if (!activeGroupId) {
      throw new Error("No active group");
    }

    try {
      get().setSyncStatus("pending");

      const result = await FS.disburseLoanServer(
        activeGroupId,
        loanId,
        disbursementDate,
      );

      get().updateLoanLocal(loanId, result.loan);
      get().addWalletTxLocal(result.walletTx);

      set((s: StoreState) => recalcGroupTotals(s));

      get().setSyncStatus("synced");
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
  },

  recordRepayment: async (loanId, amount, date) => {
    const { activeGroupId, authUid, members } = get();
    if (!activeGroupId) return;
    try {
      get().setSyncStatus("pending");
      const result = await FS.recordRepaymentServer(
        activeGroupId,
        loanId,
        amount,
        date,
      );
      get().updateLoanLocal(loanId, result.loan);
      if (result.interestTx) get().addWalletTxLocal(result.interestTx);
      if (result.principalTx) get().addWalletTxLocal(result.principalTx);
      if (result.creditTx) get().addWalletTxLocal(result.creditTx);
      set((s: StoreState) => recalcGroupTotals(s));
      get().setSyncStatus("synced");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().setSyncStatus("failed", msg);

      const currentUser = members.find((m: Member) => m.userId === authUid);
      FS.writeFailedAuditLog(activeGroupId, {
        groupId: activeGroupId,
        userId: authUid ?? "unknown",
        userName: currentUser?.fullName ?? "Unknown",
        action: "failed",
        entityType: "loan",
        entityId: loanId,
        reason: `Repayment of ${amount} failed: ${msg}`,
        errorMessage: msg,
        status: "failed",
      }).catch(() => {});
      throw e;
    }
  },
});