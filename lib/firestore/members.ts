// lib/firestore/members.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, writeBatch,
  db, auth,
  membersCol, contribsCol, loansCol, investCol, walletCol, membershipsCol,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2, getMembershipId,
} from "./core";
import type { Member, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { getGroup, updateGroup } from "./groups";

// ─────────────────────────────────────────────────────────────────────────────
// Members
// ─────────────────────────────────────────────────────────────────────────────
export async function addMember(gId: string, data: NewRecord<Member>): Promise<string> {
  const actorInfo = await getCurrentUserInfo();
  const dRef = data.id ? doc(membersCol(gId), data.id) : doc(membersCol(gId));
  const id = dRef.id;
  const now = new Date().toISOString();

  await setDoc(dRef, { ...stripUndefined(data as any), id, createdAt: now });

  if (data.userId) {
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
        createdAt: now,
      });
    }
  }

  const g = await getGroup(gId);
  if (g) await updateGroup(gId, { memberCount: (g.memberCount || 0) + 1 });

  if (actorInfo) {
    await writeAuditLog(gId, {
      userId: actorInfo.userId,
      groupId: gId,
      userName: actorInfo.userName,
      action: "CREATE_MEMBER",
      entityType: "member",
      entityId: id,
      after: { fullName: data.fullName, role: data.role ?? "member", status: data.status ?? "pending" },
    });
  }

  return id;
}

export async function getMembers(gId: string): Promise<Member[]> {
  const snap = await getDocs(query(membersCol(gId), orderBy("fullName")));
  return snap.docs.map((s) => fromSnap<Member>(s));
}

export async function updateMember(
  gId: string,
  mId: string,
  data: Partial<Member>,
): Promise<void> {
  await updateDoc(doc(membersCol(gId), mId), stripUndefined(data as any));

  if (data.userId && (data.role || data.status)) {
    const membershipId = getMembershipId(gId, data.userId);
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
        userId: data.userId,
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
  await deleteDoc(doc(membersCol(gId), mId));

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
  // than attempt a doomed query. This should be rare in practice
  // (most members have a linked account), but if you hit it, the
  // leftover groupMemberships doc (if any) can be found and removed
  // manually in the Firebase console — it's harmless to leave in
  // place otherwise, since the member doc itself (the thing that
  // actually drives the UI) is already deleted above.
  if (userId) {
    const membershipId = getMembershipId(gId, userId);
    await deleteDoc(doc(membershipsCol, membershipId));
  }

  const g = await getGroup(gId);
  if (g) await updateGroup(gId, { memberCount: Math.max(0, (g.memberCount || 0) - 1) });
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
    // This requires admin permissions - only admins should call this function
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
      const updatedMemberData = updatedMemberDoc.exists() ? { ...updatedMemberDoc.data(), id: updatedMemberDoc.id } as Member : memberData;
      
      return { 
        merged: true, 
        memberId: memberId, 
        memberData: updatedMemberData 
      };
    }
    
    return { merged: false, memberId: "", memberData: null };
  } catch (error) {
    console.error("[findAndMergeMemberByEmail] Error:", error);
    return { merged: false, memberId: "", memberData: null };
  }
}

export async function ensureMemberExists(
  gId: string,
  userId: string,
  fullName: string,
  email: string,
): Promise<Member | null> {
  try {
    const membershipId = getMembershipId(gId, userId);
    const membershipRef = doc(db, "groupMemberships", membershipId);

    // Do not `get()` a membership before it exists. Firestore evaluates a
    // missing document with no `resource.data`, so a strict owner-only rule
    // correctly rejects that read. This query is constrained to the caller's
    // uid, which the rules explicitly permit, and returns an empty snapshot
    // for a new user rather than a permission error.
    const membershipQuery = query(
      membershipsCol,
      where("userId", "==", userId),
      where("groupId", "==", gId),
      limit(1),
    );
    const membershipResults = await getDocs(membershipQuery);
    const membershipSnap = membershipResults.docs[0];

    // If membership exists, user is already linked
    if (membershipSnap) {
      const memberId = membershipSnap.data()?.memberId;
      if (memberId) {
        const memberDoc = await getDoc(doc(membersCol(gId), memberId));
        if (memberDoc.exists()) {
          return { ...memberDoc.data(), id: memberDoc.id } as Member;
        }
      }
      return null;
    }

    // Create new member document directly without email query
    // This avoids permission errors during bootstrap
    const memberId = userId;
    const now = new Date().toISOString();
    
    // Check if this is the first member in the group
    const allMembersSnap = await getDocs(membersCol(gId));
    const isFirstMember = allMembersSnap.empty;
    const role = isFirstMember ? "admin" : "member";
    
    const newMemberRef = doc(membersCol(gId), memberId);
    await setDoc(newMemberRef, {
      id: memberId,
      groupId: gId,
      userId: userId,
      fullName: fullName,
      email: email.toLowerCase(),
      phone: "",
      role: role,
      status: "active",
      dateJoined: now,
      totalContributions: 0,
      totalSavings: 0,
      loanEarnings: 0,
      createdAt: now,
    });
    
    // Create membership document
    const membershipData = {
      id: membershipId,
      groupId: gId,
      userId: userId,
      memberId: memberId,
      role: role,
      status: "active",
      email: email.toLowerCase(),
      createdAt: now,
    };
    
    await setDoc(membershipRef, membershipData);
    
    // Return the member data
    const finalMemberDoc = await getDoc(doc(membersCol(gId), memberId));
    if (finalMemberDoc.exists()) {
      return { ...finalMemberDoc.data(), id: finalMemberDoc.id } as Member;
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

