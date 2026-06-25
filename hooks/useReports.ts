import { useMemo } from "react";
import {
  useGroupMembers, useGroupLoans, useGroupContributions,
  useGroupInvestments, useGroupWallet, useActiveGroup,
} from "../stores/useStore";
import { round2 } from "../utils/theme";

export function useReportData() {
  const group = useActiveGroup();
  const members = useGroupMembers();
  const loans = useGroupLoans();
  const contributions = useGroupContributions();
  const investments = useGroupInvestments();
  const wallet = useGroupWallet();

  // ── Monthly cashflow for the last 6 months ──────────────────────────────────
  const cashflow = useMemo(() => {
    const result: { month: string; label: string; income: number; expenses: number; net: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString("en", { month: "short" });
      const monthTxs = wallet.filter((t) => t.date?.startsWith(key));
      const income = round2(monthTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
      const expenses = round2(Math.abs(monthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)));
      result.push({ month: key, label, income, expenses, net: round2(income - expenses) });
    }
    return result;
  }, [wallet]);

  // ── Outstanding loans per member ─────────────────────────────────────────────
  const defaulters = useMemo(
    () => loans.filter((l) => l.status === "defaulted"),
    [loans]
  );

  // ── Total interest earned ──────────────────────────────────────────────────
  const totalInterestEarned = useMemo(() => {
    const loanInterest = loans
      .filter((l) => (l.amountRepaid || 0) > 0)
      .reduce((sum, l) => {
        const ratio = l.totalRepayable > 0 ? (l.totalInterest / l.totalRepayable) : 0;
        return sum + round2((l.amountRepaid || 0) * ratio);
      }, 0);
    const nonLoanInterest = wallet
      .filter((t) => t.type === "interest" && !t.loanId)
      .reduce((sum, t) => sum + t.amount, 0);
    return round2(loanInterest + nonLoanInterest);
  }, [loans, wallet]);

  // ── Pending contributions ────────────────────────────────────────────────────
  const pendingContributions = useMemo(
    () => contributions.filter((c) => c.status === "pending"),
    [contributions]
  );

  // ── Contribution compliance per member ──────────────────────────────────────
  const memberCompliance = useMemo(() => {
    return members
      .filter((m) => m.status === "active")
      .map((m) => {
        const memberContribs = contributions.filter((c) => c.memberId === m.id && c.status === "approved");
        const totalPaid = memberContribs.reduce((s, c) => s + c.amount, 0);
        const paymentCount = memberContribs.length;
        const activeLoans = loans.filter((l) => l.memberId === m.id && l.status === "disbursed");
        const loanBalance = activeLoans.reduce((s, l) => s + l.balance, 0);
        return {
          member: m,
          totalPaid,
          paymentCount,
          activeLoans: activeLoans.length,
          loanBalance,
        };
      })
      .sort((a, b) => b.totalPaid - a.totalPaid);
  }, [members, contributions, loans]);

  // ── Investment ROI summary ───────────────────────────────────────────────────
  const investmentSummary = useMemo(() => {
    const total = investments.reduce((s, i) => s + i.investmentAmount, 0);
    const closed = investments.filter((i) => i.status === "closed");
    const returned = closed.reduce((s, i) => s + (i.returnAmount ?? 0), 0);
    const profit = closed.reduce((s, i) => s + (i.profit ?? 0), 0);
    const avgROI = closed.length > 0 ? round2((profit / total) * 100) : 0;
    return { total, returned, profit, avgROI, active: investments.filter((i) => i.status === "open").length };
  }, [investments]);

  return {
    cashflow,
    defaulters,
    totalInterestEarned,
    pendingContributions,
    memberCompliance,
    investmentSummary,
    group,
  };
}
