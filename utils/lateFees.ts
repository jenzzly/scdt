// utils/lateFees.ts
//
// Late-fee detection and calculation.
//
// Contribution late fee:
//   missedContributionAmount × (ratePct / 100) × newlyOwedDays
//
// Loan late fee (corrected formula):
//   monthlyInterestBase  = loan.amount × (loan.interestRate / 100)
//   dailyLateFee         = monthlyInterestBase × (lateFeeRatePct / 100)
//   feeAmount            = dailyLateFee × daysNewlyOwed
//
//   Example: 8 000 000 loan @ 1.5% monthly, 10% lateFeeRatePct, 78 days late
//     monthlyInterestBase = 8 000 000 × 1.5% = 120 000
//     dailyLateFee        = 120 000 × 10%    = 12 000 / day
//     feeAmount           = 12 000 × 78      = 936 000
//
//   NOTE: interestRatePeriod is intentionally ignored — the base is always
//   loan.amount × interestRate% without any period conversion.
//
// IMPORTANT:
//   `lateFeeStartDate` is a GLOBAL activation date.
//
//   No late fee is charged for any overdue period whose
//   late-fee accrual ended before the global activation date.
//
//   If an overdue period crosses the activation date,
//   only fee-days on or after the activation date are counted.
//
// Nothing is automatically charged in the background.
// Overdue amounts are calculated on demand. An officer/admin explicitly
// applies each newly accrued chunk.
//
// A regular contribution that is approved after its due date still produces
// a late fee. The late-fee accrual stops on the actual contributionDate.
//
// Clearing a late-fee transaction does NOT reset the overdue period.
// Only the actual regular contribution payment stops contribution late-fee
// accrual for that period.

import { round2 } from "./theme";

import type {
  Group,
  Member,
  Contribution,
  Loan,
  WalletTransaction,
} from "../types";

const MS_PER_DAY = 86_400_000;

// -----------------------------------------------------------------------------
// Period helpers
// -----------------------------------------------------------------------------

function nextPeriod(
  periodStart: Date,
  frequency?: Group["contributionFrequency"],
): Date {
  const next = new Date(periodStart);

  const frequencyValue = String(
    frequency ?? "monthly",
  ).toLowerCase();

  switch (frequencyValue) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;

    case "weekly":
      next.setDate(next.getDate() + 7);
      break;

    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;

    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;

    case "yearly":
    case "annual":
      next.setFullYear(next.getFullYear() + 1);
      break;

    default:
      next.setMonth(next.getMonth() + 1);
      break;
  }

  return next;
}

function periodLabel(
  periodStart: Date,
  frequency?: Group["contributionFrequency"],
): string {
  const frequencyValue = String(
    frequency ?? "monthly",
  ).toLowerCase();

  switch (frequencyValue) {
    case "daily":
      return periodStart.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    case "weekly":
      return `Week of ${periodStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`;

    case "quarterly":
      return `Q${
        Math.floor(periodStart.getMonth() / 3) + 1
      } ${periodStart.getFullYear()}`;

    case "yearly":
    case "annual":
      return `${periodStart.getFullYear()}`;

    case "monthly":
    default:
      return periodStart.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
  }
}

// -----------------------------------------------------------------------------
// Date helpers
// -----------------------------------------------------------------------------

function wholeDaysBetween(
  from: Date,
  to: Date,
): number {
  return Math.floor(
    (to.getTime() - from.getTime()) /
      MS_PER_DAY,
  );
}

/**
 * Returns the later of two dates.
 *
 * This is used to enforce the global late-fee activation date.
 */
function maxDate(
  first: Date,
  second: Date,
): Date {
  return first > second
    ? new Date(first)
    : new Date(second);
}

// -----------------------------------------------------------------------------
// Existing late-fee accrual
// -----------------------------------------------------------------------------

function daysAlreadyCharged(
  prefix: string,
  existingWalletTxs: WalletTransaction[],
): number {
  let max = 0;

  for (const tx of existingWalletTxs) {
    if (tx.type !== "late_fee") {
      continue;
    }

    if (
      !tx.id.startsWith(
        prefix + "-d",
      )
    ) {
      continue;
    }

    const match =
      tx.id.match(/-d(\d+)$/);

    if (!match) {
      continue;
    }

    const day =
      Number.parseInt(
        match[1],
        10,
      );

    if (Number.isFinite(day)) {
      max = Math.max(
        max,
        day,
      );
    }
  }

  return max;
}

