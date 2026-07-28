/**
 * Global Store — Zustand with local-first + Firebase sync.
 *
 * This used to be a single ~1,600-line file defining one giant
 * create<StoreState>()({ ...everything... }) object. It's now assembled
 * from per-domain slices in stores/slices/ using Zustand's standard
 * "slices" pattern: each slice is a function (set, get) => ({ ...fields
 * and actions... }), and they're combined here with a spread. Every slice
 * still gets `get()` typed against the FULL combined store (see
 * stores/storeTypes.ts), so e.g. loanSlice can call get().recalcTotals()
 * even though recalcTotals lives in groupSlice — behavior is unchanged
 * from the monolith, only the file layout is different.
 *
 * Adding a new domain? Create stores/slices/xSlice.ts exporting
 * createXSlice(set, get), add its fields to StoreState in storeTypes.ts,
 * and spread it in below.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StoreState , SetFn, GetFn } from "./storeTypes";
import { recalcGroupTotals } from "./recalcGroupTotals";

import { createAuthSlice } from "./slices/authSlice";
import { createGroupSlice } from "./slices/groupSlice";
import { createMemberSlice } from "./slices/memberSlice";
import { createContributionSlice } from "./slices/contributionSlice";
import { createLoanSlice } from "./slices/loanSlice";
import { createInvestmentSlice } from "./slices/investmentSlice";
import { createWalletSlice } from "./slices/walletSlice";
import { createExpenseSlice } from "./slices/expenseSlice";
import { createMeetingSlice } from "./slices/meetingSlice";
import { createNotificationSlice } from "./slices/notificationSlice";
import { createAuditSlice } from "./slices/auditSlice";
import { createSyncSlice } from "./slices/syncSlice";

export const useStore = create<StoreState>()(
  persist(
    (set: SetFn, get: GetFn) => ({
      // ── Initial state ──────────────────────────────────────────────────
      authUid: null, authName: null, authEmail: null,
      groups: [], activeGroupId: null,
      members: [], contributions: [], loans: [], investments: [],
      walletTransactions: [], expenses: [], meetings: [],
      notifications: [], deletionRecords: [], auditLogs: [],
      syncStatus: "synced", syncError: null, lastSyncTimestamp: null,
      forceSyncTrigger: 0, isLoading: false,

      // ── Domain slices ───────────────────────────────────────────────────
      ...createAuthSlice(set, get),
      ...createGroupSlice(set, get),
      ...createMemberSlice(set, get),
      ...createContributionSlice(set, get),
      ...createLoanSlice(set, get),
      ...createInvestmentSlice(set, get),
      ...createWalletSlice(set, get),
      ...createExpenseSlice(set, get),
      ...createMeetingSlice(set, get),
      ...createNotificationSlice(set, get),
      ...createAuditSlice(set, get),
      ...createSyncSlice(set, get),

      // ── Cross-cutting (touches every slice's state, stays here) ────────
      reset: () =>
        set({
          authUid: null, authName: null, authEmail: null,
          groups: [], members: [], contributions: [], loans: [], investments: [],
          walletTransactions: [], expenses: [], meetings: [], notifications: [],
          activeGroupId: null,
        }),
    }),
    {
      name: "scdt-v2",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s: StoreState) => ({
        authUid: s.authUid,
        authName: s.authName,
        authEmail: s.authEmail,
        groups: s.groups,
        activeGroupId: s.activeGroupId,
        members: s.members,
        contributions: s.contributions,
        loans: s.loans,
        investments: s.investments,
        walletTransactions: s.walletTransactions,
        expenses: s.expenses,
        meetings: s.meetings,
      }),
      onRehydrateStorage: () => (state: StoreState | undefined, error: unknown) => {
        if (error) {
          console.error("Failed to rehydrate store:", error);
        } else if (state) {
          setTimeout(() => {
            const updates = recalcGroupTotals(state as StoreState);
            (useStore as any).setState(updates);
          }, 100);
        }
      },
    }
  )
);

// Selector hooks (useActiveGroup, useGroupMembers, etc) now live in
// stores/selectors.ts — re-exported here so existing
// `import { useActiveGroup } from "../stores/useStore"` call sites keep
// working unchanged.
export * from "./selectors";
