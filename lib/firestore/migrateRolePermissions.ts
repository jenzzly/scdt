// lib/firestore/migrateRolePermissions.ts
//
// One-time, idempotent migration: seeds group.rolePermissions (and an
// empty group.customRolePermissions map) the first time an admin loads a
// group whose Firestore data predates the group-level role-permissions
// model. Firestore security rules now read permission grants from
// group.rolePermissions[roleKey] / group.customRolePermissions[roleId] as
// the baseline (see firestore.rules — hasPermission()), with each
// member's own `permissions` field acting only as a per-key override.
// Groups created before this change have no rolePermissions field at
// all, so every role-gated action silently fails closed until this runs
// once per group.
//
// Safe to call on every app load for an admin/accountant: it no-ops
// immediately if rolePermissions already exists, so there's no
// double-write or clobbering of permissions an admin has already
// customized via the Permissions tab.
import { doc, getDoc, updateDoc, db } from "./core";
import type { MemberPermissions, MemberRole } from "../../types";
import { DEFAULT_MEMBER_PERMISSIONS } from "../../types";

// Mirrors SYSTEM_ROLE_DEFAULT_PERMISSIONS in app/group-settings.tsx.
// Duplicated here (rather than imported) because that file is a screen
// component, not a shared module, and this migration needs to run
// before the Group Settings screen is ever opened, from wherever the
// group first loads (see wiring note at the bottom of this file).
const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<MemberRole, MemberPermissions> = {
  admin: {
    addContribution: true, addLoan: true, addInvestment: true,
    approveContributions: true, approveLoans: true, approveInvestments: true,
    viewAllReports: true, downloadReports: true,
    manageMeetings: true, editMembers: true, deleteRecords: true, manageSettings: true,
  },
  accountant: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, viewAllReports: true, downloadReports: true,
  },
  loan_officer: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    addLoan: true, approveLoans: true, viewAllReports: true,
  },
  committee: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    approveContributions: true, approveLoans: true, approveInvestments: true, viewAllReports: true,
  },
  member: {
    ...DEFAULT_MEMBER_PERMISSIONS,
    addContribution: true,
  },
};

/**
 * Seeds group.rolePermissions / group.customRolePermissions from the
 * built-in system-role defaults if — and only if — rolePermissions is
 * completely absent from the group document. No-ops otherwise.
 *
 * Must be called by a user who already passes isAdminOrAccountant(groupId)
 * per firestore.rules (the groups/{groupId} update rule), since this is a
 * plain updateDoc against the group document. Calling it as a non-admin
 * will throw permission-denied — catch and ignore in that case, since a
 * non-admin has no reason to run this (only an admin/accountant can save
 * role permissions from the Permissions tab in the first place).
 *
 * Returns true if a migration write happened, false if it was a no-op
 * (already migrated).
 */
export async function migrateRolePermissionsIfNeeded(groupId: string): Promise<boolean> {
  if (!groupId) return false;

  const groupRef = doc(db, "groups", groupId);
  const snap = await getDoc(groupRef);
  if (!snap.exists()) return false;

  const data = snap.data();

  // Already migrated (or an admin has already saved permissions for at
  // least one role from the Permissions tab, which writes this same
  // field) — nothing to do. Checking for the field's mere presence,
  // not completeness, is deliberate: a partially-saved rolePermissions
  // map (e.g. admin saved "member" but never touched "committee")
  // still means the migration already ran and its defaults for the
  // untouched roles are recoverable from group-settings.tsx's own
  // fallback (`SYSTEM_ROLE_DEFAULT_PERMISSIONS[key]`) rather than this
  // migration re-running and silently overwriting a role an admin
  // deliberately customized down from the default.
  if (data && "rolePermissions" in data) return false;

  await updateDoc(groupRef, {
    rolePermissions: SYSTEM_ROLE_DEFAULT_PERMISSIONS,
    // Seed as an empty map rather than leaving the field absent, so
    // firestore.rules' `'customRolePermissions' in groupDoc(groupId)` 
    // check is well-defined (false is different from "field missing"
    // for readability of the rules, even though both currently
    // evaluate the same way) and so the first custom role created
    // merges into an existing map instead of the client having to
    // special-case "field doesn't exist yet."
    customRolePermissions: {},
  });

  return true;
}