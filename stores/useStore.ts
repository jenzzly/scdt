// stores/useStore.ts
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
import type { StoreState, SetFn, GetFn } from "./storeTypes";
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
      authUid: null, 
      authName: null, 
      authEmail: null,
      groups: [], 
      activeGroupId: null,
      members: [], 
      contributions: [], 
      loans: [], 
      investments: [],
      walletTransactions: [], 
      expenses: [], 
      meetings: [],
      notifications: [], 
      deletionRecords: [], 
      auditLogs: [],
      syncStatus: "synced", 
      syncError: null, 
      lastSyncTimestamp: null,
      forceSyncTrigger: 0, 
      isLoading: false,
      // Add currentMember for quick access
      currentMember: null,

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
      
      // Set current member with validation
      setCurrentMember: (member) => {
        if (member) {
          console.log(`[Store] Setting current member: ${member.fullName}, role: ${member.role}, id: ${member.id}`);
          set({ currentMember: member });
        } else {
          console.log('[Store] Clearing current member');
          set({ currentMember: null });
        }
      },
      
      // Set auth info with member lookup
      setAuth: (uid: string | null, name: string | null, email: string | null) => {
        console.log(`[Store] Setting auth: uid=${uid}, name=${name}, email=${email}`);
        set({ 
          authUid: uid, 
          authName: name, 
          authEmail: email 
        });
        
        // If we have a uid, try to find the member
        if (uid) {
          const state = get();
          const member = state.members.find((m) => m.userId === uid);
          if (member) {
            console.log(`[Store] Found member for auth: ${member.fullName}, role: ${member.role}`);
            set({ currentMember: member });
          } else {
            console.log('[Store] No member found for auth uid');
          }
        }
      },
      
      reset: () =>
        set({
          dataViewMode: "mine",
          authUid: null, 
          authName: null, 
          authEmail: null,
          groups: [], 
          members: [], 
          contributions: [], 
          loans: [], 
          investments: [],
          walletTransactions: [], 
          expenses: [], 
          meetings: [], 
          notifications: [],
          activeGroupId: null,
          currentMember: null,
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
        // Don't persist currentMember - it will be re-computed on rehydration
      }),
      onRehydrateStorage: () => (state: StoreState | undefined, error: unknown) => {
        if (error) {
          console.error("Failed to rehydrate store:", error);
        } else if (state) {
          console.log('[Store] Rehydrating storage...');
          
          // Set currentMember based on authUid
          if (state.authUid) {
            const currentMember = state.members.find((m) => m.userId === state.authUid);
            if (currentMember) {
              console.log(`[Store] Rehydration: Setting currentMember ${currentMember.fullName}, role: ${currentMember.role}`);
              (useStore as any).setState({ currentMember });
            } else {
              console.log('[Store] Rehydration: No member found for auth uid');
            }
          }
          
          // Delay recalculation to ensure AsyncStorage is fully initialized
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

// ─────────────────────────────────────────────────────────────────────────────
// Selector Hooks - All selectors in one place
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the active group from the store
 */
export const useActiveGroup = () => {
  const { groups, activeGroupId } = useStore();
  return groups.find((g) => g.id === activeGroupId);
};

/**
 * Get all members in the active group
 */
export const useGroupMembers = () => {
  const { members, activeGroupId } = useStore();
  return members.filter((m) => m.groupId === activeGroupId);
};

/**
 * Get all loans in the active group
 */
export const useGroupLoans = () => {
  const { loans, activeGroupId } = useStore();
  return loans.filter((l) => l.groupId === activeGroupId);
};

/**
 * Get all contributions in the active group
 */
export const useGroupContributions = () => {
  const { contributions, activeGroupId } = useStore();
  return contributions.filter((c) => c.groupId === activeGroupId);
};

/**
 * Get all investments in the active group
 */
export const useGroupInvestments = () => {
  const { investments, activeGroupId } = useStore();
  return investments.filter((i) => i.groupId === activeGroupId);
};

/**
 * Get all wallet transactions in the active group
 */
export const useGroupWallet = () => {
  const { walletTransactions, activeGroupId } = useStore();
  return walletTransactions.filter((t) => t.groupId === activeGroupId);
};

/**
 * Get all meetings in the active group
 */
export const useGroupMeetings = () => {
  const { meetings, activeGroupId } = useStore();
  return meetings.filter((m) => m.groupId === activeGroupId);
};

/**
 * Get all expenses in the active group
 */
export const useGroupExpenses = () => {
  const { expenses, activeGroupId } = useStore();
  return expenses.filter((e) => e.groupId === activeGroupId);
};

/**
 * Get unread notification count
 */
export const useUnreadNotifs = () => {
  const { notifications } = useStore();
  return notifications.filter((n) => !n.read).length;
};

/**
 * Get all notifications
 */
export const useNotifications = () => {
  const { notifications } = useStore();
  return notifications;
};

// ─── Current User Selectors ────────────────────────────────────────────────

/**
 * Get the current user's role from the store.
 * Falls back to "member" if not found.
 */
export const useCurrentUserRole = (): MemberRole => {
  const { members, authUid, currentMember } = useStore();
  
  // First check if we have a currentMember set
  if (currentMember) {
    return currentMember.role as MemberRole;
  }
  
  // Fallback: find by authUid
  if (authUid) {
    const member = members.find((m) => m.userId === authUid);
    if (member) {
      console.log(`[useCurrentUserRole] Found member by authUid: ${member.fullName}, role: ${member.role}`);
      return member.role as MemberRole;
    }
  }
  
  console.log(`[useCurrentUserRole] No member found, defaulting to "member"`);
  return "member" as MemberRole;
};

/**
 * Get the current member object from the store.
 * Returns null if not found.
 */
export const useCurrentMember = () => {
  const { members, authUid, currentMember } = useStore();
  
  // First check if we have a currentMember set
  if (currentMember) {
    return currentMember;
  }
  
  // Fallback: find by authUid
  if (authUid) {
    const member = members.find((m) => m.userId === authUid);
    if (member) {
      console.log(`[useCurrentMember] Found member by authUid: ${member.fullName}`);
      // Update the store with the found member
      (useStore as any).setState({ currentMember: member });
      return member;
    }
  }
  
  return null;
};

/**
 * Get the data view mode (admin or mine)
 */
export const useDataViewMode = () => useStore((s) => s.dataViewMode);

/**
 * Check if the user is in admin view mode.
 * Only true for admin role with dataViewMode === "admin".
 */
export const useIsAdminView = () => {
  const role = useCurrentUserRole();
  const dataViewMode = useDataViewMode();
  return role === "admin" && dataViewMode === "admin";
};

/**
 * Roles that review other members' loan/investment/meeting approvals
 * (committee, loan_officer, accountant).
 */
export const APPROVER_ROLES: MemberRole[] = ["loan_officer", "committee", "accountant"];

/**
 * Check if the user is in approver view mode.
 * True for approver roles with dataViewMode === "admin".
 */
export const useIsApproverView = () => {
  const role = useCurrentUserRole();
  const dataViewMode = useDataViewMode();
  return APPROVER_ROLES.includes(role) && dataViewMode === "admin";
};

/**
 * True whenever the current role has ANY "mine vs admin"-style toggle
 * available — admin (full) or an approver role (scoped).
 * Use this to decide whether to render the toggle switch itself.
 */
export const useHasViewToggle = () => {
  const role = useCurrentUserRole();
  return role === "admin" || APPROVER_ROLES.includes(role);
};

/**
 * Check if the user can see all financial data.
 * True for admin, accountant, loan_officer, and committee.
 */
export const useCanSeeAllFinancial = () => {
  const role = useCurrentUserRole();
  const financialRoles: MemberRole[] = ["admin", "accountant", "loan_officer", "committee"];
  return financialRoles.includes(role);
};

/**
 * Get audit logs for the active group
 */
export const useGroupAuditLogs = () => {
  const { auditLogs, activeGroupId } = useStore();
  return auditLogs.filter((log) => log.groupId === activeGroupId);
};

/**
 * Get deletion records for the active group
 */
export const useGroupDeletionRecords = () => {
  const { deletionRecords, activeGroupId } = useStore();
  return deletionRecords.filter((record) => record.groupId === activeGroupId);
};

/**
 * Get the current member's permissions.
 * Admins always have full permissions (all true).
 * Other roles get their permissions from the member document or defaults.
 */
export const useCurrentMemberPermissions = (): MemberPermissions => {
  const { members, authUid, currentMember } = useStore();
  
  // First check currentMember
  const member = currentMember || members.find((m) => m.userId === authUid);
  
  // Admins always have full permissions
  if (!member || member.role === "admin") {
    const allTrue: Record<string, boolean> = {};
    (Object.keys(DEFAULT_MEMBER_PERMISSIONS) as (keyof MemberPermissions)[]).forEach((k) => { 
      allTrue[k] = true; 
    });
    return allTrue as unknown as MemberPermissions;
  }
  
  return member.permissions ?? { ...DEFAULT_MEMBER_PERMISSIONS };
};

/**
 * Get the current member's permissions with role-based overrides.
 * This includes both direct permissions and role-based defaults.
 */
export const useEffectivePermissions = (): MemberPermissions => {
  const role = useCurrentUserRole();
  const permissions = useCurrentMemberPermissions();
  
  // Admins have full permissions
  if (role === "admin") {
    const allTrue: Record<string, boolean> = {};
    (Object.keys(DEFAULT_MEMBER_PERMISSIONS) as (keyof MemberPermissions)[]).forEach((k) => { 
      allTrue[k] = true; 
    });
    return allTrue as unknown as MemberPermissions;
  }
  
  // Role-based default permissions
  const roleDefaults: Partial<Record<MemberRole, Partial<MemberPermissions>>> = {
    loan_officer: {
      addLoan: true,
      approveLoans: true,
      approveContributions: true,
      viewAllReports: true,
      downloadReports: true,
    },
    accountant: {
      addContribution: true,
      approveContributions: true,
      viewAllReports: true,
      downloadReports: true,
    },
    committee: {
      approveLoans: true,
      viewAllReports: true,
      manageMeetings: true,
    },
  };
  
  const defaults = roleDefaults[role as MemberRole] || {};
  
  // Merge: permissions take precedence over role defaults
  return {
    ...DEFAULT_MEMBER_PERMISSIONS,
    ...defaults,
    ...permissions,
  };
};

/**
 * Check if the current user is an admin
 */
export const useIsAdmin = (): boolean => {
  const role = useCurrentUserRole();
  return role === "admin";
};

/**
 * Check if the current user is a loan officer
 */
export const useIsLoanOfficer = (): boolean => {
  const role = useCurrentUserRole();
  return role === "loan_officer";
};

/**
 * Check if the current user is an accountant
 */
export const useIsAccountant = (): boolean => {
  const role = useCurrentUserRole();
  return role === "accountant";
};

/**
 * Check if the current user is a committee member
 */
export const useIsCommittee = (): boolean => {
  const role = useCurrentUserRole();
  return role === "committee";
};

/**
 * Check if the current user has a specific permission
 */
export const useHasPermission = (permission: keyof MemberPermissions): boolean => {
  const permissions = useCurrentMemberPermissions();
  return permissions[permission] === true;
};

// ─────────────────────────────────────────────────────────────────────────────
// Store Actions - Convenience wrappers for common actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the active group by ID
 */
export const setActiveGroup = (groupId: string | null) => {
  useStore.setState({ activeGroupId: groupId });
};

/**
 * Set the data view mode
 */
export const setDataViewMode = (mode: "admin" | "mine") => {
  useStore.setState({ dataViewMode: mode });
};

/**
 * Set auth user info
 */
export const setAuth = (uid: string | null, name: string | null, email: string | null) => {
  useStore.getState().setAuth(uid, name, email);
};

/**
 * Set the current member
 */
export const setCurrentMember = (member: any) => {
  useStore.getState().setCurrentMember(member);
};

/**
 * Reset the store
 */
export const resetStore = () => {
  useStore.getState().reset();
};

/**
 * Force a sync
 */
export const forceSync = () => {
  useStore.setState((state) => ({ forceSyncTrigger: state.forceSyncTrigger + 1 }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────────────────────

export type { StoreState };
export { useStore as default };