// -----------------------------------------------------------------------------
// Contribution late fees
// -----------------------------------------------------------------------------

export interface OverdueContribution {
  memberId: string;
  memberName: string;

  periodLabel: string;
  periodStart: string;
  dueDate: string;

  amountDue: number;

  daysLate: number;
  daysPastGrace: number;
  daysNewlyOwed: number;
  feeAmount: number;
  feeTxId: string;
}

function contributionFeeIdPrefix(
  memberId: string,
  periodStart: Date,
): string {
  return `late-fee-contrib-${memberId}-${periodStart
    .toISOString()
    .slice(0, 10)}`;
}

export function findOverdueContributions(
  group: Group,
  members: Member[],
  contributions: Contribution[],
  existingWalletTxs: WalletTransaction[],
  asOf: Date = new Date(),
): OverdueContribution[] {
  const ratePct =
    group.contributionLateFeeRatePct;

  if (!ratePct || ratePct <= 0) {
    return [];
  }

  const graceDays =
    Math.max(
      0,
      group.contributionLateFeeGraceDays ??
        0,
    );

  const amountDue =
    group.contributionAmount ?? 0;

  if (amountDue <= 0) {
    return [];
  }

  // ---------------------------------------------------------------------------
  // GLOBAL ACTIVATION DATE
  //
  // Late fees must not apply to periods that were already overdue before
  // this date.
  // ---------------------------------------------------------------------------

  const startDateRaw =
    group.contributionLateFeeStartDate;

  if (!startDateRaw) {
    return [];
  }

  const startDate =
    new Date(startDateRaw);

  if (
    Number.isNaN(
      startDate.getTime(),
    )
  ) {
    return [];
  }

  // If the entire calculation is happening before the policy starts,
  // there can be no late fee.
  if (asOf < startDate) {
    return [];
  }

  const results: OverdueContribution[] =
    [];

  for (const member of members) {
    if (member.status !== "active") {
      continue;
    }

    if (!member.dateJoined) {
      continue;
    }

    const memberJoined =
      new Date(
        member.dateJoined,
      );

    if (
      Number.isNaN(
        memberJoined.getTime(),
      )
    ) {
      continue;
    }

    /**
     * Only approved regular contributions can stop
     * contribution late-fee accrual.
     *
     * An approved contribution does NOT automatically
     * mean there is no late fee.
     *
     * If contributionDate is after the due/grace date,
     * the member was late and the fee is calculated
     * through that contributionDate.
     */
    const approvedByMember =
      contributions.filter(
        (c) =>
          c.memberId === member.id &&
          c.status === "approved" &&
          c.contributionType === "regular",
      );

    /**
     * IMPORTANT:
     *
     * The cursor represents NATURAL CONTRIBUTION PERIODS.
     *
     * The global start date must NOT become the period start.
     *
     * For example:
     *
     *   Start calculating from: September 10
     *   Monthly contribution: September
     *
     * The September contribution period still starts on
     * September 1.
     */
    let cursor =
      memberJoined > startDate
        ? new Date(memberJoined)
        : new Date(startDate);

    const frequencyValue =
      String(
        group.contributionFrequency ??
          "monthly",
      ).toLowerCase();

    if (
      frequencyValue === "monthly"
    ) {
      cursor.setDate(1);
      cursor.setHours(
        0,
        0,
        0,
        0,
      );
    }

    let guard = 0;

    while (guard < 500) {
      guard++;

      const periodStart =
        new Date(cursor);

      const periodEnd =
        nextPeriod(
          periodStart,
          group.contributionFrequency,
        );

      /**
       * Do not process a contribution period that ended
       * completely before the global activation date.
       *
       * Example:
       *
       * Start date: September 1
       * August period: August 1 - September 1
       *
       * That period is excluded.
       */
      if (
        periodEnd <= startDate
      ) {
        const next =
          periodEnd;

        if (
          next.getTime() <=
          periodStart.getTime()
        ) {
          break;
        }

        cursor = next;
        continue;
      }

      const dueDate =
        new Date(periodStart);

      if (
        frequencyValue === "monthly"
      ) {
        const configuredDay =
          Math.max(
            1,
            Math.min(
              group.contributionDay ??
                1,
              31,
            ),
          );

        dueDate.setDate(1);

        const lastDayOfMonth =
          new Date(
            dueDate.getFullYear(),
            dueDate.getMonth() + 1,
            0,
          ).getDate();

        dueDate.setDate(
          Math.min(
            configuredDay,
            lastDayOfMonth,
          ),
        );
      } else {
        dueDate.setDate(
          group.contributionDay ||
            dueDate.getDate(),
        );
      }

      const graceDate =
        new Date(dueDate);

      graceDate.setDate(
        graceDate.getDate() +
          graceDays,
      );

      if (graceDate > asOf) {
        break;
      }

      /**
       * Find the actual approved contribution date
       * for this contribution period.
       */
      const paymentDate =
        approvedByMember.reduce<Date | null>(
          (latest, c) => {
            const contributionDateRaw =
              (
                c as Contribution & {
                  contributionDate?: string;
                }
              ).contributionDate ??
              (
                c as Contribution & {
                  date?: string;
                }
              ).date;

            if (!contributionDateRaw) {
              return latest;
            }

            const contributionDate =
              new Date(
                contributionDateRaw,
              );

            if (
              Number.isNaN(
                contributionDate.getTime(),
              )
            ) {
              return latest;
            }

            if (
              contributionDate <
                periodStart ||
              contributionDate >=
                periodEnd
            ) {
              return latest;
            }

            if (
              !latest ||
              contributionDate >
                latest
            ) {
              return contributionDate;
            }

            return latest;
          },
          null,
        );

      /**
       * If the member paid during this period,
       * stop late-fee accrual on the actual payment date.
       *
       * If there is no contribution, continue
       * accruing through `asOf`.
       */
      const accrualAsOf =
        paymentDate &&
        paymentDate < asOf
          ? paymentDate
          : asOf;

      /**
       * The first fee day is the day AFTER the grace date.
       *
       * Example:
       *
       * Due:        September 1
       * Grace:      5 days
       * Grace ends: September 5
       *
       * First fee day: September 6
       *
       * If the global activation date is September 8,
       * the first fee day becomes September 8.
       *
       * Therefore:
       *
       *   feeStartBoundary = max(
       *     graceDate,
       *     activationDate - 1 day
       *   )
       *
       * This preserves the existing inclusive behavior.
       */
      const activationBoundary =
        new Date(startDate);

      activationBoundary.setDate(
        activationBoundary.getDate() - 1,
      );

      const feeStartBoundary =
        maxDate(
          graceDate,
          activationBoundary,
        );

      /**
       * If the actual payment happened before the
       * global activation date, there is no fee to charge.
       */
      if (
        paymentDate &&
        paymentDate < startDate
      ) {
        const next =
          periodEnd;

        if (
          next.getTime() <=
          periodStart.getTime()
        ) {
          break;
        }

        cursor = next;
        continue;
      }

      /**
       * Calculate complete fee-days after BOTH:
       *
       * 1. the grace period
       * 2. the global late-fee activation date
       *
       * The end date is inclusive.
       */
      const daysPastGrace =
        Math.max(
          0,
          wholeDaysBetween(
            feeStartBoundary,
            accrualAsOf,
          ),
        );

      if (
        daysPastGrace <= 0
      ) {
        const next =
          periodEnd;

        if (
          next.getTime() <=
          periodStart.getTime()
        ) {
          break;
        }

        cursor = next;
        continue;
      }

      const prefix =
        contributionFeeIdPrefix(
          member.id,
          periodStart,
        );

      const chargedSoFar =
        daysAlreadyCharged(
          prefix,
          existingWalletTxs,
        );

      if (
        daysPastGrace >
        chargedSoFar
      ) {
        const daysNewlyOwed =
          daysPastGrace -
          chargedSoFar;

        const daysLate =
          Math.max(
            0,
            wholeDaysBetween(
              dueDate,
              accrualAsOf,
            ),
          );

        const feeAmount =
          round2(
            amountDue *
              (ratePct / 100) *
              daysNewlyOwed,
          );

        const feeTxId =
          `${prefix}-d${daysPastGrace}`;

        results.push({
          memberId:
            member.id,

          memberName:
            member.fullName,

          periodLabel:
            periodLabel(
              periodStart,
              group.contributionFrequency,
            ),

          periodStart:
            periodStart.toISOString(),

          dueDate:
            dueDate.toISOString(),

          amountDue,

          daysLate,

          daysPastGrace,

          daysNewlyOwed,

          feeAmount,

          feeTxId,
        });
      }

      const next =
        periodEnd;

      if (
        next.getTime() <=
        periodStart.getTime()
      ) {
        break;
      }

      cursor = next;
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// Loan repayment late fees
// -----------------------------------------------------------------------------

export interface OverdueInstallment {
  loanId: string;
  memberId: string;
  memberName: string;

  installmentIndex: number;

  dueDate: string;
  amountDue: number;

  /** loan.amount × (interestRate / 100) — the monthly interest used as the fee base */
  monthlyInterestBase: number;

  daysLate: number;
  daysPastGrace: number;
  daysNewlyOwed: number;
  feeAmount: number;
  feeTxId: string;
}


function loanFeeIdPrefix(
  loanId: string,
  index: number,
): string {
  return `late-fee-loan-${loanId}-${index}`;
}

export function findOverdueInstallments(
  group: Group,
  members: Member[],
  loans: Loan[],
  existingWalletTxs: WalletTransaction[],
  asOf: Date = new Date(),
): OverdueInstallment[] {
  const results: OverdueInstallment[] =
    [];

  /**
   * ---------------------------------------------------------------------------
   * GLOBAL LOAN LATE-FEE ACTIVATION DATE
   * ---------------------------------------------------------------------------
   *
   * This uses the loan late-fee start date.
   *
   * If your Group type uses the same global field for both
   * contribution and loan late fees, this falls back to
   * contributionLateFeeStartDate.
   */
  const loanStartDateRaw =
    (
      group as Group & {
        loanLateFeeStartDate?: string;
      }
    ).loanLateFeeStartDate ??
    group.contributionLateFeeStartDate;

  if (!loanStartDateRaw) {
    return [];
  }

  const loanStartDate =
    new Date(loanStartDateRaw);

  if (
    Number.isNaN(
      loanStartDate.getTime(),
    )
  ) {
    return [];
  }

  // Nothing can accrue before the global activation date.
  if (asOf < loanStartDate) {
    return [];
  }

  for (const loan of loans) {
    if (
      loan.status !== "disbursed"
    ) {
      continue;
    }

    if (!loan.schedule) {
      continue;
    }

    const ratePct =
      loan.lateFeeRatePct ??
      group.loanLateFeeRatePct;

    if (
      !ratePct ||
      ratePct <= 0
    ) {
      continue;
    }

    const graceDays =
      Math.max(
        0,
        loan.lateFeeGraceDays ??
          group.loanLateFeeGraceDays ??
          0,
      );

    const member =
      members.find(
        (m) =>
          m.id === loan.memberId,
      );

    loan.schedule.forEach(
      (item, index) => {
        if (item.paid) {
          return;
        }

        const dueDate =
          new Date(
            item.dueDate,
          );

        if (
          Number.isNaN(
            dueDate.getTime(),
          )
        ) {
          return;
        }

        /**
         * If the installment's grace period ended
         * before the global activation date, we do not
         * charge anything for the pre-activation days.
         *
         * If the installment remains overdue when the
         * policy activates, calculation begins from
         * the activation date.
         */
        const graceDate =
          new Date(dueDate);

        graceDate.setDate(
          graceDate.getDate() +
            graceDays,
        );

        /**
         * First fee day is the day after the grace date.
         *
         * Example:
         *
         * Due: September 5
         * Grace: 0
         *
         * September 5 => 0 fee-days
         * September 6 => 1 fee-day
         * September 7 => 2 fee-days
         *
         * If the global activation date is September 10,
         * fee calculation starts on September 10 instead.
         */
        const activationBoundary =
          new Date(loanStartDate);

        activationBoundary.setDate(
          activationBoundary.getDate() - 1,
        );

        const feeStartBoundary =
          maxDate(
            graceDate,
            activationBoundary,
          );

        /**
         * If the installment's grace period has not
         * ended by the activation date, it still needs
         * to wait for the grace period.
         *
         * If the installment itself is entirely before
         * the activation date, there is no fee.
         *
         * For example:
         *
         * Due: August 5
         * Grace: 5
         * Start: September 1
         *
         * Grace ends: August 10
         * The installment is already overdue when the
         * policy activates, so calculation begins
         * September 1.
         */
        if (
          graceDate > asOf
        ) {
          return;
        }

        /**
         * If the schedule item has a payment date,
         * use it as the accrual endpoint.
         *
         * Otherwise, accrue through asOf.
         *
         * We support paidDate and paymentDate here
         * without changing the existing Loan type.
         */
        let accrualAsOf = asOf;

        if (
          typeof (item as any).paidDate ===
          "string"
        ) {
          const paymentDate =
            new Date(
              (item as any).paidDate,
            );

          if (
            !Number.isNaN(
              paymentDate.getTime(),
            ) &&
            paymentDate < asOf
          ) {
            accrualAsOf =
              paymentDate;
          }
        } else if (
          typeof (item as any).paymentDate ===
          "string"
        ) {
          const paymentDate =
            new Date(
              (item as any).paymentDate,
            );

          if (
            !Number.isNaN(
              paymentDate.getTime(),
            ) &&
            paymentDate < asOf
          ) {
            accrualAsOf =
              paymentDate;
          }
        }

        /**
         * Calculate complete fee-days after both:
         *
         * 1. grace period
         * 2. global activation date
         *
         * The activation date is inclusive.
         */
        const daysPastGrace =
          Math.max(
            0,
            wholeDaysBetween(
              feeStartBoundary,
              accrualAsOf,
            ),
          );

        if (
          daysPastGrace <= 0
        ) {
          return;
        }

        const prefix =
          loanFeeIdPrefix(
            loan.id,
            index,
          );

        const chargedSoFar =
          daysAlreadyCharged(
            prefix,
            existingWalletTxs,
          );

        if (
          daysPastGrace <=
          chargedSoFar
        ) {
          return;
        }

        const daysNewlyOwed =
          daysPastGrace -
          chargedSoFar;

        const daysLate =
          Math.max(
            0,
            wholeDaysBetween(
              dueDate,
              accrualAsOf,
            ),
          );

        /**
         * Late-fee formula:
         *   monthlyInterestBase = loan.amount × (interestRate / 100)
         *   dailyLateFee        = monthlyInterestBase × (lateFeeRatePct / 100)
         *   feeAmount           = dailyLateFee × daysNewlyOwed
         *
         * interestRatePeriod is intentionally not used — the base is always
         * loan.amount × interestRate% with no period conversion.
         */
        const monthlyInterestBase =
          round2(
            loan.amount *
              (loan.interestRate / 100),
          );

        const feeAmount =
          round2(
            monthlyInterestBase *
              (ratePct / 100) *
              daysNewlyOwed,
          );

        const feeTxId =
          `${prefix}-d${daysPastGrace}`;

        results.push({
          loanId:
            loan.id,

          memberId:
            loan.memberId,

          memberName:
            member?.fullName ??
            "Unknown",

          installmentIndex:
            index,

          dueDate:
            item.dueDate,

          amountDue:
            item.total,

          monthlyInterestBase,

          daysLate,

          daysPastGrace,

          daysNewlyOwed,

          feeAmount,

          feeTxId,
        });

      },
    );
  }

  return results;
}

// -----------------------------------------------------------------------------
// Late-fee transaction ID helpers
// -----------------------------------------------------------------------------

export function getLateFeeTransactionPrefix(
  type: "contribution" | "loan",
  sourceId: string,
  periodOrIndex: string | number,
): string {
  if (type === "contribution") {
    return `late-fee-contrib-${sourceId}-${String(
      periodOrIndex,
    )}`;
  }

  return `late-fee-loan-${sourceId}-${String(
    periodOrIndex,
  )}`;
}