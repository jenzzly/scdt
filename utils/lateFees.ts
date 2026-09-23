// utils/lateFees.ts
//
// Late-fee detection and calculation.
//
// Contribution late fee:
//   missedContributionAmount × (ratePct / 100) × newlyOwedDays
//
// Loan late fee:
//   monthlyInterestBase  = loan.amount × (loan.interestRate / 100)
//   dailyLateFee         = monthlyInterestBase × (lateFeeRatePct / 100)
//   totalFee             = dailyLateFee × daysLate
//   feeAmount (to apply) = dailyLateFee × daysNewlyOwed
//
//   Once the grace period has elapsed, daysLate is counted from the
//   installment due date through today (or the installment payment date).
//   The global activation date only turns the policy on; it does not
//   drop days that were already late.
//
//   Example: 8 000 000 loan @ 1.5% monthly, 2% lateFeeRatePct, 78 days late
//     monthlyInterestBase = 8 000 000 × 1.5% = 120 000
//     dailyLateFee        = 120 000 × 2%     = 2 400 / day
//     totalFee            = 2 400 × 78       = 187 200
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
//
// ─────────────────────────────────────────────────────────────────────────────
// LATE-FEE EXEMPTIONS
//
// A member may have a `lateFeeExemptions` array (see LateFeeExemption in
// types/index.ts). Each entry covers a scope (`contribution`, `loan`, or
// `both`) and an inclusive [periodStart, periodEnd] window. Both detection
// functions below skip any period or installment whose date falls inside
// an applicable exemption — so recording an exemption is all that's
// required to stop new fees from accruing for that member and period,
// without touching the ledger.
//
// Exemptions do NOT retroactively delete fees that were already applied
// to the ledger. Clearing those is a separate operation; the UI's
// "Waive Period" flow combines both (records the exemption and marks the
// specific fee tx paid), but the exemption on its own is purely about
// future accrual.
// ─────────────────────────────────────────────────────────────────────────────

import { round2 } from "./theme";

import type {
  Group,
  Member,
  Contribution,
  Loan,
  WalletTransaction,
} from "../types";

import type { LateFeeExemption } from "../types";

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

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Deliberately NOT `toISOString().slice(0, 10)` — that returns the UTC
 * date, so a period evaluated at 11pm on September 30 in a UTC+2
 * timezone would produce "2026-10-01" and slip past a September
 * exemption by one day. Everything in this module is local-time, so
 * the exemption comparison has to be too.
 */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * True when the given member has a late-fee exemption that covers the
 * given scope AND the given calendar day.
 *
 * Scope matching: "both" matches any request, otherwise the exemption's
 * scope must equal the requested one. The [periodStart, periodEnd]
 * window is inclusive on both ends.
 */
