// utils/accrual.ts
//
// Shared accrual-date resolution and daily-interest math.
//
// Single source of truth for the client side. Must stay in sync with
// lib/firestore/loans.ts's getAccrualStartDate() / splitRepayment() —
// that is the authoritative server-side implementation.
//
// Used by:
//   - app/(tabs)/loans.tsx              (Loan detail modal — live accrued)
//   - app/modals/record-repayment.tsx   (Payment preview + today strip)
//
// Why this exists: a previous version of record-repayment.tsx had a
// JavaScript operator-precedence bug in its anchor fallback chain
// (`??` binds tighter than `?:`), which silently produced an anchor of
// the literal string "null" for loans that had a lastAccrualDate but
// no disbursementDate. Pulling the chain into one place, with explicit
// if/else ordering instead of a long mixed chain, removes that class of
// bug entirely.

import { round2 } from "./theme";

export type RatePeriod = "monthly" | "annual";

// Convert any date-like value to a YYYY-MM-DD string.
//
// Tolerant of the shapes different call sites pass in:
//   • plain YYYY-MM-DD or ISO strings — the common case
//   • JS Date instances — some external callers construct Dates
//   • Firestore Timestamp objects — legacy records or console-edited data
//
// Returns undefined for anything unparseable so resolveAccrualAnchor's
// fallback chain keeps working. Internal — callers outside this module
// should use resolveAccrualAnchor.
function toYmd(value: unknown): string | undefined {
  if (!value) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, 10);
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) {
      return undefined;
    }
    return d.toISOString().slice(0, 10);
  }

  return undefined;
}

// Resolve the date from which interest has been accruing.
//
// Priority (highest first):
//   1. lastAccrualDate  — authoritative. Set to the DISBURSEMENT date
//                          at disburse time, then moved forward to each
//                          payment date by recordRepaymentServer.
//   2. disbursementDate — the day the money actually left the wallet.
//   3. applicationDate  — last-resort fallback for legacy loans that
//                          predate the disbursement flow.
//   4. fallbackYmd      — supplied by the caller (usually "today").
//
// NEVER uses applicationDate before disbursementDate — the whole point
// is that interest starts when the money moved, not when the paperwork
// was filed.
export function resolveAccrualAnchor(
  loan:
    | {
        lastAccrualDate?: unknown;
        disbursementDate?: unknown;
        applicationDate?: unknown;
      }
    | null
    | undefined,
  fallbackYmd: string,
): string {
  if (!loan) return fallbackYmd;

  const lastAccrual = toYmd(loan.lastAccrualDate);
  if (lastAccrual) return lastAccrual;

  const disbursed = toYmd(loan.disbursementDate);
  if (disbursed) return disbursed;

  const applied = toYmd(loan.applicationDate);
  if (applied) return applied;

  return fallbackYmd;
}

// Whole calendar days between two YYYY-MM-DD dates. Never negative.
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd.slice(0, 10)).getTime();
  const b = new Date(toYmd.slice(0, 10)).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Normalize a "per month" rate into an annual rate. Must be applied
// BEFORE dividing by 365 — otherwise a 2%/month rate is silently
// charged as 2%/year (12× undercharge).
export function toAnnualRate(
  ratePercent: number,
  period?: RatePeriod,
): number {
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return period === "monthly" ? rate * 12 : rate;
}

// Today's date as YYYY-MM-DD (local time — never UTC).
export function ymdToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TodayAccrued {
  days: number; // whole days from the resolved anchor to asOfYmd
  accrued: number; // today's newly-accrued slice
  total: number; // stored prior accruedInterest + today's slice
  dailyRatePct: number; // fraction of 1%, e.g. 0.0658 for 24%/yr
  annualRatePct: number; // e.g. 24 for 2%/mo
  anchor: string; // the resolved YYYY-MM-DD anchor
}

// Compute the live accrued-interest number for a reducing-balance loan
// as of `asOfYmd` (defaults to today). Returns null for flat-rate loans
// — they don't accrue daily; their interest is schedule-derived and
// computed elsewhere.
//
// Math MUST match lib/firestore/loans.ts's splitRepayment:
//   balance × (annualRate / 100 / 365) × days
// where days is from the resolved anchor to asOfYmd.
export function computeTodayAccrued(
  loan:
    | {
        balance?: number;
        interestRate?: number;
        interestMethod?: string;
        interestRatePeriod?: RatePeriod;
        accruedInterest?: number;
        lastAccrualDate?: string;
        disbursementDate?: string;
        applicationDate?: string;
      }
    | null
    | undefined,
  asOfYmd: string = ymdToday(),
): TodayAccrued | null {
  if (!loan) return null;
  if (loan.interestMethod !== "reducing_balance") return null;

  const anchor = resolveAccrualAnchor(loan, asOfYmd);
  const days = daysBetween(anchor, asOfYmd);

  const annualRatePct = toAnnualRate(
    Number(loan.interestRate) || 0,
    loan.interestRatePeriod ?? "monthly",
  );
  const dailyRate = annualRatePct / 100 / 365;

  const balance = Math.max(0, Number(loan.balance) || 0);
  const accrued = round2(balance * dailyRate * days);

  const prior = round2(Number(loan.accruedInterest) || 0);
  const total = round2(prior + accrued);

  return {
    days,
    accrued,
    total,
    dailyRatePct: round2(dailyRate * 100),
    annualRatePct,
    anchor,
  };
}


