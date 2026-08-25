// stores/slices/walletSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type {ID, WalletTransaction} from "../../types";
import * as FS from "../../lib/firestore";
import { recalcGroupTotals } from "../recalcGroupTotals";
import { round2 } from "../../utils/theme";
import type { OverdueContribution, OverdueInstallment } from "../../utils/lateFees";

export const createWalletSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addWalletTxLocal" | "applyContributionLateFee" | "applyLoanLateFee" | "clearStandaloneLateFee" | "deleteWalletTransaction" | "deleteWalletTx" | "deleteWalletTxLocal" | "setWalletTxs" | "updateWalletTxLocal"> => ({
      setWalletTxs: (txs) => set((s: StoreState) => {
        // Deduplicate: Firestore subscription fires after optimistic addWalletTxLocal,
        // producing duplicate IDs. Last-write-wins by merging subscription data over
        // local state, keeping the authoritative Firestore values.
        const byId = new Map(txs.map((t: WalletTransaction) => [t.id, t]));
        // Preserve any local-only txs not yet in Firestore snapshot
        s.walletTransactions.forEach((t) => { if (!byId.has(t.id)) byId.set(t.id, t); });
        const merged = Array.from(byId.values()).sort(
          (a, b) => new Date(b.createdAt ?? b.date).getTime() - new Date(a.createdAt ?? a.date).getTime()
        );
        return { walletTransactions: merged };
      }),
      addWalletTxLocal: (tx) => set((s: StoreState) => {
        // Deduplicate: drop if ID already exists (idempotent optimistic update)
        if (s.walletTransactions.some((t) => t.id === tx.id)) return s;
        const newTxs = [tx, ...s.walletTransactions];
        const updates = recalcGroupTotals({ ...s, walletTransactions: newTxs });
        return { walletTransactions: newTxs, ...updates };
      }),
      updateWalletTxLocal: (id, data) => set((s: StoreState) => {
        const updatedTxs = s.walletTransactions.map((t: WalletTransaction) => (t.id === id ? { ...t, ...data } : t));
        const updates = recalcGroupTotals({ ...s, walletTransactions: updatedTxs });
        return { walletTransactions: updatedTxs, ...updates };
      }),
      deleteWalletTxLocal: (id) => set((s: StoreState) => {
        const remainingTxs = s.walletTransactions.filter((t: WalletTransaction) => t.id !== id);
        const updates = recalcGroupTotals({ ...s, walletTransactions: remainingTxs });
        return { walletTransactions: remainingTxs, ...updates };
      }),

      deleteWalletTransaction: async (transactionId: ID, reason: string) => {
        const { activeGroupId, walletTransactions, contributions, loans } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const tx = walletTransactions.find((t) => t.id === transactionId);
        if (!tx) throw new Error("Transaction not found");
        
        const previousTxs = [...walletTransactions];
        const previousContributions = [...contributions];
        const previousLoans = [...loans];
        
        get().deleteWalletTxLocal(transactionId);
        
        if (tx.contributionId) {
          get().deleteContributionLocal(tx.contributionId);
        }
        
        try {
          get().setSyncStatus("pending");
          await FS.deleteWalletTransactionWithRelations(activeGroupId, transactionId, reason);
          get().recalcTotals();
          get().setSyncStatus("synced");
        } catch (e) {
          set((s) => ({ 
            walletTransactions: previousTxs,
            contributions: previousContributions,
            loans: previousLoans,
            ...recalcGroupTotals({ ...s, walletTransactions: previousTxs, contributions: previousContributions, loans: previousLoans })
          }));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete transaction");
          throw e;
        }
      },

      // ── High-level actions (keeping existing implementations) ──
      deleteWalletTx: async (id, reason) => {
        return get().deleteWalletTransaction(id, reason);
      },

      // ── Late fees — calculated on the amount due, not a flat figure ────────
      // Both mirror the meeting-penalty pattern: an officer/admin triggers
      // these explicitly (nothing auto-charges in the background), a
      // deterministic wallet-tx ID prevents double-charging the same
      // missed period / overdue installment, and the fee amount is derived
      // from findOverdueContributions/findOverdueInstallments in
      // utils/lateFees.ts so the UI and the write always agree on the math.
      applyContributionLateFee: async (overdue) => {
        const { activeGroupId, authUid } = get();
        if (!activeGroupId) throw new Error("No active group");

        const existing = get().walletTransactions.find((t) => t.id === overdue.feeTxId);
        if (existing) return; // already charged — idempotent no-op

        const now = new Date().toISOString();
        const tx: WalletTransaction = {
          id: overdue.feeTxId,
          groupId: activeGroupId,
          type: "late_fee",
          sourceType: "manual",
          sourceId: overdue.memberId,
          amount: overdue.feeAmount,
          description: `Late contribution fee — ${overdue.periodLabel} (${overdue.daysLate}d late)`,
          date: now,
          memberId: overdue.memberId,
          createdAt: now,
          createdBy: authUid ?? undefined,
        };

        get().addWalletTxLocal(tx);
        get().recalcTotals();

        try {
          get().setSyncStatus("pending");
          await FS.addWalletTx(activeGroupId, tx);
          get().setSyncStatus("synced");
        } catch (e) {
          get().deleteWalletTxLocal(overdue.feeTxId);
          get().recalcTotals();
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to apply late fee");
          throw e;
        }
      },

      applyLoanLateFee: async (overdue) => {
        const { activeGroupId, authUid, loans } = get();
        if (!activeGroupId) throw new Error("No active group");

        const existing = get().walletTransactions.find((t) => t.id === overdue.feeTxId);
        if (existing) return; // already charged — idempotent no-op

        const loan = loans.find((l) => l.id === overdue.loanId);
        if (!loan) throw new Error("Loan not found");

        const now = new Date().toISOString();
        const tx: WalletTransaction = {
          id: overdue.feeTxId,
          groupId: activeGroupId,
          type: "late_fee",
          sourceType: "loan",
          sourceId: overdue.loanId,
          amount: overdue.feeAmount,
          description: `Late repayment fee — installment #${overdue.installmentIndex + 1} (${overdue.daysLate}d late)`,
          date: now,
          memberId: overdue.memberId,
          loanId: overdue.loanId,
          createdAt: now,
          createdBy: authUid ?? undefined,
        };

        const newLateFees = round2((loan.lateFees || 0) + overdue.feeAmount);

        get().addWalletTxLocal(tx);
        get().updateLoanLocal(overdue.loanId, { lateFees: newLateFees });
        get().recalcTotals();

        try {
          get().setSyncStatus("pending");
          await FS.addWalletTx(activeGroupId, tx);
          await FS.updateLoan(activeGroupId, overdue.loanId, { lateFees: newLateFees });
          get().setSyncStatus("synced");
        } catch (e) {
          get().deleteWalletTxLocal(overdue.feeTxId);
          get().updateLoanLocal(overdue.loanId, { lateFees: loan.lateFees || 0 });
          get().recalcTotals();
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to apply late fee");
          throw e;
        }
      },

      // Marks a standalone late fee (contribution or loan — NOT a meeting
      // penalty, which is cleared via clearAllMemberPenalties instead) as
      // paid, so it stops counting against a member's loan eligibility in
      // useUnpaidPenalties. The caller is responsible for the officer-only
      // gate — this matches how clearAllMemberPenalties works today, where
      // permission checks live in the UI (meetings.tsx, add-loan.tsx), not
      // in the store action itself.
      clearStandaloneLateFee: async (transactionId: ID) => {
        const { activeGroupId, authUid, members } = get();
        if (!activeGroupId) throw new Error("No active group");

        const role = members.find(member => member.userId === authUid)?.role;
        if (!role || !["admin", "accountant", "loan_officer"].includes(role)) {
          throw new Error("Only an admin, accountant, or loan officer can clear late fees");
        }

        const tx = get().walletTransactions.find((t) => t.id === transactionId);
        if (!tx) throw new Error("Fee not found");
        if (tx.type !== "late_fee") throw new Error("Not a late fee transaction");

        get().updateWalletTxLocal(transactionId, { feePaid: true });

        try {
          get().setSyncStatus("pending");
          await FS.updateWalletTx(activeGroupId, transactionId, { feePaid: true });
          get().setSyncStatus("synced");
        } catch (e) {
          get().updateWalletTxLocal(transactionId, { feePaid: tx.feePaid });
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to clear fee");
          throw e;
        }
      },

});
