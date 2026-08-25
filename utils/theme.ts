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

export const Colors = {
  // Light theme
  bg: "#F5F7FA",
  bgWhite: "#FFFFFF",
  surface: "#FFFFFF",
  elevated: "#F0F2F5",
  border: "#E4E8EF",
  borderLight: "#EEF1F6",
  muted: "#CBD2DC",

  // Brand — sourced from BRAND.colors, not hardcoded
  primary: BRAND.colors.navy,
  primaryLight: BRAND.colors.navy,
  primaryFaint: "#EBF1F8",
  accent: BRAND.colors.primary,
  accentLight: BRAND.colors.primary,
  accentFaint: "#CCFBF1",

  /** @deprecated kept for screens not yet migrated to `C`; now aliases the brand accent instead of a separately-hardcoded teal. */
  teal: BRAND.colors.primary,
  tealLight: BRAND.colors.primary,
  tealDim: BRAND.colors.navy,
  tealFaint: "#CCFBF1",
  gold: "#D97706",
  goldDim: "#B45309",

  // Text
  text: "#0F1F33",
  text2: "#4A607A",
  text3: "#8FA3BA",

  // Semantic — intentionally NOT brand-driven. Error/warning/success/info
  // colors are UX conventions (red = danger, green = success, etc); letting
  // a client's brand palette override these would break comprehension, so
  // they stay fixed regardless of client.
  success: "#059669",
  warning: "#D97706",
  error: "#DC2626",
  info: "#2563EB",

  chartColors: ["#0D9488", "#D97706", "#2563EB", "#059669", "#7C3AED", "#EA580C"],

  // Semantic bg/text pairs — used by screens still on Colors
  greenBg:  "#ECFDF5",
  greenText:"#065F46",
  redBg:    "#FEF2F2",
  redText:  "#991B1B",
  goldBg:   "#FFFBEB",
  goldText: "#B45309",
  infoBg:   "#DBEAFE",
  infoText: "#1D4ED8",
  mutedBg:  "#F1F5F9",

  // Card color (dark navy) — used by login.tsx desktop panel
  card: BRAND.colors.navy,
};

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
  bg:         "#F0F3F8",
  surface:    "#FFFFFF",
  card:       BRAND.colors.navy,    // dark navy account card
  cardText:   "#FFFFFF",
  primary:    "#1A56DB",
  accent:     BRAND.colors.primary,
  debit:      "#EF4444",
  text:       "#0F172A",
  text2:      "#475569",
  text3:      "#94A3B8",
  border:     "#E2E8F0",
  pill:       "#EFF6FF",
  pillText:   "#1A56DB",
  goldBg:     "#FFFBEB",
  goldText:   "#B45309",
  greenBg:    "#ECFDF5",
  greenText:  "#065F46",
  redBg:      "#FEF2F2",
  redText:    "#991B1B",
  info:       "#EFF6FF",
  infoText:   "#1D4ED8",
  infoBg:     "#DBEAFE",
  mutedBg:    "#F1F5F9",
  success:    BRAND.colors.primary,
  warning:    "#F59E0B",
  error:      "#EF4444",
  gold:       "#D97706",
  elevated:   "#F0F2F5",
  tealBg:      "#CCFBF1",
  tealText:    BRAND.colors.primary,
  tealDim:     BRAND.colors.navy,
  borderLight: "#EEF1F6",
  teal:      BRAND.colors.primary,
};

export const T = StyleSheet.create({
  label:  { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.6, textTransform: "uppercase" },
  amount: { fontSize: 28, fontWeight: "800", color: C.text,  letterSpacing: -1 },
  h2:     { fontSize: 15, fontWeight: "700", color: C.text,  letterSpacing: -0.2 },
  body:   { fontSize: 13, fontWeight: "500", color: C.text2 },
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

// ─────────────────────────────────────────────────────────────────────────
// Loan math — PREVIEW/ESTIMATE ONLY.
//
// These are used to show an applicant an estimated repayment schedule while
// filling out a loan application, before anything is submitted. The
// authoritative calculation that actually moves money — disbursement,
// posting a repayment, computing the running balance — now lives server
// side in Cloud Functions (functions/src/loans.ts) and is called via
// lib/firestore/loans.ts. Do not use these two functions to compute values
// that get written to a loan's balance/repayment fields.
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
