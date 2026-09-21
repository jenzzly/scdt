// stores/recalcGroupTotals.ts
//
// Single source of truth for derived group/member totals.
//
// Changes in this revision:
//
//   MEMBER CONTRIBUTION TOTALS no longer come from walletTransactions.
//
//   The previous implementation computed each member's
//   `totalContributions` (and its alias `totalSavings`) by summing
//   `contribution`-type rows in the member's slice of the wallet
//   ledger. That works on any device that can read the wallet — which
//   is exactly admin and accountant, and nobody else. firestore.rules
//   restricts `walletTransactions` reads to `isAdminOrAccountant`, so
//   a plain member's local wallet array is always empty; running this
//   file on their device therefore recomputed their `totalContributions`
//   as 0 on every screen focus, on every write, and on rehydrate. The
//   visible symptom was every member-facing number built on top of
//   `currentMember.totalContributions` appearing briefly, then going
//   to zero.
//
//   The authoritative source for "how much has this member contributed"
//   is the contributions collection itself — specifically the approved
//   rows. Every role can read the rows they're entitled to see
//   (their own for members, everyone's for staff), and the total
//   computed from that collection is identical on every device.
//
//   `loanEarnings` is deliberately still wallet-derived. It sums
//   interest the member has actually paid, late fees, and investment
//   returns — all of which live only on the wallet ledger. For
//   non-staff roles this will remain 0 until we widen that read path
//   (see B4 in the outstanding-items list). Nothing downstream of
//   this file currently depends on a member's `loanEarnings` being
//   non-zero, so this is a known, deliberate scope boundary rather
//   than a regression.
import { round2 } from "../utils/theme";
import type { StoreState } from "./storeTypes";

