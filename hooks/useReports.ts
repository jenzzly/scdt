import { useMemo } from "react";
import {
  useGroupMembers,
  useGroupLoans,
  useGroupContributions,
  useGroupInvestments,
  useGroupWallet,
  useActiveGroup,
} from "../stores/useStore";
import { round2 } from "../utils/theme";

export function useReportData() {
  const group = useActiveGroup();
  const members = useGroupMembers();
  const loans = useGroupLoans();
  const contributions = useGroupContributions();
  const investments = useGroupInvestments();
  const wallet = useGroupWallet();

  // ── Monthly cashflow for the last 6 months ──────────────────────────────
  //
  // FIX (2 issues):
  //   1. Month key was built from `toISOString().slice(0,7)` — UTC-based.
  //      A transaction recorded on the 1st of the month at, say, 1am
  //      local time in a UTC+2 zone is 11pm the PREVIOUS day UTC, so it
  //      got bucketed into the wrong month. Key is now built from local
  //      year/month.
  //   2. `d.setMonth(d.getMonth() - i)` on a month-end day rolls over:
  //      Mar 31 minus one month becomes Mar 2 or Mar 3 (Feb 31 doesn't
  //      exist), which then produces a duplicate "Mar" bar and drops the
  //      "Feb" bar entirely. Normalizing to the 1st of each month first
  //      (`new Date(y, m - i, 1)`) makes the arithmetic safe.
  const cashflow = useMemo(() => {
    const now = new Date();
    const result: {
      month: string;
      label: string;
      income: number;
      expenses: number;
      net: number;
    }[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0",
      )}`;
      const label = d.toLocaleDateString("en", { month: "short" });

      const monthTxs = wallet.filter((t) => t.date?.startsWith(key));

      const income = round2(
        monthTxs
          .filter((t) => t.amount > 0)
          .reduce((s, t) => s + t.amount, 0),
      );

      const expenses = round2(
        Math.abs(
          monthTxs
            .filter((t) => t.amount < 0)
            .reduce((s, t) => s + t.amount, 0),
        ),
      );

      result.push({
        month: key,
        label,
        income,
        expenses,
        net: round2(income - expenses),
      });
    }

    return result;
  }, [wallet]);

  // ── Loans currently in the "defaulted" lifecycle status ────────────────
  //
  // NOTE: this is NOT "members with overdue installments right now."
  // Overdue detection lives in utils/lateFees.ts (findOverdueInstallments).
  // This is the persisted status field on the loan. Rename to
  // `defaultedLoans` if the current name causes confusion — keeping
  // `defaulters` here so existing callers don't break.
  const defaulters = useMemo(
    () => loans.filter((l) => l.status === "defaulted"),
    [loans],
  );

  // ── Total interest earned ──────────────────────────────────────────────
  //
  // Single source of truth: recalcGroupTotals.ts maintains
  // `group.totalInterestEarned` by reading `loan_interest_income` wallet
  // txs directly (the modern split-tx shape), with a legacy-ratio
  // fallback for old combined `loan_repayment` rows. Do not re-derive
  // this here — an independent implementation would drift and, for
  // legacy rows, would double-count the interest already included by
  // recalcGroupTotals's own fallback.
  const totalInterestEarned = useMemo(
    () => round2(group?.totalInterestEarned ?? 0),
    [group?.totalInterestEarned],
  );

  // ── Pending contributions ──────────────────────────────────────────────
  const pendingContributions = useMemo(
    () => contributions.filter((c) => c.status === "pending"),
    [contributions],
  );

  // ── Contribution compliance per member ─────────────────────────────────
  const memberCompliance = useMemo(() => {
    return members
      .filter((m) => m.status === "active")
      .map((m) => {
        const memberContribs = contributions.filter(
          (c) => c.memberId === m.id && c.status === "approved",
        );
        const totalPaid = round2(
          memberContribs.reduce((s, c) => s + c.amount, 0),
        );
        const paymentCount = memberContribs.length;

        const activeLoans = loans.filter(
          (l) => l.memberId === m.id && l.status === "disbursed",
        );
        const loanBalance = round2(
          activeLoans.reduce((s, l) => s + l.balance, 0),
        );

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

  // ── Investment ROI summary ─────────────────────────────────────────────
  //
  // FIX: avgROI denominator was `total` (ALL investments, including the
  // open ones that haven't produced any return yet). That silently
  // understates ROI — adding more open positions shrinks the reported
  // ROI, which is backwards. The denominator must be capital that has
  // actually been realized: the investmentAmount of CLOSED investments,
  // which are the ones whose profit is in the numerator.
  const investmentSummary = useMemo(() => {
    const total = round2(
      investments.reduce((s, i) => s + (i.investmentAmount ?? 0), 0),
    );

    const closed = investments.filter((i) => i.status === "closed");

    const closedInvested = round2(
      closed.reduce((s, i) => s + (i.investmentAmount ?? 0), 0),
    );
    const returned = round2(
      closed.reduce((s, i) => s + (i.returnAmount ?? 0), 0),
    );
    const profit = round2(
      closed.reduce((s, i) => s + (i.profit ?? 0), 0),
    );

    const avgROI =
      closedInvested > 0
        ? round2((profit / closedInvested) * 100)
        : 0;

    return {
      total,
      returned,
      profit,
      avgROI,
      active: investments.filter((i) => i.status === "open").length,
    };
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