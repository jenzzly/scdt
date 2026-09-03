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

export function canViewWallet(role: UserRole, permissions?: MemberPermissions): boolean {
  if (role === "admin" || role === "accountant") return true;
  return permissions?.manageSettings === true;
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
