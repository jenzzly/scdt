// stores/slices/expenseSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { Expense, WalletTransaction } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createExpenseSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addExpense" | "addExpenseLocal" | "deleteExpenseLocal" | "setExpenses" | "updateExpenseLocal"> => ({
      setExpenses: (es) => set({ expenses: es }),
      addExpenseLocal: (e) => set((s) => ({ expenses: [e, ...s.expenses] })),
      updateExpenseLocal: (id, data) => set((s) => ({
        expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...data } : e)),
      })),
      deleteExpenseLocal: (id) => set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) })),

      addExpense: async (data) => {
        const { activeGroupId } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const expense: Expense = { ...data, id: uid(), createdAt: now };
        get().addExpenseLocal(expense);
        const tx: WalletTransaction = {
          id: uid(),
          groupId: activeGroupId,
          type: "other_debit",
          amount: -data.amount,
          description: data.description,
          date: data.date,
          createdAt: now,
        };
        get().addWalletTxLocal(tx);
        set((s) => recalcGroupTotals(s));
        FS.addExpense(activeGroupId, expense).catch(console.warn);
        FS.addWalletTx(activeGroupId, tx).catch(console.warn);
        return expense.id;
      },


});
