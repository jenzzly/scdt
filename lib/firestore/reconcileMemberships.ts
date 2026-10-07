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
import { doc, getDoc, writeBatch, auth } from "./core";
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
export async function findMembershipDrift(
  groupId: string,
  members: Member[],
): Promise<MembershipDrift[]> {
  const drift: MembershipDrift[] = [];

  for (const member of members) {
    if (!member.userId) continue; // no account linked yet — nothing to compare

    const membershipId = getMembershipId(groupId, member.userId);
    const membershipSnap = await getDoc(doc(db, "groupMemberships", membershipId));

    if (!membershipSnap.exists()) {
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

    const membershipData = membershipSnap.data();
    const roleMismatch = membershipData.role !== member.role;
    const statusMismatch = membershipData.status !== member.status;

    if (roleMismatch || statusMismatch) {
      drift.push({
        memberId: member.id,
        memberFullName: member.fullName,
        userId: member.userId,
        memberRole: member.role,
        membershipRole: membershipData.role ?? null,
        memberStatus: member.status,
        membershipStatus: membershipData.status ?? null,
      });
    }
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
  if (!member.userId || member.userId !== user.uid) return false;

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