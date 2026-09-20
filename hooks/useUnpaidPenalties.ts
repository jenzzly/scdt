// hooks/useUnpaidPenalties.ts
import { useMemo } from "react";
import {
  useStore,
  useActiveGroup,
  useGroupMembers,
  useGroupMeetings,
  useGroupWallet,
  useGroupContributions,
  useGroupLoans,
  useCurrentUserRole,
} from "../stores/useStore";
import {
  findOverdueContributions,
  findOverdueInstallments,
} from "../utils/lateFees";

export function useUnpaidPenalties(memberId: string) {
  const group = useActiveGroup();
  const members = useGroupMembers();
  const meetings = useGroupMeetings();
  const wallet = useGroupWallet();
  const contributions = useGroupContributions();
  const loans = useGroupLoans();
  const role = useCurrentUserRole();

  // Wallet is only readable to admin/accountant under firestore.rules.
  // Everyone else gets a fallback path that skips wallet entirely and
  // uses only the collections that ARE list-readable (meetings,
  // contributions, loans).
  const canReadWallet = role === "admin" || role === "accountant";

  const unpaidPenalties = useMemo(() => {
    // ─────────────────────────────────────────────────────────────────────
    // 1. Meeting penalties (readable by every role via `meetings`)
    // ─────────────────────────────────────────────────────────────────────
    const memberMeetingPenalties = meetings.flatMap((meeting) =>
      meeting.attendees
        .filter(
          (attendee) =>
            attendee.memberId === memberId &&
            attendee.penaltyAmount &&
            attendee.penaltyAmount > 0 &&
            !attendee.penaltyPaid,
        )
        .map((attendee) => ({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          meetingDate: meeting.date,
          penaltyAmount: attendee.penaltyAmount,
          status: attendee.status,
          type: "meeting_penalty",
        })),
    );

    // ─────────────────────────────────────────────────────────────────────
    // 2. Applied-but-unpaid late fees (staff only — wallet-based)
    //
    // Members can't read walletTransactions, so this list is only
    // populated for admin/accountant. The member-safe fallback is
    // handled by the "live" lists below using their total-fee variant.
    // ─────────────────────────────────────────────────────────────────────
    const meetingPenaltyTxIds = new Set(
      meetings.map((meeting) => `meeting-penalty-${meeting.id}-${memberId}`),
    );
    const unpaidWalletPenalties = canReadWallet
      ? wallet
          .filter(
            (tx) =>
              tx.type === "late_fee" &&
              tx.memberId === memberId &&
              !tx.deletedAt &&
              !tx.feePaid &&
              !meetingPenaltyTxIds.has(tx.id),
          )
          .map((tx) => ({
            ...tx,
            type: "late_fee",
          }))
      : [];

    // ─────────────────────────────────────────────────────────────────────
    // 3. Live, not-yet-cleared late fees — computed from readable
    //    collections only.
    //
    // findOverdueContributions / findOverdueInstallments compute what
    // an officer COULD apply right now for each overdue period. For
    // staff, `feeAmount` (the newly-accrued portion) is the right
    // number because the applied portion is already counted in
    // unpaidWalletPenalties above.
    //
    // For everyone else, we can't see the applied portion — so we use
    // `totalFeeAmount` on installments (the full fee owed across all
    // days of lateness, applied or not) and `feeAmount` on
    // contributions (the only field the utility exposes). This makes
    // the member's number a real, non-zero reflection of what they
    // owe, at the cost of possibly including fees already cleared.
    // Over-counting is the safe failure mode for a "what do I owe"
    // display — under-counting hides money the member still owes.
    // ─────────────────────────────────────────────────────────────────────
    const liveLateContributions = group
      ? findOverdueContributions(group, members, contributions, wallet).filter(
          (o) => o.memberId === memberId,
        )
      : [];

    const liveLateInstallments = group
      ? findOverdueInstallments(group, members, loans, wallet).filter(
          (o) => o.memberId === memberId,
        )
      : [];

    // ─────────────────────────────────────────────────────────────────────
    // 4. Pending contributions (submitted, awaiting approval)
    // ─────────────────────────────────────────────────────────────────────
    const unpaidContributions = contributions
      .filter(
        (c) =>
          c.memberId === memberId &&
          c.status === "pending" &&
          c.contributionType === "regular",
      )
      .map((c) => ({
        contributionId: c.id,
        amount: c.amount,
        date: c.date,
        description: c.description || "Regular contribution",
        type: "unpaid_contribution" as const,
      }));

    // ─────────────────────────────────────────────────────────────────────
    // 5. Genuinely overdue loans (not merely "has a balance")
    // ─────────────────────────────────────────────────────────────────────
    const activeLoanBalances = loans
      .filter(
        (loan) =>
          loan.memberId === memberId &&
          loan.status === "disbursed" &&
          loan.balance > 0,
      )
      .map((loan) => ({
        loanId: loan.id,
        amount: loan.balance,
        applicationDate: loan.applicationDate,
        totalRepayable: loan.totalRepayable,
        amountRepaid: loan.amountRepaid,
        type: "overdue_loan" as const,
      }));

    const overdueLoanIds = new Set(liveLateInstallments.map((i) => i.loanId));
    const overdueLoans = activeLoanBalances.filter((l) =>
      overdueLoanIds.has(l.loanId),
    );

    // ─────────────────────────────────────────────────────────────────────
    // 6. Total
    // ─────────────────────────────────────────────────────────────────────
    const liveContribFeesTotal = liveLateContributions.reduce(
      (sum, o) => sum + o.feeAmount,
      0,
    );
    const liveInstallmentFeesTotal = liveLateInstallments.reduce(
      (sum, o) =>
        sum +
        (canReadWallet
          ? // Staff: only the newly-accrued slice — the applied
            // portion is already counted via unpaidWalletPenalties.
            o.feeAmount
          : // Member: full fee owed across all days of lateness,
            // because we have no readable source for the applied
            // portion. Over-counts if some has been cleared.
            o.totalFeeAmount ?? o.feeAmount),
      0,
    );

    const totalUnpaid =
      memberMeetingPenalties.reduce(
        (sum, p) => sum + (p.penaltyAmount || 0),
        0,
      ) +
      unpaidWalletPenalties.reduce((sum, p) => sum + p.amount, 0) +
      unpaidContributions.reduce((sum, c) => sum + c.amount, 0) +
      overdueLoans.reduce((sum, l) => sum + l.amount, 0) +
      liveContribFeesTotal +
      liveInstallmentFeesTotal;

    return {
      hasUnpaidPenalties: totalUnpaid > 0,
      totalAmount: totalUnpaid,
      penalties: memberMeetingPenalties,
      walletPenalties: unpaidWalletPenalties,
      unpaidContributions,
      overdueLoans,
      liveLateContributions,
      liveLateInstallments,
      count:
        memberMeetingPenalties.length +
        unpaidWalletPenalties.length +
        unpaidContributions.length +
        overdueLoans.length +
        liveLateContributions.length +
        liveLateInstallments.length,
      // Signals to the UI whether the totals include the applied-but-
      // unpaid ledger half (staff) or are a member-safe approximation.
      // UIs can surface this in a "how is this calculated?" tooltip.
      isCompleteView: canReadWallet,
    };
  }, [
    group,
    members,
    meetings,
    wallet,
    contributions,
    loans,
    memberId,
    canReadWallet,
  ]);

  return unpaidPenalties;
}