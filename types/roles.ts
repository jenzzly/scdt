// types/roles.ts
//
// Centralized role definitions and role-related utilities
// This ensures consistent role naming and permissions across the application

import {
  DEFAULT_MEMBER_PERMISSIONS,
  type MemberPermissions,
  type MemberRole,
} from "./index";

export const USER_ROLES = [
  "admin",
  "accountant",
  "committee",
  "loan_officer",
  "audit",
  "member",
  "groups",
] as const;

export type UserRole = typeof USER_ROLES[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  accountant: "Accountant",
  committee: "Committee",
  loan_officer: "Loan Officer",
  audit: "Audit",
  member: "Member",
  groups: "Groups",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "Full administrative access to all group functions",
  accountant: "Financial management and accounting functions",
  committee: "Committee oversight and loan approval functions",
  loan_officer: "Loan management and approval functions",
  audit: "Audit and reporting access",
  member: "Standard member access to personal functions",
  groups: "Group-level functions and permissions",
};

export function getRoleLabel(role: UserRole): string {
  return ROLE_LABELS[role] || role;
}

export function getRoleDescription(role: UserRole): string {
  return ROLE_DESCRIPTIONS[role] || "";
}

export function isValidRole(role: string): role is UserRole {
  return USER_ROLES.includes(role as UserRole);
}

// ─────────────────────────────────────────────────────────────────
// SYSTEM_ROLE_DEFAULT_PERMISSIONS
//
// Starting-point permission templates for the 5 built-in roles.
// Admins are always full-access; the other four are sensible defaults
// that the Permissions tab can override. Consolidating these here —
// they used to be duplicated in app/group-settings.tsx and
// lib/firestore/migrateRolePermissions.ts, and had drifted — means
// there is exactly one source of truth for what a role "starts as".
//
// The screen version used to be a subset (missing manageLoans,
// applyLateFees, recordAttendance, viewAuditLogs, manageBackup on the
// accountant / loan_officer / committee roles). The migration file's
// shape is what actually seeded real groups, so it's the one that
// wins here — no behavior change for existing groups.
// ─────────────────────────────────────────────────────────────────
export const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<
  MemberRole,
  MemberPermissions
> = {
  admin: {
    addContribution: true, addLoan: true, addInvestment: true,
    approveContributions: true, approveLoans: true, approveInvestments: true,
    viewAllReports: true, downloadReports: true,
    manageMeetings: true, editMembers: true, deleteRecords: true, manageSettings: true,
    manageContributions: true, manageLoans: true, manageInvestments: true,
    applyLateFees: true, waiveLateFees: true, recordAttendance: true,
    viewAuditLogs: true, revertAuditLogs: true,
    manageRoles: true, manageBackup: true,
  },
  accountant: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, viewAllReports: true, downloadReports: true,
    manageContributions: true, manageLoans: true, manageInvestments: true,
    applyLateFees: true, waiveLateFees: true, recordAttendance: true,
    viewAuditLogs: true, manageBackup: true,
  },
  loan_officer: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    addLoan: true, approveLoans: true, viewAllReports: true,
    manageLoans: true, applyLateFees: true, recordAttendance: true,
  },
  committee: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, approveLoans: true, approveInvestments: true, viewAllReports: true,
    recordAttendance: true, viewAuditLogs: true,
  },
  member: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    // member role: can apply for their own loan
    addContribution: true,
    addLoan: true,
  },
};
