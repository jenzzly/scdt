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
import { doc, getDoc } from "./core";
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