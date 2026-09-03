// lib/firestore/notifications.ts
import {
  doc, getDocs, setDoc, updateDoc, query, orderBy, limit, onSnapshot,
  notifsCol, pendingEmailsCol, stripUndefined, fromSnap,
} from "./core";
import type { AppNotification, NewRecord } from "./core";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────
//
// `recipientEmail` is optional and additive: every call site already has
// the Member record in scope (that's how it found the userId to notify),
// so passing member.email costs nothing there. When present, this also
// queues a `pendingEmails` doc — a separate Node script
// (scripts/send-pending-emails.js) picks these up with the Firebase Admin
// SDK and sends them via Resend/nodemailer. No email is sent if the
// member has no email on file, or if the caller doesn't pass one; the
// in-app notification is always created either way.
export async function addNotification(
  uid: string,
  data: NewRecord<AppNotification>,
  recipientEmail?: string,
): Promise<void> {
  const dRef = data.id ? doc(notifsCol(uid), data.id) : doc(notifsCol(uid));
  const createdAt = new Date().toISOString();
  await setDoc(dRef, {
    ...stripUndefined(data as any),
    id: dRef.id,
    createdAt,
  });

  if (recipientEmail) {
    const emailRef = doc(pendingEmailsCol);
    await setDoc(emailRef, {
      id: emailRef.id,
      to: recipientEmail,
      subject: data.title,
      message: data.message,
      notificationId: dRef.id,
      userId: uid,
      groupId: data.groupId ?? null,
      status: "pending",
      createdAt,
    }).catch((e) => {
      // Never let a failed email-queue write break the in-app
      // notification that already succeeded above.
      console.warn("[addNotification] failed to queue email", e);
    });
  }
}

export async function markNotificationRead(uid: string, nId: string): Promise<void> {
  await updateDoc(doc(notifsCol(uid), nId), { read: true });
}

export async function deleteNotification(uid: string, nId: string): Promise<void> {
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(doc(notifsCol(uid), nId));
}

export async function clearAllUserNotifications(uid: string): Promise<void> {
  const { writeBatch } = await import("firebase/firestore");
  const { db } = await import("./core");
  const snap = await getDocs(notifsCol(uid));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
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

