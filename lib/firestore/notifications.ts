// lib/firestore/notifications.ts
import {
  doc, getDocs, setDoc, updateDoc, query, orderBy, limit, onSnapshot,
  notifsCol, stripUndefined, fromSnap,
} from "./core";
import type { AppNotification, NewRecord } from "./core";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────
export async function addNotification(
  uid: string,
  data: NewRecord<AppNotification>,
): Promise<void> {
  const dRef = data.id ? doc(notifsCol(uid), data.id) : doc(notifsCol(uid));
  await setDoc(dRef, {
    ...stripUndefined(data as any),
    id: dRef.id,
    createdAt: new Date().toISOString(),
  });
}

export async function markNotificationRead(uid: string, nId: string): Promise<void> {
  await updateDoc(doc(notifsCol(uid), nId), { read: true });
}

export function subscribeNotifications(
  uid: string,
  cb: (ns: AppNotification[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(notifsCol(uid), orderBy("createdAt", "desc"), limit(50)),
    (snap) => cb(snap.docs.map((s) => fromSnap<AppNotification>(s))),
    onError,
  );
}

