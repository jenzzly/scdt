// lib/firestore/groups.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, query, where, limit, onSnapshot,
  groupsCol, groupDoc, stripUndefined, fromSnap, getMembershipId, membershipsCol,
} from "./core";
import type { Group } from "./core";

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────
export async function createGroup(data: Omit<Group, "id"> & { id?: string }): Promise<string> {
  const dRef = data.id ? doc(groupsCol, data.id) : doc(groupsCol);
  const groupId = dRef.id;
  const now = new Date().toISOString();

  await setDoc(dRef, {
    ...stripUndefined(data as any),
    id: groupId,
    createdAt: now,
  });

  if (data.createdBy) {
    const membershipId = getMembershipId(groupId, data.createdBy);
    const membershipRef = doc(membershipsCol, membershipId);
    const membershipSnap = await getDoc(membershipRef);
    if (!membershipSnap.exists()) {
      await setDoc(membershipRef, {
        id: membershipId,
        userId: data.createdBy,
        groupId,
        role: "admin",
        status: "active",
        createdAt: now,
      });
    }
  }

  return groupId;
}

export async function getGroup(id: string): Promise<Group | null> {
  const snap = await getDoc(groupDoc(id));
  return snap.exists() ? fromSnap<Group>(snap) : null;
}

export async function updateGroup(id: string, data: Partial<Group>): Promise<void> {
  await updateDoc(groupDoc(id), stripUndefined(data as any));
}

export function subscribeGroup(
  id: string,
  cb: (g: Group) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(groupDoc(id), (snap) => {
    if (snap.exists()) cb(fromSnap<Group>(snap));
  }, onError);
}

export async function getGroupsByUser(userId: string): Promise<Group[]> {
  const q = query(membershipsCol, where("userId", "==", userId));
  const snap = await getDocs(q);
  const groups: Group[] = [];
  for (const s of snap.docs) {
    const g = await getGroup(s.data().groupId);
    if (g) groups.push(g);
  }
  return groups;
}

export async function getGroupByInviteCode(code: string): Promise<Group | null> {
  const q = query(groupsCol, where("inviteCode", "==", code), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : fromSnap<Group>(snap.docs[0]);
}

