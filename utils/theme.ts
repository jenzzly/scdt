
import { Platform, StyleSheet } from "react-native";
import { BRAND } from "../lib/brand";
import type { LoanInterestMethod } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Brand-driven design tokens.
//
// This file used to have two independent, hardcoded color systems (`Colors`
// and `C`) with different hex values for what was conceptually the same
// "brand navy" / "brand accent" — meaning a client wanting a different
// palette had to hunt through two separate token objects, and the two
// systems could visually drift from each other over time.
//
// Now there is ONE source of brand identity — `BRAND.colors` (loaded per
// client from clients/<id>/brand.json, see lib/brand.ts) — and both token
// objects below derive from it. `C` is the current design system (clean
// banking aesthetic: navy card, green primary, flat surfaces) and is what
// new screens should use. `Colors` is kept only for screens not yet
// migrated to `C`; it now points at the same brand values instead of its
// own frozen hex codes, so legacy screens stay visually in sync with
// whatever a client sets in brand.json instead of needing a separate edit.
// ─────────────────────────────────────────────────────────────────────────


export const Fonts = {
  regular: Platform.select({ ios: "PlusJakartaSans_400Regular", android: "PlusJakartaSans_400Regular", default: "System" }),
  medium: Platform.select({ ios: "PlusJakartaSans_500Medium", android: "PlusJakartaSans_500Medium", default: "System" }),
  semibold: Platform.select({ ios: "PlusJakartaSans_600SemiBold", android: "PlusJakartaSans_600SemiBold", default: "System" }),
  bold: Platform.select({ ios: "PlusJakartaSans_700Bold", android: "PlusJakartaSans_700Bold", default: "System" }),
  extrabold: Platform.select({ ios: "PlusJakartaSans_800ExtraBold", android: "PlusJakartaSans_800ExtraBold", default: "System" }),
};

export const R = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 };
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// ─── Design tokens (current system) ──────────────────────────────────
export const C = {
  bg:          "#F0F3F8",
  surface:     "#FFFFFF",
  card:        "#09491e",     // dark navy account card
  cardText:    "#FFFFFF",
  primary:     BRAND.colors.secondary || "#0F766E", // SCDT Brand deep teal
  accent:      BRAND.colors.primary || "#10B981",   // Emerald green
  brandBlue:   BRAND.colors.accent || "#3B82F6",    // Logo blue
  brandAmber:  BRAND.colors.highlight || "#EAB308", // Logo amber
  debit:       "#EF4444",
  text:        "#0F172A",
  text2:       "#475569",
  text3:       "#94A3B8",
  border:      "#E2E8F0",
  pill:        "#EFF6FF",
  pillText:    BRAND.colors.secondary || "#0F766E",
  goldBg:      "#FFFBEB",
  goldText:    "#B45309",
  greenBg:     "#ECFDF5",
  greenText:   "#065F46",
  redBg:       "#FEF2F2",
  redText:     "#991B1B",
  info:        "#1D4ED8",
  infoText:    "#1D4ED8",
  infoBg:      "#DBEAFE",
  mutedBg:     "#F1F5F9",
  success:     "#059669",
  warning:     "#F59E0B",
  error:       "#EF4444",
  gold:        "#D97706",
  elevated:    "#F0F2F5",
  tealBg:      "#CCFBF1",
  tealText:    BRAND.colors.secondary || "#0F766E",
  tealDim:     "#09491e", 
  borderLight: "#EEF1F6",
  teal:        BRAND.colors.secondary || "#0F766E",
  bgWhite: "#FFFFFF",
  muted: "#CBD2DC",
  primaryLight: BRAND.colors.secondary || "#0F766E",
  primaryFaint: "#E6F4F2",
  accentLight: BRAND.colors.primary || "#10B981",
  accentFaint: "#CCFBF1",
  brandNavy: BRAND.colors.navy || "#0B1C3D",
  tealLight: BRAND.colors.primary || "#10B981",
  tealFaint: "#CCFBF1",
  goldDim: "#B45309",
  chartColors: [
    BRAND.colors.secondary || "#0F766E",
    BRAND.colors.primary || "#10B981",
    BRAND.colors.accent || "#3B82F6",
    BRAND.colors.highlight || "#EAB308",
    "#0B1C3D",
    "#EA580C",
  ],
};

