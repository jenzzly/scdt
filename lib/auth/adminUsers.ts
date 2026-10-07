// lib/auth/adminUsers.ts
//
// Admin user creation functionality
// Allows admins to create new Firebase Auth accounts without signing out
import { createUserWithSecondaryAuth, sendPasswordResetWithSecondaryAuth } from "./secondaryAuth";
import { addMember, findMemberByEmail } from "../firestore/members";
import { writeAuditLog } from "../firestore/audit";
import { isValidRole, type UserRole } from "../../types/roles";
import type { Member, MemberRole } from "../../types";
import { repairOwnMembershipIfDrifted } from "../firestore/reconcileMemberships";

export interface CreateUserData {
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  groupId: string;
}

/**
 * Runs the caller's own membership self-heal and waits long
 * enough for the Firestore rules engine to observe the new doc
 * before the caller proceeds to an admin-only write.
 *
 * Called at the top of every admin flow that writes on behalf
 * of another user. Without this, a drifted admin membership
 * makes every server-side admin gate fail with permission-
 * denied — while the client UI (which reads role from the
 * members doc) still shows the admin affordances.
 */
async function selfHealCallerMembership(
  groupId: string,
  callerMember: Member | null | undefined,
): Promise<void> {
  if (!callerMember?.userId) return;
  try {
    const fixed = await repairOwnMembershipIfDrifted(
      groupId,
      callerMember,
    );
    if (fixed) {
      // Rules cache the membership doc briefly; 700ms is a
      // comfortable margin without visibly stalling the action.
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch (e) {
    // A self-heal failure is not fatal — the caller may still
    // have a working membership. Fall through and let the
    // admin write attempt and report its own outcome.
    console.warn("[selfHealCallerMembership] heal failed:", e);
  }
}

export async function createUserAsAdmin(
  data: CreateUserData,
  adminUserId: string,
  adminUserName: string,
  /**
   * The caller's own Member doc. Pass this so the function can
   * repair the caller's groupMemberships drift before attempting
   * the first Firestore write. Optional for backward compat —
   * omitting it just skips the pre-flight heal.
   */
  callerMember?: Member | null
): Promise<{
  success: boolean;
  userId?: string;
  error?: string;
  /** True when the failure was "already exists" rather than a real error. */
  existing?: boolean;
}> {
  const trimmedEmail = data.email.trim();

  try {
    // ── Validate role ─────────────────────────────────────────
    if (!isValidRole(data.role)) {
      return { success: false, error: "Invalid role specified" };
    }
    if (!trimmedEmail) {
      return { success: false, error: "Email is required" };
    }

    // ── Self-heal the caller's admin membership FIRST. ──────────
    //
    // Every Firestore write below is gated by isAdminOrAccountant
    // server-side, which reads the CALLER's own groupMemberships
    // doc. If that doc has drifted, all of the writes fail with
    // permission-denied. Repairing it here, before the first
    // write, removes the whole failure class.
    await selfHealCallerMembership(data.groupId, callerMember);

    // ── Pre-check: member doc with this email already in group? ──
    //
    // This runs BEFORE the Auth create. Two reasons:
    //
    //   1. If a member doc already exists, the correct action is
    //      "Reset Password" on that member — not to create a
    //      second member doc with a duplicate email.
    //
    //   2. The Firestore write that used to happen AFTER Auth
    //      creation (addMember -> groupMemberships create) fails
    //      with "Missing or insufficient permissions" whenever the
    //      admin's own membership doc is out of sync. Doing the
    //      read first turns that into a clear, fixable error.
    //
    // The read is wrapped in a try/catch because a permissions
    // failure HERE should not block the create — we just skip
    // the pre-check and let the write surface any real error.
    // [createUserAsAdmin] existing-member pre-check
    let existingMember: Awaited<ReturnType<typeof findMemberByEmail>> = null;
    try {
      existingMember = await findMemberByEmail(data.groupId, trimmedEmail);
    } catch (lookupErr) {
      console.warn(
        "[createUserAsAdmin] existing-member lookup failed (proceeding):",
        lookupErr,
      );
    }

    if (existingMember) {
      return {
        success: false,
        existing: true,
        error:
          `${existingMember.fullName} (${trimmedEmail}) is already a member of this group. ` +
          `Open their row and use "Reset Password" to send them a password link.`,
      };
    }

    // ── Try to create the Firebase Auth account. ─────────────────
    //
    // If the email already has an account (signed up before,
    // invited to a different group, etc.), `createUserWithEmailAndPassword`
    // throws `auth/email-already-in-use`. That is a specific,
    // recoverable condition — surface it as such rather than
    // letting it fall through to the generic catch.
    const tempPassword = generateTempPassword();
    let uid: string;
    try {
      const result = await createUserWithSecondaryAuth(
        trimmedEmail,
        tempPassword,
      );
      uid = result.uid;
    } catch (authErr: any) {
      if (authErr?.code === "auth/email-already-in-use") {
        return {
          success: false,
          existing: true,
          error:
            "This email already has a Firebase account. If they are in the Members list, use \"Reset Password\" on their row; otherwise ask them to sign in first.",
        };
      }
      throw authErr;
    }

    // ── Create the member document + membership. ────────────────
    const memberId = await addMember(data.groupId, {
      userId: uid,
      fullName: data.fullName,
      email: trimmedEmail,
      phone: data.phone || "",
      role: data.role as MemberRole,
      status: "active",
      groupId: data.groupId,
      dateJoined: new Date().toISOString(),
      totalContributions: 0,
      totalSavings: 0,
      loanEarnings: 0,
    });

    // ── Send the invite email (best-effort). ────────────────────
    // A mail-queue failure must not roll back the member doc
    // the admin just created.
    try {
      await sendPasswordResetWithSecondaryAuth(trimmedEmail);
    } catch (mailErr) {
      console.warn("[createUserAsAdmin] reset email failed:", mailErr);
    }

    // ── Audit log. ──────────────────────────────────────────────
    try {
      await writeAuditLog(data.groupId, {
        userId: adminUserId,
        userName: adminUserName,
        groupId: data.groupId,
        action: "CREATE_USER",
        entityType: "member",
        entityId: memberId,
        after: {
          fullName: data.fullName,
          email: trimmedEmail,
          role: data.role,
          status: "active",
        },
        reason: "Admin created new user account",
      });
    } catch (auditErr) {
      console.warn("[createUserAsAdmin] audit log failed:", auditErr);
    }

    return { success: true, userId: uid };
  } catch (error: any) {
    console.error("[createUserAsAdmin] Error:", error);

    // ── Specific Firebase Auth errors. ──────────────────────────
    if (error?.code === "auth/email-already-in-use") {
      return {
        success: false,
        existing: true,
        error:
          "This email already has a Firebase account. If they are in the Members list, use \"Reset Password\" on their row.",
      };
    }
    if (error?.code === "auth/invalid-email") {
      return { success: false, error: "Invalid email address" };
    }
    if (error?.code === "auth/weak-password") {
      return { success: false, error: "Password is too weak" };
    }

    // ── Auth transport failures. ────────────────────────────────
    //
    // `auth/network-request-failed` is misleading on web: it is
    // usually not a network problem, it is the secondary Auth
    // instance being unable to reach its storage layer. See
    // lib/auth/secondaryAuth.ts. The fix there is a persistence
    // override; this branch only exists so the admin sees a
    // useful message if the persistence override ever fails.
    if (error?.code === "auth/network-request-failed") {
      return {
        success: false,
        error:
          "Auth network request failed. Usually this is a browser storage conflict, not a real network issue. Try: (1) hard-reload the page (Ctrl+Shift+R), then retry; (2) if it persists, sign out and back in, then retry.",
      };
    }
    if (error?.code === "auth/too-many-requests") {
      return {
        success: false,
        error:
          "Firebase temporarily blocked requests from this device. Wait a few minutes and try again.",
      };
    }

    // ── Firestore permission failures. ──────────────────────────
    //
    // The most common cause of a `permission-denied` here is a
    // mismatch between the admin's members doc and their
    // groupMemberships doc: the UI reads role/status from
    // `members`, but the security rules read them from
    // `groupMemberships`. If the two disagree, the client
    // offers admin actions the server then rejects.
    if (
      error?.code === "permission-denied" ||
      (typeof error?.message === "string" &&
        error.message.toLowerCase().includes("insufficient permissions"))
    ) {
      return {
        success: false,
        error:
          "The server rejected this action. Your admin role may be out of sync — open Group Settings \u2192 Members \u2192 \"Verify access\" to re-sync your role, or sign out and back in.",
      };
    }

    return {
      success: false,
      error: error?.message || "Failed to create user",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RESET USER PASSWORD (with auto-create)
// ═══════════════════════════════════════════════════════════════════
//
// Called from the Members screen when an admin hits "Reset Password"
// on a member. Two possible states:
//
//   • The member already has a Firebase Auth account → just send
//     the reset email.
//
//   • The member exists in the Firestore members collection (added
//     by an admin or CSV import) but has NO Firebase Auth account
//     yet → create it with a throwaway password, then send the
//     reset email so the member can set their real password. This
//     is what turns "admin pre-registers the member" into a
//     working invite path.
//
// Both branches end with a reset email delivered via the
// secondary-auth instance, so the admin's own session is never
// replaced.
export async function resetUserPasswordAsAdmin(
  email: string,
  adminUserId: string,
  adminUserName: string,
  groupId: string,
  /** Same self-heal plumbing as createUserAsAdmin. */
  callerMember?: Member | null
): Promise<{ success: boolean; error?: string; created?: boolean }> {
  try {
    const trimmed = email.trim();
    if (!trimmed) {
      return { success: false, error: "No email address on this member" };
    }

    // Self-heal the caller's own membership before the first
    // Firestore write (Auth create + audit log both need it).
    await selfHealCallerMembership(groupId, callerMember);

    // Step 1 — ensure the Auth account exists.
    let created = false;
    try {
      const tempPassword = generateTempPassword();
      await createUserWithSecondaryAuth(trimmed, tempPassword);
      created = true;
    } catch (e: any) {
      if (e?.code !== "auth/email-already-in-use") {
        throw e;
      }
      // Already exists — nothing to do, fall through to reset.
    }

    // Step 2 — send the reset email.
    await sendPasswordResetWithSecondaryAuth(trimmed);

    // Step 3 — audit log.
    await writeAuditLog(groupId, {
      userId: adminUserId,
      userName: adminUserName,
      groupId,
      action: created ? "CREATE_USER" : "PASSWORD_RESET_REQUEST",
      entityType: "member",
      entityId: trimmed,
      after: { email: trimmed, created },
      reason: created
        ? "Admin created Auth account + sent reset email"
        : "Admin initiated password reset for existing user",
    });

    return { success: true, created };
  } catch (error: any) {
    console.error("[resetUserPasswordAsAdmin] Error:", error);

    if (error?.code === "auth/invalid-email") {
      return { success: false, error: "Invalid email address" };
    }
    if (error?.code === "auth/weak-password") {
      return { success: false, error: "Password is too weak (internal)" };
    }
    if (error?.code === "auth/network-request-failed") {
      return {
        success: false,
        error:
          "Auth network request failed. Hard-reload the page (Ctrl+Shift+R) and retry; if it persists, sign out and back in first.",
      };
    }
    if (error?.code === "auth/too-many-requests") {
      return {
        success: false,
        error:
          "Firebase temporarily blocked requests from this device. Wait a few minutes and try again.",
      };
    }

    return {
      success: false,
      error: error?.message || "Failed to send password reset",
    };
  }
}

function generateTempPassword(): string {
  // Generate a secure temporary password
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}