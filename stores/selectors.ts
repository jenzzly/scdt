// stores/selectors.ts
//
// Small derived-state hooks that read from useStore() and filter/compute
// something simple. Pulled out of the useStore.ts monolith purely to keep
// that file focused on store assembly; these have no special relationship
// to the store internals and could just as easily live next to the
// screens that use them.
import { useStore } from "./useStore";
import type { MemberRole } from "../types";

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

import type { MemberPermissions } from "../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../types";

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
