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
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Platform } from "react-native";
import type { StoreState , SetFn, GetFn } from "./storeTypes";
import { recalcGroupTotals } from "./recalcGroupTotals";
import type { MemberRole, MemberPermissions } from "../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../types";

// Load native storage only on native platforms. AsyncStorage's web adapter
// accesses window as soon as Zustand hydrates, which also runs during SSR.
let AsyncStorage: any;
if (Platform.OS !== "web") {
  try {
    AsyncStorage = require("@react-native-async-storage/async-storage").default;
  } catch (e) {
    AsyncStorage = null;
  }
}

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
      dataViewMode: "mine",
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
      setDataViewMode: (mode) => set({ dataViewMode: mode }),
      reset: () =>
        set({
          dataViewMode: "mine",
          authUid: null, authName: null, authEmail: null,
          groups: [], members: [], contributions: [], loans: [], investments: [],
          walletTransactions: [], expenses: [], meetings: [], notifications: [],
          activeGroupId: null,
        }),
    }),
    {
      name: "scdt-v2",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage;
        }
        if (AsyncStorage) {
          return AsyncStorage;
        }
        // Fallback in-memory storage for environments without AsyncStorage
        const inMemoryStorage = new Map<string, string>();
        return {
          getItem: (name: string) => {
            const value = inMemoryStorage.get(name);
            return Promise.resolve(value ?? null);
          },
          setItem: (name: string, value: string) => {
            inMemoryStorage.set(name, value);
            return Promise.resolve();
          },
          removeItem: (name: string) => {
            inMemoryStorage.delete(name);
            return Promise.resolve();
          },
        };
      }),
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
          // Delay recalculation to ensure AsyncStorage is fully initialized
          // Use multiple attempts with progressive delays
          const attemptRecalc = (attempt: number) => {
            setTimeout(() => {
              try {
                const updates = recalcGroupTotals(state as StoreState);
                (useStore as any).setState(updates);
              } catch (e) {
                console.error(`Failed to recalc totals during rehydration (attempt ${attempt}):`, e);
                if (attempt < 3) {
                  attemptRecalc(attempt + 1);
                }
              }
            }, attempt * 200);
          };
          attemptRecalc(1);
        }
      },
    }
  )
);

// Selector hooks (useActiveGroup, useGroupMembers, etc) — implemented here
// to avoid circular dependency with selectors.ts
export const useActiveGroup = () => {
  const { groups, activeGroupId } = useStore();
  return groups.find((g) => g.id === activeGroupId);
};

export const useGroupMembers = () => {
  const { members, activeGroupId } = useStore();
  return members.filter((m) => m.groupId === activeGroupId);
};

export const useGroupLoans = () => {
  const { loans, activeGroupId } = useStore();
  return loans.filter((l) => l.groupId === activeGroupId);
};

export const useGroupContributions = () => {
  const { contributions, activeGroupId } = useStore();
  return contributions.filter((c) => c.groupId === activeGroupId);
};

export const useGroupInvestments = () => {
  const { investments, activeGroupId } = useStore();
  return investments.filter((i) => i.groupId === activeGroupId);
};

export const useGroupWallet = () => {
  const { walletTransactions, activeGroupId } = useStore();
  return walletTransactions.filter((t) => t.groupId === activeGroupId);
};

export const useGroupMeetings = () => {
  const { meetings, activeGroupId } = useStore();
  return meetings.filter((m) => m.groupId === activeGroupId);
};

export const useGroupExpenses = () => {
  const { expenses, activeGroupId } = useStore();
  return expenses.filter((e) => e.groupId === activeGroupId);
};

export const useUnreadNotifs = () => {
  const { notifications } = useStore();
  return notifications.filter((n) => !n.read).length;
};

export const useCurrentUserRole = (): MemberRole => {
  const { members, authUid } = useStore();
  const currentMember = members.find((m) => m.userId === authUid);
  return (currentMember?.role ?? "member") as MemberRole;
};

export const useCurrentMember = () => {
  const { members, authUid } = useStore();
  return members.find((m) => m.userId === authUid) ?? null;
};

export const useDataViewMode = () => useStore((s) => s.dataViewMode);

export const useIsAdminView = () => {
  const role = useCurrentUserRole();
  const dataViewMode = useDataViewMode();
  return role === "admin" && dataViewMode === "admin";
};

export const useCanSeeAllFinancial = () => {
  const role = useCurrentUserRole();
  const financialRoles: MemberRole[] = ["admin", "accountant", "loan_officer", "committee"];
  return financialRoles.includes(role);
};

export const useGroupAuditLogs = () => {
  const { auditLogs } = useStore();
  return auditLogs;
};

export const useGroupDeletionRecords = () => {
  const { deletionRecords } = useStore();
  return deletionRecords;
};

export const useCurrentMemberPermissions = (): MemberPermissions => {
  const { members, authUid } = useStore();
  const currentMember = members.find((m) => m.userId === authUid);
  // Admins always have full permissions
  if (!currentMember || currentMember.role === "admin") {
    const allTrue: Record<string, boolean> = {};
    (Object.keys(DEFAULT_MEMBER_PERMISSIONS) as (keyof MemberPermissions)[]).forEach((k) => { allTrue[k] = true; });
    return allTrue as unknown as MemberPermissions;
  }
  return currentMember.permissions ?? { ...DEFAULT_MEMBER_PERMISSIONS };
};
