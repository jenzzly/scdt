// stores/slices/walletSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID } from "../../types";
import * as FS from "../../lib/firestore";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createWalletSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addWalletTxLocal" | "deleteWalletTransaction" | "deleteWalletTx" | "deleteWalletTxLocal" | "setWalletTxs" | "updateWalletTxLocal"> => ({
      setWalletTxs: (txs) => set({ walletTransactions: txs }),
      addWalletTxLocal: (tx) => set((s) => {
        // Deduplicate — ignore if this tx ID is already in local state (double-submit guard)
        if (s.walletTransactions.some((t) => t.id === tx.id)) return s;
        const newTxs = [tx, ...s.walletTransactions];
        const updates = recalcGroupTotals({ ...s, walletTransactions: newTxs });
        return { walletTransactions: newTxs, ...updates };
      }),
      updateWalletTxLocal: (id, data) => set((s) => {
        const updatedTxs = s.walletTransactions.map((t) => (t.id === id ? { ...t, ...data } : t));
        const updates = recalcGroupTotals({ ...s, walletTransactions: updatedTxs });
        return { walletTransactions: updatedTxs, ...updates };
      }),
      deleteWalletTxLocal: (id) => set((s) => {
        const remainingTxs = s.walletTransactions.filter((t) => t.id !== id);
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


});
