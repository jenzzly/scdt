// utils/theme.ts
import { Alert, Platform, StyleSheet } from "react-native";
import { BRAND } from "../lib/brand";
import type { LoanInterestMethod } from "../types";

// ─────────────────────────────────────────────────────────────────────────
// Design system
//
// Typography uses the native system font:
//   iOS     → San Francisco
//   Android → Roboto
//   Web     → Apple system / Segoe UI
//
// Weight hierarchy:
//   400 → normal content
//   500 → medium emphasis
//   600 → important UI
//   700 → headings / financial figures
// ─────────────────────────────────────────────────────────────────────────

export const Fonts = {
  regular: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),

  medium: Platform.select({
    ios: "System",
    android: "sans-serif-medium",
    default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),

  semibold: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),

  bold: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }),
};

export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const S = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

// ─────────────────────────────────────────────────────────────────────────
// Page layout
// ─────────────────────────────────────────────────────────────────────────

const PAGE_GUTTER = 16;
const PAGE_MAX_WIDTH = 1100;

export const Layout = {
  gutter: PAGE_GUTTER,
  maxWidth: PAGE_MAX_WIDTH,
  insetMaxWidth: PAGE_MAX_WIDTH + PAGE_GUTTER * 2,

  column: {
    width: "100%",
    maxWidth: PAGE_MAX_WIDTH,
    alignSelf: "center",
  } as const,

  insetColumn: {
    width: "100%",
    maxWidth: PAGE_MAX_WIDTH + PAGE_GUTTER * 2,
    alignSelf: "center",
  } as const,
};

// ─────────────────────────────────────────────────────────────────────────
// Light palette
// ─────────────────────────────────────────────────────────────────────────

export const C = {
  bg: "#F0F3F8",
  surface: "#FFFFFF",

  card: "#09491e",
  cardText: "#FFFFFF",

  primary: BRAND.colors.secondary || "#0F766E",
  accent: BRAND.colors.primary || "#10B981",

  brandBlue: BRAND.colors.accent || "#3B82F6",
  brandAmber: BRAND.colors.highlight || "#EAB308",

  debit: "#EF4444",

  text: "#0F172A",
  text2: "#475569",
  text3: "#94A3B8",

  border: "#E2E8F0",

  pill: "#EFF6FF",
  pillText: BRAND.colors.secondary || "#0F766E",

  goldBg: "#FFFBEB",
  goldText: "#B45309",

  greenBg: "#ECFDF5",
  greenText: "#065F46",

  redBg: "#FEF2F2",
  redText: "#991B1B",

  info: "#1D4ED8",
  infoText: "#1D4ED8",
  infoBg: "#DBEAFE",

  mutedBg: "#F1F5F9",

  success: "#059669",
  warning: "#F59E0B",
  error: "#EF4444",

  gold: "#D97706",

  elevated: "#F0F2F5",

  tealBg: "#CCFBF1",
  tealText: BRAND.colors.secondary || "#0F766E",
  tealDim: "#09491e",

  borderLight: "#EEF1F6",

  teal: BRAND.colors.secondary || "#0F766E",

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

  purple: "#9333EA",
  indigo: "#4F46E5",
  orange: "#EA580C",
  coral: "#E4572E",

  chartColors: [
    BRAND.colors.secondary || "#0F766E",
    BRAND.colors.primary || "#10B981",
    BRAND.colors.accent || "#3B82F6",
    BRAND.colors.highlight || "#EAB308",
    "#0B1C3D",
    "#EA580C",
  ],
};

export type Palette = typeof C;

// ─────────────────────────────────────────────────────────────────────────
// Dark palette
// ─────────────────────────────────────────────────────────────────────────

