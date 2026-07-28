// hooks/useUnpaidPenalties.ts
import { useMemo } from "react";
import { useStore, useGroupMeetings, useGroupWallet } from "../stores/useStore";

export function useUnpaidPenalties(memberId: string) {
  const meetings = useGroupMeetings();
  const wallet = useGroupWallet();
  
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
    );
    
    const totalUnpaid = memberMeetingPenalties.reduce((sum, p) => sum + (p.penaltyAmount || 0), 0) +
                        unpaidWalletPenalties.reduce((sum, p) => sum + p.amount, 0);
    
    return {
      hasUnpaidPenalties: totalUnpaid > 0,
      totalAmount: totalUnpaid,
      penalties: memberMeetingPenalties,
      walletPenalties: unpaidWalletPenalties,
      count: memberMeetingPenalties.length + unpaidWalletPenalties.length,
    };
  }, [meetings, wallet, memberId]);
  
  return unpaidPenalties;
}