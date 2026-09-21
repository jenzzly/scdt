// stores/selectors.ts
//
// Small derived-state hooks that read from useStore() and filter/compute
// something simple. Pulled out of the useStore.ts monolith purely to keep
// that file focused on store assembly; these have no special relationship
// to the store internals and could just as easily live next to the
// screens that use them.
import { useMemo } from "react";
import type { MemberRole } from "../types";

// These hooks are now re-exported from useStore.ts to avoid circular dependency
// They are implemented in the slice files to maintain the same functionality
export {
  useActiveGroup,
  useGroupMembers,
  useGroupLoans,
  useGroupContributions,
  useGroupInvestments,
  useGroupWallet,
  useGroupMeetings,
  useGroupExpenses,
  useUnreadNotifs,
  useCurrentUserRole,
  useCurrentMember,
  useDataViewMode,
  useIsGroupView,
  useIsAdminView,
  useIsApproverView,
  useHasViewToggle,
  APPROVER_ROLES,
  useCanSeeAllFinancial,
  useGroupAuditLogs,
  useGroupDeletionRecords,
  useCurrentMemberPermissions,
} from "./useStore";

import { useCurrentMember } from "./useStore";

// ─────────────────────────────────────────────────────────────────────────
// useMyMemberIds — every identifier a record might use to reference the
// current member.
//
// Records in this app were written under two conventions over time:
//   • New:    record.memberId = member-document id
//   • Legacy: record.memberId = Firebase auth userId
//
// The two are usually different strings. A screen that filters with
// `record.memberId === currentMember.id` will silently drop every legacy
// record; the same screen filtering by `currentMember.userId` will drop
// every new record. Neither single-key comparison sees the full set.
//
// This hook returns the SET of strings a record could have at
// `record.memberId` or at the (older) `record.userId` field to
// legitimately belong to the current user. Screens filter with
// `myIds.has(record.memberId) || myIds.has(record.userId)` — or the
// shorthand helper below — and get both conventions at once.
//
// Returns a Set rather than an array because every call site is a
// membership test, and Set.has is O(1) regardless of how many aliases
// the member ends up having.
// ─────────────────────────────────────────────────────────────────────────
export function useMyMemberIds(): Set<string> {
  const currentMember = useCurrentMember();

  return useMemo(() => {
    const ids = new Set<string>();
    if (!currentMember) return ids;
    if (currentMember.id) ids.add(currentMember.id);
    const asAny = currentMember as any;
    if (asAny.userId) ids.add(asAny.userId);
    return ids;
  }, [
    currentMember?.id,
    (currentMember as any)?.userId,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// recordIsMine — same logic as useMyMemberIds, exposed as a plain
// predicate so non-hook contexts (helper functions, .filter callbacks
// inside useMemo bodies that already have `myIds` in scope) can reuse
// the exact same rule without re-deriving it.
// ─────────────────────────────────────────────────────────────────────────
export function recordIsMine(
  record: { memberId?: string; userId?: string } | null | undefined,
  myIds: Set<string>,
): boolean {
  if (!record) return false;
  if (record.memberId && myIds.has(record.memberId)) return true;
  if (record.userId && myIds.has(record.userId)) return true;
  return false;
}