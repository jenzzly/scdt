// lib/firestore/reconcileMemberships.ts
//
// Detects and fixes drift between a members/{memberId} doc's role/status
// and its corresponding groupMemberships/{groupId}_{userId} doc.
//
// WHY THIS EXISTS: Firestore security rules (see firestore.rules) resolve
// a user's role from their groupMemberships doc (memberRole() ->
// membershipData(groupId).role), not from their members doc — but the
// app's own UI (useCurrentUserRole, currentMember, etc. in
// stores/useStore.ts) reads role from the members doc. updateMember() in
// lib/firestore/members.ts keeps the two in sync whenever a role/status
// change goes through it, but any write that touches members.role
// directly and bypasses updateMember — a manual Firestore console edit,
// a migration script, restoreGroupData's batch set — leaves the
// membership doc stale. The user then sees "admin" everywhere in the UI
// while the server, correctly, treats them as whatever their stale
// membership doc says, and every role-gated read/write is silently
// denied with no obvious cause (see the "Couldn't load your group's
// data (permission denied)" investigation this file resulted from).
//
// This is a detect+fix pair; wire the detect step into an admin-only
// "Verify member roles" action (e.g. a button in the Members tab of
// group-settings.tsx) rather than running it automatically, since
// scanning N members means N membership-doc reads and a mismatch is
// rare enough that it doesn't need constant background checking.
import { doc, getDoc, setDoc, writeBatch, auth } from "./core";
import { db } from "./core";
import type { Member } from "./core";
import { getMembershipId } from "./core";
import { updateMember } from "./members";

export interface MembershipDrift {
  memberId: string;
  memberFullName: string;
  userId: string;
  memberRole: string;
  membershipRole: string | null; // null if the membership doc doesn't exist at all
  memberStatus: string;
  membershipStatus: string | null;
}

/**
 * Scans the given members for role/status drift against their
 * groupMemberships doc. Members with no linked userId are skipped
 * (they have no membership doc to compare against, and can't sign in
 * yet regardless). Returns only the members that are actually
 * mismatched — an empty array means everything is in sync.
 */
/**
 * One entry per member whose membership doc could not be read at
 * all — either the doc is missing or the caller was denied.
 * Returned alongside the drift list so a caller can distinguish
 * "no drift" from "could not check everyone".
 */
export interface MembershipScanIssue {
  memberId: string;
  memberFullName: string;
  userId: string | null;
  membershipId: string | null;
  kind: "no-userId" | "missing-doc" | "permission-denied" | "other";
  message?: string;
}

export interface MembershipScanResult {
  drift: MembershipDrift[];
  issues: MembershipScanIssue[];
}

/**
 * Reads each member's membership doc, catching per-member failures
 * so a single unreadable doc doesn't abort the whole scan. Use
 * this from the Verify UI, which cares about the aggregate and
 * about surfacing WHICH members it couldn't check.
 *
 * findMembershipDrift below is kept for backward compatibility and
 * delegates here, throwing only if EVERY read failed (so a
 * genuinely-broken caller still gets the diagnostic path).
 */
export async function scanMembershipDrift(
  groupId: string,
  members: Member[],
): Promise<MembershipScanResult> {
  const drift: MembershipDrift[] = [];
  const issues: MembershipScanIssue[] = [];

  for (const member of members) {
    if (!member.userId) {
      issues.push({
        memberId: member.id,
        memberFullName: member.fullName,
        userId: null,
        membershipId: null,
        kind: "no-userId",
      });
      continue;
    }

    const membershipId = getMembershipId(groupId, member.userId);
    let snap;
    try {
      snap = await getDoc(doc(db, "groupMemberships", membershipId));
    } catch (e: any) {
      const code = e?.code ?? "";
      const msg = e?.message ?? String(e);
      const kind: MembershipScanIssue["kind"] =
        msg.toLowerCase().includes("insufficient") ||
        msg.toLowerCase().includes("permission") ||
        code === "permission-denied"
          ? "permission-denied"
          : "other";
      console.warn(
        "[scanMembershipDrift] read failed for member",
        {
          memberId: member.id,
          memberFullName: member.fullName,
          userId: member.userId,
          membershipId,
          code,
          message: msg,
        },
      );
      issues.push({
        memberId: member.id,
        memberFullName: member.fullName,
        userId: member.userId,
        membershipId,
        kind,
        message: msg,
      });
      continue;
    }

    if (!snap.exists()) {
      // The doc genuinely does not exist — treat as drift so the
      // fixer can recreate it.
      drift.push({
        memberId: member.id,
        memberFullName: member.fullName,
        userId: member.userId,
        memberRole: member.role,
        membershipRole: null,
        memberStatus: member.status,
        membershipStatus: null,
      });
      continue;
    }

    const data = snap.data();
    const roleMismatch = data.role !== member.role;
    const statusMismatch = data.status !== member.status;

    if (roleMismatch || statusMismatch) {
      drift.push({
        memberId: member.id,
        memberFullName: member.fullName,
        userId: member.userId,
        memberRole: member.role,
        membershipRole: data.role ?? null,
        memberStatus: member.status,
        membershipStatus: data.status ?? null,
      });
    }
  }

  return { drift, issues };
}

