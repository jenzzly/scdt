// stores/slices/loanSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type {ID, Loan, LoanApprovals, Group, Member} from "../../types";
import * as FS from "../../lib/firestore";
import { uid, loanSchedule, round2 } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createLoanSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addLoanLocal" | "approveLoanStep" | "deleteLoan" | "deleteLoanLocal" | "disburseLoan" | "recordRepayment" | "rejectLoan" | "setLoans" | "submitLoan" | "updateLoan" | "updateLoanLocal"> => ({
      setLoans: (loans) => set({ loans }),
      addLoanLocal: (loan) => set((s: StoreState) => ({ loans: [loan, ...s.loans] })),
      updateLoanLocal: (id, data) => set((s) => ({
        loans: s.loans.map((l: Loan) => (l.id === id ? { ...l, ...data } : l)),
      })),
      deleteLoanLocal: (id) => set((s: StoreState) => ({ loans: s.loans.filter((l: Loan) => l.id !== id) })),

      deleteLoan: async (loanId: ID, reason: string) => {
        const { activeGroupId, loans, walletTransactions } = get();
        const loan = loans.find((l: Loan) => l.id === loanId);
        if (!loan) throw new Error("Loan not found");
        if (!activeGroupId) throw new Error("No active group");

        const previousLoans = [...loans];
        const previousWalletTxs = [...walletTransactions];

        get().deleteLoanLocal(loanId);
        
        const associatedTxs = walletTransactions.filter(tx => tx.loanId === loanId);
        associatedTxs.forEach(tx => {
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
            ...recalcGroupTotals({ ...s, loans: previousLoans, walletTransactions: previousWalletTxs })
          }));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete loan");
          throw e;
        }
      },

      // ── Contribution Actions ─────────────────────────────────────────────────
      submitLoan: async (data) => {
        const { activeGroupId, members, groups } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const group = groups.find((g: Group) => g.id === activeGroupId);
        const interestMethod = group?.loanInterestMethod || "flat";
        // Snapshot the group's rate period at submission time — changing the
        // group setting later must NOT retroactively change existing loans.
        const interestRatePeriod = (data as any).interestRatePeriod ?? group?.loanInterestRatePeriod ?? "monthly";
        const { schedule, monthlyPayment, totalInterest: rawTI, totalRepayable: rawTR } = loanSchedule({
          amount: data.amount,
          interestRate: data.interestRate,
          repaymentMonths: data.repaymentMonths,
          firstPaymentDate: data.firstPaymentDate,
        }, interestMethod, interestRatePeriod);
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
          schedule,
          monthlyPayment,
          totalInterest,
          totalRepayable,
          amountRepaid: 0,
          balance: data.amount,
          accruedInterest: 0,
          totalInterestPaid: 0,
          lastAccrualDate: now.slice(0, 10),
          lateFees: 0,
          status: "pending_loan_officer",
          approvals: defaultApprovals,
          createdAt: now,
          updatedAt: now,
        };
        get().addLoanLocal(loan);
        FS.addLoan(activeGroupId, loan).catch(console.warn);

        const loanOfficer = members.find(
          (m) => m.role === "loan_officer" && m.status === "active" && m.groupId === activeGroupId
        );
        if (loanOfficer?.userId) {
          FS.addNotification(loanOfficer.userId, {
            userId: loanOfficer.userId,
            groupId: activeGroupId,
            type: "loan_approval",
            title: "New Loan Application",
            message: `A loan application for ${loan.amount} RWF awaits your review`,
            read: false,
            metadata: { loanId: loan.id },
            createdAt: now,
          }).catch(console.warn);
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
          newStatus = "pending_accountant";
        } else if (step === "accountant") {
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

        // Send rejection notification to the loan applicant
        if (newStatus === "rejected") {
          const loanMember = members.find((m: Member) => m.id === loan.memberId);
          if (loanMember?.userId) {
            FS.addNotification(loanMember.userId, {
              userId: loanMember.userId,
              groupId: activeGroupId,
              type: "loan_rejected",
              title: "Loan Application Rejected",
              message: `Your loan application for ${loan.amount} RWF was rejected${comment ? `: ${comment}` : ""}. You can edit and resubmit your application.`,
              read: false,
              metadata: { loanId, rejectionReason: comment },
              createdAt: new Date().toISOString(),
            }).catch(console.warn);
          }
        }

        if (approved && newStatus !== "approved" && newStatus !== "rejected") {
          const nextRoleMap: Record<string, string> = {
            pending_committee: "committee",
            pending_accountant: "accountant",
          };
          const nextRole = nextRoleMap[newStatus];
          if (nextRole) {
            const nextApprover = members.find(
              (m) => m.role === nextRole && m.status === "active" && m.groupId === activeGroupId
            );
            if (nextApprover?.userId) {
              FS.addNotification(nextApprover.userId, {
                userId: nextApprover.userId,
                groupId: activeGroupId,
                type: "loan_approval",
                title: "Loan Requires Your Approval",
                message: `A loan application for ${loan.amount} RWF needs your review`,
                read: false,
                metadata: { loanId },
                createdAt: new Date().toISOString(),
              }).catch(console.warn);
            }
          }
        }

        if (newStatus === "approved") {
          const admin = members.find(
            (m) => m.role === "admin" && m.status === "active" && m.groupId === activeGroupId
          );
          if (admin?.userId) {
            FS.addNotification(admin.userId, {
              userId: admin.userId,
              groupId: activeGroupId,
              type: "loan_ready_to_disburse",
              title: "Loan Ready for Disbursement",
              message: `Loan of ${loan.amount} RWF has been fully approved and is ready to disburse`,
              read: false,
              metadata: { loanId },
              createdAt: new Date().toISOString(),
            }).catch(console.warn);
          }
        }
      },

      rejectLoan: async (loanId, reason) => {
        const { activeGroupId, loans, members } = get();
        const loan = loans.find((l: Loan) => l.id === loanId);
        const now = new Date().toISOString();
        get().updateLoanLocal(loanId, { status: "rejected", rejectionReason: reason, updatedAt: now });
        if (activeGroupId) {
          FS.updateLoan(activeGroupId, loanId, {
            status: "rejected",
            rejectionReason: reason,
          }).catch(console.warn);
          const loanMember = members.find((m: Member) => m.id === loan?.memberId);
          if (loanMember?.userId) {
            FS.addNotification(loanMember.userId, {
              userId: loanMember.userId,
              groupId: activeGroupId,
              type: "loan_rejected",
              title: "Loan application rejected",
              message: `Your loan application for ${loan?.amount ?? "N/A"} RWF was rejected`,
              read: false,
              metadata: { loanId },
              createdAt: now,
            }).catch(console.warn);
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

      disburseLoan: async (loanId) => {
        const { activeGroupId } = get();
        if (!activeGroupId) return;
        try {
          get().setSyncStatus("pending");
          const result = await FS.disburseLoanServer(activeGroupId, loanId);
          get().updateLoanLocal(loanId, result.loan);
          get().addWalletTxLocal(result.walletTx);
          set((s: StoreState) => recalcGroupTotals(s));
          get().setSyncStatus("synced");
        } catch (e) {
          get().setSyncStatus("failed", e instanceof Error ? e.message : String(e));
          throw e;
        }
      },

      recordRepayment: async (loanId, amount, date) => {
        const { activeGroupId, authUid, members } = get();
        if (!activeGroupId) return;
        try {
          get().setSyncStatus("pending");
          const result = await FS.recordRepaymentServer(activeGroupId, loanId, amount, date);
          get().updateLoanLocal(loanId, result.loan);
          // Two separate wallet txs: interest income + principal recovery
          get().addWalletTxLocal(result.interestTx);
          get().addWalletTxLocal(result.principalTx);
          if (result.creditTx) get().addWalletTxLocal(result.creditTx);
          set((s: StoreState) => recalcGroupTotals(s));
          get().setSyncStatus("synced");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          get().setSyncStatus("failed", msg);
          // Write failed transaction to audit log for admin visibility
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
