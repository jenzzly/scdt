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

  const unpaidPenalties = useMemo(() => {
    // Find all meeting penalties for this member
    const memberMeetingPenalties = meetings.flatMap(meeting => 
      meeting.attendees
        .filter(attendee => 
          attendee.memberId === memberId && 
          attendee.penaltyAmount && 
          attendee.penaltyAmount > 0 &&
          !attendee.penaltyPaid
        )
        .map(attendee => ({
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          meetingDate: meeting.date,
          penaltyAmount: attendee.penaltyAmount,
          status: attendee.status,
          type: "meeting_penalty",
        }))
    );

    // recordAttendance() also writes a "late_fee" wallet transaction for
    // every absence, as a permanent ledger record — using a deterministic
    // id of `meeting-penalty-{meetingId}-{memberId}`. That wallet entry is
    // never deleted (it's a historical ledger record, not a "still owed"
    // flag), so whether it's still outstanding is governed entirely by the
    // matching meeting attendee's `penaltyPaid` flag above — NOT by
    // whether the wallet transaction still exists. Counting both was
    // double-counting every absence penalty, and clicking "Clear" on the
    // Meetings screen (which only flips `penaltyPaid`) could never make it
    // disappear here, since the wallet half was never reconsidered.
    //
    // Late fees added independently of meeting attendance (standalone
    // contribution/loan late fees from utils/lateFees.ts, or manual wallet
    // entries) don't have that id shape, so they're tracked via their own
    // `feePaid` flag instead — set by clearStandaloneLateFee(), officer-gated
    // the same way clearAllMemberPenalties() is.
    const meetingPenaltyTxIds = new Set(
      meetings.map((meeting) => `meeting-penalty-${meeting.id}-${memberId}`)
    );
    const unpaidWalletPenalties = wallet.filter(tx => 
      tx.type === "late_fee" && 
      tx.memberId === memberId &&
      !tx.deletedAt && // Not soft-deleted
      !tx.feePaid && // Not already cleared by an officer (see clearStandaloneLateFee)
      !meetingPenaltyTxIds.has(tx.id) // not a meeting-attendance ledger mirror — those are tracked above
    ).map(tx => ({
      ...tx,
      type: "late_fee",
    }));

    // ─────────────────────────────────────────────────────────────────────
    // Live, not-yet-applied late fees.
    //
    // utils/lateFees.ts computes contribution/loan late fees ON DEMAND and
    // never auto-charges them: "Nothing is automatically charged in the
    // background... An officer/admin explicitly applies each newly accrued
    // chunk." That means `unpaidWalletPenalties` above — which only looks
    // at EXISTING wallet `late_fee` transactions — misses a member who is
    // genuinely late right now but whose fee simply hasn't been applied
    // yet by an officer. These two lists close that gap by running the
    // exact same detection the Late Fees report uses, live, and matching
    // it to this member, so a real-time overdue member is caught here too.
    // ─────────────────────────────────────────────────────────────────────

    const liveLateContributions = group
      ? findOverdueContributions(group, members, contributions, wallet).filter(
          (o) => o.memberId === memberId
        )
      : [];

    const liveLateInstallments = group
      ? findOverdueInstallments(group, members, loans, wallet).filter(
          (o) => o.memberId === memberId
        )
      : [];

    // Check for unpaid/pending contributions (submitted, awaiting
    // approval — this is unrelated to lateness; a contribution can be
    // pending and still be on time).
    const unpaidContributions = contributions.filter(c => 
      c.memberId === memberId && 
      c.status === "pending" && // Only pending contributions count as unpaid
      c.contributionType === "regular" // Only regular contributions, not loan repayments
    ).map(c => ({
      contributionId: c.id,
      amount: c.amount,
      date: c.date,
      description: c.description || "Regular contribution",
      type: "unpaid_contribution",
    }));

    // Active loans with an outstanding balance.
    const activeLoanBalances = loans.filter(loan => 
      loan.memberId === memberId && 
      loan.status === "disbursed" &&
      loan.balance > 0 // Still has outstanding balance
    ).map(loan => ({
      loanId: loan.id,
      amount: loan.balance,
      applicationDate: loan.applicationDate,
      totalRepayable: loan.totalRepayable,
      amountRepaid: loan.amountRepaid,
      type: "overdue_loan",
    }));

    // IMPORTANT: "overdue" now means genuinely overdue — the loan has at
    // least one installment past its due date + grace period, per
    // findOverdueInstallments — NOT merely "not yet fully repaid."
    //
    // The previous version flagged ANY active loan with balance > 0,
    // which is true of every loan right up until its final installment —
    // including one being paid exactly on schedule. That meant this was
    // the only one of the four checks that reliably fired (it fires on
    // almost any existing loan), while the genuinely-late checks stayed
    // empty because they either require an officer to have already
    // applied a fee (see liveLateContributions/liveLateInstallments
    // above, which now cover that gap) or a real attendance/contribution
    // record to exist.
    const overdueLoanIds = new Set(liveLateInstallments.map((i) => i.loanId));
    const overdueLoans = activeLoanBalances.filter((l) =>
      overdueLoanIds.has(l.loanId)
    );

    const totalUnpaid =
      memberMeetingPenalties.reduce((sum, p) => sum + (p.penaltyAmount || 0), 0) +
      unpaidWalletPenalties.reduce((sum, p) => sum + p.amount, 0) +
      unpaidContributions.reduce((sum, c) => sum + c.amount, 0) +
      overdueLoans.reduce((sum, l) => sum + l.amount, 0) +
      liveLateContributions.reduce((sum, o) => sum + o.feeAmount, 0) +
      liveLateInstallments.reduce((sum, o) => sum + o.feeAmount, 0);

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
    };
  }, [group, members, meetings, wallet, contributions, loans, memberId]);
  
  return unpaidPenalties;
}