/**
 * Thin wrapper preserved for existing callers. If ANY scan issue
 * is a permission-denied, this throws with a message that names
 * the offending members; otherwise it returns just the drift list.
 * A missing-doc issue is treated as drift (see scanMembershipDrift)
 * so no error is thrown for those.
 */
export async function findMembershipDrift(
  groupId: string,
  members: Member[],
): Promise<MembershipDrift[]> {
  const { drift, issues } = await scanMembershipDrift(groupId, members);
  const denied = issues.filter((i) => i.kind === "permission-denied");
  if (denied.length > 0) {
    const names = denied
      .map((d) => `${d.memberFullName} (${d.membershipId})`)
      .join(", ");
    throw new Error(
      `Permission denied reading ${denied.length} membership doc${
        denied.length === 1 ? "" : "s"
      }: ${names}`,
    );
  }
  return drift;
}

/**
 * Fixes one drifted member by re-pushing their members-doc role/status
 * onto their groupMemberships doc. Treats the members doc as the
 * source of truth to reconcile toward, since that's what the app's UI
 * (and an admin editing a member through the normal Edit Member flow)
 * already shows and edits.
 *
 * Reuses updateMember() from lib/firestore/members.ts rather than
 * writing to groupMemberships directly, since that function already
 * contains the correct sync branch (create-if-missing vs update, and
 * gating on `data.role || data.status` being present) — this just
 * re-triggers it.
 */
export async function fixMembershipDrift(
  groupId: string,
  drift: MembershipDrift,
): Promise<void> {
  const user = auth.currentUser;

  // When the drift is on the CURRENT user, `updateMember` cannot
  // fix it. updateMember writes role/status via updateDoc against
  // groupMemberships, and the rules require `isAdmin(groupId)`
  // for that update. If the caller IS the drifted admin, the
  // server sees them as a non-admin and rejects — the exact
  // deadlock this is meant to break.
  //
  // The rules DO allow a user to delete and re-create their OWN
  // membership doc (see `allow delete: if resource.data.userId ==
  // uid()` and `allow create: if request.resource.data.userId ==
  // uid()`). An atomic batch gives us both operations in one
  // round-trip and one rule evaluation each — no window where
  // the user has no membership at all.
  if (user && drift.userId === user.uid) {
    const membershipId = getMembershipId(groupId, user.uid);
    const membershipRef = doc(db, "groupMemberships", membershipId);

    const batch = writeBatch(db);
    batch.delete(membershipRef);
    batch.set(membershipRef, {
      id: membershipId,
      userId: user.uid,
      groupId,
      memberId: drift.memberId,
      role: drift.memberRole,
      status: drift.memberStatus,
      email: (user.email ?? "").toLowerCase(),
      createdAt: new Date().toISOString(),
    });
    await batch.commit();
    return;
  }

  // Everyone else: the standard path, which updates both the
  // members doc and the groupMemberships doc in one call.
  await updateMember(groupId, drift.memberId, {
    role: drift.memberRole as any,
    status: drift.memberStatus as any,
    userId: drift.userId,
  });
}

/**
 * Convenience wrapper: finds and fixes every drifted member in one
 * call. Returns the list of drifts that were found (and fixed) so the
 * caller can report what happened.
 */
export async function reconcileAllMemberships(
  groupId: string,
  members: Member[],
): Promise<MembershipDrift[]> {
  const drift = await findMembershipDrift(groupId, members);
  for (const d of drift) {
    await fixMembershipDrift(groupId, d);
  }
  return drift;
}