function isLateFeeExempt(
  member: Member | null | undefined,
  scope: "contribution" | "loan",
  date: Date,
): boolean {
  if (!member) return false;

  const exemptions = (member.lateFeeExemptions ??
    []) as LateFeeExemption[];
  if (exemptions.length === 0) return false;

  const day = localIso(date);

  return exemptions.some((ex) => {
    if (ex.scope !== "both" && ex.scope !== scope) {
      return false;
    }
    return day >= ex.periodStart && day <= ex.periodEnd;
  });
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
       * Skip periods covered by a member late-fee exemption.
       *
       * The exemption's [periodStart, periodEnd] window is compared
       * against the contribution period's START date — a September
       * exemption covers the September period (periodStart = Sept 1),
       * which is exactly the granularity an admin thinks in when they
       * say "waive September for this member".
       *
       * Placed BEFORE the periodEnd-vs-startDate check so a waiver
       * can silence a period that would otherwise be skipped anyway,
       * and BEFORE the grace-period check so no work is done for
       * periods we're not going to charge.
       */
      if (
        isLateFeeExempt(
          member,
          "contribution",
          periodStart,
        )
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

  /** Late fee rate used in the daily formula (percent) */
  ratePct: number;

  daysLate: number;
  daysPastGrace: number;
  daysNewlyOwed: number;
  /** Unapplied slice: dailyLateFee × daysNewlyOwed */
  feeAmount: number;
  /** Full outstanding fee for this installment: dailyLateFee × daysLate */
  totalFeeAmount: number;
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
    // Keep showing unpaid late fees after the loan is repaid until the
    // person actually pays the fee (feePaid on the wallet tx).
    if ((loan as any).lateFeesDisabled === true) {
      continue;
    }

    if (
      loan.status !== "disbursed" &&
      loan.status !== "repaid"
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

    // Late-fee accrual is paused for non-active members.
    //
    // Deactivating a member is a deliberate admin decision to freeze
    // their participation. Letting their loan late fees keep growing
    // day by day while they're deactivated would accumulate a debt
    // they have no way to act on, and would penalise them for the
    // deactivated period if they were later reactivated.
    //
    // Existing unpaid fees already on the ledger stay visible — they
    // were applied while the member was active. Only NEW days stop
    // accruing. findOverdueContributions already has this same guard.
    if (!member || member.status !== "active") {
      continue;
    }

    let loanClosedAt: Date | null = null;
    if (typeof (loan as any).completionDate === "string") {
      const closed = new Date((loan as any).completionDate);
      if (!Number.isNaN(closed.getTime())) {
        loanClosedAt = closed;
      }
    }

    loan.schedule.forEach(
      (item, index) => {
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
         * Skip installments covered by a member late-fee exemption.
         *
         * For loans, the exemption window is compared against the
         * installment's DUE DATE — an October exemption waives fees
         * on installments due in October, not fees applied in
         * October. That's the phrasing an admin uses ("waive October
         * for this member") and it's stable even when the fee is
         * applied weeks later.
         *
         * Placed BEFORE the grace-period check so an exempted
         * installment skips all downstream work.
         */
        if (
          isLateFeeExempt(
            member,
            "loan",
            dueDate,
          )
        ) {
          return;
        }

        const graceDate =
          new Date(dueDate);

        graceDate.setDate(
          graceDate.getDate() +
            graceDays,
        );

        /**
         * No fee until the grace period has elapsed. After that, days
         * are counted from the due date (not from grace-end or the
         * global activation date).
         */
        if (
          graceDate > asOf
        ) {
          return;
        }

        /**
         * Stop accruing new days once the installment (or the whole
         * loan) is actually paid. Unpaid fees for those days still
         * surface via applied wallet txs + any unapplied remainder.
         */
        let accrualAsOf = asOf;

        if (
          loanClosedAt &&
          loanClosedAt < accrualAsOf
        ) {
          accrualAsOf = loanClosedAt;
        }

        const paidDateRaw =
          typeof (item as any).paidDate === "string"
            ? (item as any).paidDate
            : typeof (item as any).paymentDate === "string"
              ? (item as any).paymentDate
              : null;

        if (paidDateRaw) {
          const paymentDate = new Date(paidDateRaw);

          if (
            !Number.isNaN(paymentDate.getTime()) &&
            paymentDate < accrualAsOf
          ) {
            accrualAsOf = paymentDate;
          }
        }

        const daysLate =
          Math.max(
            0,
            wholeDaysBetween(
              dueDate,
              accrualAsOf,
            ),
          );

        const daysPastGrace =
          Math.max(
            0,
            wholeDaysBetween(
              graceDate,
              accrualAsOf,
            ),
          );

        if (daysLate <= 0) {
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
          daysLate <=
          chargedSoFar
        ) {
          return;
        }

        const daysNewlyOwed =
          daysLate -
          chargedSoFar;

        /**
         * Late-fee formula:
         *   monthlyInterestBase = loan.amount × (interestRate / 100)
         *   dailyLateFee        = monthlyInterestBase × (lateFeeRatePct / 100)
         *   totalFee            = dailyLateFee × daysLate
         *   feeAmount           = dailyLateFee × daysNewlyOwed
         */
        const monthlyInterestBase =
          round2(
            loan.amount *
              (loan.interestRate / 100),
          );

        const dailyLateFee =
          monthlyInterestBase *
          (ratePct / 100);

        const feeAmount =
          round2(
            dailyLateFee *
              daysNewlyOwed,
          );

        const totalFeeAmount =
          round2(
            dailyLateFee *
              daysLate,
          );

        const feeTxId =
          `${prefix}-d${daysLate}`;

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

          ratePct,

          daysLate,

          daysPastGrace,

          daysNewlyOwed,

          feeAmount,

          totalFeeAmount,

          feeTxId,
        });

      },
    );
  }

  return results;
}

/**
 * Unpaid loan late fees: unapplied accrued amounts plus recorded
 * `late_fee` wallet txs that have not been marked feePaid.
 */
export function outstandingLoanLateFeeTotal(
  group: Group,
  members: Member[],
  loans: Loan[],
  wallet: WalletTransaction[],
  asOf: Date = new Date(),
): number {
  const overdue =
    findOverdueInstallments(
      group,
      members,
      loans,
      wallet,
      asOf,
    ) || [];

  const accrued = overdue.reduce(
    (sum, item) => sum + (item.feeAmount || 0),
    0,
  );

  const loanIds = new Set(loans.map((loan) => loan.id));

  const appliedUnpaid = wallet.reduce((sum, tx) => {
    if (tx.type !== "late_fee") return sum;
    if (!tx.loanId || !loanIds.has(tx.loanId)) return sum;
    if ((tx as any).feePaid || (tx as any).deletedAt) return sum;
    return sum + Math.abs(tx.amount || 0);
  }, 0);

  return round2(accrued + appliedUnpaid);
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