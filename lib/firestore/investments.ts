// lib/firestore/investments.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  investCol, walletCol, groupDoc,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2,
} from "./core";
import type { Investment, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";
import type { InvestmentApprovals } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Investments
// ─────────────────────────────────────────────────────────────────────────────
export async function addInvestment(gId: string, data: NewRecord<Investment>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(investCol(gId), data.id) : doc(investCol(gId));
    const now = new Date().toISOString();

    const defaultApprovals: InvestmentApprovals = {
      committee: { approved: false },
      accountant: { approved: false },
    };

    const investmentData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      status: "pending_committee",
      approvals: data.approvals ?? defaultApprovals,
      createdAt: now,
      createdBy: userInfo?.userId,
      updatedAt: now,
    };

    await setDoc(dRef, investmentData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "investment",
        entityId: dRef.id,
        after: investmentData,
        reason: data.description || "Investment created — pending committee approval",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addInvestment", "investment", error, { groupId: gId });
    throw error;
  }
}

export async function approveInvestmentStep(
  gId: string,
  id: string,
  step: "committee" | "accountant",
  approved: boolean,
  comment?: string,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(investCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Investment not found");
    const investment = fromSnap<Investment>(currentSnap);

    const currentApprovals: InvestmentApprovals = (investment as any).approvals ?? {
      committee: { approved: false },
      accountant: { approved: false },
    };

    const updatedApprovals: InvestmentApprovals = {
      ...currentApprovals,
      [step]: { approved, date: now, comment, userId: userInfo.userId },
    };

    let newStatus = investment.status;
    if (!approved) {
      newStatus = "closed"; // rejected → closed
    } else if (step === "committee") {
      newStatus = "pending" as any; // awaiting accountant
    } else if (step === "accountant") {
      newStatus = "open"; // fully approved → open/active
    }

    const updateData: Partial<Investment> & Record<string, unknown> = {
      approvals: updatedApprovals,
      status: newStatus,
      updatedAt: now,
      updatedBy: userInfo.userId,
    };

    if (!approved) {
      updateData.rejectedBy = userInfo.userId;
      updateData.rejectedAt = now;
      updateData.rejectionReason = comment || "Investment rejected";
    } else if (step === "accountant") {
      updateData.approvedBy = userInfo.userId;
      updateData.approvedAt = now;
    }

    await updateDoc(doc(investCol(gId), id), updateData);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: approved ? "approved" : "rejected",
      entityType: "investment",
      entityId: id,
      before: investment as unknown as Record<string, unknown>,
      after: { ...investment, ...updateData },
      reason: comment || `Investment ${approved ? "approved" : "rejected"} at ${step} step`,
    });
  } catch (error) {
    logError("approveInvestmentStep", "investment", error, { groupId: gId, id });
    throw error;
  }
}

export async function updateInvestment(
  gId: string,
  id: string,
  data: Partial<Investment>,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(investCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const updateData = {
      ...stripUndefined(data as any),
      updatedAt: now,
      updatedBy: userInfo?.userId,
    };

    await updateDoc(doc(investCol(gId), id), updateData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "investment",
        entityId: id,
        before,
        after: { ...before, ...updateData },
        reason: data.description || "Investment updated",
      });
    }
  } catch (error) {
    logError("updateInvestment", "investment", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteInvestment(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(investCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Investment not found");

    const investment = fromSnap<Investment>(currentSnap);

    if (!["open", "pending", "pending_committee", "matured", "closed"].includes(investment.status)) {
        throw new Error(`Cannot delete investment with status: ${investment.status}`);
    }

    await recordDeletion(gId, "investment", id, investment as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "investment",
      entityId: id,
      before: investment as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(investCol(gId), id));
  } catch (error) {
    logError("deleteInvestment", "investment", error, { groupId: gId, id });
    throw error;
  }
}

export function subscribeInvestments(
  gId: string,
  cb: (is: Investment[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(investCol(gId), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Investment>(s))),
    onError,
  );
}

// Legacy approveInvestment kept for backward compat (admin direct-approve)
export async function approveInvestment(gId: string, id: string, reason?: string): Promise<void> {
  return approveInvestmentStep(gId, id, "accountant", true, reason);
}

export async function rejectInvestment(
  gId: string,
  id: string,
  rejectionReason: string,
): Promise<void> {
  return approveInvestmentStep(gId, id, "committee", false, rejectionReason);
}
