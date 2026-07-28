// utils/lateFees.ts
//
// Late-fee detection and calculation — separate from meeting-attendance
// penalties (see Group.latePenaltyRatePct etc. for those). Both fee types
// here are calculated as a PERCENTAGE OF THE AMOUNT DUE, not a flat figure:
//
//   • Contribution late fee = missedContributionAmount × (ratePct / 100)
//   • Loan late fee         = overdueInstallmentAmount  × (ratePct / 100)
//
// Nothing in this app runs on a server-side schedule, so "overdue" status
// is computed on demand (when an officer opens Reports or Group Settings)
// rather than via a background job. Officers/admins explicitly apply a fee
// with one tap once it's surfaced — nothing charges silently in the
// background.
import { round2 } from "./theme";
import type { Group, Member, Contribution, Loan, WalletTransaction } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Contribution late fees
// ─────────────────────────────────────────────────────────────────────────────
export interface OverdueContribution {
  memberId: string;
  memberName: string;
  periodLabel: string;       // e.g. "March 2026"
  periodStart: string;       // ISO date the period began
  dueDate: string;           // ISO date payment was due
  amountDue: number;         // the group's standard contribution amount
  daysLate: number;
  feeAmount: number;         // amountDue × ratePct / 100
  feeTxId: string;           // deterministic ID — used to avoid double-charging
}

/** Advance a date forward by one contribution period. */
function nextPeriod(date: Date, frequency: Group["contributionFrequency"]): Date {
  const d = new Date(date);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "biweekly") d.setDate(d.getDate() + 14);
  else if (frequency === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly (default)
  return d;
}

function periodLabel(date: Date, frequency: Group["contributionFrequency"]): string {
  if (frequency === "weekly" || frequency === "biweekly") {
    return `Week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (frequency === "yearly") return String(date.getFullYear());
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Find every contribution period between a member joining and today that
 * has no matching approved contribution and is past its due date + grace
 * period. Returns one entry per missed period, each carrying its own
 * deterministic fee transaction ID so re-running this never double-charges
 * a period that already has a fee applied.
 */
export function findOverdueContributions(
  group: Group,
  members: Member[],
  contributions: Contribution[],
  existingWalletTxs: WalletTransaction[],
  asOf: Date = new Date(),
): OverdueContribution[] {
  const ratePct = group.contributionLateFeeRatePct;
  if (!ratePct || ratePct <= 0) return [];
  const graceDays = group.contributionLateFeeGraceDays ?? 0;
  const amountDue = group.contributionAmount ?? 0;
  if (amountDue <= 0) return [];

  // Fees only ever apply to periods on/after this date — never retroactively
  // from a member's dateJoined. Unconfigured (no start date set) means the
  // feature is off, even if a rate is set, so enabling the rate alone can
  // never surprise-charge a group's entire history.
  const startDateRaw = group.contributionLateFeeStartDate;
  if (!startDateRaw) return [];
  const startDate = new Date(startDateRaw);
  if (isNaN(startDate.getTime())) return [];

  const results: OverdueContribution[] = [];

  for (const member of members) {
    if (member.status !== "active") continue;
    if (!member.dateJoined) continue;

    const approvedByMember = contributions.filter(
      (c) => c.memberId === member.id && c.status === "approved" && c.contributionType === "regular",
    );

    // Start scanning from whichever is LATER: the member joining, or the
    // group's configured late-fee start date — so fee calculation never
    // reaches back before the date an admin explicitly opted in.
    const memberJoined = new Date(member.dateJoined);
    let cursor = memberJoined > startDate ? memberJoined : startDate;
    let guard = 0; // safety valve against runaway loops on bad data
    while (guard < 500) {
      guard++;
      const periodStart = new Date(cursor);
      const dueDate = new Date(cursor);
      dueDate.setDate(group.contributionDay || dueDate.getDate());
      const graceDate = new Date(dueDate);
      graceDate.setDate(graceDate.getDate() + graceDays);

      if (graceDate > asOf) break; // this and all future periods aren't due yet

      const periodEnd = nextPeriod(periodStart, group.contributionFrequency);
      const wasPaid = approvedByMember.some((c) => {
        const cd = new Date(c.date);
        return cd >= periodStart && cd < periodEnd;
      });

      if (!wasPaid) {
        const feeTxId = `late-fee-contrib-${member.id}-${periodStart.toISOString().slice(0, 10)}`;
        const alreadyCharged = existingWalletTxs.some((t) => t.id === feeTxId);
        if (!alreadyCharged) {
          const daysLate = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
          results.push({
            memberId: member.id,
            memberName: member.fullName,
            periodLabel: periodLabel(periodStart, group.contributionFrequency),
            periodStart: periodStart.toISOString(),
            dueDate: dueDate.toISOString(),
            amountDue,
            daysLate,
            feeAmount: round2(amountDue * (ratePct / 100)),
            feeTxId,
          });
        }
      }

      cursor = periodEnd;
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loan repayment late fees
// ─────────────────────────────────────────────────────────────────────────────
export interface OverdueInstallment {
  loanId: string;
  memberId: string;
  memberName: string;
  installmentIndex: number;
  dueDate: string;
  amountDue: number;         // the specific installment's total
  daysLate: number;
  feeAmount: number;         // amountDue × ratePct / 100
  feeTxId: string;
}

/**
 * Walk every disbursed loan's repayment schedule and surface installments
 * that are past due + grace period and not yet fully paid. Uses the same
 * deterministic-ID guard as contributions to avoid double-charging.
 */
export function findOverdueInstallments(
  group: Group,
  members: Member[],
  loans: Loan[],
  existingWalletTxs: WalletTransaction[],
  asOf: Date = new Date(),
): OverdueInstallment[] {
  const ratePct = group.loanLateFeeRatePct;
  if (!ratePct || ratePct <= 0) return [];
  const graceDays = group.loanLateFeeGraceDays ?? 0;

  const results: OverdueInstallment[] = [];

  for (const loan of loans) {
    if (loan.status !== "disbursed" || !loan.schedule) continue;
    const member = members.find((m) => m.id === loan.memberId);

    loan.schedule.forEach((item, index) => {
      if (item.paid) return;
      const dueDate = new Date(item.dueDate);
      const graceDate = new Date(dueDate);
      graceDate.setDate(graceDate.getDate() + graceDays);
      if (graceDate > asOf) return;

      const feeTxId = `late-fee-loan-${loan.id}-${index}`;
      const alreadyCharged = existingWalletTxs.some((t) => t.id === feeTxId);
      if (alreadyCharged) return;

      const daysLate = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
      results.push({
        loanId: loan.id,
        memberId: loan.memberId,
        memberName: member?.fullName ?? "Unknown",
        installmentIndex: index,
        dueDate: item.dueDate,
        amountDue: item.total,
        daysLate,
        feeAmount: round2(item.total * (ratePct / 100)),
        feeTxId,
      });
    });
  }

  return results;
}
