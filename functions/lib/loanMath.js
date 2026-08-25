"use strict";
// functions/src/loanMath.ts
//
// The authoritative loan ledger math. This mirrors the shape of the
// estimate-only helpers in app/utils/theme.ts (loanSchedule,
// loanMonthlyPayment) but THIS is the version that actually gets used to
// move money — every disbursement and repayment goes through
// splitRepayment() below, server-side, so the principal/interest split and
// resulting balance can never be forged or miscalculated by a client.
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = round2;
exports.splitRepayment = splitRepayment;
exports.fmtCurrency = fmtCurrency;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Splits an incoming repayment amount between interest and principal.
 * The method used is whatever was snapshotted on the loan at submission
 * time (loan.interestMethod) — never the group's *current* setting, so a
 * later change to a group's default doesn't retroactively change how an
 * existing loan's repayments are split.
 *
 * - "flat": interest accrues at a fixed ratio of totalInterest/totalRepayable
 *   (matches the original client-side implementation this replaced).
 * - "reducing_balance": interest for THIS repayment is the outstanding
 *   balance times the loan's periodic rate — the standard amortizing-loan
 *   definition, so interest shrinks as principal gets paid down instead of
 *   being a fixed proportion of every payment.
 */
function splitRepayment(loan, amount) {
    const amountNum = round2(amount);
    const method = loan.interestMethod || "flat";
    if (method === "reducing_balance") {
        const periodicRate = loan.interestRate / 100;
        const interestDue = round2(loan.balance * periodicRate);
        const remainingTotal = round2(loan.balance + interestDue);
        const isOverpaid = amountNum > remainingTotal;
        const overpaidAmount = isOverpaid ? round2(amountNum - remainingTotal) : 0;
        let interestPortion;
        let principalPortion;
        if (amountNum >= remainingTotal) {
            interestPortion = interestDue;
            principalPortion = loan.balance;
        }
        else if (amountNum <= interestDue) {
            // Payment doesn't even cover this period's interest — all of it
            // goes to interest, nothing reduces the balance.
            interestPortion = amountNum;
            principalPortion = 0;
        }
        else {
            interestPortion = interestDue;
            principalPortion = round2(amountNum - interestDue);
        }
        const newAmountRepaid = round2(loan.amountRepaid + (amountNum - overpaidAmount));
        const newBalance = Math.max(0, round2(loan.balance - principalPortion));
        const isRepaid = newBalance === 0;
        return { interestPortion, principalPortion, overpaidAmount, isOverpaid, newAmountRepaid, newBalance, isRepaid };
    }
    // Flat / simple interest (original behavior, unchanged).
    const ratio = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
    const interestRepaidSoFar = loan.totalRepayable > 0 ? round2(loan.amountRepaid * ratio) : 0;
    const remainingInterest = Math.max(0, round2(loan.totalInterest - interestRepaidSoFar));
    const remainingPrincipal = loan.balance;
    const remainingTotal = round2(remainingInterest + remainingPrincipal);
    const isOverpaid = amountNum > remainingTotal;
    const overpaidAmount = isOverpaid ? round2(amountNum - remainingTotal) : 0;
    let interestPortion;
    let principalPortion;
    if (amountNum >= remainingTotal) {
        interestPortion = remainingInterest;
        principalPortion = remainingPrincipal;
    }
    else {
        interestPortion = Math.min(remainingInterest, round2(amountNum * ratio));
        principalPortion = round2(amountNum - interestPortion);
    }
    const newAmountRepaid = round2(loan.amountRepaid + (amountNum - overpaidAmount));
    const newBalance = Math.max(0, round2(loan.balance - principalPortion));
    const isRepaid = newBalance === 0;
    return { interestPortion, principalPortion, overpaidAmount, isOverpaid, newAmountRepaid, newBalance, isRepaid };
}
function fmtCurrency(amount, currency) {
    const value = Number.isFinite(amount) ? amount : 0;
    return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
//# sourceMappingURL=loanMath.js.map