// lib/firestore/bank.ts
//
// Bank account configuration + reconciliation.
//
// Model: the group has ONE bank account. The group's wallet ledger
// tracks the group's total position; the bank account tracks what the
// bank actually shows. These SHOULD be equal — when they're not, the
// admin records a reconciliation that captures the reason and writes
// an adjustment transaction to the ledger, bringing them back into
// agreement.

import {
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  deleteField,
  db,
  groupDoc,
  walletCol,
  getCurrentUserInfo,
  stripUndefined,
  fromSnap,
  round2,
  logError,
} from "./core";
import type { Group, WalletTransaction, BankAccount } from "./core";
import { writeAuditLog } from "./audit";

// ─────────────────────────────────────────────────────────────────────
// Setup / edit
// ─────────────────────────────────────────────────────────────────────

export async function setBankAccount(
  groupId: string,
  data: BankAccount,
): Promise<void> {
  try {
    const groupRef = doc(db, "groups", groupId);
    await updateDoc(groupRef, {
      bankAccount: stripUndefined(data as any),
    });
  } catch (error) {
    logError("setBankAccount", "group", error, { groupId });
    throw error;
  }
}

export async function clearBankAccount(groupId: string): Promise<void> {
  try {
    const groupRef = doc(db, "groups", groupId);
    await updateDoc(groupRef, { bankAccount: deleteField() });
  } catch (error) {
    logError("clearBankAccount", "group", error, { groupId });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────────────────────────

export interface ReconciliationInput {
  /** The wallet ledger's current balance, as computed by recalcGroupTotals. */
  walletBalance: number;
  /** The actual balance from the bank statement, in the group's currency. */
  actualBankBalance: number;
  /** Short reason, one of the categories offered in the UI. */
  reason: string;
  /** Optional free-text explanation. */
  notes?: string;
}

export interface ReconciliationResult {
  walletTx: WalletTransaction;
  bankAccount: BankAccount;
  difference: number;
}

export async function recordBankReconciliation(
  groupId: string,
  params: ReconciliationInput,
): Promise<ReconciliationResult> {
  const userInfo = await getCurrentUserInfo();
  if (!userInfo) throw new Error("You must be logged in.");

  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found");

  const group = fromSnap<Group>(groupSnap);
  if (!group.bankAccount) {
    throw new Error("No bank account is configured for this group.");
  }

  const difference = round2(
    Number(params.actualBankBalance) - Number(params.walletBalance),
  );
  const now = new Date().toISOString();

  const description =
    `Bank reconciliation: ${params.reason}` +
    (params.notes && params.notes.trim() ? ` — ${params.notes.trim()}` : "");

  const walletRef = doc(walletCol(groupId));
  const walletTx: WalletTransaction = {
    id: walletRef.id,
    groupId,
    type: "bank_reconciliation",
    amount: difference,
    description,
    date: now.slice(0, 10),
    sourceType: "manual",
    createdAt: now,
    createdBy: userInfo.userId,
  };

  const updatedBankAccount: BankAccount = {
    ...group.bankAccount,
    currentBalance: round2(Number(params.actualBankBalance)),
    lastReconciledAt: now,
    lastReconciledBy: userInfo.userId,
    lastReconciledByName: userInfo.userName,
  };

  const batch = writeBatch(db);
  batch.set(walletRef, stripUndefined(walletTx as any));
  batch.update(groupRef, {
    bankAccount: stripUndefined(updatedBankAccount as any),
  });
  await batch.commit();

  await writeAuditLog(groupId, {
    groupId,
    userId: userInfo.userId,
    userName: userInfo.userName,
    action: "updated",
    entityType: "group",
    entityId: groupId,
    before: { bankAccount: group.bankAccount },
    after: { bankAccount: updatedBankAccount },
    reason: `Bank reconciliation: ${params.reason} (difference ${difference >= 0 ? "+" : ""}${difference})`,
  });

  return { walletTx, bankAccount: updatedBankAccount, difference };
}
