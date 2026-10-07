// lib/firestore/members.ts
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  db,
  membersCol,
  membershipsCol,
  getCurrentUserInfo,
  stripUndefined,
  fromSnap,
  getMembershipId,
} from "./core";
import type { Member, NewRecord } from "./core";
import type { MemberRole } from "../../types";
import { writeAuditLog } from "./audit";
import { getGroup, updateGroup } from "./groups";
import { ensureGroupExists } from "./groupInit";

// ─────────────────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────────────────
export async function addMember(gId: string, data: NewRecord<Member>): Promise<string> {
  const actorInfo = await getCurrentUserInfo();
  const dRef = data.id ? doc(membersCol(gId), data.id) : doc(membersCol(gId));
  const id = dRef.id;
  const now = new Date().toISOString();

  // ── Primary write — FATAL on failure. ──────────────────────────
  //
  // The member doc is the thing this function exists to create.
  // Its create rule is `isAdminOrAccountant(groupId)`, which is
  // the loosest admin gate in the ruleset. A genuine failure here
  // means the caller is not actually admin/accountant server-side
  // and should surface as an error — the caller will see it and
  // can run Verify access.
  await setDoc(dRef, { ...stripUndefined(data as any), id, createdAt: now });

  // ── Secondary writes — best-effort. ────────────────────────────
  //
  // The groupMemberships create rule is stricter than the member
  // create rule (`isAdmin(groupId)` only — accountants do not
  // pass). The memberCount update requires admin/accountant OR a
  // `manageSettings` permission OR being the group creator. If any
  // of those stricter checks fails, we still want the primary
  // write to stick: the new user can log in (their first login
  // calls ensureMemberExists, which now looks up by the userId
  // field and creates the missing membership), and memberCount
  // is derived data that can be recomputed later.
  //
  // Before this change, a failure here threw, aborted addMember,
  // and made createUserAsAdmin report failure even though the
  // member was already created — the exact "user gets created
  // but I see a permission error" symptom.

  if (data.userId) {
    try {
      const membershipId = getMembershipId(gId, data.userId);
      const mRef = doc(membershipsCol, membershipId);
      const mSnap = await getDoc(mRef);
      if (!mSnap.exists()) {
        await setDoc(mRef, {
          id: membershipId,
          userId: data.userId,
          groupId: gId,
          memberId: id,
          role: data.role ?? "member",
          status: data.status ?? "pending",
          email:
            typeof data.email === "string"
              ? data.email.toLowerCase()
              : undefined,
          createdAt: now,
        });
      }
    } catch (e) {
      console.warn(
        "[addMember] membership write failed (non-fatal — first login will retry):",
        e,
      );
    }
  }

  try {
    const g = await getGroup(gId);
    if (g) {
      await updateGroup(gId, {
        memberCount: (g.memberCount || 0) + 1,
      });
    }
  } catch (e) {
    console.warn(
      "[addMember] memberCount update failed (non-fatal — value is recomputable):",
      e,
    );
  }

  if (actorInfo) {
    try {
      await writeAuditLog(gId, {
        userId: actorInfo.userId,
        groupId: gId,
        userName: actorInfo.userName,
        action: "CREATE_MEMBER",
        entityType: "member",
        entityId: id,
        after: { fullName: data.fullName, role: data.role ?? "member", status: data.status ?? "pending" },
      });
    } catch (e) {
      // writeAuditLog already swallows internally; this is just
      // belt-and-braces so a future refactor cannot make it fatal.
      console.warn("[addMember] audit log failed (non-fatal):", e);
    }
  }

  return id;
}

export async function getMembers(gId: string): Promise<Member[]> {
  const snap = await getDocs(query(membersCol(gId), orderBy("fullName")));
  return snap.docs.map((s) => fromSnap<Member>(s));
}

export async function getMemberById(gId: string, mId: string): Promise<Member | null> {
  const snap = await getDoc(doc(membersCol(gId), mId));
  return snap.exists() ? fromSnap<Member>(snap) : null;
}

