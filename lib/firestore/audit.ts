// lib/firestore/audit.ts
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy, limit, onSnapshot,
  auditCol, stripUndefined, fromSnap, getCurrentUserInfo, logError,
  membersCol, contribsCol, loansCol, investCol, walletCol, expensesCol, meetingsCol,
} from "./core";
import type { AuditLog } from "./core";

function collectionForEntity(gId: string, entityType: string) {
  switch (entityType) {
    case "member":             return membersCol(gId);
    case "contribution":       return contribsCol(gId);
    case "loan":                return loansCol(gId);
    case "investment":         return investCol(gId);
    case "wallet_transaction": return walletCol(gId);
    case "expense":            return expensesCol(gId);
    case "meeting":            return meetingsCol(gId);
    default: throw new Error(`Cannot revert unknown entity type: ${entityType}`);
  }
}

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

// Write a failed-transaction audit entry — used by slices to record errors
export async function writeFailedAuditLog(
  gId: string,
  data: Partial<AuditLog> & Pick<AuditLog, "groupId" | "userId" | "userName" | "action" | "entityType" | "entityId">,
): Promise<void> {
  return writeAuditLog(gId, data);
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

// ─────────────────────────────────────────────────────────────────────────────
// Revert — restore an entity to the state captured in an audit log entry.
//
// Supported reversals:
//   • action === "created" → deletes the entity (undoes the creation)
//   • action === "deleted" → re-creates the document from the "before" snapshot
//   • anything else (updated/approved/rejected/disbursed/…) → restores the
//     "before" snapshot over the current document
//
// A new "reverted" audit log entry is written for the revert itself, so the
// trail stays complete — you can see both the original action and the fact
// that it was undone (and by whom, and when).
// ─────────────────────────────────────────────────────────────────────────────
export async function revertAuditLog(gId: string, log: AuditLog): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const col = collectionForEntity(gId, log.entityType);
    const docRef = doc(col, log.entityId);

    if (log.action === "created") {
      await deleteDoc(docRef);
    } else if (log.action === "deleted") {
      if (!log.before) throw new Error("No prior state recorded for this deletion — cannot restore");
      await setDoc(docRef, { ...log.before, id: log.entityId });
    } else {
      if (!log.before) throw new Error("No prior state recorded for this action — cannot revert");
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        await setDoc(docRef, { ...log.before, id: log.entityId });
      } else {
        await updateDoc(docRef, { ...stripUndefined(log.before as any) });
      }
    }

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "reverted",
      entityType: log.entityType,
      entityId: log.entityId,
      before: log.after ?? undefined,
      after: log.before ?? undefined,
      reason: `Reverted "${log.action}" action from ${new Date(log.timestamp).toLocaleString()}`,
    });
  } catch (error) {
    logError("revertAuditLog", log.entityType, error, { groupId: gId, logId: log.id });
    throw error;
  }
}
