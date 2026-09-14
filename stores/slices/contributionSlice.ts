// stores/slices/contributionSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, Contribution, WalletTransaction } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";
import {
  findContributionWalletTx,
  buildLinkedTxPatch,
} from "../../utils/linkedWalletSync";

export const createContributionSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addContributionLocal" | "approveContribution" | "deleteContribution" | "deleteContributionLocal" | "recordContribution" | "rejectContribution" | "setContributions" | "updateContribution" | "updateContributionAndSync" | "updateContributionLocal"> => ({
      setContributions: (cs) => set({ contributions: cs }),
      addContributionLocal: (c) => set((s) => ({ contributions: [c, ...s.contributions] })),
      updateContributionLocal: (id, data) => set((s) => ({
        contributions: s.contributions.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })),
      deleteContributionLocal: (id) => set((s) => ({ contributions: s.contributions.filter((c) => c.id !== id) })),

      deleteContribution: async (contributionId: ID, reason: string) => {
        const { activeGroupId, contributions, walletTransactions, members, authName } = get();
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

          const submitter = members.find((m) => m.id === contribution.memberId);
          if (submitter?.userId) {
            FS.addNotification(submitter.userId, {
              userId: submitter.userId,
              groupId: activeGroupId,
              type: "contribution_deleted",
              title: "Contribution Removed",
              message: `Your contribution of ${contribution.amount} RWF was removed by ${authName || "an admin"}${reason ? `: ${reason}` : ""}`,
              read: false,
              metadata: { contributionId, reason },
              createdAt: new Date().toISOString(),
            }, submitter.email).catch(console.warn);
          }
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
        const { activeGroupId, members } = get();
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
          } else {
            // Needs approval — notify whoever can approve contributions:
            // admin, accountant, and loan_officer always can (see
            // firestore rules canApproveContributions); committee only
            // with an explicit permission, which isn't checked here
            // since it's a per-member flag rather than a role — the
            // small risk of notifying a committee member who then
            // can't actually act is preferable to silently notifying
            // no one when a committee member DOES have the permission.
            const submitter = members.find((m) => m.id === data.memberId);
            const approvers = members.filter(
              (m) =>
                m.groupId === activeGroupId &&
                m.status === "active" &&
                ["admin", "accountant", "loan_officer"].includes(m.role) &&
                !!m.userId
            );
            for (const approver of approvers) {
              FS.addNotification(approver.userId!, {
                userId: approver.userId!,
                groupId: activeGroupId,
                type: "contribution_pending",
                title: "New Contribution Awaiting Approval",
                message: `${submitter?.fullName ?? "A member"} submitted a contribution of ${data.amount} RWF`,
                read: false,
                metadata: { contributionId: contribution.id },
                createdAt: now,
              }, approver.email).catch(console.warn);
            }
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
        const { activeGroupId, contributions, members } = get();
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

        const submitter = members.find((m) => m.id === c.memberId);
        if (submitter?.userId) {
          FS.addNotification(submitter.userId, {
            userId: submitter.userId,
            groupId: activeGroupId,
            type: "contribution_approved",
            title: "Contribution Approved",
            message: `Your contribution of ${c.amount} RWF has been approved`,
            read: false,
            metadata: { contributionId },
            createdAt: new Date().toISOString(),
          }, submitter.email).catch(console.warn);
        }
      },

      rejectContribution: async (contributionId, reason) => {
        const { activeGroupId, contributions, members } = get();
        get().updateContributionLocal(contributionId, { status: "rejected", rejectionReason: reason });
        if (activeGroupId) {
          FS.updateContribution(activeGroupId, contributionId, {
            status: "rejected",
            rejectionReason: reason,
          }).catch(console.warn);
        }

        const c = contributions.find((x) => x.id === contributionId);
        const submitter = c ? members.find((m) => m.id === c.memberId) : undefined;
        if (activeGroupId && submitter?.userId && c) {
          FS.addNotification(submitter.userId, {
            userId: submitter.userId,
            groupId: activeGroupId,
            type: "contribution_rejected",
            title: "Contribution Rejected",
            message: `Your contribution of ${c.amount} RWF was rejected${reason ? `: ${reason}` : ""}`,
            read: false,
            metadata: { contributionId, rejectionReason: reason },
            createdAt: new Date().toISOString(),
          }, submitter.email).catch(console.warn);
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

      // ═══════════════════════════════════════════════════════════════════════
      // EDIT CONTRIBUTION + SYNC LINKED WALLET TX
      // ═══════════════════════════════════════════════════════════════════════
      //
      // Distinct from `updateContribution` above (which is a general-purpose
      // patch used for status transitions and doesn't touch amount/date of
      // an existing linked tx). This is specifically the "user edited the
      // contribution's amount/date/description in a form" path — it:
      //
      //   1. Updates the Contribution record itself.
      //   2. If an approved contribution has a linked wallet tx
      //      (type: "contribution", contributionId match), patches that
      //      tx's amount/date/description to match.
      //   3. Rolls back BOTH writes if either Firestore call fails, so the
      //      contribution and its wallet tx never drift out of sync.
      //
      // Only amount / date / description are accepted here — matches the
      // same restriction edit-transaction.tsx enforces for direct wallet
      // edits, and avoids the more complex status-transition logic that
      // `updateContribution` already owns.
      updateContributionAndSync: async (contributionId, data) => {
        const { activeGroupId, contributions, walletTransactions } = get();
        if (!activeGroupId) throw new Error("No active group");

        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");

        const allowed: Partial<Pick<Contribution, "amount" | "date" | "description">> = {};
        if (data.amount !== undefined) allowed.amount = data.amount;
        if (data.date !== undefined) allowed.date = data.date;
        if (data.description !== undefined) allowed.description = data.description;

        const previousContribution = { ...contribution };
        const linkedTx = findContributionWalletTx(walletTransactions, contributionId);
        const previousTx = linkedTx ? { ...linkedTx } : null;

        // Optimistic local updates.
        get().updateContributionLocal(contributionId, allowed);

        if (linkedTx) {
          const txPatch = buildLinkedTxPatch(linkedTx, allowed);
          get().updateWalletTxLocal(linkedTx.id, txPatch);
        }

        set((s) => recalcGroupTotals(s));

        try {
          get().setSyncStatus("pending");

          await FS.updateContribution(activeGroupId, contributionId, allowed);

          if (linkedTx) {
            const txPatch = buildLinkedTxPatch(linkedTx, allowed);
            await FS.updateWalletTx(activeGroupId, linkedTx.id, txPatch);
          }

          get().recalcTotals();
          get().setSyncStatus("synced");
        } catch (e) {
          // Roll back both records together.
          get().updateContributionLocal(contributionId, previousContribution);
          if (linkedTx && previousTx) {
            get().updateWalletTxLocal(linkedTx.id, previousTx);
          }
          set((s) => recalcGroupTotals(s));

          get().setSyncStatus(
            "failed",
            e instanceof Error ? e.message : "Failed to update contribution"
          );
          throw e;
        }
      },
});