export async function updateMember(
  gId: string,
  mId: string,
  data: Partial<Member>,
): Promise<void> {
  await updateDoc(doc(membersCol(gId), mId), stripUndefined(data as any));

  let userId = data.userId;
  if (!userId && (data.role || data.status)) {
    const memberSnap = await getDoc(doc(membersCol(gId), mId));
    if (memberSnap.exists()) {
      userId = memberSnap.data()?.userId;
    }
  }

  if (userId && (data.role || data.status)) {
    const membershipId = getMembershipId(gId, userId);
    const membershipRef = doc(membershipsCol, membershipId);
    const membershipSnap = await getDoc(membershipRef);

    const syncData: Record<string, string> = {};
    if (data.status) syncData.status = data.status;
    if (data.role)   syncData.role   = data.role;

    if (membershipSnap.exists()) {
      await updateDoc(membershipRef, syncData);
    } else {
      await setDoc(membershipRef, {
        id: membershipId,
        userId: userId,
        groupId: gId,
        memberId: mId,
        role: data.role ?? "member",
        status: data.status ?? "active",
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export async function deleteMember(
  gId: string,
  mId: string,
  userId?: string,
): Promise<void> {
  // ── Primary write — FATAL on failure. ──────────────────────────
  //
  // The members-doc delete is the operation this function exists
  // to perform. Its rule accepts `isAdmin(groupId)` OR a member
  // with the editMembers permission bit. A genuine rejection here
  // is a real problem the caller needs to see.
  await deleteDoc(doc(membersCol(gId), mId));

  // ── Secondary writes — best-effort. ────────────────────────────
  //
  // The groupMemberships delete rule is STRICTER than the members
  // delete rule: it requires `isAdmin(groupId)`, not just
  // editMembers. And the groups update needs isAdminOrAccountant
  // OR manageSettings OR group-creator. A caller with editMembers
  // (or a drifted admin) passes the primary write and fails one of
  // these — which, without the try/catch below, aborts deleteMember
  // even though the member is already gone server-side. The store's
  // catch then rolls the local member back, so the UI shows the
  // member still present with a permission-denied toast until the
  // next snapshot reconciles it away. Net effect: "error, but
  // actually deleted after sync."
  //
  // Both are safe to skip:
  //   • an orphan groupMemberships row is a low-severity state; the
  //     next login for that uid resolves or recreates it via
  //     ensureMemberExists.
  //   • memberCount is derived data and can be recomputed.

  // Always resolve the groupMemberships doc ID directly
  // (`{groupId}_{userId}`) rather than querying for it by `memberId`.
  // The membershipsCol query fallback this used to have
  // (`where("memberId", "==", mId)`) cannot be authorized under
  // Firestore's rules model — a `list`/query operation is evaluated
  // against its entire potential result set, not per matched document
  // ("rules are not filters"), so there is no way to write a
  // groupMemberships security rule that both (a) lets an admin's
  // query through and (b) doesn't expose every membership doc in the
  // database to any signed-in user. That query was therefore always
  // being silently rejected — which is why deleting a member without
  // a linked userId (e.g. someone added but who hasn't signed up yet)
  // failed even for a genuine admin, no matter how the rules were
  // adjusted. A single-document delete by its exact known ID has no
  // such problem and is already safely allowed by the rules.
  //
  // If userId isn't known, there's no membership doc to look up by ID
  // and no safe way to find it any other way — skip cleanly rather
  // than attempt a doomed query.
  if (userId) {
    try {
      const membershipId = getMembershipId(gId, userId);
      await deleteDoc(doc(membershipsCol, membershipId));
    } catch (e) {
      console.warn(
        "[deleteMember] membership delete failed (non-fatal — orphan row can be cleaned up later):",
        e,
      );
    }
  }

  try {
    const g = await getGroup(gId);
    if (g) {
      await updateGroup(gId, {
        memberCount: Math.max(0, (g.memberCount || 0) - 1),
      });
    }
  } catch (e) {
    console.warn(
      "[deleteMember] memberCount update failed (non-fatal — value is recomputable):",
      e,
    );
  }
}

export async function findMemberByEmail(
  groupId: string,
  email: string,
): Promise<Member | null> {
  try {
    if (!email) return null;

    // Query for member with matching email (case insensitive)
    const membersRef = membersCol(groupId);
    const membersQuery = query(membersRef, where("email", "==", email.toLowerCase()));
    const memberSnap = await getDocs(membersQuery);

    if (!memberSnap.empty) {
      const existingMember = memberSnap.docs[0];
      return { ...existingMember.data(), id: existingMember.id } as Member;
    }

    return null;
  } catch (error) {
    console.error("[findMemberByEmail] Error:", error);
    return null;
  }
}

export async function findAndMergeMemberByEmail(
  groupId: string,
  email: string,
  userId: string,
  fullName: string,
): Promise<{ merged: boolean; memberId: string; memberData: Member | null }> {
  try {
    if (!email) return { merged: false, memberId: "", memberData: null };

    // Query for member with matching email (case insensitive)
    const membersRef = membersCol(groupId);
    const membersQuery = query(membersRef, where("email", "==", email.toLowerCase()));
    const memberSnap = await getDocs(membersQuery);

    if (!memberSnap.empty) {
      const existingMember = memberSnap.docs[0];
      const memberData = existingMember.data() as Member;
      const memberId = existingMember.id;

      // Update member with Firebase user ID (if not already set)
      const updates: any = {
        updatedAt: new Date().toISOString(),
      };

      // Only update if userId is different or missing
      if (!memberData.userId || memberData.userId !== userId) {
        updates.userId = userId;
      }

      // Update full name if provided and different
      if (fullName && memberData.fullName !== fullName) {
        updates.fullName = fullName;
      }

      const memberUpdateRef = doc(membersCol(groupId), memberId);
      await updateDoc(memberUpdateRef, updates);

      // Create/update membership document
      const membershipId = getMembershipId(groupId, userId);
      const membershipRef = doc(db, "groupMemberships", membershipId);
      const membershipSnap = await getDoc(membershipRef);

      const membershipData = {
        id: membershipId,
        groupId: groupId,
        userId: userId,
        memberId: memberId,
        role: memberData.role || "member",
        status: memberData.status || "active",
        email: email.toLowerCase(),
        createdAt: new Date().toISOString(),
      };

      if (!membershipSnap.exists()) {
        await setDoc(membershipRef, membershipData);
      } else {
        await updateDoc(membershipRef, {
          memberId: memberId,
          updatedAt: new Date().toISOString(),
        });
      }

      // Get updated member data
      const updatedMemberDoc = await getDoc(doc(membersCol(groupId), memberId));
      const updatedMemberData = updatedMemberDoc.exists()
        ? ({ ...updatedMemberDoc.data(), id: updatedMemberDoc.id } as Member)
        : memberData;

      return {
        merged: true,
        memberId: memberId,
        memberData: updatedMemberData,
      };
    }

    return { merged: false, memberId: "", memberData: null };
  } catch (error) {
    console.error("[findAndMergeMemberByEmail] Error:", error);
    return { merged: false, memberId: "", memberData: null };
  }
}

/**
 * Registration/login bootstrap for the app's single fixed group.
 *
 * This function ensures a user exists as a member in the group. It handles:
 * 1. Checking if the user already has a membership
 * 2. Creating the group if it doesn't exist (first user)
 * 3. Determining if the user should be admin (first member gets admin)
 * 4. Creating the member document and membership document
 * 5. Returning the member data
 *
 * IMPORTANT: The role detection uses group.memberCount to determine if
 * the user should be admin. The first member (memberCount === 0) gets
 * the "admin" role.
 *
 * This function is called during login/registration to ensure the user
 * has a valid member record in the group.
 */
export async function ensureMemberExists(
  gId: string,
  userId: string,
  fullName: string,
  email: string,
): Promise<Member | null> {
  try {
    // Check if user already has a membership document
    const membershipId = getMembershipId(gId, userId);
    const membershipRef = doc(db, "groupMemberships", membershipId);
    const membershipSnap = await getDoc(membershipRef);

    // If membership exists, load and return the member
    if (membershipSnap.exists()) {
      const memberId = membershipSnap.data()?.memberId;

      if (memberId) {
        const memberDoc = await getDoc(doc(membersCol(gId), memberId));
        if (memberDoc.exists()) {
          const member = { ...memberDoc.data(), id: memberDoc.id } as Member;
          return member;
        }
      }

      // Membership exists but member doc is missing — fall through to
      // the recovery path below rather than silently doing nothing.
    }

    // Ensure the group document exists
    await ensureGroupExists(gId, userId);

    // ── [ensureMemberExists] dedupe: userId field lookup ──────────
    //
    // The membership lookup above resolved via groupMemberships.
    // If that returned nothing, we are about to create (or reuse)
    // a member doc — but the doc-ID convention differs between the
    // two creation paths in this codebase:
    //
    //   • addMember (admin "Create User")     → random doc ID
    //   • ensureMemberExists (this function)  → doc ID = userId
    //
    // The historical bug: an admin-created member lives at
    // members/{randomId} with userId = uid. On first login, this
    // function looked only at members/{uid}, did not find it, and
    // created a SECOND doc. The member then appeared twice in
    // personal view, with fees attributed to each copy.
    //
    // The fix: query the members collection by the `userId` FIELD
    // first. If ANY member doc in this group carries this uid,
    // reuse it instead of creating a duplicate. Only fall through
    // to the uid-as-doc-id path when no such doc exists anywhere.
    let preexistingByUserId: Member | null = null;
    try {
      const byUserId = await getDocs(
        query(membersCol(gId), where("userId", "==", userId)),
      );
      if (!byUserId.empty) {
        const doc0 = byUserId.docs[0];
        preexistingByUserId = {
          ...(doc0.data() as Member),
          id: doc0.id,
        };
      }
    } catch (lookupErr) {
      // A list query on members requires either isMember(groupId)
      // (true for the caller here, they just signed in) or a
      // resource.data-scoped rule. If the ruleset has tightened
      // for any reason, fall through and let the uid-as-id path
      // run — its behaviour is unchanged.
      console.warn(
        "[ensureMemberExists] userId-field lookup failed; falling back:",
        lookupErr,
      );
    }

    if (preexistingByUserId) {
      // Reuse the existing member doc. Ensure the
      // groupMemberships row exists and points at it, then
      // return without creating anything new.
      const nowReuse = new Date().toISOString();
      const canonicalId = preexistingByUserId.id;

      await setDoc(
        membershipRef,
        {
          id: membershipId,
          groupId: gId,
          userId,
          memberId: canonicalId,
          role: preexistingByUserId.role || "member",
          status: preexistingByUserId.status || "pending",
          email: (
            preexistingByUserId.email || email
          ).toLowerCase(),
          createdAt: nowReuse,
        },
        { merge: true },
      );

      return preexistingByUserId;
    }
    // ── end dedupe ────────────────────────────────────────────────

    // Get the group to check member count
    const groupRef = doc(db, "groups", gId);
    const groupSnap = await getDoc(groupRef);

    // Read memberCount from the group
    const groupData = groupSnap.exists() ? groupSnap.data() : null;
    const memberCount = groupData?.memberCount ?? 0;

    // Determine role: first member (memberCount === 0) becomes admin.
    // This ensures the first person to register gets admin privileges.
    const role: MemberRole = memberCount === 0 ? "admin" : "member";

    const now = new Date().toISOString();
    const memberId = userId; // Use userId as memberId for consistency

    // Check if member document already exists (maybe created by admin)
    const memberRef = doc(membersCol(gId), memberId);
    const memberSnap = await getDoc(memberRef);

    if (memberSnap.exists()) {
      // Member exists but membership doesn't — this could be a deleted
      // member trying to rejoin.
      const existingData = memberSnap.data() as Member;

      // If member was previously deleted/exited/inactive, keep that
      // status to require admin approval. Only allow automatic active
      // status if they were previously active.
      const memberStatus = existingData.status === "active" ? "active" : "pending";

      // Create membership document
      await setDoc(membershipRef, {
        id: membershipId,
        groupId: gId,
        userId: userId,
        memberId: memberId,
        role: existingData.role || role,
        status: memberStatus,
        email: email.toLowerCase(),
        createdAt: now,
      });

      // Update member status if needed (for rejoining members)
      if (existingData.status !== "active") {
        await updateDoc(memberRef, {
          status: memberStatus,
          userId: userId,
          updatedAt: now,
        });
      }

      return { ...existingData, id: memberId, status: memberStatus } as Member;
    }

    // Create new member document
    const initialStatus = role === "admin" ? "active" : "pending"; // First member (admin) is auto-approved, others require approval
    await setDoc(memberRef, {
      id: memberId,
      groupId: gId,
      userId,
      fullName,
      email: email.toLowerCase(),
      phone: "",
      role,
      status: initialStatus,
      dateJoined: now,
      totalContributions: 0,
      totalSavings: 0,
      loanEarnings: 0,
      createdAt: now,
    });

    // Create membership document
    await setDoc(membershipRef, {
      id: membershipId,
      groupId: gId,
      userId,
      memberId,
      role,
      status: initialStatus,
      email: email.toLowerCase(),
      createdAt: now,
    });

    // Increment memberCount — only for new members (not re-links).
    // We increment after creating both docs to avoid race conditions.
    await updateDoc(groupRef, { memberCount: memberCount + 1 }).catch(() => {});

    // Return the created member
    const finalMemberDoc = await getDoc(memberRef);
    if (finalMemberDoc.exists()) {
      const member = { ...finalMemberDoc.data(), id: finalMemberDoc.id } as Member;
      return member;
    }

    return null;
  } catch (error) {
    console.error("[ensureMemberExists] Error:", error);
    throw error;
  }
}

export function subscribeMembers(
  gId: string,
  cb: (ms: Member[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(membersCol(gId), orderBy("fullName")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Member>(s))),
    onError,
  );
}

export function subscribeMember(
  gId: string,
  mId: string,
  cb: (m: Member | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    doc(membersCol(gId), mId),
    (snap) => cb(snap.exists() ? fromSnap<Member>(snap) : null),
    onError,
  );
}

export async function approveMember(
  gId: string,
  mId: string,
): Promise<void> {
  const actorInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();

  await updateMember(gId, mId, { status: "active" });

  if (actorInfo) {
    await writeAuditLog(gId, {
      userId: actorInfo.userId,
      groupId: gId,
      userName: actorInfo.userName,
      action: "APPROVE_MEMBER",
      entityType: "member",
      entityId: mId,
      after: { status: "active" },
    });
  }
}

export async function suspendMember(
  gId: string,
  mId: string,
  reason?: string,
): Promise<void> {
  const actorInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();

  await updateMember(gId, mId, { status: "suspended" });

  if (actorInfo) {
    await writeAuditLog(gId, {
      userId: actorInfo.userId,
      groupId: gId,
      userName: actorInfo.userName,
      action: "SUSPEND_MEMBER",
      entityType: "member",
      entityId: mId,
      after: { status: "suspended" },
      reason,
    });
  }
}

export async function activateMember(
  gId: string,
  mId: string,
): Promise<void> {
  const actorInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();

  await updateMember(gId, mId, { status: "active" });

  if (actorInfo) {
    await writeAuditLog(gId, {
      userId: actorInfo.userId,
      groupId: gId,
      userName: actorInfo.userName,
      action: "ACTIVATE_MEMBER",
      entityType: "member",
      entityId: mId,
      after: { status: "active" },
    });
  }
}

export async function updateMemberRole(
  gId: string,
  mId: string,
  newRole: MemberRole,
): Promise<void> {
  const actorInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();

  const member = await getMemberById(gId, mId);
  if (!member) throw new Error("Member not found");

  await updateMember(gId, mId, { role: newRole });

  if (actorInfo) {
    await writeAuditLog(gId, {
      userId: actorInfo.userId,
      groupId: gId,
      userName: actorInfo.userName,
      action: "UPDATE_ROLE",
      entityType: "member",
      entityId: mId,
      before: { role: member.role },
      after: { role: newRole },
    });
  }
}