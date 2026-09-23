// lib/auth/permissions.ts
//
// Central role → navigation / capability mapping. Granular MemberPermissions
// still win when present; roles only describe the default surface.
import { DEFAULT_MEMBER_PERMISSIONS, type MemberPermissions } from "../../types";
import type { UserRole } from "../../types/roles";

export interface NavItem {
  label: string;
  route: string;
}

const FULL_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Investments", route: "/(tabs)/investments" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Members", route: "/(tabs)/members" },
  { label: "Wallet", route: "/(tabs)/wallet" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Settings", route: "/(tabs)/more" },
];

const MEMBER_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  // Members tab is the "me" page — a member sees only their own card
  // (personal view) and their own risk breakdown. Both mobile and web.
  { label: "Members", route: "/(tabs)/members" },
  { label: "Settings", route: "/(tabs)/more" },
];

const AUDIT_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Settings", route: "/(tabs)/more" },
];

const LOAN_OFFICER_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Settings", route: "/(tabs)/more" },
];

const ACCOUNTANT_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Members", route: "/(tabs)/members" },
  { label: "Wallet", route: "/(tabs)/wallet" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Settings", route: "/(tabs)/more" },
];

const COMMITTEE_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Investments", route: "/(tabs)/investments" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Settings", route: "/(tabs)/more" },
];

const GROUPS_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Settings", route: "/(tabs)/more" },
];

export function getWebNavForRole(
  role: UserRole,
  permissions?: MemberPermissions,
): NavItem[] {
  const perms = permissions ?? DEFAULT_MEMBER_PERMISSIONS;
  let items: NavItem[];
  switch (role) {
    case "admin":
      items = FULL_WEB_NAV;
      break;
    case "accountant":
      items = ACCOUNTANT_WEB_NAV;
      break;
    case "loan_officer":
      items = LOAN_OFFICER_WEB_NAV;
      break;
    case "committee":
      items = COMMITTEE_WEB_NAV;
      break;
    case "audit":
      items = AUDIT_WEB_NAV;
      break;
    case "groups":
      items = GROUPS_WEB_NAV;
      break;
    case "member":
    default:
      items = MEMBER_WEB_NAV;
      break;
  }

  if (role !== "admin" && role !== "member" && perms.viewAllReports) {
    if (!items.some((i) => i.route === "/(tabs)/reports")) {
      items = [...items, { label: "Reports", route: "/(tabs)/reports" }];
    }
  }
  return items;
}

export function canManageMembers(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.editMembers === true;
}

export function canManageGroupSettings(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.manageSettings === true;
}

export function canCreateUsers(role: UserRole): boolean {
  return role === "admin";
}

// Centralized permission functions as per spec
export function canViewAllContributions(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.viewAllReports === true;
}

export function canApproveContributions(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.approveContributions === true;
}

export function canViewAllLoans(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant" || role === "loan_officer" || role === "committee") return true;
  return permissions?.viewAllReports === true;
}

export function canApproveLoanStage1(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "loan_officer") return true;
  return permissions?.approveLoans === true;
}

export function canApproveLoanStage2(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "committee") return true;
  return permissions?.approveLoans === true;
}

export function canDisburseLoans(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.approveLoans === true;
}

export function canRecordRepayment(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.addContribution === true;
}

export function canManageWallet(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.manageSettings === true;
}

export function canApproveInvestments(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "committee") return true;
  return permissions?.approveInvestments === true;
}

export function canViewInvestments(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "committee") return true;
  return permissions?.viewAllReports === true;
}

// Wallet visibility relaxed to every authenticated member of an active
// group. Two reasons:
//
//   1. Rules already permit it. `match /walletTransactions/{id}` has
//      `allow list: if isAdminOrAccountant(groupId) || isActiveMember(groupId)`,
//      so the whole-collection list that `subscribeWalletTxs` runs is
//      legal for any active member. Leaving this gate closed just meant
//      the client declined to make a read it was allowed to make.
//
//   2. Subscribing members to the wallet gives three things:
//        • Their own ledger rows (contributions, interest paid,
//          repayments, late fees, penalties) — this is what finally
//          makes member `loanEarnings` non-zero, and it means the
//          Recent Activity list on the dashboard shows real
//          transactions instead of the synthesized fallback.
//        • Correct group totals on their device too, because
//          recalcGroupTotals runs locally and needs the collection to
//          compute `availableBalance` / `totalInterestEarned`. With a
//          partial read it would compute garbage; with the full read
//          it computes exactly what staff devices compute.
//        • No new UI surface. The Wallet tab is not in
//          MEMBER_WEB_NAV; mobile nav filters it out explicitly; and
//          every screen that reads `useGroupWallet()` already filters
//          to the current member when not in group view.
//
// The permission argument is retained for API compatibility with the
// other canView* helpers and for future fine-grained overrides; today
// the answer is the same for every role that has reached this code
// path (pending/suspended users are intercepted before mount).
export function canViewWallet(role: UserRole, permissions?: MemberPermissions): boolean {
  void role;
  void permissions;
  return true;
}

export function canViewReports(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant" || role === "audit") return true;
  return permissions?.viewAllReports === true;
}

export function canViewAuditLogs(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant" || role === "audit") return true;
  return permissions?.viewAllReports === true;
}

export function canManageSettings(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin") return true;
  return permissions?.manageSettings === true;
}

export function canResetPasswords(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.editMembers === true;
}

export function hasViewToggle(role: UserRole): boolean {
  return role === "admin" || role === "accountant" || role === "loan_officer" || role === "committee";
}

/** @deprecated alias for hasViewToggle */
export function hasAdminViewToggle(role: UserRole): boolean {
  return hasViewToggle(role);
}