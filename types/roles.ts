// types/roles.ts
//
// Centralized role definitions and role-related utilities
// This ensures consistent role naming and permissions across the application

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