export function recalcGroupTotals(
  state: Pick<
    StoreState,
    | "groups"
    | "walletTransactions"
    | "contributions"
    | "loans"
    | "investments"
    | "members"
    | "expenses"
  >,
): Partial<StoreState> {
  const updatedGroups = state.groups.map((g) => {
    const gwt = state.walletTransactions.filter((t) => t.groupId === g.id);

    // Net wallet balance: sum of all signed amounts.
    const availableBalance = round2(gwt.reduce((s, t) => s + t.amount, 0));

    // ── GROUP TOTAL SAVINGS ──────────────────────────────────────────
    //
    // Sourced from APPROVED CONTRIBUTIONS rather than from the wallet
    // ledger, for two reasons:
    //
    //   1. Correctness on every device. The group's wallet array is
    //      empty on any client that can't read `walletTransactions`,
    //      so a group whose total was derived from that array would
    //      read as 0 on a member's device.
    //
    //   2. Parity with the member-level figure computed below, which
    //      has to come from `contributions` too. Group total = sum of
    //      member totals should hold exactly, and it does when both
    //      sides share a source.
    //
    // The old wallet-based version counted `contribution`-type rows,
    // which are created 1:1 with approved contributions (both in
    // `recordContribution` with autoApprove, and in `approveContribution`
    // when a pending row is approved). Filtering approved contributions
    // here produces the same number on a staff device, and a correct
    // (rather than empty) number on a member device.
    const totalSavings = round2(
      state.contributions
        .filter((c) => c.groupId === g.id && c.status === "approved")
        .reduce((s, c) => s + (c.amount || 0), 0),
    );

    // Outstanding loans: sum of current principal balances on
    // disbursed loans. Loans are readable by every active member under
    // the current rules, so this is correct on every device.
    const totalLoans = round2(
      state.loans
        .filter((l) => l.groupId === g.id && l.status === "disbursed")
        .reduce((s, l) => s + (l.balance || 0), 0),
    );

    // Investments at cost.
    const totalInvestments = round2(
      state.investments
        .filter((i) => i.groupId === g.id && i.status === "open")
        .reduce((s, i) => s + (i.investmentAmount || 0), 0),
    );

    // ── GROUP INTEREST EARNED ────────────────────────────────────────
    //
    // Read from the wallet ledger where possible:
    //   • loan_interest_income — the modern split-tx shape
    //   • loan_repayment (legacy combined tx) — estimated via the
    //     loan's fixed schedule ratio
    //   • interest — non-loan interest credits
    //
    // On a non-staff device this sums to 0 because the wallet array is
    // empty, which is the same class of limitation as `loanEarnings`
    // below. The persisted figure only needs to be correct on the
    // device where it's actually read — the Reports screen, which is
    // admin/accountant-only today.
    const loanInterestFromLedger = round2(
      gwt
        .filter((t) => t.type === "loan_interest_income" && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    );

    const legacyRepayments = gwt.filter(
      (t) => t.type === "loan_repayment" && t.amount > 0,
    );
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

    const totalInterestEarned = round2(
      loanInterestFromLedger + loanInterestLegacy + nonLoanInterest,
    );

    const memberCount = state.members.filter(
      (m) => m.groupId === g.id && m.status === "active",
    ).length;

    return {
      ...g,
      availableBalance,
      totalSavings,
      totalLoans,
      totalInvestments,
      totalInterestEarned,
      memberCount,
    };
  });

  const updatedMembers = state.members.map((m) => {
    // ── MEMBER TOTAL CONTRIBUTIONS ──────────────────────────────────
    //
    // Sourced from approved contribution records, NOT from wallet
    // transactions. See the file header comment for the full
    // reasoning; the short version is that wallet is unreadable for
    // a plain member, so a wallet-derived figure silently resets to
    // 0 on their device.
    //
    // Filter key is `memberId`, with a fallback to `userId` so that
    // records written under the legacy convention (memberId === userId)
    // are counted too. The wallet-based version didn't need that
    // fallback because it iterated the wallet directly with the same
    // filter the wallet writer used; here we're iterating a collection
    // whose `memberId` was set by two different code paths over the
    // app's lifetime.
    const memberContributions = state.contributions.filter(
      (c) =>
        c.groupId === m.groupId &&
        c.status === "approved" &&
        (c.memberId === m.id ||
          (m.userId !== undefined && c.memberId === m.userId)),
    );

    const totalContributions = round2(
      memberContributions.reduce((s, c) => s + (c.amount || 0), 0),
    );

    // ── MEMBER LOAN EARNINGS ────────────────────────────────────────
    //
    // Still wallet-derived. On a non-staff device this remains 0 —
    // see the file header. Kept as-is here so that the shape of the
    // returned member object is unchanged from the previous version
    // (callers that already do `m.loanEarnings` keep compiling), and
    // so a single-file change is enough to fix the member totals
    // without touching the wider wallet-read story.
    const gwt = state.walletTransactions.filter(
      (t) => t.groupId === m.groupId && t.memberId === m.id,
    );

    const interestFromLedger = round2(
      gwt
        .filter((t) => t.type === "loan_interest_income")
        .reduce((s, t) => s + t.amount, 0),
    );
    const interestLegacy = round2(
      gwt
        .filter((t) => t.type === "loan_repayment" && t.amount > 0)
        .reduce((sum, tx) => {
          const loan = state.loans.find((l) => l.id === tx.loanId);
          if (!loan || !loan.totalRepayable) return sum;
          return (
            sum + round2(tx.amount * (loan.totalInterest / loan.totalRepayable))
          );
        }, 0),
    );

    const otherEarnings = round2(
      gwt
        .filter(
          (t) =>
            ["late_fee", "investment_return"].includes(t.type) &&
            t.amount > 0,
        )
        .reduce((s, t) => s + t.amount, 0),
    );

    const loanEarnings = round2(
      interestFromLedger + interestLegacy + otherEarnings,
    );

    return {
      ...m,
      totalContributions,
      totalSavings: totalContributions,
      loanEarnings,
    };
  });

  return { groups: updatedGroups, members: updatedMembers };
}