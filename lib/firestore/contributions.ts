// lib/firestore/contributions.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  membersCol, contribsCol, walletCol, groupDoc,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2,
} from "./core";
import type { Contribution, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Contributions
// ─────────────────────────────────────────────────────────────────────────────
export async function addContribution(gId: string, data: NewRecord<Contribution>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(contribsCol(gId), data.id) : doc(contribsCol(gId));
    const now = new Date().toISOString();

    const contributionData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      createdAt: now,
      createdBy: userInfo?.userId,
    };

    await setDoc(dRef, contributionData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "contribution",
        entityId: dRef.id,
        after: contributionData,
        reason: data.description || "Contribution created",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addContribution", "contribution", error, { groupId: gId });
    throw error;
  }
}

export async function updateContribution(
  gId: string,
  id: string,
  data: Partial<Contribution>,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(contribsCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const updateData = {
      ...stripUndefined(data as any),
      updatedAt: now,
      updatedBy: userInfo?.userId,
    };

    await updateDoc(doc(contribsCol(gId), id), updateData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "contribution",
        entityId: id,
        before,
        after: { ...before, ...updateData },
        reason: data.description || "Contribution updated",
      });
    }
  } catch (error) {
    logError("updateContribution", "contribution", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteContributionPermanently(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const currentSnap = await getDoc(doc(contribsCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Contribution not found");

    const contribution = fromSnap<Contribution>(currentSnap);
    const memberId = contribution.memberId;

    await recordDeletion(gId, "contribution", id, contribution as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "contribution",
      entityId: id,
      before: contribution as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(contribsCol(gId), id));
    
    const remainingContributions = await getDocs(
      query(contribsCol(gId), where("memberId", "==", memberId), where("status", "==", "approved"))
    );
    
    const totalAmount = remainingContributions.docs.reduce((sum, doc) => {
      const data = doc.data();
      return sum + (data.amount || 0);
    }, 0);
    
    await updateDoc(doc(membersCol(gId), memberId), {
      totalContributions: totalAmount,
      totalSavings: totalAmount,
      updatedAt: new Date().toISOString(),
    });
    
  } catch (error) {
    logError("deleteContributionPermanently", "contribution", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteContribution(gId: string, id: string, reason: string): Promise<void> {
  return deleteContributionPermanently(gId, id, reason);
}

export function subscribeContributions(
  gId: string,
  cb: (cs: Contribution[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(contribsCol(gId), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Contribution>(s))),
    onError,
  );
}

export async function approveContribution(gId: string, id: string, reason?: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(contribsCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Contribution not found");

    const contribution = fromSnap<Contribution>(currentSnap);

    await updateDoc(doc(contribsCol(gId), id), {
      status: "approved",
      approvedBy: userInfo.userId,
      approvedAt: now,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "approved",
      entityType: "contribution",
      entityId: id,
      before: contribution as unknown as Record<string, unknown>,
      after: { ...contribution, status: "approved", approvedBy: userInfo.userId, approvedAt: now },
      reason: reason || "Contribution approved",
    });
  } catch (error) {
    logError("approveContribution", "contribution", error, { groupId: gId, id });
    throw error;
  }
}

export async function rejectContribution(
  gId: string,
  id: string,
  rejectionReason: string,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(contribsCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Contribution not found");

    const contribution = fromSnap<Contribution>(currentSnap);

    await updateDoc(doc(contribsCol(gId), id), {
      status: "rejected",
      rejectedBy: userInfo.userId,
      rejectedAt: now,
      rejectionReason,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "rejected",
      entityType: "contribution",
      entityId: id,
      before: contribution as unknown as Record<string, unknown>,
      after: { ...contribution, status: "rejected", rejectedBy: userInfo.userId, rejectedAt: now, rejectionReason },
      reason: rejectionReason,
    });
  } catch (error) {
    logError("rejectContribution", "contribution", error, { groupId: gId, id });
    throw error;
  }
}

