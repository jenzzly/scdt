// lib/auth/permissions.ts
//
// Central role → navigation / capability mapping. Granular MemberPermissions
// still win when present; roles only describe the default surface.
import { DEFAULT_MEMBER_PERMISSIONS, type MemberPermissions, type UserRole } from "../../types";

export interface NavItem {
  label: string;
  route: string;
}

const FULL_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Investments", route: "/(tabs)/investments" },
  { label: "Wallet", route: "/(tabs)/wallet" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Settings", route: "/(tabs)/more" },
];

const MEMBER_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "My Contributions", route: "/(tabs)/contributions" },
  { label: "Contribution Goal", route: "/(tabs)/contributions" },
  { label: "My Loans", route: "/(tabs)/loans" },
  { label: "My Investments", route: "/(tabs)/investments" },
  { label: "Wallet", route: "/(tabs)/wallet" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Notifications", route: "/notifications" },
  { label: "Profile", route: "/(tabs)/more" },
];

const AUDIT_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Profile", route: "/(tabs)/more" },
];

const LOAN_OFFICER_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Settings", route: "/(tabs)/more" },
];

const ACCOUNTANT_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Investments", route: "/(tabs)/investments" },
  { label: "Wallet", route: "/(tabs)/wallet" },
  { label: "Contributions", route: "/(tabs)/contributions" },
  { label: "Reports", route: "/(tabs)/reports" },
  { label: "Meetings", route: "/(tabs)/meetings" },
  { label: "Settings", route: "/(tabs)/more" },
];

const COMMITTEE_WEB_NAV: NavItem[] = [
  { label: "Dashboard", route: "/(tabs)/dashboard" },
  { label: "Loans", route: "/(tabs)/loans" },
  { label: "Investments", route: "/(tabs)/investments" },
  { label: "Meetings", route: "/(tabs)/meetings" },
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
