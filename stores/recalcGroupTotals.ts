// stores/recalcGroupTotals.ts
//
// Single source of truth for derived group/member totals.
// Interest earned is now read directly from wallet tx types rather than
// back-calculated from loan objects — this is correct for both flat and
// reducing-balance loans and avoids rounding drift.
import { round2 } from "../utils/theme";
import type { StoreState } from "./storeTypes";

export function recalcGroupTotals(
  state: Pick<StoreState, "groups" | "walletTransactions" | "contributions" | "loans" | "investments" | "members">
): Partial<StoreState> {
  const updatedGroups = state.groups.map((g) => {
    const gwt = state.walletTransactions.filter((t) => t.groupId === g.id);

    // Net wallet balance: sum of all signed amounts
    const availableBalance = round2(gwt.reduce((s, t) => s + t.amount, 0));

    // Total savings: positive contribution credits only
    const totalSavings = round2(
      gwt
        .filter((t) => t.type === "contribution" && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    );

    // Outstanding loans: sum of current principal balances on disbursed loans
    const totalLoans = round2(
      state.loans
        .filter((l) => l.groupId === g.id && l.status === "disbursed")
        .reduce((s, l) => s + (l.balance || 0), 0),
    );

    // Investments at cost
    const totalInvestments = round2(
      state.investments
        .filter((i) => i.groupId === g.id && i.status === "open")
        .reduce((s, i) => s + (i.investmentAmount || 0), 0),
    );

    // ── Interest earned ──────────────────────────────────────────────────
    // Read from wallet ledger — works correctly for BOTH flat and RB loans.
    // loan_interest_income: new split tx type (post-fix)
    // interest: non-loan interest credits
    // loan_repayment with positive amount: legacy combined tx (pre-fix data)
    //   For legacy txs we estimate interest as amount × ratio from the loan object.
    const loanInterestFromLedger = round2(
      gwt
        .filter((t) => t.type === "loan_interest_income" && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    );

    // Legacy fallback: old loan_repayment txs (combined) — estimate interest portion
    const legacyRepayments = gwt.filter((t) => t.type === "loan_repayment" && t.amount > 0);
    const loanInterestLegacy = round2(
      legacyRepayments.reduce((sum, tx) => {
        const loan = state.loans.find((l) => l.id === tx.loanId);
        if (!loan || !loan.totalRepayable) return sum;
        const ratio = loan.totalInterest / loan.totalRepayable;
        return sum + round2(tx.amount * ratio);
      }, 0),
    );

    const nonLoanInterest = round2(
      gwt
        .filter((t) => t.type === "interest" && !t.loanId && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    );

    const totalInterestEarned = round2(loanInterestFromLedger + loanInterestLegacy + nonLoanInterest);

    const memberCount = state.members.filter((m) => m.groupId === g.id && m.status === "active").length;

    return { ...g, availableBalance, totalSavings, totalLoans, totalInvestments, totalInterestEarned, memberCount };
  });

  const updatedMembers = state.members.map((m) => {
    const gwt = state.walletTransactions.filter((t) => t.groupId === m.groupId && t.memberId === m.id);

    const totalContributions = round2(
      gwt.filter((t) => t.type === "contribution" && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    );

    // Interest paid by this member — from ledger where possible, legacy fallback
    const interestFromLedger = round2(
      gwt.filter((t) => t.type === "loan_interest_income").reduce((s, t) => s + t.amount, 0),
    );
    const interestLegacy = round2(
      gwt.filter((t) => t.type === "loan_repayment" && t.amount > 0).reduce((sum, tx) => {
        const loan = state.loans.find((l) => l.id === tx.loanId);
        if (!loan || !loan.totalRepayable) return sum;
        return sum + round2(tx.amount * (loan.totalInterest / loan.totalRepayable));
      }, 0),
    );

    const otherEarnings = round2(
      gwt
        .filter((t) => ["late_fee", "investment_return"].includes(t.type) && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    );

    const loanEarnings = round2(interestFromLedger + interestLegacy + otherEarnings);

    return { ...m, totalContributions, totalSavings: totalContributions, loanEarnings };
  });

  return { groups: updatedGroups, members: updatedMembers };
}
