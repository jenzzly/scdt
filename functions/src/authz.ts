// functions/src/authz.ts
import * as admin from "firebase-admin";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

const ROLES_THAT_CAN_DISBURSE = new Set(["accountant"]);
const ROLES_THAT_CAN_RECORD_REPAYMENT = new Set(["admin", "accountant"]);

export function requireAuth(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to do this.");
  }
  return uid;
}

/**
 * Looks up the caller's membership/role for this specific group (not just
 * "are they logged in") and throws if they're not in the allowed set. This
 * is the check that the client-side Firestore rules currently don't do for
 * loan disbursement/repayment — doing it here, server-side, means it can't
 * be bypassed by a modified client.
 */
export async function requireRole(
  db: admin.firestore.Firestore,
  groupId: string,
  uid: string,
  allowedRoles: Set<string>,
): Promise<string> {
  const membershipId = `${groupId}_${uid}`;
  const snap = await db.collection("groupMemberships").doc(membershipId).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "You are not a member of this group.");
  }
  const role = (snap.data()?.role as string) || "member";
  if (!allowedRoles.has(role)) {
    throw new HttpsError(
      "permission-denied",
      `Your role (${role}) is not allowed to perform this action.`,
    );
  }
  return role;
}

export { ROLES_THAT_CAN_DISBURSE, ROLES_THAT_CAN_RECORD_REPAYMENT };