/**
 * Detects and repairs drift on the CURRENT user's own
 * groupMemberships doc, using the delete + recreate path the
 * rules allow for a user's own membership.
 *
 * Called at the START of the drift-check flow, before anything
 * tries to read OTHER members' membership docs. Reason: every
 * one of those reads evaluates `isAdmin(groupId)`, which reads
 * the caller's OWN membership. If the caller's membership is
 * out of sync, every subsequent read is denied — so drift on
 * other members is never even detected. Fixing the caller first
 * is what makes the rest of the flow work.
 *
 * Returns true when a repair was made, false when there was
 * nothing to fix (or the current user has no linked account).
 */
export async function repairOwnMembershipIfDrifted(
  groupId: string,
  member: Member,
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;

  // Identify the caller. Three cases prove this member doc
  // represents the signed-in user:
  //   1. member.userId === user.uid  — the standard link
  //   2. member.id === user.uid      — the ensureMemberExists
  //                                     convention (doc id = uid)
  //   3. !member.userId              — no link yet; the caller
  //                                     reached this screen with
  //                                     a currentMember, so the
  //                                     store already resolved
  //                                     them as this user
  //
  // Previously this function only accepted case 1 and bailed
  // silently on cases 2 and 3 — which meant a drifted admin
  // whose member doc didn't carry a userId field could never
  // get their membership repaired, and every subsequent read of
  // another member's membership doc was denied with "Missing
  // or insufficient permissions" at the Verify-access step.
  const isCaller =
    member.userId === user.uid ||
    member.id === user.uid ||
    !member.userId;

  if (!isCaller) {
    console.warn(
      "[repairOwnMembershipIfDrifted] member doc does not match the caller — not repairing",
      {
        memberId: member.id,
        memberUserId: member.userId,
        callerUid: user.uid,
      },
    );
    return false;
  }

  const membershipId = getMembershipId(groupId, user.uid);
  const membershipRef = doc(db, "groupMemberships", membershipId);

  let snapExists = false;
  let snapRole: string | null = null;
  let snapStatus: string | null = null;
  try {
    const snap = await getDoc(membershipRef);
    if (snap.exists()) {
      snapExists = true;
      snapRole = snap.data()?.role ?? null;
      snapStatus = snap.data()?.status ?? null;
    }
  } catch (readErr) {
    // Reading your own membership is always allowed by the
    // rules, but if for any reason it fails, treat it as
    // drifted and try the delete+recreate path anyway.
    console.warn(
      "[repairOwnMembershipIfDrifted] read failed:",
      readErr,
    );
  }

  const roleMatches = snapExists && snapRole === member.role;
  const statusMatches = snapExists && snapStatus === member.status;
  if (roleMatches && statusMatches) return false;

  const batch = writeBatch(db);
  batch.delete(membershipRef);
  batch.set(membershipRef, {
    id: membershipId,
    userId: user.uid,
    groupId,
    memberId: member.id,
    role: member.role,
    status: member.status,
    email:
      (member.email ?? user.email ?? "").toLowerCase(),
    createdAt: new Date().toISOString(),
  });
  await batch.commit();

  return true;
}


export async function repairMembershipDocForMember(
  groupId: string,
  member: Member,
): Promise<{ repaired: boolean; reason?: string }> {
  const user = auth.currentUser;
  if (!user) return { repaired: false, reason: "Not signed in" };
  if (!member.userId) {
    return { repaired: false, reason: "Member has no userId — no account to link" };
  }

  const membershipId = getMembershipId(groupId, member.userId);
  const membershipRef = doc(db, "groupMemberships", membershipId);

  const payload = {
    id: membershipId,
    groupId,
    userId: member.userId,
    memberId: member.id,
    role: member.role,
    status: member.status,
    email:
      typeof member.email === "string"
        ? member.email.toLowerCase()
        : undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(membershipRef, payload);
    return { repaired: true };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const isPermission =
      msg.toLowerCase().includes("insufficient") ||
      msg.toLowerCase().includes("permission") ||
      e?.code === "permission-denied";

    if (isPermission) {
      return {
        repaired: false,
        reason:
          `Permission denied writing ${membershipId}. ` +
          `Open Firestore → groupMemberships → ${membershipId} ` +
          `and set groupId = "${groupId}", userId = "${member.userId}", ` +
          `role = "${member.role}", status = "${member.status}". ` +
          `Or delete that doc entirely and click "Try repair" again.`,
      };
    }
    return { repaired: false, reason: msg };
  }
}