export const T = StyleSheet.create({
  label:  { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.6, textTransform: "uppercase" },
  amount: { fontSize: 28, fontWeight: "800", color: C.text,  letterSpacing: -1 },
  h2:     { fontSize: 15, fontWeight: "700", color: C.text,  letterSpacing: -0.2 },
  body:   { fontSize: 13, fontWeight: "500", color: C.text2 },
  bold:   { fontSize: 13, fontWeight: "700", color: C.text },
  small:  { fontSize: 11, fontWeight: "500", color: C.text3 },
  mono:   { fontVariant: ["tabular-nums"] as any },
});

// Always shows the full comma-separated amount (e.g. "RWF 10,000", not
// "RWF 10K") — abbreviated forms hide real values and make it hard to
// verify totals at a glance for loans, contributions, and wallet balances.
// Preserves the sign so negative amounts (debits, overdrafts) display
// correctly instead of being silently shown as positive.
export function fmtCurrency(amount: number, currency = BRAND.defaultCurrency): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? "-" : "";
  return `${sign}${currency} ${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Alias kept for existing call sites — identical behavior to fmtCurrency now.
export function fmtFull(amount: number, currency = BRAND.defaultCurrency): string {
  return fmtCurrency(amount, currency);
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateShort(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// "Monday, 31 August 2026" — used by the desktop top header.
export function fmtDateLong(date: Date = new Date()): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function fmtPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Add N days to a YYYY-MM-DD date, operating in local time so
 * the calendar day doesn't shift across a timezone boundary.
 * Used by the cascading installment reschedule.
 */
export function addDaysToYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? '').trim());
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + Math.round(days));
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Whole calendar days between two YYYY-MM-DD (or ISO) dates.
 * Always non-negative.
 */
export function daysBetweenYmd(a: string, b: string): number {
  const ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(a ?? '').trim());
  const mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b ?? '').trim());
  if (!ma || !mb) return 0;
  const da = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const db = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round(Math.abs(db - da) / 86_400_000);
}

/**
 * Add N months to a YYYY-MM-DD date, clamping to the last day
 * of the target month when the original day doesn't exist
 * (e.g. Jan 31 + 1mo → Feb 28/29, not Mar 2/3). Used by the
 * loan first-payment-date computation so a disbursement on the
 * 31st of a month doesn't skip the intended first-payment
 * month.
 */
export function addMonthsToYmd(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? '').trim());
  if (!m) return ymd;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);

  // Roll the year forward if the target month index overflows.
  const totalMonths = year * 12 + month0 + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;

  const lastDay = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDay);

  const yy = targetYear;
  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Loan math — PREVIEW/ESTIMATE ONLY.
//
// These are used to show an applicant an estimated repayment schedule while
// filling out a loan application, before anything is submitted. The
// calculation that actually moves money — disbursement, posting a
// repayment, computing the running balance — lives in
// lib/firestore/loans.ts (disburseLoanServer / recordRepaymentServer),
// which runs as a direct, batched Firestore write from the client, gated
// by firestore-rules. There are no Cloud Functions in this project. Do
// not use these two functions to compute values that get written to a
// loan's balance/repayment fields.
//
// Both methods take `ratePercent` as a per-period (monthly) rate, matching
// how Group.loanInterestRate / brand.json's defaults.loanInterestRate are
// already used elsewhere (e.g. "2" = 2% per month).
//
//  - "flat": principal * rate * months, charged up front. Every
//    installment has the same principal/interest split. Common for SACCOs
//    and tontines.
//  - "reducing_balance": interest for each installment is recalculated on
//    the outstanding balance, so it shrinks every month as principal gets
//    paid down — the standard bank amortization schedule. Total interest
//    paid is lower than flat for the same nominal rate.
// ─────────────────────────────────────────────────────────────────────────

// Convert rate to a per-period (monthly) rate for amortization.
// When period = "annual": monthlyRate = annualRate / 12
// When period = "monthly": rate is already per-month
export function toMonthlyRate(ratePercent: number, period: "monthly" | "annual" = "monthly"): number {
  return period === "annual" ? ratePercent / 12 : ratePercent;
}

export function loanMonthlyPayment(
  principal: number,
  ratePercent: number,
  months: number,
  method: LoanInterestMethod = "flat",
  period: "monthly" | "annual" = "monthly",
): number {
  if (months <= 0) return 0;
  const r = toMonthlyRate(ratePercent, period) / 100;
  if (method === "reducing_balance") {
    if (r === 0) return round2(principal / months);
    const payment = (principal * r) / (1 - Math.pow(1 + r, -months));
    return round2(payment);
  }
  // Flat: totalInterest = principal × monthlyRate × months
  const totalInterest = principal * r * months;
  return round2((principal + totalInterest) / months);
}

export function loanSchedule(loan: {
  amount: number;
  interestRate: number;
  repaymentMonths: number;
  firstPaymentDate: string;
}, method: LoanInterestMethod = "flat", period: "monthly" | "annual" = "monthly") {
  const { amount, interestRate, repaymentMonths, firstPaymentDate } = loan;
  // Always work in monthly rate internally
  const monthlyRatePct = toMonthlyRate(interestRate, period);

  if (method === "reducing_balance") {
    const r = monthlyRatePct / 100;
    const monthly = loanMonthlyPayment(amount, interestRate, repaymentMonths, "reducing_balance", period);
    let balance = amount;
    let totalInterest = 0;
    const schedule = Array.from({ length: repaymentMonths }, (_, i) => {
      const interestPer = round2(balance * r); // r = monthly rate
      // Last installment absorbs any rounding remainder so the schedule
      // ends exactly at zero rather than a few cents off.
      const isLast = i === repaymentMonths - 1;
      const principalPer = isLast ? round2(balance) : round2(monthly - interestPer);
      balance = round2(Math.max(0, balance - principalPer));
      totalInterest = round2(totalInterest + interestPer);

      const d = new Date(firstPaymentDate);
      d.setMonth(d.getMonth() + i);
      return {
        index: i,
        dueDate: d.toISOString(),
        principal: principalPer,
        interest: interestPer,
        total: round2(principalPer + interestPer),
        paid: false,
      };
    });
    const totalRepayable = round2(amount + totalInterest);
    return { schedule, monthlyPayment: monthly, totalInterest, totalRepayable };
  }

  // Flat / simple interest.
  // Round totalInterest and totalRepayable at origination so that
  // splitRepayment's amountRepaid comparisons never drift by a fraction of a cent.
  const totalInterest = round2(amount * (monthlyRatePct / 100) * repaymentMonths);
  const totalRepayable = round2(amount + totalInterest);
  const monthly = round2(totalRepayable / repaymentMonths);
  const principalPer = round2(amount / repaymentMonths);
  const interestPer = round2(totalInterest / repaymentMonths);

  // Last-payment reconciliation: absorb any cent-level rounding remainder so
  // the schedule sums exactly to totalRepayable (prevents isRepaid never triggering).
  const scheduleTotal = round2(monthly * (repaymentMonths - 1));
  const lastPayment = round2(totalRepayable - scheduleTotal);

  const schedule = Array.from({ length: repaymentMonths }, (_, i) => {
    const d = new Date(firstPaymentDate);
    d.setMonth(d.getMonth() + i);
    const isLast = i === repaymentMonths - 1;
    const total = isLast ? lastPayment : monthly;
    const interest = isLast ? round2(lastPayment * (totalInterest / totalRepayable)) : interestPer;
    const principal = round2(total - interest);
    return {
      index: i,
      dueDate: d.toISOString(),
      principal,
      interest,
      total,
      paid: false,
    };
  });
  return { schedule, monthlyPayment: monthly, totalInterest, totalRepayable };
}

// ── Web-compatible confirm dialog ──────────────────────────────────────────────
export function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void,
  destructive = false,
) {
  if (Platform.OS === "web") {
    const confirmed = window.confirm(`${title}\n\n${message}`);
    if (confirmed) onConfirm();
    else onCancel?.();
  } else {
    const { Alert } = require("react-native");
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: onCancel },
      {
        text: "Confirm",
        style: destructive ? "destructive" : "default",
        onPress: onConfirm,
      },
    ]);
  }
}

export const Shadow = StyleSheet.create({
  xs: {
    boxShadow: "0px 1px 4px rgba(26, 60, 94, 0.06)",
    shadowColor: "#1A3C5E",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sm: {
    boxShadow: "0px 2px 8px rgba(26, 60, 94, 0.08)",
    shadowColor: "#1A3C5E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  md: {
    boxShadow: "0px 4px 16px rgba(26, 60, 94, 0.10)",
    shadowColor: "#1A3C5E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 6,
  },
  teal: {
    boxShadow: "0px 4px 12px rgba(13, 148, 136, 0.25)",
    shadowColor: "#0D9488",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
});
