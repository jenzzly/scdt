"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLES_THAT_CAN_RECORD_REPAYMENT = exports.ROLES_THAT_CAN_DISBURSE = void 0;
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const https_1 = require("firebase-functions/v2/https");
const ROLES_THAT_CAN_DISBURSE = new Set(["accountant"]);
exports.ROLES_THAT_CAN_DISBURSE = ROLES_THAT_CAN_DISBURSE;
const ROLES_THAT_CAN_RECORD_REPAYMENT = new Set(["admin", "accountant"]);
exports.ROLES_THAT_CAN_RECORD_REPAYMENT = ROLES_THAT_CAN_RECORD_REPAYMENT;
function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to do this.");
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
async function requireRole(db, groupId, uid, allowedRoles) {
    const membershipId = `${groupId}_${uid}`;
    const snap = await db.collection("groupMemberships").doc(membershipId).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "You are not a member of this group.");
    }
    const role = snap.data()?.role || "member";
    if (!allowedRoles.has(role)) {
        throw new https_1.HttpsError("permission-denied", `Your role (${role}) is not allowed to perform this action.`);
    }
    return role;
}
//# sourceMappingURL=authz.js.map