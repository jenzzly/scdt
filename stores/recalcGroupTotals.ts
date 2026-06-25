// stores/recalcGroupTotals.ts
//
// Pulled out of the old useStore.ts monolith so every domain slice can
// import it without creating a circular dependency on useStore.ts itself.
import { round2 } from "../utils/theme";
import type { StoreState } from "./storeTypes";

export function recalcGroupTotals(
  state: Pick<StoreState, "groups" | "walletTransactions" | "contributions" | "loans" | "investments" | "members">
): Partial<StoreState> {
  const updatedGroups = state.groups.map((g) => {
    const gwt = state.walletTransactions.filter((t) => t.groupId === g.id);
    const availableBalance = round2(gwt.reduce((s, t) => s + t.amount, 0));
    const totalSavings = round2(
      gwt.filter((t) => t.type === "contribution" && t.amount > 0).reduce((s, t) => s + t.amount, 0)
    );
    const totalLoans = round2(
      state.loans
        .filter((l) => l.groupId === g.id && l.status === "disbursed")
        .reduce((s, l) => s + (l.balance || 0), 0)
    );
    const totalInvestments = round2(
      state.investments
        .filter((i) => i.groupId === g.id && i.status === "open")
        .reduce((s, i) => s + (i.investmentAmount || 0), 0)
    );
    const loanInterest = state.loans
      .filter((l) => l.groupId === g.id && (l.amountRepaid || 0) > 0)
      .reduce((sum, l) => {
        const ratio = l.totalRepayable > 0 ? (l.totalInterest / l.totalRepayable) : 0;
        return sum + round2((l.amountRepaid || 0) * ratio);
      }, 0);
    const nonLoanInterest = gwt
      .filter((t) => t.type === "interest" && !t.loanId)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalInterestEarned = round2(loanInterest + nonLoanInterest);
    const memberCount = state.members.filter((m) => m.groupId === g.id && m.status === "active").length;
    return { ...g, availableBalance, totalSavings, totalLoans, totalInvestments, totalInterestEarned, memberCount };
  });

  const updatedMembers = state.members.map((m) => {
    const gwt = state.walletTransactions.filter((t) => t.groupId === m.groupId && t.memberId === m.id);
    const totalContributions = round2(
      gwt.filter((t) => t.type === "contribution" && t.amount > 0).reduce((s, t) => s + t.amount, 0)
    );
    const totalSavings = round2(
      gwt.filter((t) => t.type === "contribution" && t.amount > 0).reduce((s, t) => s + t.amount, 0)
    );
    const memberLoans = state.loans.filter((l) => l.groupId === m.groupId && l.memberId === m.id);
    const interestPaid = memberLoans.reduce((sum, l) => {
      const ratio = l.totalRepayable > 0 ? (l.totalInterest / l.totalRepayable) : 0;
      return sum + round2((l.amountRepaid || 0) * ratio);
    }, 0);
    const otherEarnings = round2(
      gwt
        .filter((t) => ["late_fee", "investment_return"].includes(t.type) && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0)
    );
    const loanEarnings = round2(interestPaid + otherEarnings);
    return { ...m, totalContributions, totalSavings, loanEarnings };
  });

  return { groups: updatedGroups, members: updatedMembers };
}
