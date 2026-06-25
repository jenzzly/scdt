// lib/firestore/wallet.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  walletCol, groupDoc,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2,
} from "./core";
import type { WalletTransaction, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Wallet Transactions
// ─────────────────────────────────────────────────────────────────────────────
export async function addWalletTx(
  gId: string,
  data: NewRecord<WalletTransaction>,
): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(walletCol(gId), data.id) : doc(walletCol(gId));
    const now = new Date().toISOString();

    const walletTxData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      createdAt: now,
      createdBy: userInfo?.userId,
    };

    await setDoc(dRef, walletTxData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "wallet_transaction",
        entityId: dRef.id,
        after: walletTxData,
        reason: data.description || "Wallet transaction created",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addWalletTx", "wallet_transaction", error, { groupId: gId });
    throw error;
  }
}

export async function updateWalletTx(
  gId: string,
  id: string,
  data: Partial<WalletTransaction>,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(walletCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const updateData = {
      ...stripUndefined(data as any),
      updatedAt: now,
      updatedBy: userInfo?.userId,
    };

    await updateDoc(doc(walletCol(gId), id), updateData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "wallet_transaction",
        entityId: id,
        before,
        after: { ...before, ...updateData },
        reason: data.description || "Wallet transaction updated",
      });
    }
  } catch (error) {
    logError("updateWalletTx", "wallet_transaction", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteWalletTxPermanently(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const currentSnap = await getDoc(doc(walletCol(gId), id));

    if (!currentSnap.exists()) {
      console.warn("[deleteWalletTxPermanently] Doc not found, skipping:", id);
      return;
    }

    const walletTx = fromSnap<WalletTransaction>(currentSnap);

    await recordDeletion(gId, "wallet_transaction", id, walletTx as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "wallet_transaction",
      entityId: id,
      before: walletTx as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(walletCol(gId), id));
  } catch (error) {
    logError("deleteWalletTxPermanently", "wallet_transaction", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteWalletTx(gId: string, id: string, reason: string): Promise<void> {
  return deleteWalletTxPermanently(gId, id, reason);
}

export function subscribeWalletTxs(
  gId: string,
  cb: (txs: WalletTransaction[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(walletCol(gId), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<WalletTransaction>(s))),
    onError,
  );
}