export const D: Palette = {
  bg: "#0F172A",
  surface: "#1E293B",

  card: "#0A2E1F",
  cardText: "#FFFFFF",

  primary: BRAND.colors.secondary || "#0F766E",
  accent: BRAND.colors.primary || "#10B981",

  brandBlue: BRAND.colors.accent || "#3B82F6",
  brandAmber: BRAND.colors.highlight || "#EAB308",

  debit: "#F87171",

  text: "#F1F5F9",
  text2: "#CBD5E1",
  text3: "#94A3B8",

  border: "#334155",

  pill: "#1E293B",
  pillText: BRAND.colors.secondary || "#0F766E",

  goldBg: "#2D1F0A",
  goldText: "#FCD34D",

  greenBg: "#052E1B",
  greenText: "#6EE7B7",

  redBg: "#3F1212",
  redText: "#FCA5A5",

  info: "#60A5FA",
  infoText: "#93C5FD",
  infoBg: "#1E3A5F",

  mutedBg: "#1E293B",

  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",

  gold: "#FBBF24",

  elevated: "#293548",

  tealBg: "#134E4A",
  tealText: "#5EEAD4",
  tealDim: "#0A2E1F",

  borderLight: "#293548",

  teal: BRAND.colors.secondary || "#0F766E",

  bgWhite: "#1E293B",

  muted: "#475569",

  primaryLight: BRAND.colors.secondary || "#0F766E",
  primaryFaint: "#0F2E2A",

  accentLight: BRAND.colors.primary || "#10B981",
  accentFaint: "#052E1B",

  brandNavy: "#0A1828",

  tealLight: BRAND.colors.primary || "#10B981",
  tealFaint: "#134E4A",

  goldDim: "#FCD34D",

  purple: "#C084FC",
  indigo: "#818CF8",
  orange: "#FB923C",
  coral: "#F87F5C",

  chartColors: [
    BRAND.colors.secondary || "#0F766E",
    BRAND.colors.primary || "#10B981",
    BRAND.colors.accent || "#3B82F6",
    BRAND.colors.highlight || "#EAB308",
    "#0B1C3D",
    "#EA580C",
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Typography
// ─────────────────────────────────────────────────────────────────────────

export const T = StyleSheet.create({
  label: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    fontWeight: "600",
    color: C.text3,
    letterSpacing: 0.3,
  },

  amount: {
    fontFamily: Fonts.bold,
    fontSize: 28,
    fontWeight: "700",
    color: C.text,
    letterSpacing: -0.6,
    fontVariant: ["tabular-nums"] as any,
  },

  h2: {
    fontFamily: Fonts.semibold,
    fontSize: 17,
    fontWeight: "600",
    color: C.text,
    letterSpacing: -0.2,
  },

  body: {
    fontFamily: Fonts.regular,
    fontSize: 15,
    fontWeight: "400",
    color: C.text2,
    lineHeight: 21,
  },

  bold: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    fontWeight: "600",
    color: C.text,
  },

  small: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    fontWeight: "400",
    color: C.text3,
    lineHeight: 18,
  },

  mono: {
    fontVariant: ["tabular-nums"] as any,
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Themed typography
// ─────────────────────────────────────────────────────────────────────────

export const makeT = (palette: Palette) =>
  StyleSheet.create({
    label: {
      fontFamily: Fonts.semibold,
      fontSize: 12,
      fontWeight: "600",
      color: palette.text3,
      letterSpacing: 0.3,
    },

    amount: {
      fontFamily: Fonts.bold,
      fontSize: 28,
      fontWeight: "700",
      color: palette.text,
      letterSpacing: -0.6,
      fontVariant: ["tabular-nums"] as any,
    },

    h2: {
      fontFamily: Fonts.semibold,
      fontSize: 17,
      fontWeight: "600",
      color: palette.text,
      letterSpacing: -0.2,
    },

    body: {
      fontFamily: Fonts.regular,
      fontSize: 15,
      fontWeight: "400",
      color: palette.text2,
      lineHeight: 21,
    },

    bold: {
      fontFamily: Fonts.semibold,
      fontSize: 15,
      fontWeight: "600",
      color: palette.text,
    },

    small: {
      fontFamily: Fonts.regular,
      fontSize: 13,
      fontWeight: "400",
      color: palette.text3,
      lineHeight: 18,
    },

    mono: {
      fontVariant: ["tabular-nums"] as any,
    },
  });

// ─────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────

export function fmtCurrency(
  amount: number,
  currency = BRAND.defaultCurrency,
): string {
  const value = Number.isFinite(amount) ? amount : 0;

  const sign = value < 0 ? "-" : "";

  return `${sign}${currency} ${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtFull(
  amount: number,
  currency = BRAND.defaultCurrency,
): string {
  return fmtCurrency(amount, currency);
}

// ─────────────────────────────────────────────────────────────────────────
// Amount input formatting
// ─────────────────────────────────────────────────────────────────────────

export function formatAmountInput(raw: string): string {
  if (!raw) return "";

  let s = String(raw).replace(/[^\d.]/g, "");

  const firstDot = s.indexOf(".");

  if (firstDot !== -1) {
    s =
      s.slice(0, firstDot + 1) +
      s.slice(firstDot + 1).replace(/\./g, "");
  }

  let intPart: string;
  let fracPart: string | undefined;

  const dotIdx = s.indexOf(".");

  if (dotIdx === -1) {
    intPart = s;
  } else {
    intPart = s.slice(0, dotIdx);
    fracPart = s.slice(dotIdx + 1).slice(0, 2);
  }

  intPart = intPart.replace(/^0+(?=\d)/, "");

  if (intPart === "" && fracPart === undefined) {
    return "";
  }

  if (intPart === "" && fracPart !== undefined) {
    intPart = "0";
  }

  const grouped = intPart.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );

  return fracPart !== undefined
    ? `${grouped}.${fracPart}`
    : grouped;
}

export function padAmountOnBlur(
  formatted: string,
): string {
  if (!formatted) return "";

  if (formatted.includes(".")) {
    return formatted;
  }

  return `${formatted}.00`;
}

export function parseFormattedAmount(
  formatted: string,
): number {
  const n = Number(
    String(formatted).replace(/,/g, ""),
  );

  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Date formatting
// ─────────────────────────────────────────────────────────────────────────

export function fmtDate(iso: string): string {
  if (!iso) return "";

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  if (!iso) return "";

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function fmtDateLong(
  date: Date = new Date(),
): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function fmtPercent(
  value: number,
  decimals = 1,
): string {
  return `${value.toFixed(decimals)}%`;
}

// ─────────────────────────────────────────────────────────────────────────
// General helpers
// ─────────────────────────────────────────────────────────────────────────

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function uid(): string {
  return `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────
// Date calculations
// ─────────────────────────────────────────────────────────────────────────

export function addDaysToYmd(
  ymd: string,
  days: number,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(ymd ?? "").trim(),
  );

  if (!m) return ymd;

  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  );

  d.setDate(d.getDate() + Math.round(days));

  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yy}-${mm}-${dd}`;
}

export function daysBetweenYmd(
  a: string,
  b: string,
): number {
  const ma = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(a ?? "").trim(),
  );

  const mb = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(b ?? "").trim(),
  );

  if (!ma || !mb) return 0;

  const da = Date.UTC(
    Number(ma[1]),
    Number(ma[2]) - 1,
    Number(ma[3]),
  );

  const db = Date.UTC(
    Number(mb[1]),
    Number(mb[2]) - 1,
    Number(mb[3]),
  );

  return Math.round(
    Math.abs(db - da) / 86_400_000,
  );
}

export function addMonthsToYmd(
  ymd: string,
  months: number,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(
    String(ymd ?? "").trim(),
  );

  if (!m) return ymd;

  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);

  const totalMonths =
    year * 12 + month0 + months;

  const targetYear = Math.floor(
    totalMonths / 12,
  );

  const targetMonth0 =
    ((totalMonths % 12) + 12) % 12;

  const lastDay = new Date(
    targetYear,
    targetMonth0 + 1,
    0,
  ).getDate();

  const clampedDay = Math.min(
    day,
    lastDay,
  );

  const yy = targetYear;
  const mm = String(
    targetMonth0 + 1,
  ).padStart(2, "0");
  const dd = String(
    clampedDay,
  ).padStart(2, "0");

  return `${yy}-${mm}-${dd}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Loan calculations
// ─────────────────────────────────────────────────────────────────────────

export function toMonthlyRate(
  ratePercent: number,
  period: "monthly" | "annual" = "monthly",
): number {
  return period === "annual"
    ? ratePercent / 12
    : ratePercent;
}

export function loanMonthlyPayment(
  principal: number,
  ratePercent: number,
  months: number,
  method: LoanInterestMethod = "flat",
  period: "monthly" | "annual" = "monthly",
): number {
  if (months <= 0) return 0;

  const r =
    toMonthlyRate(ratePercent, period) / 100;

  if (method === "reducing_balance") {
    if (r === 0) {
      return round2(principal / months);
    }

    const payment =
      (principal * r) /
      (1 - Math.pow(1 + r, -months));

    return round2(payment);
  }

  const totalInterest =
    principal * r * months;

  return round2(
    (principal + totalInterest) / months,
  );
}

export function loanSchedule(
  loan: {
    amount: number;
    interestRate: number;
    repaymentMonths: number;
    firstPaymentDate: string;
  },
  method: LoanInterestMethod = "flat",
  period: "monthly" | "annual" = "monthly",
) {
  const {
    amount,
    interestRate,
    repaymentMonths,
    firstPaymentDate,
  } = loan;

  const monthlyRatePct =
    toMonthlyRate(interestRate, period);

  if (method === "reducing_balance") {
    const r = monthlyRatePct / 100;

    const monthly =
      loanMonthlyPayment(
        amount,
        interestRate,
        repaymentMonths,
        "reducing_balance",
        period,
      );

    let balance = amount;
    let totalInterest = 0;

    const schedule = Array.from(
      { length: repaymentMonths },
      (_, i) => {
        const interestPer = round2(
          balance * r,
        );

        const isLast =
          i === repaymentMonths - 1;

        const principalPer = isLast
          ? round2(balance)
          : round2(
              monthly - interestPer,
            );

        balance = round2(
          Math.max(
            0,
            balance - principalPer,
          ),
        );

        totalInterest = round2(
          totalInterest + interestPer,
        );

        const d = new Date(
          firstPaymentDate,
        );

        d.setMonth(
          d.getMonth() + i,
        );

        return {
          index: i,
          dueDate: d.toISOString(),
          principal: principalPer,
          interest: interestPer,
          total: round2(
            principalPer + interestPer,
          ),
          paid: false,
        };
      },
    );

    const totalRepayable = round2(
      amount + totalInterest,
    );

    return {
      schedule,
      monthlyPayment: monthly,
      totalInterest,
      totalRepayable,
    };
  }

  // Flat / simple interest.

  const totalInterest = round2(
    amount *
      (monthlyRatePct / 100) *
      repaymentMonths,
  );

  const totalRepayable = round2(
    amount + totalInterest,
  );

  const monthly = round2(
    totalRepayable / repaymentMonths,
  );

  const principalPer = round2(
    amount / repaymentMonths,
  );

  const interestPer = round2(
    totalInterest / repaymentMonths,
  );

  const scheduleTotal = round2(
    monthly * (repaymentMonths - 1),
  );

  const lastPayment = round2(
    totalRepayable - scheduleTotal,
  );

  const schedule = Array.from(
    { length: repaymentMonths },
    (_, i) => {
      const d = new Date(
        firstPaymentDate,
      );

      d.setMonth(
        d.getMonth() + i,
      );

      const isLast =
        i === repaymentMonths - 1;

      const total = isLast
        ? lastPayment
        : monthly;

      const interest = isLast
        ? round2(
            lastPayment *
              (totalInterest /
                totalRepayable),
          )
        : interestPer;

      const principal = round2(
        total - interest,
      );

      return {
        index: i,
        dueDate: d.toISOString(),
        principal,
        interest,
        total,
        paid: false,
      };
    },
  );

  return {
    schedule,
    monthlyPayment: monthly,
    totalInterest,
    totalRepayable,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Confirm dialog
//
// IMPORTANT:
// Keep this exported because existing screens use:
//
// import { showConfirm } from "../utils/theme";
//
// No require() is used.
// ─────────────────────────────────────────────────────────────────────────

export function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void,
  destructive = false,
) {
  if (Platform.OS === "web") {
    const confirmed = window.confirm(
      `${title}\n\n${message}`,
    );

    if (confirmed) {
      onConfirm();
    } else {
      onCancel?.();
    }

    return;
  }

  Alert.alert(title, message, [
    {
      text: "Cancel",
      style: "cancel",
      onPress: onCancel,
    },
    {
      text: "Confirm",
      style: destructive
        ? "destructive"
        : "default",
      onPress: onConfirm,
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Shadows
// ─────────────────────────────────────────────────────────────────────────

export const Shadow = StyleSheet.create({
  xs: {
    boxShadow:
      "0px 1px 4px rgba(26, 60, 94, 0.06)",
    shadowColor: "#1A3C5E",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  sm: {
    boxShadow:
      "0px 2px 8px rgba(26, 60, 94, 0.08)",
    shadowColor: "#1A3C5E",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  md: {
    boxShadow:
      "0px 4px 16px rgba(26, 60, 94, 0.10)",
    shadowColor: "#1A3C5E",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 6,
  },

  teal: {
    boxShadow:
      "0px 4px 12px rgba(13, 148, 136, 0.25)",
    shadowColor: "#0D9488",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
});
