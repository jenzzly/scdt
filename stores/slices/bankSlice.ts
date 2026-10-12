// stores/slices/bankSlice.ts
//
// Balance Sheet feature: one bank account per group, and a reconcile
// action that brings the wallet ledger back into agreement with the
// bank when they drift apart.
//
// Every write goes through the standard pattern:
//   1. optimistic local update
//   2. Firestore write
//   3. rollback on failure
// so the UI stays responsive and never drifts from the server.

import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { BankAccount } from "../../types";
import * as FS from "../../lib/firestore";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createBankSlice = (
  set: SetFn,
  get: GetFn,
): Pick<
  StoreState,
  "setBankAccount" | "clearBankAccount" | "reconcileBankBalance"
> => ({

  // ─────────────────────────────────────────────────────────────────
  // SET / UPDATE
  // ─────────────────────────────────────────────────────────────────

  setBankAccount: async (data: BankAccount) => {
    const { activeGroupId, groups } = get();
    if (!activeGroupId) throw new Error("No active group");

    const previous = groups.find((g) => g.id === activeGroupId)?.bankAccount;

    // Preserve reconciliation metadata when the admin edits the
    // account without reconciling (e.g. renaming the bank).
    const merged: BankAccount = {
      ...data,
      lastReconciledAt: previous?.lastReconciledAt,
      lastReconciledBy: previous?.lastReconciledBy,
      lastReconciledByName: previous?.lastReconciledByName,
    };

    // Optimistic
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === activeGroupId ? { ...g, bankAccount: merged } : g,
      ),
    }));

    try {
      get().setSyncStatus("pending");
      await FS.setBankAccount(activeGroupId, merged);
      get().setSyncStatus("synced");
    } catch (e) {
      set((s) => ({
        groups: s.groups.map((g) =>
          g.id === activeGroupId ? { ...g, bankAccount: previous } : g,
        ),
      }));
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to save bank account",
      );
      throw e;
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // CLEAR
  // ─────────────────────────────────────────────────────────────────

  clearBankAccount: async () => {
    const { activeGroupId, groups } = get();
    if (!activeGroupId) throw new Error("No active group");

    const previous = groups.find((g) => g.id === activeGroupId)?.bankAccount;
    if (!previous) return;

    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === activeGroupId ? { ...g, bankAccount: undefined } : g,
      ),
    }));

    try {
      get().setSyncStatus("pending");
      await FS.clearBankAccount(activeGroupId);
      get().setSyncStatus("synced");
    } catch (e) {
      set((s) => ({
        groups: s.groups.map((g) =>
          g.id === activeGroupId ? { ...g, bankAccount: previous } : g,
        ),
      }));
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to remove bank account",
      );
      throw e;
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // RECONCILE
  // ─────────────────────────────────────────────────────────────────

  reconcileBankBalance: async (
    actualBankBalance: number,
    reason: string,
    notes?: string,
  ) => {
    const { activeGroupId, groups, walletTransactions } = get();
    if (!activeGroupId) throw new Error("No active group");

    const group = groups.find((g) => g.id === activeGroupId);
    if (!group?.bankAccount) {
      throw new Error("No bank account is configured for this group.");
    }

    // Compute the wallet balance the same way recalcGroupTotals does —
    // sum of every signed wallet transaction for the group.
    const walletBalance =
      Math.round(
        walletTransactions
          .filter((t) => t.groupId === activeGroupId)
          .reduce((s, t) => s + (t.amount || 0), 0) * 100,
      ) / 100;

    try {
      get().setSyncStatus("pending");
      const result = await FS.recordBankReconciliation(activeGroupId, {
        walletBalance,
        actualBankBalance,
        reason,
        notes,
      });

      // Apply locally: the new wallet tx, then the updated bankAccount.
      // addWalletTxLocal already recomputes group totals (availableBalance
      // moves to match the bank), so we only need to overlay the
      // bankAccount afterwards.
      get().addWalletTxLocal(result.walletTx);
      set((s) => ({
        groups: s.groups.map((g) =>
          g.id === activeGroupId
            ? { ...g, bankAccount: result.bankAccount }
            : g,
        ),
      }));
      set((s) => recalcGroupTotals(s));

      get().setSyncStatus("synced");
      return { difference: result.difference };
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to reconcile bank balance",
      );
      throw e;
    }
  },
});
