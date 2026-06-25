// lib/firestore/expenses.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  expensesCol, walletCol, groupDoc,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2,
} from "./core";
import type { Expense, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Expenses
// ─────────────────────────────────────────────────────────────────────────────
export async function addExpense(gId: string, data: NewRecord<Expense>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(expensesCol(gId), data.id) : doc(expensesCol(gId));
    const now = new Date().toISOString();

    const expenseData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      createdAt: now,
      createdBy: userInfo?.userId,
    };

    await setDoc(dRef, expenseData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "expense",
        entityId: dRef.id,
        after: expenseData,
        reason: data.description || "Expense created",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addExpense", "expense", error, { groupId: gId });
    throw error;
  }
}

export async function updateExpense(gId: string, id: string, data: Partial<Expense>): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(expensesCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const updateData = {
      ...stripUndefined(data as any),
      updatedAt: now,
      updatedBy: userInfo?.userId,
    };

    await updateDoc(doc(expensesCol(gId), id), updateData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "expense",
        entityId: id,
        before,
        after: { ...before, ...updateData },
        reason: data.description || "Expense updated",
      });
    }
  } catch (error) {
    logError("updateExpense", "expense", error, { groupId: gId, id });
    throw error;
  }
}

export async function deleteExpense(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(expensesCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Expense not found");

    const expense = fromSnap<Expense>(currentSnap);

    await recordDeletion(gId, "expense", id, expense as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "expense",
      entityId: id,
      before: expense as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(expensesCol(gId), id));
  } catch (error) {
    logError("deleteExpense", "expense", error, { groupId: gId, id });
    throw error;
  }
}

export function subscribeExpenses(
  gId: string,
  cb: (es: Expense[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(expensesCol(gId), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Expense>(s))),
    onError,
  );
}

export async function approveExpense(gId: string, id: string, reason?: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(expensesCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Expense not found");

    const expense = fromSnap<Expense>(currentSnap);

    await updateDoc(doc(expensesCol(gId), id), {
      approvedBy: userInfo.userId,
      approvedAt: now,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "approved",
      entityType: "expense",
      entityId: id,
      before: expense as unknown as Record<string, unknown>,
      after: { ...expense, approvedBy: userInfo.userId, approvedAt: now },
      reason: reason || "Expense approved",
    });
  } catch (error) {
    logError("approveExpense", "expense", error, { groupId: gId, id });
    throw error;
  }
}

export async function rejectExpense(
  gId: string,
  id: string,
  rejectionReason: string,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(expensesCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Expense not found");

    const expense = fromSnap<Expense>(currentSnap);

    await updateDoc(doc(expensesCol(gId), id), {
      rejectedBy: userInfo.userId,
      rejectedAt: now,
      rejectionReason,
    });

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "rejected",
      entityType: "expense",
      entityId: id,
      before: expense as unknown as Record<string, unknown>,
      after: { ...expense, rejectedBy: userInfo.userId, rejectedAt: now, rejectionReason },
      reason: rejectionReason,
    });
  } catch (error) {
    logError("rejectExpense", "expense", error, { groupId: gId, id });
    throw error;
  }
}