// Project accrued interest as of a given moment, for a reducing-balance
// loan. Reads the stored `accruedInterest` (already capitalized from
// previous repayments) and adds whatever has accrued since the anchor.
//
// Returns zeros (not null) for flat-rate loans — flat interest is
// schedule-derived, not daily-accrued, so there's nothing to project.
//
// Moved here from lib/firestore/loans.ts so the same projection can be
// used from screens, store slices, and the linked-wallet sync helpers
// without pulling in the Firestore module.
export function projectAccruedInterest(
  loan: {
    balance: number;
    interestRate: number;
    interestMethod?: string;
    interestRatePeriod?: RatePeriod;
    accruedInterest?: number;
    lastAccrualDate?: unknown;
    applicationDate?: unknown;
    disbursementDate?: unknown;
  },
  asOfDate: string = new Date().toISOString(),
): { days: number; accrued: number; total: number } {
  const existingAccrued = round2(
    Math.max(0, Number(loan.accruedInterest) || 0),
  );

  if (loan.interestMethod !== "reducing_balance") {
    return { days: 0, accrued: 0, total: existingAccrued };
  }

  const asOf = toYmd(asOfDate);
  if (!asOf) return { days: 0, accrued: 0, total: existingAccrued };

  const fromDate = resolveAccrualAnchor(loan, asOf);
  const days = daysBetween(fromDate, asOf);

  const annualRate = toAnnualRate(
    Number(loan.interestRate) || 0,
    loan.interestRatePeriod,
  );
  if (annualRate <= 0 || days <= 0) {
    return { days, accrued: 0, total: existingAccrued };
  }

  const dailyRate = annualRate / 100 / 365;
  const balance = round2(Math.max(0, Number(loan.balance) || 0));
  const projectedInterest = round2(balance * dailyRate * days);
  const total = round2(existingAccrued + projectedInterest);

  return { days, accrued: projectedInterest, total };
}


// ─── Flat-loan accrual ──────────────────────────────────────────────
//
// Flat loans don't accrue daily on the outstanding balance. Their
// interest is scheduled upfront: totalInterest = principal × rate ×
// months, split evenly across the term. "Accrued" for a flat loan just
// means "interest from installments whose due date has passed."
//
// Used by:
//   • record-repayment.tsx    — info line for flat loans
//   • edit-transaction.tsx    — accrued panel for flat disbursements
//
// Returns null for reducing-balance loans (they use
// computeTodayAccrued) and for loans with no schedule.

export interface FlatAccrued {
  /** Sum of interest on installments whose dueDate <= asOfYmd. */
  scheduled: number;
  /** totalInterestPaid from the loan record. */
  paid: number;
  /** scheduled - paid, floored at 0. */
  outstanding: number;
  /** Number of installments with dueDate <= asOfYmd. */
  installmentCount: number;
  /** The as-of date the calculation was made for. */
  asOf: string;
}

export function computeFlatAccrued(
  loan:
    | {
        interestMethod?: string;
        schedule?: Array<{ dueDate?: unknown; interest?: number }>;
        totalInterestPaid?: number;
      }
    | null
    | undefined,
  asOfYmd: string = ymdToday(),
): FlatAccrued | null {
  if (!loan) return null;
  if (loan.interestMethod === "reducing_balance") return null;
  if (!Array.isArray(loan.schedule) || loan.schedule.length === 0) {
    return null;
  }

  const asOf = toYmd(asOfYmd);
  if (!asOf) return null;

  let scheduled = 0;
  let installmentCount = 0;

  for (const inst of loan.schedule) {
    const due = toYmd(inst.dueDate);
    if (!due) continue;
    if (due <= asOf) {
      scheduled += Number(inst.interest) || 0;
      installmentCount++;
    }
  }

  const paid = Math.max(0, Number(loan.totalInterestPaid) || 0);
  const outstanding = Math.max(0, scheduled - paid);

  return {
    scheduled: round2(scheduled),
    paid: round2(paid),
    outstanding: round2(outstanding),
    installmentCount,
    asOf,
  };
}
