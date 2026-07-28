// stores/slices/contributionSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, Contribution, WalletTransaction } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createContributionSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addContributionLocal" | "approveContribution" | "deleteContribution" | "deleteContributionLocal" | "recordContribution" | "rejectContribution" | "setContributions" | "updateContribution" | "updateContributionLocal"> => ({
      setContributions: (cs) => set({ contributions: cs }),
      addContributionLocal: (c) => set((s) => ({ contributions: [c, ...s.contributions] })),
      updateContributionLocal: (id, data) => set((s) => ({
        contributions: s.contributions.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })),
      deleteContributionLocal: (id) => set((s) => ({ contributions: s.contributions.filter((c) => c.id !== id) })),

      deleteContribution: async (contributionId: ID, reason: string) => {
        const { activeGroupId, contributions, walletTransactions } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");
        
        const previousContributions = [...contributions];
        const previousWalletTxs = [...walletTransactions];
        
        get().deleteContributionLocal(contributionId);
        
        const associatedTxs = walletTransactions.filter(tx => tx.contributionId === contributionId);
        associatedTxs.forEach(tx => {
          get().deleteWalletTxLocal(tx.id);
        });
        
        try {
          get().setSyncStatus("pending");
          await FS.deleteContributionWithRelations(activeGroupId, contributionId, reason);
          get().recalcTotals();
          get().setSyncStatus("synced");
        } catch (e) {
          set((s) => ({ 
            contributions: previousContributions,
            walletTransactions: previousWalletTxs,
            ...recalcGroupTotals({ ...s, contributions: previousContributions, walletTransactions: previousWalletTxs })
          }));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete contribution");
          throw e;
        }
      },

      // ── Wallet Actions ───────────────────────────────────────────────────────
      recordContribution: async (data, autoApprove = true) => {
        const { activeGroupId } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const status = autoApprove ? "approved" : "pending";
        const contribution: Contribution = { ...data, id: uid(), status, createdAt: now };

        get().addContributionLocal(contribution);
        set((s) => recalcGroupTotals(s));

        try {
          get().setSyncStatus("pending");
          await FS.addContribution(activeGroupId, { ...data, id: contribution.id, status, createdAt: now });

          if (autoApprove) {
            const tx: WalletTransaction = {
              id: uid(),
              groupId: activeGroupId,
              type: "contribution",
              sourceType: "contribution" as const,
              sourceId: contribution.id,
              amount: data.amount,
              description: data.description || "Contribution",
              date: data.date,
              memberId: data.memberId,
              contributionId: contribution.id,
              createdAt: now,
            };
            get().addWalletTxLocal(tx);
            FS.addWalletTx(activeGroupId, tx).catch(console.warn);
          }

          get().setSyncStatus("synced");
        } catch (e) {
          get().updateContributionLocal(contribution.id, { status: "pending" });
          set((s) => recalcGroupTotals(s));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to record contribution");
          throw e;
        }

        return contribution.id;
      },

      approveContribution: async (contributionId) => {
        const { activeGroupId, contributions } = get();
        if (!activeGroupId) return;
        const c = contributions.find((x) => x.id === contributionId);
        if (!c) return;
        get().updateContributionLocal(contributionId, { status: "approved" });
        const tx: WalletTransaction = {
          id: uid(),
          groupId: activeGroupId,
          type: "contribution",
          amount: c.amount,
          description: c.description || "Contribution",
          date: c.date,
          memberId: c.memberId,
          contributionId: c.id,
          createdAt: new Date().toISOString(),
        };
        get().addWalletTxLocal(tx);
        set((s) => recalcGroupTotals(s));
        FS.updateContribution(activeGroupId, contributionId, { status: "approved" }).catch(console.warn);
        FS.addWalletTx(activeGroupId, tx).catch(console.warn);
      },

      rejectContribution: async (contributionId, reason) => {
        const { activeGroupId } = get();
        get().updateContributionLocal(contributionId, { status: "rejected", rejectionReason: reason });
        if (activeGroupId) {
          FS.updateContribution(activeGroupId, contributionId, {
            status: "rejected",
            rejectionReason: reason,
          }).catch(console.warn);
        }
      },

      updateContribution: async (contributionId, data) => {
        const { activeGroupId, contributions } = get();
        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");
        const prevStatus = contribution.status;
        get().updateContributionLocal(contributionId, data);
        if (activeGroupId) {
          await FS.updateContribution(activeGroupId, contributionId, data).catch(console.warn);
        }
        if (data.status === "approved" && prevStatus !== "approved") {
          const tx: WalletTransaction = {
            id: uid(),
            groupId: activeGroupId!,
            type: "contribution",
            amount: contribution.amount,
            description: contribution.description || "Contribution",
            date: contribution.date,
            memberId: contribution.memberId,
            contributionId: contribution.id,
            createdAt: new Date().toISOString(),
          };
          get().addWalletTxLocal(tx);
          if (activeGroupId) {
            FS.addWalletTx(activeGroupId, tx).catch(console.warn);
          }
        }
      },


});
