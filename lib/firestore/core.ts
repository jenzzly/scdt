// lib/firestore/core.ts
//
// Shared helpers, collection references, and types used across every
// Firestore domain module (groups, members, loans, etc). Nothing in here
// should depend on any other file inside lib/firestore/ — this is the base
// layer everything else imports from.
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch,
} from "firebase/firestore";
import { db, auth, functions } from "../firebase";
import type {
  Group, Member, Contribution, Loan, Investment,
  WalletTransaction, Expense, Meeting, MeetingAttendee, AppNotification, AuditLog, DeletionRecord,
} from "../../types";

// Re-export the firestore primitives + db/auth/functions so domain modules
// can do a single `from "./core"` import instead of reaching into
// firebase/firestore and ../firebase separately everywhere.
export {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch,
  db, auth, functions,
};
export type {
  Group, Member, Contribution, Loan, Investment,
  WalletTransaction, Expense, Meeting, MeetingAttendee, AppNotification, AuditLog, DeletionRecord,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
export function logError(
  operation: string,
  entity: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  console.error(`[DB Error] ${operation} on ${entity}:`, error);
  if (context) console.error("Context:", context);
  return {
    operation,
    entity,
    error: error instanceof Error ? error.message : String(error),
    context,
    timestamp: new Date().toISOString(),
  };
}

export async function getCurrentUserInfo(): Promise<{ userId: string; userName: string } | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    userId: user.uid,
    userName: user.displayName || user.email || "Unknown",
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type NewRecord<T extends { id: string }> = Omit<T, "id"> & Partial<Pick<T, "id">>;

export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = stripUndefined(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => {
          if (item && typeof item === 'object') {
            return stripUndefined(item as Record<string, unknown>);
          }
          return item;
        });
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

export function fromSnap<T>(snap: any): T {
  return { ...snap.data(), _docId: snap.id } as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection References
// ─────────────────────────────────────────────────────────────────────────────
export const groupsCol      = collection(db, "groups");
export const membershipsCol = collection(db, "groupMemberships");
export const notifsCol      = (uid: string) => collection(db, "users", uid, "notifications");

export const groupDoc    = (gId: string) => doc(db, "groups", gId);
export const membersCol  = (gId: string) => collection(db, "groups", gId, "members");
export const contribsCol = (gId: string) => collection(db, "groups", gId, "contributions");
export const loansCol    = (gId: string) => collection(db, "groups", gId, "loans");
export const investCol   = (gId: string) => collection(db, "groups", gId, "investments");
export const walletCol   = (gId: string) => collection(db, "groups", gId, "walletTransactions");
export const expensesCol = (gId: string) => collection(db, "groups", gId, "expenses");
export const meetingsCol = (gId: string) => collection(db, "groups", gId, "meetings");
export const auditCol    = (gId: string) => collection(db, "groups", gId, "auditLogs");
export const deletionsCol = (gId: string) => collection(db, "groups", gId, "deletions");

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────
export function getMembershipId(groupId: string, userId: string): string {
  return `${groupId}_${userId}`;
}
