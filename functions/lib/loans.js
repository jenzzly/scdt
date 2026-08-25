"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRepayment = exports.disburseLoan = void 0;
// functions/src/loans.ts
//
// Server-side ledger authority for loans. These two callables replace the
// client-computed disbursement/repayment logic that used to live in
// stores/slices/loanSlice.ts (disburseLoan, recordRepayment). The client
// now just calls these and trusts whatever they return — it never computes
// a balance or writes one directly.
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const authz_1 = require("./authz");
const loanMath_1 = require("./loanMath");
const db = admin.firestore();
exports.disburseLoan = (0, https_1.onCall)(async (request) => {
    const uid = (0, authz_1.requireAuth)(request);
    const { groupId, loanId } = request.data || {};
    if (!groupId || !loanId) {
        throw new https_1.HttpsError("invalid-argument", "groupId and loanId are required.");
    }
    await (0, authz_1.requireRole)(db, groupId, uid, authz_1.ROLES_THAT_CAN_DISBURSE);
    const loanRef = db.collection("groups").doc(groupId).collection("loans").doc(loanId);
    const groupRef = db.collection("groups").doc(groupId);
    return db.runTransaction(async (tx) => {
        const [loanSnap, groupSnap] = await Promise.all([tx.get(loanRef), tx.get(groupRef)]);
        if (!loanSnap.exists)
            throw new https_1.HttpsError("not-found", "Loan not found.");
        const loan = loanSnap.data();
        const currency = groupSnap.data()?.currency || "RWF";
        if (loan.status !== "approved") {
            throw new https_1.HttpsError("failed-precondition", `Loan must be fully approved before disbursement (current status: ${loan.status}).`);
        }
        const now = new Date().toISOString();
        const walletTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
        const auditRef = db.collection("groups").doc(groupId).collection("auditLogs").doc();
        const loanUpdate = {
            status: "disbursed",
            disbursementDate: now,
            updatedAt: now,
            updatedBy: uid,
        };
        tx.update(loanRef, loanUpdate);
        const walletTx = {
            id: walletTxRef.id,
            groupId,
            type: "loan_disbursement",
            amount: -(0, loanMath_1.round2)(loan.amount),
            description: `Loan disbursement (${(0, loanMath_1.fmtCurrency)(loan.amount, currency)})`,
            date: now,
            memberId: loan.memberId,
            loanId,
            createdAt: now,
            createdBy: uid,
        };
        tx.set(walletTxRef, walletTx);
        tx.set(auditRef, {
            id: auditRef.id,
            groupId,
            userId: uid,
            userName: request.auth?.token?.name || request.auth?.token?.email || "Unknown",
            action: "disbursed",
            entityType: "loan",
            entityId: loanId,
            before: loan,
            after: { ...loan, ...loanUpdate },
            reason: "Loan disbursed",
            timestamp: now,
        });
        return { loan: { ...loan, ...loanUpdate, id: loanId }, walletTx };
    });
});
exports.recordRepayment = (0, https_1.onCall)(async (request) => {
    const uid = (0, authz_1.requireAuth)(request);
    const { groupId, loanId, amount, date } = request.data || {};
    if (!groupId || !loanId || typeof amount !== "number" || amount <= 0) {
        throw new https_1.HttpsError("invalid-argument", "groupId, loanId, and a positive amount are required.");
    }
    await (0, authz_1.requireRole)(db, groupId, uid, authz_1.ROLES_THAT_CAN_RECORD_REPAYMENT);
    const loanRef = db.collection("groups").doc(groupId).collection("loans").doc(loanId);
    const groupRef = db.collection("groups").doc(groupId);
    const memberCol = db.collection("groups").doc(groupId).collection("members");
    return db.runTransaction(async (tx) => {
        const [loanSnap, groupSnap] = await Promise.all([tx.get(loanRef), tx.get(groupRef)]);
        if (!loanSnap.exists)
            throw new https_1.HttpsError("not-found", "Loan not found.");
        const loan = loanSnap.data();
        const currency = groupSnap.data()?.currency || "RWF";
        if (loan.status !== "disbursed") {
            throw new https_1.HttpsError("failed-precondition", `Repayments can only be recorded against a disbursed loan (current status: ${loan.status}).`);
        }
        const split = (0, loanMath_1.splitRepayment)({
            amount: loan.amount,
            interestRate: loan.interestRate,
            interestMethod: loan.interestMethod || "flat",
            totalInterest: loan.totalInterest,
            totalRepayable: loan.totalRepayable,
            amountRepaid: loan.amountRepaid || 0,
            balance: loan.balance,
        }, amount);
        const now = date || new Date().toISOString();
        const loanUpdate = {
            amountRepaid: split.newAmountRepaid,
            balance: split.newBalance,
            status: split.isRepaid ? "repaid" : "disbursed",
            updatedAt: now,
            updatedBy: uid,
        };
        if (split.isRepaid)
            loanUpdate.completionDate = now;
        tx.update(loanRef, loanUpdate);
        const repaymentTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
        const repaymentTx = {
            id: repaymentTxRef.id,
            groupId,
            type: "loan_repayment",
            amount: (0, loanMath_1.round2)(amount - split.overpaidAmount),
            description: `Loan repayment (Principal: ${(0, loanMath_1.fmtCurrency)(split.principalPortion, currency)}, Interest: ${(0, loanMath_1.fmtCurrency)(split.interestPortion, currency)})`,
            date: now,
            memberId: loan.memberId,
            loanId,
            createdAt: now,
            createdBy: uid,
        };
        tx.set(repaymentTxRef, repaymentTx);
        let creditTx = null;
        if (split.isOverpaid && split.overpaidAmount > 0) {
            const creditTxRef = db.collection("groups").doc(groupId).collection("walletTransactions").doc();
            creditTx = {
                id: creditTxRef.id,
                groupId,
                type: "other_credit",
                amount: split.overpaidAmount,
                description: "Overpayment credit from loan - can be used for future contributions",
                date: now,
                memberId: loan.memberId,
                loanId,
                createdAt: now,
                createdBy: uid,
            };
            tx.set(creditTxRef, creditTx);
        }
        const auditRef = db.collection("groups").doc(groupId).collection("auditLogs").doc();
        tx.set(auditRef, {
            id: auditRef.id,
            groupId,
            userId: uid,
            userName: request.auth?.token?.name || request.auth?.token?.email || "Unknown",
            action: "updated",
            entityType: "loan",
            entityId: loanId,
            before: loan,
            after: { ...loan, ...loanUpdate },
            reason: `Repayment of ${(0, loanMath_1.fmtCurrency)(amount, currency)} recorded`,
            timestamp: now,
        });
        return {
            loan: { ...loan, ...loanUpdate, id: loanId },
            repaymentTx,
            creditTx,
            memberId: loan.memberId,
            overpaidAmount: split.overpaidAmount,
            currency,
        };
    }).then(async (result) => {
        // Notification is sent outside the transaction since it's not part of
        // the ledger and shouldn't roll the financial write back if it fails.
        if (result.overpaidAmount > 0) {
            const memberSnap = await memberCol.doc(String(result.memberId)).get();
            const userId = memberSnap.data()?.userId;
            if (userId) {
                await db.collection("users").doc(userId).collection("notifications").add({
                    userId,
                    groupId,
                    type: "overpayment_credit",
                    title: "Loan Overpayment Credit",
                    message: `Your loan overpayment of ${(0, loanMath_1.fmtCurrency)(result.overpaidAmount, result.currency)} has been credited to your account.`,
                    read: false,
                    metadata: { loanId, amount: result.overpaidAmount },
                    createdAt: new Date().toISOString(),
                }).catch((err) => console.warn("[recordRepayment] notification failed (non-fatal):", err));
            }
        }
        return result;
    });
});
//# sourceMappingURL=loans.js.map