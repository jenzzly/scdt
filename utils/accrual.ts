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
        lastAccrualDate?: string;
        disbursementDate?: string;
        applicationDate?: string;
      }
    | null
    | undefined,
  fallbackYmd: string,
): string {
  if (!loan) return fallbackYmd;

  const lastAccrual = loan.lastAccrualDate
    ? String(loan.lastAccrualDate).slice(0, 10)
    : undefined;
  if (lastAccrual) return lastAccrual;

  const disbursed = loan.disbursementDate
    ? String(loan.disbursementDate).slice(0, 10)
    : undefined;
  if (disbursed) return disbursed;

  const applied = loan.applicationDate
    ? String(loan.applicationDate).slice(0, 10)
    : undefined;
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