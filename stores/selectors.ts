// stores/selectors.ts
//
// Small derived-state hooks that read from useStore() and filter/compute
// something simple. Pulled out of the useStore.ts monolith purely to keep
// that file focused on store assembly; these have no special relationship
// to the store internals and could just as easily live next to the
// screens that use them.
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
  useIsAdminView,
  useCanSeeAllFinancial,
  useGroupAuditLogs,
  useGroupDeletionRecords,
  useCurrentMemberPermissions,
} from "./useStore";
