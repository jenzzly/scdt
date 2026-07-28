// stores/slices/investmentSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, Investment, WalletTransaction, InvestmentApprovals } from "../../types";
import * as FS from "../../lib/firestore";
import { uid, round2, fmtCurrency } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createInvestmentSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addInvestmentLocal" | "approveInvestmentStep" | "closeInvestment" | "createInvestment" | "deleteInvestment" | "deleteInvestmentLocal" | "setInvestments" | "updateInvestment" | "updateInvestmentLocal"> => ({
      setInvestments: (invs) => set({ investments: invs }),
      addInvestmentLocal: (inv) => set((s: StoreState) => ({ investments: [inv, ...s.investments] })),
      updateInvestmentLocal: (id, data) => set((s) => ({
        investments: s.investments.map((i: Investment) => (i.id === id ? { ...i, ...data } : i)),
      })),

      createInvestment: async (data) => {
        const { activeGroupId, authUid } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const defaultApprovals: InvestmentApprovals = {
          committee: { approved: false },
          accountant: { approved: false },
        };
        const investment: Investment = {
          ...data,
          id: uid(),
          status: "pending_committee",
          approvals: defaultApprovals,
          createdAt: now,
          updatedAt: now,
        };
        get().addInvestmentLocal(investment);
        // No wallet tx until investment is approved and opened
        FS.addInvestment(activeGroupId, investment).catch(console.warn);
        return investment.id;
      },

      approveInvestmentStep: async (investmentId, step, approved, comment) => {
        const { activeGroupId, investments, authUid } = get();
        if (!activeGroupId) throw new Error("No active group");
        const inv = investments.find((i: Investment) => i.id === investmentId);
        if (!inv) throw new Error("Investment not found");

        const currentApprovals: InvestmentApprovals = (inv as any).approvals ?? {
          committee: { approved: false },
          accountant: { approved: false },
        };
        const updatedApprovals: InvestmentApprovals = {
          ...currentApprovals,
          [step]: { approved, date: new Date().toISOString(), comment, userId: authUid ?? undefined },
        };

        let newStatus = inv.status;
        if (!approved) { newStatus = "closed"; }
        else if (step === "committee") { newStatus = "pending"; }
        else if (step === "accountant") { newStatus = "open"; }

        const updateData: Partial<Investment> = { approvals: updatedApprovals, status: newStatus, updatedAt: new Date().toISOString() };
        if (!approved) { (updateData as any).rejectedBy = authUid; (updateData as any).rejectedAt = new Date().toISOString(); (updateData as any).rejectionReason = comment; }
        else if (step === "accountant") { (updateData as any).approvedBy = authUid; (updateData as any).approvedAt = new Date().toISOString(); }

        get().updateInvestmentLocal(investmentId, updateData);

        // If approved and now open, create the wallet debit
        if (approved && step === "accountant") {
          const tx: WalletTransaction = {
            id: uid(), groupId: activeGroupId,
            type: "investment_disbursement",
            sourceType: "investment",
            sourceId: inv.id,
            amount: -inv.investmentAmount,
            description: `Investment: ${inv.investmentName}`,
            date: inv.startDate, investmentId: inv.id, createdAt: new Date().toISOString(),
          };
          get().addWalletTxLocal(tx);
          set((s: StoreState) => recalcGroupTotals(s));
          FS.addWalletTx(activeGroupId, tx).catch(console.warn);
        }

        try {
          get().setSyncStatus("pending");
          await FS.approveInvestmentStep(activeGroupId, investmentId, step, approved, comment);
          get().setSyncStatus("synced");
        } catch (e) {
          get().updateInvestmentLocal(investmentId, inv);
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to update investment");
          throw e;
        }
      },

      updateInvestment: async (investmentId, data) => {
        const { activeGroupId } = get();
        get().updateInvestmentLocal(investmentId, data);
        if (activeGroupId) {
          await FS.updateInvestment(activeGroupId, investmentId, data).catch(console.warn);
        }
      },

      // closeInvestment implementation with:
      closeInvestment: async (investmentId, returnAmount, actualReturn) => {
        const { activeGroupId, investments } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const inv = investments.find((i: Investment) => i.id === investmentId);
        if (!inv) throw new Error("Investment not found");
        if (inv.status === "closed") throw new Error("Investment is already closed");
        
        const profit = round2(returnAmount - inv.investmentAmount);
        const now = new Date().toISOString();
        
        // Update investment status
        get().updateInvestmentLocal(investmentId, { 
          status: "closed", 
          returnAmount, 
          actualReturn: actualReturn || profit,
          profit, 
          closedAt: now,
          updatedAt: now 
        });
        
        // Create wallet transaction for the return
        const tx: WalletTransaction = {
          id: uid(),
          groupId: activeGroupId,
          type: "investment_return",
          sourceType: "investment",
          sourceId: inv.id,
          amount: returnAmount,
          description: `Investment return: ${inv.investmentName} (${returnAmount > inv.investmentAmount ? 'Profit' : 'Loss'})`,
          date: now,
          investmentId: inv.id,
          createdAt: now,
        };
        get().addWalletTxLocal(tx);
        
        // Recalculate totals
        set((s: StoreState) => recalcGroupTotals(s));
        
        // Sync to Firebase
        try {
          await FS.updateInvestment(activeGroupId, investmentId, { 
            status: "closed", 
            returnAmount, 
            actualReturn: actualReturn || profit,
            profit, 
            closedAt: now,
            updatedAt: now 
          });
          await FS.addWalletTx(activeGroupId, tx);
          
          // Notify admin about investment closure
          const { members } = get();
          const admin = members.find(
            (m) => m.role === "admin" && m.status === "active" && m.groupId === activeGroupId
          );
          if (admin?.userId) {
            await FS.addNotification(admin.userId, {
              userId: admin.userId,
              groupId: activeGroupId,
              type: "investment_closed",
              title: "Investment Closed",
              message: `Investment "${inv.investmentName}" has been closed. Return: ${fmtCurrency(returnAmount)}, Profit: ${fmtCurrency(profit)}`,
              read: false,
              metadata: { investmentId, returnAmount, profit },
              createdAt: now,
            }).catch(console.warn);
          }
        } catch (error) {
          // Rollback on error
          get().updateInvestmentLocal(investmentId, { 
            status: inv.status, 
            returnAmount: undefined, 
            actualReturn: undefined,
            profit: undefined, 
            closedAt: undefined,
            updatedAt: inv.updatedAt 
          });
          get().deleteWalletTxLocal(tx.id);
          set((s: StoreState) => recalcGroupTotals(s));
          throw error;
        }
      },
      // ─── Delete Investment (atomic cascade to all related wallet txs) ───
      deleteInvestment: async (investmentId: ID, reason: string) => {
        const { activeGroupId, investments, walletTransactions } = get();
        if (!activeGroupId) throw new Error("No active group");

        const investment = investments.find((i: Investment) => i.id === investmentId);
        if (!investment) throw new Error("Investment not found");

        if (!["open", "pending", "pending_committee", "matured", "closed"].includes(investment.status)) {
          throw new Error(`Cannot delete investment with status: ${investment.status}`);
        }

        const previousInvestments = [...investments];
        const previousWalletTxs = [...walletTransactions];
        const associatedTxs = walletTransactions.filter(tx => tx.investmentId === investmentId);

        // Optimistic local removal — investment + every related wallet tx
        get().deleteInvestmentLocal(investmentId);

        try {
          get().setSyncStatus("pending");

          // Single atomic batch on the server: investment + all related wallet txs
          await FS.deleteInvestmentWithRelations(activeGroupId, investmentId, reason);

          get().recalcTotals();
          get().setSyncStatus("synced");
          // Note: audit log entry (including cascade count) is already written
          // server-side inside FS.deleteInvestmentWithRelations — no duplicate needed here.

        } catch (e) {
          // Rollback on error
          set((s) => ({ 
            investments: previousInvestments,
            walletTransactions: previousWalletTxs,
            ...recalcGroupTotals({ 
              ...s, 
              investments: previousInvestments, 
              walletTransactions: previousWalletTxs 
            })
          }));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete investment");
          throw e;
        }
      },

      deleteInvestmentLocal: (id: ID) => set((s: StoreState) => {
        // Also clean up any wallet transactions associated with this investment
        const remainingTxs = s.walletTransactions.filter((tx) => tx.investmentId !== id);
        return {
          investments: s.investments.filter((i: Investment) => i.id !== id),
          walletTransactions: remainingTxs,
        };
      }),


});
