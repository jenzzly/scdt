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
  //
  // FIXED (found during wallet-source-of-truth review):
  //
  // This used to recompute interest independently as
  // `sum(loan.amountRepaid * (loan.totalInterest / loan.totalRepayable))`
  // for every loan with amountRepaid > 0, plus non-loan "interest" wallet
  // txs. That's the OLD, legacy-only estimation method —
  // recalcGroupTotals.ts's own comment explicitly calls this out as
  // superseded: "Interest earned is now read directly from wallet tx
  // types rather than back-calculated from loan objects — this is correct
  // for both flat and reducing-balance loans and avoids rounding drift."
  //
  // recalcGroupTotals.ts already maintains `group.totalInterestEarned`
  // correctly — it reads `loan_interest_income` wallet transactions
  // directly (the modern split-tx shape from recordRepaymentServer), and
  // only falls back to the ratio-estimation method for old
  // `loan_repayment` (pre-split, combined) transactions still sitting in
  // the ledger. Recomputing a second, divergent version of the same
  // number here — using ONLY the old method, unconditionally, for every
  // loan regardless of which tx shape actually backs it — is exactly the
  // kind of two-implementations-drift bug that produces a report showing
  // the wrong figure. Reading the single source of truth instead of
  // re-deriving it fixes that.
  //
  // Also fixes a real double-count for loans repaid via the OLD
  // (pre-split) transaction shape: those loans' interest is included in
  // group.totalInterestEarned via recalcGroupTotals's own legacy-ratio
  // fallback, so recomputing the same ratio again here was literally
  // counting that interest a second time, in addition to being stale for
  // every loan already migrated to the new split-tx shape.
  const totalInterestEarned = useMemo(
    () => group?.totalInterestEarned ?? 0,
    [group?.totalInterestEarned]
  );

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