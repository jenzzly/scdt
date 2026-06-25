// lib/firestore/audit.ts
import {
  doc, setDoc, getDocs, query, orderBy, limit, onSnapshot,
  auditCol, stripUndefined, fromSnap,
} from "./core";
import type { AuditLog } from "./core";

// ─────────────────────────────────────────────────────────────────────────────
// Audit Logs
// ─────────────────────────────────────────────────────────────────────────────
export async function writeAuditLog(
  gId: string,
  data: Partial<AuditLog> & Pick<AuditLog, "groupId" | "userId" | "userName" | "action" | "entityType" | "entityId">,
): Promise<void> {
  try {
    const dRef = doc(auditCol(gId));
    await setDoc(dRef, {
      ...stripUndefined(data as any),
      id: dRef.id,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[writeAuditLog] Failed (non-fatal):", err);
  }
}

export async function getAuditLogs(gId: string, maxItems = 200): Promise<AuditLog[]> {
  try {
    const snap = await getDocs(
      query(auditCol(gId), orderBy("timestamp", "desc"), limit(maxItems)),
    );
    return snap.docs.map((s) => fromSnap<AuditLog>(s));
  } catch {
    return [];
  }
}

export function subscribeAuditLogs(
  gId: string,
  cb: (logs: AuditLog[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(auditCol(gId), orderBy("timestamp", "desc"), limit(200)),
    (snap) => cb(snap.docs.map((s) => fromSnap<AuditLog>(s))),
    onError,
  );
}

