// app/(tabs)/reports.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
  Modal,
  Platform,
  Alert,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  useStore,
  useActiveGroup,
  useGroupMembers,
  useGroupLoans,
  useGroupContributions,
  useGroupInvestments,
  useGroupWallet,
  useGroupMeetings,
  useCurrentMember,
  useCurrentMemberPermissions,
  useIsGroupView,
} from "../../stores/useStore";

import { useMyMemberIds } from "../../stores/selectors";

import {
  Card,
  Empty,
  useToast,
  Toast,
  Input,
  BottomModal,
  Select,
  DatePicker,
} from "../../components/ui";

import {
  C as LightPalette,
  D as DarkPalette,
  fmtCurrency,
  fmtDate,
  round2,
  type Palette,
} from "../../utils/theme";
import { Layout } from "../../utils/theme";
import { KeyboardAwareScrollView } from "../../components/ui/KeyboardAwareScrollView";
import { useTheme, useThemeMode } from "../../hooks/useTheme";

import {
  exportXlsx,
  exportPdf,
} from "../../utils/export";

import {
  findOverdueContributions,
  findOverdueInstallments,
} from "../../utils/lateFees";

import { computeTodayAccrued } from "../../utils/accrual";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Category =
  | "contributions"
  | "loans"
  | "latefees"
  | "members"
  | "expenses"
  | "investments"
  | "earnings";

type DropdownOption = {
  label: string;
  value: string;
};

type MemberStatusFilter =
  | "all"
  | "has_unpaid_fees"
  | "late_contribution_fees"
  | "late_loans"
  | "no_contributions_in_period"
  | "no_loans";

type EarningsViewMode = "all" | "actual" | "projected";

type LateFeeSourceFilter =
  | "all"
  | "contribution"
  | "loan"
  | "meeting";

type EarningsSourceFilter =
  | "all"
  | "loan_interest"
  | "late_fees"
  | "investment_returns"
  | "other";

// ─────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────

const CATEGORIES: {
  key: Category;
  label: string;
  icon: string;
}[] = [
  { key: "contributions", label: "Contributions", icon: "📈" },
  { key: "loans", label: "Loans", icon: "🏦" },
  { key: "latefees", label: "Late Fees", icon: "⚠️" },
  { key: "members", label: "Members", icon: "👥" },
  { key: "expenses", label: "Expenses", icon: "💸" },
  { key: "earnings", label: "Profits", icon: "💰" },
];

const MEMBER_STATUS_OPTIONS: { label: string; value: MemberStatusFilter }[] = [
  { label: "All members", value: "all" },
  { label: "Has unpaid late fees", value: "has_unpaid_fees" },
  { label: "Late contribution fees", value: "late_contribution_fees" },
  { label: "Late loan repayments", value: "late_loans" },
  { label: "No contributions in period", value: "no_contributions_in_period" },
  { label: "No loans taken", value: "no_loans" },
];

const LOAN_STATUS_CHIPS: { label: string; value: "all" | "pending" | "active" | "repaid" }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Active", value: "active" },
  { label: "Repaid", value: "repaid" },
];

const CONTRIBUTION_STATUS_CHIPS: { label: string; value: "all" | "approved" | "pending" | "rejected" }[] = [
  { label: "All", value: "all" },
  { label: "Approved", value: "approved" },
  { label: "Pending", value: "pending" },
  { label: "Rejected", value: "rejected" },
];

const LATE_FEE_SOURCE_CHIPS: { label: string; value: LateFeeSourceFilter }[] = [
  { label: "All Sources", value: "all" },
  { label: "Contributions", value: "contribution" },
  { label: "Loans", value: "loan" },
  { label: "Meetings", value: "meeting" },
];

const EARNINGS_SOURCE_CHIPS: { label: string; value: EarningsSourceFilter }[] = [
  { label: "All Sources", value: "all" },
  { label: "Loan Interest", value: "loan_interest" },
  { label: "Late Fees", value: "late_fees" },
  { label: "Investment Returns", value: "investment_returns" },
  { label: "Other", value: "other" },
];

function classifyEarningsSource(t: { type: string }): EarningsSourceFilter {
  switch (t.type) {
    case "loan_repayment":
    case "loan_interest_income":
    case "interest":
    case "projected_interest":
      return "loan_interest";
    case "late_fee":
    case "loan_late_fee":
      return "late_fees";
    case "investment_return":
      return "investment_returns";
    default:
      return "other";
  }
}

const MEMBER_CONDITION_GROUPS: {
  groupLabel: string;
  options: { label: string; value: MemberStatusFilter; description: string }[];
}[] = [
  {
    groupLabel: "Payment issues",
    options: [
      {
        label: "Has unpaid late fees",
        value: "has_unpaid_fees",
        description: "Any late fee — from a contribution or a loan — that hasn't been paid",
      },
      {
        label: "Late contribution fees",
        value: "late_contribution_fees",
        description: "Specifically an unpaid fee from a missed contribution",
      },
      {
        label: "Late loan repayments",
        value: "late_loans",
        description: "Currently has a loan installment past its due date",
      },
    ],
  },
  {
    groupLabel: "Activity",
    options: [
      {
        label: "No contributions in period",
        value: "no_contributions_in_period",
        description: "Hasn't contributed within the selected date range (or ever, if no range is set)",
      },
      {
        label: "No loans taken",
        value: "no_loans",
        description: "Has never taken out a loan",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────

function monthKey(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
  });
}

function monthBounds(key: string) {
  const [y, m] = key.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

function countActiveFilters(opts: {
  search: string;
  fromDate: string;
  toDate: string;
  loanStatus: string;
  contributionStatus: string;
  memberStatus: string;
  lateFeeSource: string;
  earningsSource: string;
  contributionType?: string;
}) {
  let n = 0;
  if (opts.search) n++;
  if (opts.fromDate || opts.toDate) n++;
  if (opts.loanStatus !== "all") n++;
  if (opts.contributionStatus !== "all") n++;
  if (opts.memberStatus !== "all") n++;
  if (opts.lateFeeSource !== "all") n++;
  if (opts.earningsSource !== "all") n++;
  if (opts.contributionType && opts.contributionType !== "all") n++;
  return n;
}

function monthlyTotals(
  items: any[],
  dateField: string,
  amountField: string | null
) {
  const byMonth: Record<string, number> = {};

  items.forEach((item) => {
    const k = monthKey(item[dateField]);
    if (!k) return;
    const v = amountField ? Math.abs(item[amountField] || 0) : 1;
    byMonth[k] = (byMonth[k] || 0) + v;
  });

  const keys = Object.keys(byMonth).sort();

  return {
    labels: keys.map(monthLabel),
    values: keys.map((k) => byMonth[k]),
  };
}

function calculateLoanInterestProjection(
  loan: any,
  fromDate: string,
  toDate: string
) {
  if (!loan.schedule || loan.status !== "disbursed") return 0;

  const asOfDate = toDate ? new Date(toDate) : null;
  const fromDateObj = fromDate ? new Date(fromDate) : null;

  let projectedInterest = 0;

  loan.schedule.forEach((installment: any) => {
    if (installment.paid) return;

    const dueDate = new Date(installment.dueDate);

    if (fromDateObj && dueDate < fromDateObj) return;
    if (asOfDate && dueDate > asOfDate) return;

    projectedInterest += Number(installment.interest) || 0;
  });

  return round2(projectedInterest);
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helpers for the overview layout
// ─────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 5;

function fmtAxis(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function niceScale(max: number, tickCount = 4) {
  if (!Number.isFinite(max) || max <= 0) {
    return { top: 100, ticks: [0, 25, 50, 75, 100] };
  }

  const raw = max / tickCount;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  const mult = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 3 ? 3 : frac <= 5 ? 5 : 10;
  const step = mult * pow;

  return {
    top: step * tickCount,
    ticks: Array.from({ length: tickCount + 1 }, (_, i) => i * step),
  };
}

function titleCase(s: string) {
  return String(s)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────
// Financial Position KPI card — no icon, 2-col grid style matching the
// "Group Financial Position" panel design.
// ─────────────────────────────────────────────────────────────────────────

type KpiCardProps = {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  onPress?: () => void;
};

function KpiCard({ label, value, sub, valueColor, onPress }: KpiCardProps) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const body = (
    <>
      <Text style={styles.positionCardLabel} numberOfLines={1}>
        {label}
      </Text>

      <Text
        style={[
          styles.positionCardValue,
          valueColor ? { color: valueColor } : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>

      <Text style={styles.positionCardSub} numberOfLines={1}>
        {sub}
      </Text>
    </>
  );

  if (!onPress) {
    return <View style={styles.positionCard}>{body}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.positionCard}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Open report`}
    >
      {body}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Status badge (table cells)
// ─────────────────────────────────────────────────────────────────────────

function StatusBadge({ value }: { value: string }) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const text = String(value ?? "").trim();
  if (!text) return null;

  const v = text.toLowerCase();

  let bg = C.elevated;
  let fg = C.text2;
  let border = C.border;

  if (["approved", "paid", "active", "repaid", "actual", "disbursed"].includes(v)) {
    bg = C.greenBg;
    fg = C.success;
    border = C.success;
  } else if (v.startsWith("pending")) {
    bg = C.goldBg;
    fg = C.goldText;
    border = C.gold;
  } else if (["rejected", "unpaid", "overdue", "defaulted", "inactive", "suspended"].includes(v)) {
    bg = C.redBg;
    fg = C.redText;
    border = C.error;
  } else if (v === "projected") {
    bg = C.infoBg;
    fg = C.infoText;
    border = C.info;
  }

  return (
    <View style={[styles.tableBadge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.tableBadgeText, { color: fg }]} numberOfLines={1}>
        {titleCase(text)}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Earnings donut
// ─────────────────────────────────────────────────────────────────────────
function EarningsDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const positiveSegments = segments.filter(
    (s) => Number.isFinite(s.value) && s.value > 0
  );
  const total = positiveSegments.reduce((sum, s) => sum + s.value, 0);

  const size = 148;
  const strokeWidth = 22;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (total <= 0) {
    return (
      <View style={styles.donutEmpty}>
        <View style={styles.donutEmptyCircle}>
          <Text style={styles.donutEmptyText}>No earnings</Text>
          <Text style={styles.donutEmptySubtext}>recorded yet</Text>
        </View>
      </View>
    );
  }

  let cumulative = 0;

  return (
    <View style={styles.donutContainer}>
      <View style={styles.donutVisual}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={C.border}
            strokeWidth={strokeWidth}
            fill="none"
          />

          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={positiveSegments.length === 1 ? positiveSegments[0].color : "transparent"}
            strokeWidth={strokeWidth}
            fill="none"
          />

          {positiveSegments.map((seg, i) => {
            const pct = seg.value / total;
            const dashLength = Math.max(0.5, pct * circumference);
            const dashOffset = -cumulative * circumference;
            cumulative += pct;

            return (
              <Circle
                key={`${seg.label}-${i}`}
                cx={center}
                cy={center}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={`${dashLength} ${circumference}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${center} ${center})`}
              />
            );
          })}
        </Svg>

        <View style={styles.donutCenter}>
          <Text style={styles.donutCenterLabel}>Total</Text>
          <Text
            style={styles.donutCenterValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            {fmtCurrency(total)}
          </Text>
        </View>
      </View>

      <View style={styles.donutLegend}>
        {positiveSegments.map((seg, i) => {
          const pct = Math.round((seg.value / total) * 100);

          return (
            <View key={`${seg.label}-legend-${i}`} style={styles.donutLegendRow}>
              <View style={styles.donutLegendName}>
                <View style={[styles.donutLegendDot, { backgroundColor: seg.color }]} />
                <Text style={styles.donutLegendText} numberOfLines={1}>
                  {seg.label}
                </Text>
              </View>

              <Text style={styles.donutLegendPct}>{pct}%</Text>

              <Text style={styles.donutLegendAmount} numberOfLines={1}>
                {fmtCurrency(seg.value)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gauge
// ─────────────────────────────────────────────────────────────────────────
function Gauge({
  value,
  max = 100,
  color,
  trackColor,
  caption,
}: {
  value: number;
  max?: number;
  color?: string;
  trackColor?: string;
  caption?: string;
}) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const finalColor = color ?? C.success;
  const finalTrackColor = trackColor ?? C.border;

  const size = 168;
  const strokeWidth = 14;
  const centerX = size / 2;
  const centerY = size / 2 + 4;
  const radius = (size - strokeWidth) / 2 - 2;
  const left = centerX - radius;
  const right = centerX + radius;
  const arcLength = Math.PI * radius;
  const svgHeight = centerY + strokeWidth / 2 + 2;

  const safeMax = max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(1, safeValue / safeMax));
  const progressLength = pct * arcLength;

  const arcPath = `M ${left} ${centerY} A ${radius} ${radius} 0 0 1 ${right} ${centerY}`;

  const displayText =
    safeValue > safeMax
      ? `${Math.round(safeMax)}%+`
      : `${Math.round(Math.max(0, safeValue))}%`;

  return (
    <View style={styles.gaugeContainer}>
      <View style={{ width: size, height: svgHeight }}>
        <Svg width={size} height={svgHeight} viewBox={`0 0 ${size} ${svgHeight}`}>
          <Path
            d={arcPath}
            stroke={finalTrackColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
          />

          {progressLength > 0 && (
            <Path
              d={arcPath}
              stroke={finalColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${progressLength} ${arcLength}`}
            />
          )}
        </Svg>

        <View style={styles.gaugeValueWrap}>
          <Text style={styles.gaugeValue}>{displayText}</Text>
        </View>
      </View>

      {caption ? (
        <Text style={[styles.gaugeCaption, { color: finalColor }]}>{caption}</Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cashflow chart
// ─────────────────────────────────────────────────────────────────────────

function CashflowBarChart({
  months,
  income,
  expenses,
}: {
  months: string[];
  income: number[];
  expenses: number[];
}) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const [plotWidth, setPlotWidth] = useState(0);

  const safeIncome = income.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const safeExpenses = expenses.map((v) =>
    Number.isFinite(v) ? Math.max(0, v) : 0
  );

  const rawMax = Math.max(0, ...safeIncome, ...safeExpenses);
  const { top, ticks } = niceScale(rawMax, 4);

  const plotH = 108;
  const labelH = 22;
  const minColWidth = 40;

  const innerWidth = Math.max(plotWidth, months.length * minColWidth);
  const colWidth = innerWidth / Math.max(1, months.length);
  const barWidth = Math.max(7, Math.min(18, colWidth / 4));

  return (
    <View style={styles.cashflowWrap}>
      <View style={{ width: 42, height: plotH + labelH }}>
        {ticks.map((t, i) => (
          <Text
            key={`${t}_${i}`}
            style={[
              styles.cashflowAxisText,
              { bottom: labelH + (t / top) * plotH - 6 },
            ]}
          >
            {fmtAxis(t)}
          </Text>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
      >
        <View style={{ width: innerWidth, height: plotH + labelH }}>
          {ticks.map((t, i) => (
            <View
              key={`grid_${t}_${i}`}
              style={[
                styles.cashflowGridLine,
                { bottom: labelH + (t / top) * plotH },
              ]}
            />
          ))}

          <View style={{ flexDirection: "row", height: plotH + labelH }}>
            {months.map((m, i) => {
              const incH = safeIncome[i] > 0 ? Math.max(3, (safeIncome[i] / top) * plotH) : 0;
              const expH = safeExpenses[i] > 0 ? Math.max(3, (safeExpenses[i] / top) * plotH) : 0;

              return (
                <View key={`${m}_${i}`} style={{ width: colWidth }}>
                  <View style={styles.cashflowBars}>
                    {incH > 0 && (
                      <View
                        style={[
                          styles.cashflowBar,
                          { height: incH, width: barWidth, backgroundColor: C.success },
                        ]}
                      />
                    )}
                    {expH > 0 && (
                      <View
                        style={[
                          styles.cashflowBar,
                          { height: expH, width: barWidth, backgroundColor: C.error },
                        ]}
                      />
                    )}
                  </View>

                  <Text style={styles.cashflowMonthLabel} numberOfLines={1}>
                    {m}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Member shares
// ─────────────────────────────────────────────────────────────────────────

function MemberSharesChart({
  data,
}: {
  data: { name: string; population: number; color: string }[];
}) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const total = data.reduce((s, d) => s + d.population, 0) || 1;

  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => {
        const pct = (d.population / total) * 100;

        return (
          <View key={i}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <Text
                style={{ fontSize: 12, fontWeight: "600", color: C.text2, flex: 1, minWidth: 0 }}
                numberOfLines={1}
              >
                {d.name}
              </Text>

              <Text style={{ fontSize: 12, fontWeight: "700", color: d.color, flexShrink: 0 }}>
                {pct.toFixed(0)}%
              </Text>
            </View>

            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: C.border,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: "100%" as any,
                  width: `${pct}%` as any,
                  backgroundColor: d.color,
                  borderRadius: 4,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Category chart
// ─────────────────────────────────────────────────────────────────────────

function CategoryBarChart({
  labels,
  values,
  color,
}: {
  labels: string[];
  values: number[];
  color: string;
}) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const safeValues = values.map((v) =>
    Number.isFinite(v) ? Math.max(0, v) : 0
  );
  const max = Math.max(1, ...safeValues);
  const chartWidth = Math.max(280, labels.length * 62);
  const plotHeight = 140;

  return (
    <View style={styles.categoryChartWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ minWidth: "100%" }}
      >
        <View style={{ width: chartWidth }}>
          <View style={styles.categoryAxisLabels}>
            <Text style={styles.categoryAxisText}>
              {Math.round(max).toLocaleString()}
            </Text>
            <Text style={styles.categoryAxisText}>
              {Math.round(max / 2).toLocaleString()}
            </Text>
            <Text style={styles.categoryAxisText}>0</Text>
          </View>

          <View style={[styles.categoryPlot, { height: plotHeight }]}>
            {labels.map((label, i) => {
              const ratio = max > 0 ? safeValues[i] / max : 0;
              const height = ratio > 0 ? Math.max(3, ratio * plotHeight) : 0;

              return (
                <View
                  key={`${label}-${i}`}
                  style={styles.categoryBarColumn}
                >
                  <View style={styles.categoryBarArea}>
                    {height > 0 && (
                      <View
                        style={[
                          styles.categoryBar,
                          { height, backgroundColor: color },
                        ]}
                      />
                    )}
                  </View>

                  <Text
                    style={styles.categoryBarLabel}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Responsive dropdown
// ─────────────────────────────────────────────────────────────────────────

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <TouchableOpacity
        style={styles.dropdownTrigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.dropdownLabel} numberOfLines={1}>
            {label}
          </Text>

          <Text style={styles.dropdownValue} numberOfLines={1}>
            {selected?.label ?? label}
          </Text>
        </View>

        <Text style={styles.dropdownChevron}>▼</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === "web" ? "fade" : "slide"}
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />

          <View style={styles.dropdownModal}>
            <View style={styles.dropdownModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dropdownModalTitle}>{label}</Text>
                <Text style={styles.dropdownModalSubtitle}>Select an option</Text>
              </View>

              <TouchableOpacity style={styles.dropdownClose} onPress={() => setOpen(false)}>
                <Text style={styles.dropdownCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ maxHeight: Platform.OS === "web" ? 420 : 420 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {options.map((option) => {
                const active = option.value === value;

                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.dropdownRadio, active && styles.dropdownRadioActive]}>
                      {active ? <View style={styles.dropdownRadioDot} /> : null}
                    </View>

                    <Text
                      style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}
                      numberOfLines={2}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Advanced filter modal
// ─────────────────────────────────────────────────────────────────────────

function StatusChipRow({
  value,
  options,
  onChange,
  scroll = false,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  scroll?: boolean;
}) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const chips = options.map((opt) => {
    const active = opt.value === value;
    return (
      <TouchableOpacity
        key={opt.value}
        style={[styles.statusChip, active && styles.statusChipActive]}
        onPress={() => onChange(opt.value)}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.statusChipText, active && styles.statusChipTextActive]}
          numberOfLines={1}
        >
          {opt.label}
        </Text>
      </TouchableOpacity>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowScroll}
      >
        {chips}
      </ScrollView>
    );
  }

  return <View style={styles.chipRow}>{chips}</View>;
}

function FilterModal({
  visible,
  onClose,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  loanStatus,
  contributionStatus,
  onLoanStatusChange,
  onContributionStatusChange,
  memberStatus,
  onMemberStatusChange,
  lateFeeSource,
  onLateFeeSourceChange,
  earningsSource,
  onEarningsSourceChange,
  onApply,
  searchTerm,
  onSearchChange,
  onClear,
  activeFilterCount,
}: any) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  return (
    <BottomModal visible={visible} onClose={onClose} title="Advanced Filters">
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
      >
        <Text style={styles.modalIntro}>
          Every filter below narrows the same list further — a record has
          to match ALL of the ones you set, not just one.
        </Text>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Search</Text>
          <Input
            value={searchTerm}
            onChangeText={onSearchChange}
            placeholder="Search by member, ID, description..."
            leftIcon="🔍"
          />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Time Period</Text>
          <Text style={styles.filterSectionHelp}>
            Set a custom range to look at a specific window. This replaces
            the "Month" quick-filter on the main screen while it's active —
            clear both dates below to go back to using that instead.
          </Text>

          <DatePicker label="From Date" value={fromDate} onChange={onFromDateChange} placeholder="Start date" />
          <DatePicker label="To Date" value={toDate} onChange={onToDateChange} placeholder="End date" />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Loan Status</Text>
          <Text style={styles.filterSectionHelp}>Only affects the Loans report tab.</Text>
          <StatusChipRow value={loanStatus} options={LOAN_STATUS_CHIPS} onChange={onLoanStatusChange} />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Contribution Status</Text>
          <Text style={styles.filterSectionHelp}>Only affects the Contributions report tab.</Text>
          <StatusChipRow
            value={contributionStatus}
            options={CONTRIBUTION_STATUS_CHIPS}
            onChange={onContributionStatusChange}
          />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Late Fee Source</Text>
          <Text style={styles.filterSectionHelp}>
            Only affects the Late Fees report tab. Pick whether to see
            fees from missed contributions, overdue loan installments,
            meeting attendance penalties, or any combination.
          </Text>
          <StatusChipRow
            value={lateFeeSource}
            options={LATE_FEE_SOURCE_CHIPS}
            onChange={onLateFeeSourceChange}
          />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Profit Source</Text>
          <Text style={styles.filterSectionHelp}>
            Only affects the Profits report tab. Filter by where the
            earning came from — loan interest, late fees, investment
            returns, or the remaining category. Applies to both actual
            and projected rows.
          </Text>
          <StatusChipRow
            value={earningsSource}
            options={EARNINGS_SOURCE_CHIPS}
            onChange={onEarningsSourceChange}
          />
        </View>

        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Member Condition</Text>
          <Text style={styles.filterSectionHelp}>
            Show only members matching one condition below — grouped by
            what kind of issue it is. Pick "All members" to remove this
            filter.
          </Text>

          <TouchableOpacity
            style={[styles.conditionCard, memberStatus === "all" && styles.conditionCardActive]}
            onPress={() => onMemberStatusChange("all")}
            activeOpacity={0.7}
          >
            <View style={[styles.conditionRadio, memberStatus === "all" && styles.conditionRadioActive]}>
              {memberStatus === "all" ? <View style={styles.conditionRadioDot} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.conditionCardTitle}>All members</Text>
              <Text style={styles.conditionCardDesc}>No member condition applied</Text>
            </View>
          </TouchableOpacity>

          {MEMBER_CONDITION_GROUPS.map((group) => (
            <View key={group.groupLabel} style={{ marginTop: 12 }}>
              <Text style={styles.conditionGroupLabel}>{group.groupLabel}</Text>

              {group.options.map((opt) => {
                const active = memberStatus === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.conditionCard, active && styles.conditionCardActive]}
                    onPress={() => onMemberStatusChange(opt.value)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.conditionRadio, active && styles.conditionRadioActive]}>
                      {active ? <View style={styles.conditionRadioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.conditionCardTitle}>{opt.label}</Text>
                      <Text style={styles.conditionCardDesc}>{opt.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.modalButtonRow}>
          <TouchableOpacity style={styles.modalClearBtn} onPress={onClear}>
            <Text style={styles.modalClearBtnText}>Clear All</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.modalApplyBtn} onPress={onApply}>
            <Text style={styles.modalApplyBtnText}>
              Apply Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </BottomModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const { width } = useWindowDimensions();

  const isWide = width >= 1024;
  const isMobile = width < 600;

  const group = useActiveGroup();
  const allMembers = useGroupMembers();
  const allLoans = useGroupLoans();
  const allContributions = useGroupContributions();
  const allInvestments = useGroupInvestments();
  const allWallet = useGroupWallet();
  const allMeetings = useGroupMeetings();
  const permissions = useCurrentMemberPermissions();
  const currentMember = useCurrentMember();
  const canSeeAll = useIsGroupView();

  const isGroupViewHeader = useIsGroupView();
  const isPersonalView = !isGroupViewHeader || !canSeeAll;

  const { show, visible, msg, type } = useToast();

  const [category, setCategory] = useState<Category>("contributions");

  const [monthFilter, setMonthFilter] = useState("all");
  const [memberIdFilter, setMemberIdFilter] = useState("all");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFromDate, setSelectedFromDate] = useState("");
  const [selectedToDate, setSelectedToDate] = useState("");

  const [loanStatus, setLoanStatus] = useState<
    "all" | "pending" | "active" | "repaid"
  >("all");

  const [contributionStatus, setContributionStatus] = useState<
    "all" | "approved" | "pending" | "rejected"
  >("all");

  const [memberStatusFilter, setMemberStatusFilter] =
    useState<MemberStatusFilter>("all");

  const [lateFeeSourceFilter, setLateFeeSourceFilter] =
    useState<LateFeeSourceFilter>("all");

  const [earningsMode, setEarningsMode] = useState<EarningsViewMode>("all");

  const [earningsSourceFilter, setEarningsSourceFilter] =
    useState<EarningsSourceFilter>("all");

  const [tempSearch, setTempSearch] = useState("");
  const [tempFromDate, setTempFromDate] = useState("");
  const [tempToDate, setTempToDate] = useState("");
  const [tempLoanStatus, setTempLoanStatus] = useState<typeof loanStatus>("all");
  const [tempContributionStatus, setTempContributionStatus] =
    useState<typeof contributionStatus>("all");
  const [tempMemberStatus, setTempMemberStatus] =
    useState<MemberStatusFilter>("all");
  const [tempLateFeeSource, setTempLateFeeSource] =
    useState<LateFeeSourceFilter>("all");
  const [tempEarningsSource, setTempEarningsSource] =
    useState<EarningsSourceFilter>("all");

  const scrollRef = useRef<ScrollView>(null);
  const activityY = useRef(0);

  // "all" = no year filter (aggregate every year), otherwise the picked year.
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [contributionTypeFilter, setContributionTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    if (isPersonalView) {
      setMemberIdFilter("all");
    }
  }, [isPersonalView]);

  // ───────────────────────────────────────────────────────────────────────
  // Scope
  // ───────────────────────────────────────────────────────────────────────

  const myIds = useMyMemberIds();

  const members = isPersonalView
    ? allMembers.filter(
        (m) =>
          myIds.has(m.id) ||
          myIds.has((m as any).userId),
      )
    : allMembers;

  const loans = isPersonalView
    ? allLoans.filter(
        (l) =>
          myIds.has(l.memberId) ||
          myIds.has((l as any).userId),
      )
    : allLoans;

  const contributions = isPersonalView
    ? allContributions.filter(
        (c) =>
          myIds.has(c.memberId) ||
          myIds.has((c as any).userId),
      )
    : allContributions;

  const investments = isPersonalView
    ? allInvestments.filter(
        (i: any) =>
          myIds.has(i.createdBy) ||
          myIds.has(i.memberId) ||
          myIds.has(i.userId),
      )
    : allInvestments;

  const wallet = isPersonalView
    ? allWallet.filter(
        (t) =>
          (t.memberId && myIds.has(t.memberId)) ||
          myIds.has((t as any).userId),
      )
    : allWallet;

  // ───────────────────────────────────────────────────────────────────────
  // Year scoping — header Year dropdown narrows the entire page.
  // When the picker is set to "all", no year filter is applied.
  // ───────────────────────────────────────────────────────────────────────
  const inYear = (dateStr?: string) => {
    if (year === "all") return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return String(d.getFullYear()) === year;
  };

  const walletYr = useMemo(
    () => wallet.filter((t) => inYear(t.date)),
    [wallet, year],
  );

  const loansYr = useMemo(
    () => loans.filter((l) => inYear(l.applicationDate)),
    [loans, year],
  );

  const contributionsYr = useMemo(
    () => contributions.filter((c) => inYear(c.date)),
    [contributions, year],
  );

  const allWalletYr = useMemo(
    () => allWallet.filter((t) => inYear(t.date)),
    [allWallet, year],
  );

  const allLoansYr = useMemo(
    () => allLoans.filter((l) => inYear(l.applicationDate)),
    [allLoans, year],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Filters
  // ───────────────────────────────────────────────────────────────────────

  const handleMonthChange = (mk: string) => {
    setMonthFilter(mk);

    if (mk === "all") {
      setSelectedFromDate("");
      setSelectedToDate("");
    } else {
      const { from, to } = monthBounds(mk);
      setSelectedFromDate(from);
      setSelectedToDate(to);
    }
  };

  const openFilterModal = () => {
    setTempSearch(searchTerm);
    setTempFromDate(selectedFromDate);
    setTempToDate(selectedToDate);
    setTempLoanStatus(loanStatus);
    setTempContributionStatus(contributionStatus);
    setTempMemberStatus(memberStatusFilter);
    setTempLateFeeSource(lateFeeSourceFilter);
    setTempEarningsSource(earningsSourceFilter);
    setShowFilterModal(true);
  };

  const applyFilters = () => {
    setSearchTerm(tempSearch);
    setSelectedFromDate(tempFromDate);
    setSelectedToDate(tempToDate);
    setLoanStatus(tempLoanStatus);
    setContributionStatus(tempContributionStatus);
    setMemberStatusFilter(tempMemberStatus);
    setLateFeeSourceFilter(tempLateFeeSource);
    setEarningsSourceFilter(tempEarningsSource);
    setMonthFilter("all");
    setShowFilterModal(false);
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setSelectedFromDate("");
    setSelectedToDate("");
    setLoanStatus("all");
    setContributionStatus("all");
    setMonthFilter("all");
    setMemberIdFilter("all");
    setMemberStatusFilter("all");
    setLateFeeSourceFilter("all");
    setEarningsSourceFilter("all");
    setContributionTypeFilter("all");

    setTempSearch("");
    setTempFromDate("");
    setTempToDate("");
    setTempLoanStatus("all");
    setTempContributionStatus("all");
    setTempMemberStatus("all");
    setTempLateFeeSource("all");
    setTempEarningsSource("all");
  };

  const hasActiveFilters =
    selectedFromDate !== "" ||
    selectedToDate !== "" ||
    loanStatus !== "all" ||
    contributionStatus !== "all" ||
    searchTerm !== "" ||
    memberIdFilter !== "all" ||
    memberStatusFilter !== "all" ||
    lateFeeSourceFilter !== "all" ||
    earningsSourceFilter !== "all" ||
    contributionTypeFilter !== "all";

  const appliedFilterCount =
    countActiveFilters({
      search: searchTerm,
      fromDate: selectedFromDate,
      toDate: selectedToDate,
      loanStatus,
      contributionStatus,
      memberStatus: memberStatusFilter,
      lateFeeSource: lateFeeSourceFilter,
      earningsSource: earningsSourceFilter,
      contributionType: contributionTypeFilter,
    }) + (memberIdFilter !== "all" ? 1 : 0);

  const inDateRange = (dStr?: string) => {
    if (!dStr) return true;
    const d = dStr.slice(0, 10);

    if (year !== "all" && d.slice(0, 4) !== year) return false;

    if (selectedFromDate && d < selectedFromDate) return false;
    if (selectedToDate && d > selectedToDate) return false;
    return true;
  };

  const inMember = (id?: string) => memberIdFilter === "all" || id === memberIdFilter;

  const matchesSearch = (item: any, fields: string[]) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();

    if (fields.some((field) => item[field]?.toString().toLowerCase().includes(term))) {
      return true;
    }

    const name = item.memberName ?? (item.memberId ? getMemberName(item.memberId) : "");
    return !!name && String(name).toLowerCase().includes(term);
  };

  const getMemberName = (id?: string) =>
    allMembers.find((m) => m.id === id)?.fullName ?? "Unknown";

  // ───────────────────────────────────────────────────────────────────────
  // Late fees (contributions)
  // ───────────────────────────────────────────────────────────────────────

  const overdue = useMemo(() => {
    if (!group) return [];
    return findOverdueContributions(group, allMembers, allContributions, allWallet);
  }, [group, allMembers, allContributions, allWallet]);

  const lateFees = useMemo(() => {
    return overdue
      .map((item: any) => {
        const tx = allWallet.find((t) => t.id === item.feeTxId && t.type === "late_fee");
        return { ...item, isPaid: !!tx?.feePaid };
      })
      .filter((item: any) =>
        isPersonalView
          ? myIds.has(item.memberId) || myIds.has((item as any).userId)
          : true,
      );
  }, [overdue, allWallet, isPersonalView, myIds]);

  // ───────────────────────────────────────────────────────────────────────
  // Overdue loans
  // ───────────────────────────────────────────────────────────────────────

  const overdueLoans = useMemo(() => {
    if (!group) return [];

    try {
      return findOverdueInstallments(group, allMembers, allLoans, allWallet) || [];
    } catch (e) {
      console.error("[Reports] findOverdueInstallments failed:", e);
      return [];
    }
  }, [group, allMembers, allLoans, allWallet]);

  const lateLoanMemberIds = useMemo(
    () => new Set(overdueLoans.map((item: any) => item.memberId)),
    [overdueLoans]
  );

  const loanLateFeesList = useMemo(() => {
    return overdueLoans
      .map((item: any) => {
        const tx = allWallet.find((t) => t.id === item.feeTxId && t.type === "late_fee");
        return {
          ...item,
          type: "loan" as const,
          periodStart: item.dueDate,
          periodLabel: `Loan Inst #${item.installmentIndex + 1}`,
          isPaid: !!tx?.feePaid,
        };
      })
      .filter((item: any) =>
        isPersonalView
          ? myIds.has(item.memberId) || myIds.has((item as any).userId)
          : true,
      );
  }, [overdueLoans, allWallet, isPersonalView, myIds]);

  // ───────────────────────────────────────────────────────────────────
  // Meeting late fees
  // ───────────────────────────────────────────────────────────────────
  const meetingLateFeesList = useMemo(() => {
    const rows: any[] = [];

    for (const meeting of allMeetings) {
      if (meeting.status === "cancelled") continue;

      const attendees = meeting.attendees ?? [];
      for (const attendee of attendees) {
        const amt = attendee.penaltyAmount ?? 0;
        if (amt <= 0) continue;

        const member = allMembers.find((m) => m.id === attendee.memberId);

        rows.push({
          type: "meeting" as const,
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          meetingDate: meeting.date,
          memberId: attendee.memberId,
          memberName: member?.fullName ?? "Unknown",
          periodStart: meeting.date,
          dueDate: meeting.date,
          periodLabel: `${meeting.title} · ${fmtDate(meeting.date)}`,
          daysLate: 0,
          attendanceStatus:
            attendee.status ?? (attendee.attended ? "present" : "absent"),
          lateMinutes: attendee.lateMinutes ?? 0,
          feeAmount: amt,
          isPaid: !!attendee.penaltyPaid,
        });
      }
    }

    return isPersonalView
      ? rows.filter((r) => myIds.has(r.memberId))
      : rows;
  }, [allMeetings, allMembers, isPersonalView, myIds]);

  const allLateFeesCombined = useMemo(() => {
    const taggedContribFees = lateFees.map((f: any) => ({
      ...f,
      type: "contribution" as const,
    }));
    return [
      ...taggedContribFees,
      ...loanLateFeesList,
      ...meetingLateFeesList,
    ];
  }, [lateFees, loanLateFeesList, meetingLateFeesList]);

  // ───────────────────────────────────────────────────────────────────────
  // Member-status derived sets
  // ───────────────────────────────────────────────────────────────────────

  const unpaidFeeMemberIds = useMemo(
    () => new Set(allLateFeesCombined.filter((f: any) => !f.isPaid).map((f: any) => f.memberId)),
    [allLateFeesCombined]
  );

  const lateContributionFeeMemberIds = useMemo(
    () =>
      new Set(
        lateFees
          .filter((f: any) => !f.isPaid && (f.daysLate ?? 0) > 0)
          .map((f: any) => f.memberId)
      ),
    [lateFees]
  );

  const noContributionMemberIds = useMemo(() => {
    const contributingIds = new Set(
      contributions
        .filter((c) => c.status === "approved" && inDateRange(c.date))
        .map((c) => c.memberId)
    );

    return new Set(
      members
        .filter((m) => m.status === "active" && !contributingIds.has(m.id))
        .map((m) => m.id)
    );
  }, [contributions, members, selectedFromDate, selectedToDate, year]);

  const noLoanMemberIds = useMemo(() => {
    const borrowerIds = new Set(loans.map((l) => l.memberId));

    return new Set(
      members
        .filter((m) => m.status === "active" && !borrowerIds.has(m.id))
        .map((m) => m.id)
    );
  }, [loans, members]);

  const memberStatusSetFor = (status: MemberStatusFilter): Set<string> | null => {
    switch (status) {
      case "has_unpaid_fees":
        return unpaidFeeMemberIds;
      case "late_contribution_fees":
        return lateContributionFeeMemberIds;
      case "late_loans":
        return lateLoanMemberIds;
      case "no_contributions_in_period":
        return noContributionMemberIds;
      case "no_loans":
        return noLoanMemberIds;
      default:
        return null;
    }
  };

  const memberStatusSet = memberStatusSetFor(memberStatusFilter);

  const passesMemberStatus = (id?: string) =>
    !memberStatusSet || (!!id && memberStatusSet.has(id));

  const isNoActivityMemberView =
    (category === "contributions" &&
      memberStatusFilter === "no_contributions_in_period") ||
    (category === "loans" && memberStatusFilter === "no_loans");

  // ───────────────────────────────────────────────────────────────────────
  // Overview financial calculations
  // ───────────────────────────────────────────────────────────────────────

  // Expenses (bank_fee / other_debit) are deliberately NOT here —
  // they are debits, not earnings, and belong on the Expenses tab
  // via groupExpenses below, not in a "wallet earnings" total.
  const EARNING_TYPES_OVERVIEW = [
    "loan_interest_income",
    "interest",
    "late_fee",
    "investment_return",
    "other_credit",
  ];

  const groupWalletEarnings = useMemo(
    () =>
      round2(
        walletYr.reduce((sum, t) => {
          if (t.type === "loan_repayment") {
            const loan = loansYr.find((l) => l.id === t.loanId);
            if (!loan?.totalRepayable) return sum;
            return sum + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
          }

          if (EARNING_TYPES_OVERVIEW.includes(t.type)) {
            return sum + t.amount;
          }

          return sum;
        }, 0)
      ),
    [walletYr, loansYr]
  );

  const groupExpenses = useMemo(
    () =>
      walletYr
        .filter((t) => ["bank_fee", "other_debit"].includes(t.type))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [walletYr]
  );

  const groupInterestOnly = useMemo(
    () =>
      round2(
        walletYr.reduce((sum, t) => {
          if (t.type === "loan_repayment") {
            const loan = loansYr.find((l) => l.id === t.loanId);
            if (!loan?.totalRepayable) return sum;
            return sum + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
          }

          if ((t.type === "loan_interest_income" || t.type === "interest") && t.amount > 0) {
            return sum + t.amount;
          }

          return sum;
        }, 0)
      ),
    [walletYr, loansYr]
  );

  const groupContributionsOnly = useMemo(
    () =>
      round2(
        walletYr
          .filter((t) => t.type === "contribution" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [walletYr]
  );

  const groupPenaltiesOnly = useMemo(
    () =>
      round2(
        walletYr
          .filter((t) => t.type === "late_fee" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [walletYr]
  );

  const appliedUnpaidLoanLateFees = useMemo(
    () =>
      round2(
        walletYr
          .filter(
            (t) =>
              t.type === "late_fee" &&
              typeof t.id === "string" &&
              t.id.startsWith("late-fee-loan-") &&
              !(t as any).feePaid &&
              !(t as any).deletedAt
          )
          .reduce((s, t) => s + Math.abs(t.amount || 0), 0)
      ),
    [walletYr]
  );

  const groupContributionAndMeetingFees = useMemo(
    () =>
      round2(
        walletYr
          .filter(
            (t) =>
              t.type === "late_fee" &&
              t.amount > 0 &&
              !(typeof t.id === "string" &&
                t.id.startsWith("late-fee-loan-")) &&
              !t.loanId
          )
          .reduce((s, t) => s + t.amount, 0)
      ),
    [walletYr]
  );

  const groupInvestmentReturnsOnly = useMemo(
    () =>
      round2(
        walletYr
          .filter((t) => t.type === "investment_return" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [walletYr]
  );

  const groupTotalLoansDisbursed = useMemo(
    () =>
      round2(
        loansYr
          .filter((l) => l.status === "disbursed")
          .reduce((s, l) => s + (l.amount || 0), 0)
      ),
    [loansYr]
  );

  const groupTotalInvestments = useMemo(
    () =>
      round2(
        investments.reduce(
          (s: number, i: any) => s + (i.investmentAmount || 0),
          0
        )
      ),
    [investments]
  );

  const groupOtherOnly = useMemo(() => {
    // bank_fee and other_debit are expenses — they are tracked
    // separately in groupExpenses and must not fall through into
    // the "Other" bucket on the Profits view.
    const known = [
      "contribution",
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "loan_disbursement",
      "loan_repayment",
      "loan_principal_recovery",
      "bank_fee",
      "other_debit",
    ];

    return round2(
      walletYr.filter((t) => !known.includes(t.type)).reduce((s, t) => s + t.amount, 0)
    );
  }, [walletYr]);

  const groupTotalNetAssets = useMemo(
    () => round2(walletYr.reduce((s, t) => s + t.amount, 0)),
    [walletYr]
  );

  const groupAccruedInterestUnpaid = useMemo(
    () =>
      round2(
        loans
          .filter(
            (l) =>
              l.status === "disbursed" &&
              l.interestMethod === "reducing_balance" &&
              inMember(l.memberId) &&
              passesMemberStatus(l.memberId),
          )
          .reduce((sum, loan) => {
            const acc = computeTodayAccrued(loan);
            return sum + (acc?.total ?? 0);
          }, 0),
      ),
    [loans, memberIdFilter, memberStatusFilter]
  );

  const loanInterestProjections = useMemo(() => {
    const fromDate = selectedFromDate || "";
    const toDate = selectedToDate || "";

    return loans
      .filter(
        (l) =>
          l.status === "disbursed" &&
          inMember(l.memberId) &&
          passesMemberStatus(l.memberId)
      )
      .map((loan) => ({
        loanId: loan.id,
        memberId: loan.memberId,
        memberName: getMemberName(loan.memberId),
        amount: loan.amount,
        projectedInterest: calculateLoanInterestProjection(loan, fromDate, toDate),
        applicationDate: loan.applicationDate,
      }))
      .filter((item) => item.projectedInterest > 0);
  }, [loans, selectedFromDate, selectedToDate, memberIdFilter, memberStatusFilter]);

  const projectedLoanInterest = round2(
    loanInterestProjections.reduce((sum, item) => sum + item.projectedInterest, 0)
  );

  const loanLateFees = useMemo(() => {
    if (!group) return [];

    const fromDate = selectedFromDate || "";
    const toDate = selectedToDate || "";
    const asOfDate = toDate ? new Date(toDate) : new Date();

    try {
      const overdueInstallments =
        findOverdueInstallments(group, allMembers, allLoans, allWallet, asOfDate) || [];

      return overdueInstallments
        .filter(
          (item: any) =>
            inMember(item.memberId) &&
            passesMemberStatus(item.memberId) &&
            (!fromDate || item.dueDate >= fromDate)
        )
        .map((item: any) => ({
          loanId: item.loanId,
          memberId: item.memberId,
          memberName: item.memberName,
          installmentIndex: item.installmentIndex,
          dueDate: item.dueDate,
          amountDue: item.amountDue,
          daysLate: item.daysLate,
          feeAmount: item.feeAmount,
        }));
    } catch (e) {
      console.error("[Reports] loan late fees calculation failed:", e);
      return [];
    }
  }, [
    group,
    allMembers,
    allLoans,
    allWallet,
    selectedFromDate,
    selectedToDate,
    memberIdFilter,
    memberStatusFilter,
  ]);

  const projectedLoanLateFees = round2(
    loanLateFees.reduce((sum, item) => sum + item.feeAmount, 0)
  );

  const projectedLoanInterestAll = useMemo(() => {
    const fromDate = selectedFromDate || "";
    const toDate = selectedToDate || "";
    return round2(
      allLoans
        .filter((l) => l.status === "disbursed")
        .reduce(
          (sum, loan) =>
            sum + calculateLoanInterestProjection(loan, fromDate, toDate),
          0,
        ),
    );
  }, [allLoans, selectedFromDate, selectedToDate]);

  const projectedLoanLateFeesAll = useMemo(() => {
    if (!group) return 0;

    const fromDate = selectedFromDate || "";
    const toDate = selectedToDate || "";
    const asOfDate = toDate ? new Date(toDate) : new Date();

    try {
      const overdue =
        findOverdueInstallments(
          group,
          allMembers,
          allLoans,
          allWallet,
          asOfDate,
        ) || [];
      return round2(
        overdue
          .filter((item: any) => !fromDate || item.dueDate >= fromDate)
          .reduce((s, o) => s + (o.feeAmount || 0), 0),
      );
    } catch (e) {
      console.error("[reports] projectedLoanLateFeesAll failed:", e);
      return 0;
    }
  }, [
    group,
    allMembers,
    allLoans,
    allWallet,
    selectedFromDate,
    selectedToDate,
  ]);

  const groupLoanLateFeesOwed = useMemo(() => {
    if (!group) return 0;

    const scopedLoans = isPersonalView
      ? allLoans.filter(
          (l) =>
            myIds.has(l.memberId) ||
            myIds.has((l as any).userId),
        )
      : allLoans;

    const visibleLoanIds = new Set(scopedLoans.map((l) => l.id));

    let accruedTotal = 0;
    try {
      const overdue =
        findOverdueInstallments(
          group,
          allMembers,
          scopedLoans,
          allWallet,
        ) || [];
      accruedTotal = overdue.reduce(
        (sum, o) => sum + (o.feeAmount || 0),
        0,
      );
    } catch (e) {
      console.error(
        "[reports] findOverdueInstallments failed:",
        e,
      );
    }

    const appliedTotal = allWallet
      .filter(
        (t) =>
          t.type === "late_fee" &&
          !!t.loanId &&
          visibleLoanIds.has(t.loanId) &&
          !(t as any).feePaid &&
          !(t as any).deletedAt,
      )
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return round2(accruedTotal + appliedTotal);
  }, [
    group,
    allMembers,
    allLoans,
    allWallet,
    myIds,
    isPersonalView,
  ]);

  const totalProjectedEarnings = round2(
    projectedLoanInterest + projectedLoanLateFees
  );

  const groupInterestAllTime = useMemo(
    () =>
      round2(
        allWalletYr.reduce((sum, t) => {
          if (t.type === "loan_repayment") {
            const loan = allLoansYr.find((l) => l.id === t.loanId);
            if (!loan?.totalRepayable) return sum;
            return (
              sum +
              round2(t.amount * (loan.totalInterest / loan.totalRepayable))
            );
          }
          if (
            (t.type === "loan_interest_income" ||
              t.type === "interest") &&
            t.amount > 0
          ) {
            return sum + t.amount;
          }
          return sum;
        }, 0)
      ),
    [allWalletYr, allLoansYr]
  );

  const activeMemberCount = useMemo(
    () =>
      Math.max(
        1,
        allMembers.filter((m) => m.status === "active").length
      ),
    [allMembers]
  );

  const slice = (groupValue: number) =>
    isPersonalView ? round2(groupValue / activeMemberCount) : groupValue;

  const donutScale = isPersonalView ? 1 / activeMemberCount : 1;

  const donutLoanInterest = round2(groupInterestAllTime * donutScale);

  const donutLateFees = useMemo(
    () =>
      round2(
        allWalletYr
          .filter((t) => t.type === "late_fee" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0) * donutScale
      ),
    [allWalletYr, donutScale]
  );

  const donutInvestmentReturns = useMemo(
    () =>
      round2(
        allWalletYr
          .filter(
            (t) => t.type === "investment_return" && t.amount > 0
          )
          .reduce((s, t) => s + t.amount, 0) * donutScale
      ),
    [allWalletYr, donutScale]
  );

  const donutAccruedUnpaid = useMemo(
    () =>
      round2(
        allLoans
          .filter(
            (l) =>
              l.status === "disbursed" &&
              l.interestMethod === "reducing_balance"
          )
          .reduce((sum, loan) => {
            const acc = computeTodayAccrued(loan);
            return sum + (acc?.total ?? 0);
          }, 0) * donutScale
      ),
    [allLoans, donutScale]
  );

  const donutProjectedInterest = useMemo(
    () =>
      round2(
        allLoans
          .filter((l) => l.status === "disbursed")
          .reduce(
            (sum, loan) =>
              sum +
              calculateLoanInterestProjection(loan, "", ""),
            0
          ) * donutScale
      ),
    [allLoans, donutScale]
  );

  const donutProjectedLateFees = useMemo(
    () =>
      round2(
        (overdueLoans || []).reduce(
          (s, o) => s + (o.feeAmount || 0),
          0
        ) * donutScale
      ),
    [overdueLoans, donutScale]
  );

  const donutOther = useMemo(
    () => {
      // See groupOtherOnly — bank_fee / other_debit are expenses
      // and must not appear as a "Profits by source" segment.
      const known = [
        "contribution",
        "loan_interest_income",
        "interest",
        "late_fee",
        "investment_return",
        "loan_disbursement",
        "loan_repayment",
        "loan_principal_recovery",
        "bank_fee",
        "other_debit",
      ];
      return round2(
        allWalletYr
          .filter((t) => !known.includes(t.type))
          .reduce((s, t) => s + t.amount, 0) * donutScale
      );
    },
    [allWalletYr, donutScale]
  );

  const collection = useMemo(() => {
    if (!group) return { pct: 0, collected: 0, expected: 0 };

    const target = group.contributionAmount || 0;
    if (target <= 0) return { pct: 0, collected: 0, expected: 0 };

    const activeCount = allMembers.filter((m) => m.status === "active").length;
    const expected = isPersonalView ? target : target * Math.max(1, activeCount);

    const collected = contributionsYr
      .filter((c) => c.status === "approved" && c.contributionType === "regular")
      .reduce((s, c) => s + (c.amount || 0), 0);

    return {
      pct: expected > 0 ? Math.min(999, Math.round((collected / expected) * 100)) : 0,
      collected: round2(collected),
      expected: round2(expected),
    };
  }, [group, allMembers, contributionsYr, isPersonalView]);

  const collectionRatePct = collection.pct;

  // When year === "all", the cashflow chart falls back to the current year
  // (the chart is a single Jan–Dec view; a full multi-year plot would need
  // a different axis).
  const cashflowYearValue =
    year === "all" ? new Date().getFullYear() : Number(year) || new Date().getFullYear();

  const cashflow = useMemo(() => {
    const y = cashflowYearValue;

    const months = Array.from({ length: 12 }, (_, i) =>
      new Date(y, i, 1).toLocaleDateString("en", { month: "short" })
    );
    const income: number[] = Array(12).fill(0);
    const expenses: number[] = Array(12).fill(0);

    wallet.forEach((t) => {
      const d = new Date(t.date);
      if (isNaN(d.getTime()) || d.getFullYear() !== y) return;

      const m = d.getMonth();
      if (t.amount > 0) income[m] += t.amount;
      else if (t.amount < 0) expenses[m] += Math.abs(t.amount);
    });

    return { months, income, expenses };
  }, [wallet, cashflowYearValue]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>([String(new Date().getFullYear())]);

    wallet.forEach((t) => {
      const d = new Date(t.date);
      if (!isNaN(d.getTime())) years.add(String(d.getFullYear()));
    });

    return [
      { label: "All Years", value: "all" },
      ...Array.from(years)
        .sort()
        .reverse()
        .map((y) => ({ label: y, value: y })),
    ];
  }, [wallet]);

  const memberPie = useMemo(() => {
    const top = members
      .filter((m) => m.status === "active" && m.totalContributions > 0)
      .slice(0, 5);

    const palette = [C.accent, C.gold, C.info, C.success, C.purple];

    return top.map((m, i) => ({
      name: m.fullName.split(" ")[0],
      population: m.totalContributions,
      color: palette[i % palette.length],
    }));
  }, [members, C]);

  const monthOptions = useMemo(() => {
    const dateFieldByCat: Record<Category, string> = {
      contributions: "date",
      loans: "applicationDate",
      latefees: "periodStart",
      members: "dateJoined",
      expenses: "date",
      investments: "startDate",
      earnings: "date",
    };

    let source: any[] = [];

    switch (category) {
      case "contributions":
        source = contributions;
        break;
      case "loans":
        source = loans;
        break;
      case "latefees":
        source = allLateFeesCombined;
        break;
      case "members":
        source = members;
        break;
      case "expenses":
        source = wallet.filter((t) => ["bank_fee", "other_debit"].includes(t.type));
        break;
      case "investments":
        source = investments;
        break;
      case "earnings":
        source = wallet;
        break;
    }

    const keys = new Set<string>();

    source.forEach((item) => {
      const k = monthKey(item[dateFieldByCat[category]] ?? item.date);
      if (k) keys.add(k);
    });

    const sorted = Array.from(keys).sort().reverse();

    return [
      { label: "All Months", value: "all" },
      ...sorted.map((k) => ({ label: monthLabel(k), value: k })),
    ];
  }, [category, contributions, loans, allLateFeesCombined, members, wallet, investments]);

  const memberOptions = useMemo(
    () => [
      {
        label: isPersonalView ? "My Records" : "All Members",
        value: "all",
      },

      ...(isPersonalView
        ? []
        : allMembers.map((m) => ({ label: m.fullName, value: m.id }))),
    ],
    [allMembers, isPersonalView]
  );

  const contributionTypeOptions = useMemo(() => {
    const types = new Set<string>();
    contributions.forEach((c: any) => {
      if (c.contributionType) types.add(c.contributionType);
    });

    return [
      { label: "All Types", value: "all" },
      ...Array.from(types)
        .sort()
        .map((v) => ({ label: titleCase(v), value: v })),
    ];
  }, [contributions]);

  // ───────────────────────────────────────────────────────────────────────
  // Category view
  // ───────────────────────────────────────────────────────────────────────

  const view = useMemo(() => {
    if (isNoActivityMemberView) {
      const list = members
        .filter((m) => passesMemberStatus(m.id))
        .filter((m) => matchesSearch(m, ["fullName", "email", "phone"]));

      const isNoLoans = memberStatusFilter === "no_loans";

      return {
        rows: list,
        headers: ["Name", "Phone", "Email", "Status", "Total Contributions", "Joined"],
        toRow: (m: any) => [
          m.fullName,
          m.phone || "",
          m.email || "",
          m.status,
          fmtCurrency(m.totalContributions || 0),
          fmtDate(m.dateJoined),
        ],
        chart: { labels: [], values: [] },
        chartColor: C.gold,
        kpis: [
          {
            label: isNoLoans ? "Members w/ No Loans" : "Members w/ No Contributions",
            value: String(list.length),
          },
          {
            label: "Active Members",
            value: String(members.filter((m) => m.status === "active").length),
          },
        ],
      };
    }

    if (category === "contributions") {
      let list = contributions.filter(
        (c) =>
          inDateRange(c.date) &&
          inMember(c.memberId) &&
          passesMemberStatus(c.memberId)
      );

      if (contributionStatus !== "all") {
        list = list.filter((c) => c.status === contributionStatus);
      }

      if (contributionTypeFilter !== "all") {
        list = list.filter((c) => (c.contributionType ?? "") === contributionTypeFilter);
      }

      list = list.filter((c) =>
        matchesSearch(c, ["memberId", "description", "contributionType"])
      );

      const chart = monthlyTotals(
        list.filter((c) => c.status === "approved"),
        "date",
        "amount"
      );

      return {
        rows: list,
        headers: ["Date", "Member", "Type", "Amount", "Status", "Description"],
        toRow: (c: any) => [
          fmtDate(c.date),
          getMemberName(c.memberId),
          c.contributionType ?? "",
          fmtCurrency(c.amount),
          c.status,
          c.description ?? "",
        ],
        chart,
        chartColor: C.primary,
        kpis: [
          { label: "Total", value: fmtCurrency(list.reduce((s, c) => s + c.amount, 0)) },
          { label: "Records", value: String(list.length) },
        ],
      };
    }

    if (category === "loans") {
      let list = loans.filter(
        (l) =>
          inDateRange(l.applicationDate) &&
          inMember(l.memberId) &&
          passesMemberStatus(l.memberId)
      );

      if (loanStatus !== "all") {
        if (loanStatus === "active") {
          list = list.filter((l) => l.status === "disbursed");
        } else if (loanStatus === "pending") {
          list = list.filter((l) => l.status.startsWith("pending_"));
        } else {
          list = list.filter((l) => l.status === loanStatus);
        }
      }

      list = list.filter((l) => matchesSearch(l, ["memberId", "id", "purpose"]));

      const chart = monthlyTotals(list, "applicationDate", "amount");

      return {
        rows: list,
        headers: ["Member", "Amount", "Repaid", "Balance", "Status", "Applied"],
        toRow: (l: any) => [
          getMemberName(l.memberId),
          fmtCurrency(l.amount),
          fmtCurrency(l.amountRepaid || 0),
          fmtCurrency(l.balance ?? 0),
          l.status,
          fmtDate(l.applicationDate),
        ],
        chart,
        chartColor: C.accent,
        kpis: [
          {
            label: "Total Disbursed",
            value: fmtCurrency(list.reduce((s, l) => s + l.amount, 0)),
          },
          { label: "Records", value: String(list.length) },
        ],
      };
    }

    if (category === "latefees") {
      let list = allLateFeesCombined.filter(
        (f: any) =>
          inDateRange(f.periodStart) &&
          inMember(f.memberId) &&
          passesMemberStatus(f.memberId)
      );

      if (lateFeeSourceFilter !== "all") {
        list = list.filter((f: any) => f.type === lateFeeSourceFilter);
      }

      list = list.filter((f: any) => matchesSearch(f, ["memberId", "periodLabel"]));

      const chart = monthlyTotals(list, "periodStart", "feeAmount");

      const totalContribLateFees = round2(
        list
          .filter((f: any) => f.type === "contribution" && !f.isPaid)
          .reduce((s: number, f: any) => s + (f.feeAmount || 0), 0)
      );

      const totalLoanLateFees = round2(
        list
          .filter((f: any) => f.type === "loan" && !f.isPaid)
          .reduce((s: number, f: any) => s + (f.feeAmount || 0), 0)
      );

      const totalMeetingLateFees = round2(
        list
          .filter((f: any) => f.type === "meeting" && !f.isPaid)
          .reduce((s: number, f: any) => s + (f.feeAmount || 0), 0)
      );

      const totalOwed = round2(
        totalContribLateFees + totalLoanLateFees + totalMeetingLateFees,
      );

      return {
        rows: list,
        headers: ["Member", "Type", "Reference", "Reason", "Fee Amount", "Status"],
        toRow: (f: any) => {
          let reason: string | number = "—";
          if (f.type === "loan" || f.type === "contribution") {
            reason = f.daysNewlyOwed ?? 0;
          } else if (f.type === "meeting") {
            if (f.attendanceStatus === "late" && f.lateMinutes) {
              reason = `Late ${f.lateMinutes} min`;
            } else if (f.attendanceStatus === "absent") {
              reason = "Absent";
            } else {
              reason = f.attendanceStatus ?? "—";
            }
          }
          return [
            getMemberName(f.memberId),
            f.type === "loan"
              ? "Loan"
              : f.type === "meeting"
              ? "Meeting"
              : "Contribution",
            f.periodLabel ?? "—",
            reason,
            fmtCurrency(f.feeAmount || 0),
            f.isPaid ? "Paid" : "Unpaid",
          ];
        },
        chart,
        chartColor: C.error,
        kpis: [
          { label: "Total Late Fees", value: fmtCurrency(totalOwed) },
          { label: "Loan Late Fees", value: fmtCurrency(totalLoanLateFees) },
          { label: "Contrib Late Fees", value: fmtCurrency(totalContribLateFees) },
          { label: "Meeting Fees", value: fmtCurrency(totalMeetingLateFees) },
        ],
      };
    }

    if (category === "members") {
      const list = members
        .filter((m) => passesMemberStatus(m.id))
        .filter((m) => matchesSearch(m, ["fullName", "email", "phone"]));

      return {
        rows: list,
        headers: ["Name", "Phone", "Email", "Role", "Status", "Total Contributions", "Joined"],
        toRow: (m: any) => [
          m.fullName,
          m.phone || "",
          m.email || "",
          m.role,
          m.status,
          fmtCurrency(m.totalContributions || 0),
          fmtDate(m.dateJoined),
        ],
        chart: { labels: [], values: [] },
        chartColor: C.gold,
        kpis: [
          {
            label: "Active Members",
            value: String(list.filter((m) => m.status === "active").length),
          },
          { label: "Total", value: String(list.length) },
        ],
      };
    }

    if (category === "expenses") {
      let list = wallet.filter(
        (t) =>
          ["bank_fee", "other_debit"].includes(t.type) &&
          inDateRange(t.date) &&
          inMember(t.memberId) &&
          passesMemberStatus(t.memberId)
      );

      list = list.filter((t) => matchesSearch(t, ["type", "description"]));

      const chart = monthlyTotals(list, "date", "amount");

      return {
        rows: list,
        headers: ["Date", "Type", "Amount", "Description"],
        toRow: (t: any) => [
          fmtDate(t.date),
          t.type.replace(/_/g, " "),
          fmtCurrency(Math.abs(t.amount || 0)),
          t.description || "",
        ],
        chart,
        chartColor: C.error,
        kpis: [
          {
            label: "Total Expenses",
            value: fmtCurrency(
              list.reduce((s, t) => s + Math.abs(t.amount || 0), 0)
            ),
          },
          { label: "Records", value: String(list.length) },
        ],
      };
    }

    if (category === "investments") {
      let list = investments.filter((i: any) => inDateRange(i.startDate));

      list = list.filter((i: any) => matchesSearch(i, ["investmentName", "type"]));

      const chart = monthlyTotals(list, "startDate", "investmentAmount");

      return {
        rows: list,
        headers: [
          "Investment ID",
          "Name",
          "Amount",
          "Expected Return",
          "Status",
          "Start Date",
          "Maturity Date",
        ],
        toRow: (i: any) => [
          i.id,
          i.investmentName,
          fmtCurrency(i.investmentAmount),
          fmtCurrency(i.expectedReturn || 0),
          i.status,
          fmtDate(i.startDate),
          i.maturityDate ? fmtDate(i.maturityDate) : "",
        ],
        chart,
        chartColor: C.success,
        kpis: [
          {
            label: "Total Invested",
            value: fmtCurrency(
              list.reduce((s: number, i: any) => s + (i.investmentAmount || 0), 0)
            ),
          },
          { label: "Records", value: String(list.length) },
        ],
      };
    }

    // Earnings tab
    // Expenses are shown on the Expenses tab, not here. Dropping
    // bank_fee / other_debit from this list keeps negative debits
    // out of the earnings rows and out of every earnings total
    // derived from this list.
    const EARNING_TYPES = [
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "other_credit",
    ];

    const earningAmount = (t: any) => {
      if (t.type !== "loan_repayment") return t.amount;

      const loan = loans.find((l) => l.id === t.loanId);
      if (!loan?.totalRepayable) return 0;

      return round2(t.amount * (loan.totalInterest / loan.totalRepayable));
    };

    let list = wallet.filter(
      (t) =>
        (EARNING_TYPES.includes(t.type) || t.type === "loan_repayment") &&
        t.amount !== 0 &&
        inDateRange(t.date) &&
        inMember(t.memberId) &&
        passesMemberStatus(t.memberId)
    );

    list = list.filter((t) => matchesSearch(t, ["type", "description"]));

    if (earningsSourceFilter !== "all") {
      list = list.filter(
        (t) => classifyEarningsSource(t) === earningsSourceFilter,
      );
    }

    const actualInterest = round2(
      list
        .filter((t) =>
          ["loan_repayment", "loan_interest_income", "interest"].includes(t.type)
        )
        .reduce((s, t) => s + earningAmount(t), 0)
    );

    const actualLateFees = round2(
      list.filter((t) => t.type === "late_fee").reduce((s, t) => s + t.amount, 0)
    );

    const actualInvestmentReturns = round2(
      list
        .filter((t) => t.type === "investment_return")
        .reduce((s, t) => s + t.amount, 0)
    );

    const actualOther = round2(
      list
        .filter(
          (t) =>
            ![
              "loan_repayment",
              "loan_interest_income",
              "interest",
              "late_fee",
              "investment_return",
            ].includes(t.type)
        )
        .reduce((s, t) => s + earningAmount(t), 0)
    );

    const totalEarnings = round2(
      actualInterest + actualLateFees + actualInvestmentReturns + actualOther
    );

    const totalProjectedInterest = slice(projectedLoanInterestAll);
    const totalLoanLateFees = slice(projectedLoanLateFeesAll);
    const totalProjected = round2(totalProjectedInterest + totalLoanLateFees);

    const combinedTotal = round2(totalEarnings + totalProjected);
    const totalInterestAllIn = round2(actualInterest + totalProjectedInterest);
    const totalLateFeesAllIn = round2(actualLateFees + totalLoanLateFees);

    const projectedInterestSource = isPersonalView
      ? allLoans
          .filter((l) => l.status === "disbursed")
          .map((loan) => ({
            loanId: loan.id,
            memberId: loan.memberId,
            memberName: getMemberName(loan.memberId),
            amount: loan.amount,
            projectedInterest: calculateLoanInterestProjection(
              loan,
              selectedFromDate || "",
              selectedToDate || "",
            ),
            applicationDate: loan.applicationDate,
          }))
          .filter((r) => r.projectedInterest > 0)
      : loanInterestProjections;

    const rowAmount = (rawAmount: number) =>
      isPersonalView ? round2(rawAmount / activeMemberCount) : rawAmount;

    const allProjectedRows = [
      ...projectedInterestSource.map((item) => ({
        type: "projected_interest",
        date: item.applicationDate,
        memberId: item.memberId,
        memberName: item.memberName,
        description: isPersonalView
          ? `Projected interest \u2014 my 1/${activeMemberCount} share`
          : `Projected interest for loan ${item.loanId.slice(0, 8)}...`,
        amount: rowAmount(item.projectedInterest),
        loanId: item.loanId,
      })),
      ...loanLateFees.map((item) => ({
        type: "loan_late_fee",
        date: item.dueDate,
        memberId: item.memberId,
        memberName: item.memberName,
        description: `Late fee - Installment ${item.installmentIndex + 1} (${item.daysLate} days late)`,
        amount: rowAmount(item.feeAmount),
        loanId: item.loanId,
      })),
    ];

    const projectedRows =
      earningsSourceFilter === "all"
        ? allProjectedRows
        : allProjectedRows.filter(
            (r) => classifyEarningsSource(r) === earningsSourceFilter,
          );

    const actualRows = list.map((t) => ({
      type: t.type,
      date: t.date,
      memberId: t.memberId,
      memberName: getMemberName(t.memberId),
      description: t.description || t.type.replace(/_/g, " "),
      amount: earningAmount(t),
      source: "actual" as const,
    }));

    const projectedRowsTagged = projectedRows.map((r) => ({ ...r, source: "projected" as const }));

    let earningsRows: any[];
    let earningsKpis: { label: string; value: string }[];

    if (earningsMode === "actual") {
      earningsRows = actualRows;
      earningsKpis = [
        { label: "Total Earned", value: fmtCurrency(totalEarnings) },
        { label: "Interest Collected", value: fmtCurrency(actualInterest) },
        { label: "Fees Paid", value: fmtCurrency(actualLateFees) },
        { label: "Records", value: String(actualRows.length) },
      ];
    } else if (earningsMode === "projected") {
      earningsRows = projectedRowsTagged;
      earningsKpis = [
        {
          label: isPersonalView ? "Total Projected (1/N)" : "Total Projected",
          value: fmtCurrency(totalProjected),
        },
        {
          label: isPersonalView
            ? "Projected Interest (1/N)"
            : "Projected Interest",
          value: fmtCurrency(totalProjectedInterest),
        },
        {
          label: isPersonalView
            ? "Projected Late Fees (1/N)"
            : "Projected Late Fees",
          value: fmtCurrency(totalLoanLateFees),
        },
        { label: "Records", value: String(projectedRowsTagged.length) },
      ];
    } else {
      earningsRows = [...actualRows, ...projectedRowsTagged];
      earningsKpis = [
        { label: "Total Earnings", value: fmtCurrency(combinedTotal) },
        { label: "Interest Earned", value: fmtCurrency(totalInterestAllIn) },
        { label: "Late Fees", value: fmtCurrency(totalLateFeesAllIn) },
        { label: "Projected Earnings", value: fmtCurrency(totalProjected) },
      ];
    }

    const chart = monthlyTotals(earningsRows, "date", "amount");

    return {
      rows: earningsRows,
      headers: ["Date", "Member", "Type", "Description", "Amount", "Source"],
      toRow: (t: any) => [
        fmtDate(t.date),
        t.memberName,
        t.type.replace(/_/g, " "),
        t.description,
        fmtCurrency(t.amount),
        t.source === "projected" ? "Projected" : "Actual",
      ],
      chart,
      chartColor: C.success,
      kpis: earningsKpis,
    };
  }, [
    category,
    contributions,
    loans,
    allLateFeesCombined,
    members,
    wallet,
    investments,
    selectedFromDate,
    selectedToDate,
    memberIdFilter,
    searchTerm,
    loanStatus,
    contributionStatus,
    contributionTypeFilter,
    memberStatusFilter,
    lateFeeSourceFilter,
    earningsSourceFilter,
    unpaidFeeMemberIds,
    lateContributionFeeMemberIds,
    lateLoanMemberIds,
    noContributionMemberIds,
    noLoanMemberIds,
    isNoActivityMemberView,
    group,
    allMembers,
    allLoans,
    allWallet,
    loanInterestProjections,
    loanLateFees,
    projectedLoanInterest,
    projectedLoanLateFees,
    earningsMode,
    year,
    C,
  ]);

  const exportRows = view.rows.map(view.toRow);

  const totalPages = Math.max(1, Math.ceil(exportRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = exportRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [
    category,
    searchTerm,
    monthFilter,
    memberIdFilter,
    selectedFromDate,
    selectedToDate,
    loanStatus,
    contributionStatus,
    contributionTypeFilter,
    memberStatusFilter,
    lateFeeSourceFilter,
    earningsSourceFilter,
    earningsMode,
    year,
  ]);

  const handleExport = async (format: "excel" | "pdf") => {
    if (!exportRows.length) {
      show("No records to export");
      return;
    }

    const fileName = `${category}_report_${monthFilter}_${isPersonalView ? "personal" : "group"}`;

    if (format === "excel") {
      await exportXlsx(fileName, view.headers, exportRows);
    } else {
      const html = `
        <table>
          <thead>
            <tr>
              ${view.headers.map((h) => `<th>${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${exportRows
              .map(
                (row) =>
                  `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;

      await exportPdf(
        fileName,
        `${CATEGORIES.find((c) => c.key === category)?.label} Report`,
        html
      );
    }

    show(`Exported as ${format === "excel" ? "Excel" : "PDF"}`);
  };

  const handleExportMemberContributions = async (
    memberId?: string,
    format: "excel" | "pdf" = "excel"
  ) => {
    const targetContributions = contributions
      .filter((c: any) => (memberId ? c.memberId === memberId : true))
      .filter((c: any) => c.status === "approved")
      .filter((c: any) => inDateRange(c.date))
      .filter((c: any) =>
        matchesSearch(c, ["memberId", "description", "contributionType"])
      );

    if (!targetContributions.length) {
      show("No contributions found for this selection");
      return;
    }

    const headers = ["Date", "Member", "Type", "Amount", "Status", "Description"];

    const rows = targetContributions.map((c: any) => [
      fmtDate(c.date),
      getMemberName(c.memberId),
      c.contributionType ?? "",
      fmtCurrency(c.amount),
      c.status,
      c.description ?? "",
    ]);

    const scopeName = memberId
      ? getMemberName(memberId).replace(/\s+/g, "_")
      : isPersonalView
      ? "personal"
      : "group";

    const fileName = `contributions_${scopeName}_${monthFilter}`;

    if (format === "excel") {
      await exportXlsx(fileName, headers, rows);
    } else {
      const html = `
        <table>
          <thead>
            <tr>
              ${headers.map((h) => `<th>${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
              .join("")}
          </tbody>
        </table>
      `;

      await exportPdf(fileName, "Contributions Report", html);
    }

    show(
      `Exported ${rows.length} contribution${rows.length !== 1 ? "s" : ""} as ${
        format === "excel" ? "Excel" : "PDF"
      }`
    );
  };

  // ───────────────────────────────────────────────────────────────────────
  // Layout data
  // ───────────────────────────────────────────────────────────────────────

  const groupName: string = ((group as any)?.name as string) || "";

  const headerSubtitle = isPersonalView
    ? groupName
      ? `Personal view · ${groupName}`
      : "Personal view"
    : groupName || "Group view";

  const openReport = (
    key: Category,
    opts: {
      lateFeeSource?: LateFeeSourceFilter;
      earningsSource?: EarningsSourceFilter;
      earningsMode?: EarningsViewMode;
    } = {}
  ) => {
    setCategory(key);
    setMonthFilter("all");
    setSelectedFromDate("");
    setSelectedToDate("");

    if (key === "latefees") {
      setLateFeeSourceFilter(opts.lateFeeSource ?? "all");
    }

    if (key === "earnings") {
      setEarningsSourceFilter(opts.earningsSource ?? "all");
      setEarningsMode(opts.earningsMode ?? "all");
    }

    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, activityY.current - 12),
        animated: true,
      });
    }, 0);
  };

  const activeMembersCount = members.filter((m) => m.status === "active").length;

  // KPI data for the "Group Financial Position" panel — no icons, values
  // colored per bucket, matching the panel design.
  const kpiCards: KpiCardProps[] = [
    {
      label: "Members",
      value: isPersonalView ? "1" : String(activeMembersCount),
      sub: isPersonalView ? "personal" : "active",
      onPress: () => openReport("members"),
    },
    {
      label: "Total Net Assets",
      value: fmtCurrency(groupTotalNetAssets),
      sub: isPersonalView ? "my wallet" : "everything in wallet",
      valueColor: C.success,
    },
    {
      label: "Contributions",
      value: fmtCurrency(groupContributionsOnly),
      sub: isPersonalView ? "my contributions" : "total collected",
      onPress: () => openReport("contributions"),
    },
    {
      label: "Interest Earned",
      value: fmtCurrency(groupInterestOnly),
      sub: isPersonalView ? "my interest collected" : "already collected",
      valueColor: C.gold,
      onPress: () =>
        openReport("earnings", {
          earningsMode: "actual",
          earningsSource: "loan_interest",
        }),
    },
    {
      label: "Late Fees Owed",
      value: fmtCurrency(groupLoanLateFeesOwed),
      sub: "on loans",
      valueColor: C.purple,
      onPress: () => openReport("latefees", { lateFeeSource: "loan" }),
    },
    {
      label: "Projected Interest",
      value: fmtCurrency(projectedLoanInterest),
      sub: "from remaining schedule",
      valueColor: C.indigo,
      onPress: () =>
        openReport("earnings", {
          earningsMode: "projected",
          earningsSource: "loan_interest",
        }),
    },
    {
      label: "Penalties & Late Fees",
      value: fmtCurrency(groupContributionAndMeetingFees),
      sub: "meetings + contributions",
      valueColor: C.error,
      onPress: () => openReport("latefees"),
    },
    {
      label: "Total Loans",
      value: fmtCurrency(groupTotalLoansDisbursed),
      sub: isPersonalView ? "my disbursed balance" : "principal disbursed",
      valueColor: C.orange,
      onPress: () => openReport("loans"),
    },
    {
      label: "Investment Returns",
      value: fmtCurrency(groupInvestmentReturnsOnly),
      sub: "from investments",
      valueColor: C.success,
      onPress: () =>
        openReport("earnings", {
          earningsMode: "actual",
          earningsSource: "investment_returns",
        }),
    },
    {
      label: "Other",
      value: fmtCurrency(groupOtherOnly),
      sub: "misc credits",
      onPress: () =>
        openReport("earnings", {
          earningsMode: "actual",
          earningsSource: "other",
        }),
    },
  ];

  const collectionColor =
    collectionRatePct >= 100
      ? C.success
      : collectionRatePct >= 70
      ? C.gold
      : C.error;

  const collectionCaption =
    collection.expected <= 0
      ? "No target set"
      : collectionRatePct > 100
      ? "Target exceeded"
      : collectionRatePct === 100
      ? "Target met"
      : collectionRatePct >= 70
      ? "On track"
      : "Below target";

  const collectionDiff = round2(collection.collected - collection.expected);

  const typeDropdown: {
    label: string;
    value: string;
    options: DropdownOption[];
    onChange: (v: string) => void;
  } | null =
    category === "contributions"
      ? {
          label: "Type",
          value: contributionTypeFilter,
          options: contributionTypeOptions,
          onChange: setContributionTypeFilter,
        }
      : category === "loans"
      ? {
          label: "Status",
          value: loanStatus,
          options: LOAN_STATUS_CHIPS,
          onChange: (v) => setLoanStatus(v as typeof loanStatus),
        }
      : category === "latefees"
      ? {
          label: "Source",
          value: lateFeeSourceFilter,
          options: LATE_FEE_SOURCE_CHIPS,
          onChange: (v) => setLateFeeSourceFilter(v as LateFeeSourceFilter),
        }
      : category === "earnings"
      ? {
          label: "Source",
          value: earningsSourceFilter,
          options: EARNINGS_SOURCE_CHIPS,
          onChange: (v) => setEarningsSourceFilter(v as EarningsSourceFilter),
        }
      : category === "members"
      ? {
          label: "Condition",
          value: memberStatusFilter,
          options: MEMBER_STATUS_OPTIONS,
          onChange: (v) => setMemberStatusFilter(v as MemberStatusFilter),
        }
      : null;

  const exportButtons =
    category !== "members" ? (
      <View style={styles.exportActions}>
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => handleExport("excel")}
          disabled={!exportRows.length}
          activeOpacity={0.8}
        >
          <Text style={styles.exportBtnText}>📊 Excel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.exportBtn}
          onPress={() => handleExport("pdf")}
          disabled={!exportRows.length}
          activeOpacity={0.8}
        >
          <Text style={styles.exportBtnText}>🖨 PDF</Text>
        </TouchableOpacity>
      </View>
    ) : null;

  const pageStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageEnd = Math.min(totalPages, pageStart + 4);
  const pageNumbers = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, i) => pageStart + i
  );

  const reportTitle = isNoActivityMemberView
    ? memberStatusFilter === "no_loans"
      ? "Members With No Loans"
      : "Members With No Contributions"
    : `${CATEGORIES.find((c) => c.key === category)?.label} Overview`;

  const positionPanelTitle = isPersonalView
    ? "My Financial Position"
    : "Group Financial Position";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={C.bg} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.page, { paddingBottom: 60 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.contentContainer, isWide && styles.contentContainerWide]}>
          {/* ── Header ─────────────────────────────────────────────── */}
          <View style={styles.ovHeader}>
            <View style={styles.ovHeaderLeft}>
              <View style={styles.ovHeaderIcon}>
                <Text style={{ fontSize: 16 }}>👥</Text>
              </View>
            </View>

            <View style={styles.ovYearWrap}>
              <Dropdown label="Year" value={year} options={yearOptions} onChange={setYear} />
            </View>
          </View>

          {/* ── Group Financial Position panel ─────────────────────── */}
          <View style={styles.positionPanel}>
            <Text style={styles.positionPanelTitle}>{positionPanelTitle}</Text>

            <View style={styles.positionGrid}>
              {kpiCards.map((k) => (
                <View key={k.label} style={styles.positionCell}>
                  <KpiCard {...k} />
                </View>
              ))}
            </View>
          </View>

          {/* ── Profits by source + Collection rate ────────────────── */}
          <View style={[styles.ovMidRow, isWide && styles.ovMidRowWide]}>
            <View style={[styles.chartCard, styles.ovMidCard, isWide && { flex: 1.5 }]}>
              <Text style={styles.chartTitle}>Profits by source</Text>
              <Text style={styles.chartSubtitle}>
                {isPersonalView
                  ? `My share of group profits (1/${activeMemberCount})`
                  : "Group earnings this period"}
              </Text>

              <EarningsDonut
                segments={[
                  { label: "Loan interest (actual)", value: donutLoanInterest, color: C.info },
                  { label: "Late fees (actual)", value: donutLateFees, color: C.coral },
                  { label: "Investment returns", value: donutInvestmentReturns, color: C.success },
                  { label: "Accrued (unpaid)", value: donutAccruedUnpaid, color: C.purple },
                  { label: isPersonalView ? "Projected interest (my 1/N share)" : "Projected interest (schedule)", value: donutProjectedInterest, color: C.indigo },
                  { label: "Projected late fees", value: donutProjectedLateFees, color: C.orange },
                  { label: "Other", value: donutOther, color: C.gold },
                ]}
              />
            </View>

            <View style={[styles.chartCard, styles.ovMidCard, isWide && { flex: 1 }]}>
              <Text style={styles.chartTitle}>Collection rate</Text>
              <Text style={styles.chartSubtitle}>
                {isPersonalView ? "My contributions vs my goal" : "Group contributions vs target"}
              </Text>

              <View style={styles.collectionBody}>
                <Gauge
                  value={collectionRatePct}
                  color={collectionColor}
                  caption={collectionCaption}
                />

                <View style={styles.collectionTable}>
                  <View style={styles.collectionRow}>
                    <Text style={styles.collectionLabel}>Total Collected</Text>
                    <Text style={styles.collectionValue} numberOfLines={1}>
                      {fmtCurrency(collection.collected)}
                    </Text>
                  </View>

                  <View style={styles.collectionRow}>
                    <Text style={styles.collectionLabel}>Target</Text>
                    <Text style={styles.collectionValue} numberOfLines={1}>
                      {fmtCurrency(collection.expected)}
                    </Text>
                  </View>

                  <View style={[styles.collectionRow, styles.collectionRowLast]}>
                    <Text style={styles.collectionLabel}>
                      {collectionDiff >= 0 ? "Excess" : "Shortfall"}
                    </Text>
                    <Text
                      style={[
                        styles.collectionValue,
                        { color: collectionDiff >= 0 ? C.success : C.error },
                      ]}
                      numberOfLines={1}
                    >
                      {fmtCurrency(Math.abs(collectionDiff))}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* ── Cash flow ──────────────────────────────────────────── */}
          <View style={styles.chartCard}>
            <View style={styles.cashflowHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.chartTitle}>
                  {year === "all"
                    ? `Cash Flow — ${cashflowYearValue}`
                    : `Cash Flow — ${year}`}
                </Text>
                <Text style={[styles.chartSubtitle, { marginBottom: 0 }]}>
                  Income vs Expenses
                </Text>
              </View>

              <View style={styles.cashflowLegend}>
                <View style={styles.cashflowLegendItem}>
                  <View style={[styles.cashflowLegendDot, { backgroundColor: C.success }]} />
                  <Text style={styles.cashflowLegendText}>Income</Text>
                </View>

                <View style={styles.cashflowLegendItem}>
                  <View style={[styles.cashflowLegendDot, { backgroundColor: C.error }]} />
                  <Text style={styles.cashflowLegendText}>Expenses</Text>
                </View>
              </View>
            </View>

            <CashflowBarChart months={cashflow.months} income={cashflow.income} expenses={cashflow.expenses} />
          </View>

          {memberPie.length > 0 && null}

          {/* ── Financial activity ─────────────────────────────────── */}
          <View
            style={styles.activityCard}
            onLayout={(e) => {
              activityY.current = e.nativeEvent.layout.y + 20;
            }}
          >
            <View style={[styles.activityHeader, !isWide && styles.activityHeaderStack]}>
              <View style={styles.activityTitleRow}>
                {!isWide && exportButtons}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={isWide ? { flex: 1 } : undefined}
                contentContainerStyle={styles.categoryContent}
              >
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.pill, category === c.key && styles.pillActive]}
                    onPress={() => {
                      setCategory(c.key);
                      setMonthFilter("all");
                      setSelectedFromDate("");
                      setSelectedToDate("");
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.pillIcon}>{c.icon}</Text>

                    <Text style={[styles.pillLabel, category === c.key && styles.pillLabelActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {isWide && exportButtons}
            </View>

            <View style={styles.activityFilters}>
              <View style={[styles.activityFilterItem, isMobile && styles.activityFilterItemMobile]}>
                <Dropdown label="Month" value={monthFilter} options={monthOptions} onChange={handleMonthChange} />
              </View>

              {!isPersonalView && category !== "expenses" && (
                <View style={[styles.activityFilterItem, isMobile && styles.activityFilterItemMobile]}>
                  <Dropdown
                    label="Member"
                    value={memberIdFilter}
                    options={memberOptions}
                    onChange={setMemberIdFilter}
                  />
                </View>
              )}

              {typeDropdown && (
                <View style={[styles.activityFilterItem, isMobile && styles.activityFilterItemMobile]}>
                  <Dropdown
                    label={typeDropdown.label}
                    value={typeDropdown.value}
                    options={typeDropdown.options}
                    onChange={typeDropdown.onChange}
                  />
                </View>
              )}

              <View style={[styles.activitySearch, isMobile && styles.activitySearchMobile]}>
                <Text style={styles.filterBtnIconText}>🔍</Text>
                <TextInput
                  style={styles.activitySearchInput}
                  value={searchTerm}
                  onChangeText={setSearchTerm}
                  placeholder="Search by member name..."
                  placeholderTextColor={C.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {searchTerm !== "" && (
                  <TouchableOpacity onPress={() => setSearchTerm("")} hitSlop={8}>
                    <Text style={styles.activityClearSearch}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.filterBtn,
                  isMobile && styles.filterBtnIcon,
                  hasActiveFilters && styles.filterBtnActive,
                ]}
                onPress={openFilterModal}
                activeOpacity={0.8}
                accessibilityLabel={
                  appliedFilterCount > 0 ? `Filters, ${appliedFilterCount} applied` : "Filters"
                }
              >
                <Text style={styles.filterBtnIconText}>⚙️</Text>
                {!isMobile && <Text style={styles.filterBtnText}>Filters</Text>}

                {appliedFilterCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{appliedFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>

              {hasActiveFilters && (
                <TouchableOpacity
                  onPress={clearAllFilters}
                  style={[styles.clearBtn, isMobile && styles.clearBtnIcon]}
                  accessibilityLabel="Clear filters"
                >
                  <Text style={styles.clearBtnText}>{isMobile ? "✕" : "✕ Clear"}</Text>
                </TouchableOpacity>
              )}
            </View>

          {hasActiveFilters && (
            <View style={styles.activeFiltersRow}>
              {searchTerm !== "" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    🔍 "{searchTerm}"
                  </Text>
                  <TouchableOpacity onPress={() => setSearchTerm("")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {(selectedFromDate || selectedToDate) !== "" && (selectedFromDate || selectedToDate) && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    📅 {selectedFromDate || "start"} → {selectedToDate || "now"}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedFromDate("");
                      setSelectedToDate("");
                      setMonthFilter("all");
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {loanStatus !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    🏦 Loans: {LOAN_STATUS_CHIPS.find((o) => o.value === loanStatus)?.label}
                  </Text>
                  <TouchableOpacity onPress={() => setLoanStatus("all")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {contributionStatus !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    📈 Contributions: {CONTRIBUTION_STATUS_CHIPS.find((o) => o.value === contributionStatus)?.label}
                  </Text>
                  <TouchableOpacity onPress={() => setContributionStatus("all")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {contributionTypeFilter !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    📈 Type: {contributionTypeOptions.find((o) => o.value === contributionTypeFilter)?.label}
                  </Text>
                  <TouchableOpacity onPress={() => setContributionTypeFilter("all")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {lateFeeSourceFilter !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    ⚠️ Late Fees: {LATE_FEE_SOURCE_CHIPS.find((o) => o.value === lateFeeSourceFilter)?.label}
                  </Text>
                  <TouchableOpacity onPress={() => setLateFeeSourceFilter("all")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              {memberStatusFilter !== "all" && (
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterChipText} numberOfLines={1}>
                    👤 {MEMBER_STATUS_OPTIONS.find((o) => o.value === memberStatusFilter)?.label}
                  </Text>
                  <TouchableOpacity onPress={() => setMemberStatusFilter("all")} hitSlop={8}>
                    <Text style={styles.activeFilterChipClose}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

            {category === "members" ? (
              <MembersTab
                members={view.rows}
                contributions={contributions}
                loans={loans}
                wallet={wallet}
                isGroupView={!isPersonalView}
                showActivityLists={!isPersonalView}
                currentMember={currentMember}
                onExport={handleExport}
                onExportContributions={handleExportMemberContributions}
                exportRows={exportRows}
              />
            ) : (
              <View>
                <Text style={styles.cardTitle}>{reportTitle}</Text>

                {category === "earnings" && !isNoActivityMemberView && (
                  <View style={[styles.earningsModeRow, { marginTop: 10, marginBottom: 0 }]}>
                    {(
                      [
                        { label: "All", value: "all" },
                        { label: "Earned", value: "actual" },
                        { label: "Projected", value: "projected" },
                      ] as { label: string; value: EarningsViewMode }[]
                    ).map((opt) => {
                      const active = earningsMode === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.earningsModeBtn, active && styles.earningsModeBtnActive]}
                          onPress={() => setEarningsMode(opt.value)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.earningsModeBtnText,
                              active && styles.earningsModeBtnTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={styles.kpiMiniRow}>
                  {view.kpis.map((k) => (
                    <View key={k.label} style={styles.kpiMini}>
                      <Text style={styles.kpiMiniLabel}>{k.label}</Text>

                      <Text
                        style={styles.kpiMiniValue}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {k.value}
                      </Text>
                    </View>
                  ))}
                </View>

                {exportRows.length === 0 ? (
                  <Text style={styles.noData}>No records match your filters</Text>
                ) : (
                  <View onLayout={(e) => setTableWidth(e.nativeEvent.layout.width)}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ width: Math.max(tableWidth, view.headers.length * 120) }}>
                        <View style={styles.tableHeadRow}>
                          {view.headers.map((h) => (
                            <Text key={h} style={styles.tableHeadCell} numberOfLines={1}>
                              {h}
                            </Text>
                          ))}
                        </View>

                        {pagedRows.map((row, i) => (
                          <View key={`${currentPage}_${i}`} style={styles.tableRow}>
                            {row.map((cell, j) => {
                              const head = view.headers[j];

                              if (head === "Status" || head === "Source") {
                                return (
                                  <View key={j} style={styles.tableCellBadgeWrap}>
                                    <StatusBadge value={String(cell)} />
                                  </View>
                                );
                              }

                              return (
                                <Text key={j} style={styles.tableCell} numberOfLines={2}>
                                  {String(cell)}
                                </Text>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    </ScrollView>

                    <View style={styles.pagerRow}>
                      <Text style={styles.pagerInfo}>
                        Showing {pagedRows.length} of {exportRows.length} record
                        {exportRows.length !== 1 ? "s" : ""}
                      </Text>

                      {totalPages > 1 && (
                        <View style={styles.pagerBtns}>
                          <TouchableOpacity
                            style={[styles.pagerBtn, currentPage === 1 && styles.pagerBtnDisabled]}
                            disabled={currentPage === 1}
                            onPress={() => setPage(currentPage - 1)}
                            accessibilityLabel="Previous page"
                          >
                            <Text style={styles.pagerBtnText}>‹</Text>
                          </TouchableOpacity>

                          {pageNumbers.map((n) => (
                            <TouchableOpacity
                              key={n}
                              style={[styles.pagerBtn, n === currentPage && styles.pagerBtnActive]}
                              onPress={() => setPage(n)}
                            >
                              <Text
                                style={[
                                  styles.pagerBtnText,
                                  n === currentPage && styles.pagerBtnTextActive,
                                ]}
                              >
                                {n}
                              </Text>
                            </TouchableOpacity>
                          ))}

                          <TouchableOpacity
                            style={[
                              styles.pagerBtn,
                              currentPage === totalPages && styles.pagerBtnDisabled,
                            ]}
                            disabled={currentPage === totalPages}
                            onPress={() => setPage(currentPage + 1)}
                            accessibilityLabel="Next page"
                          >
                            <Text style={styles.pagerBtnText}>›</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                <View style={styles.activityDivider} />

                <Text style={styles.chartCaption}>Monthly totals</Text>

                {view.chart.labels.length > 0 ? (
                  <CategoryBarChart labels={view.chart.labels} values={view.chart.values} color={view.chartColor} />
                ) : (
                  <Text style={styles.noData}>No data for this selection</Text>
                )}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        fromDate={tempFromDate}
        toDate={tempToDate}
        onFromDateChange={setTempFromDate}
        onToDateChange={setTempToDate}
        loanStatus={tempLoanStatus}
        contributionStatus={tempContributionStatus}
        onLoanStatusChange={setTempLoanStatus}
        onContributionStatusChange={setTempContributionStatus}
        memberStatus={tempMemberStatus}
        onMemberStatusChange={setTempMemberStatus}
        lateFeeSource={tempLateFeeSource}
        onLateFeeSourceChange={setTempLateFeeSource}
        earningsSource={tempEarningsSource}
        onEarningsSourceChange={setTempEarningsSource}
        onApply={applyFilters}
        searchTerm={tempSearch}
        onSearchChange={setTempSearch}
        onClear={clearAllFilters}
        activeFilterCount={countActiveFilters({
          search: tempSearch,
          fromDate: tempFromDate,
          toDate: tempToDate,
          loanStatus: tempLoanStatus,
          contributionStatus: tempContributionStatus,
          memberStatus: tempMemberStatus,
          lateFeeSource: tempLateFeeSource,
          earningsSource: tempEarningsSource,
        })}
      />

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Confirm dialog
// ─────────────────────────────────────────────────────────────────────────
function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void,
  destructive = false,
) {
  if (Platform.OS === "web") {
    const ok =
      typeof window !== "undefined" &&
      window.confirm(`${title}

${message}`);
    if (ok) onConfirm();
    else onCancel?.();
    return;
  }

  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel", onPress: onCancel },
    {
      text: "Confirm",
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// Members tab
// ─────────────────────────────────────────────────────────────────────────

function MembersTab({
  members,
  contributions,
  loans,
  wallet,
  isGroupView,
  showActivityLists,
  onExport,
  onExportContributions,
  exportRows,
}: any) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const [selectedMember, setSelectedMember] = useState<any>(
    !isGroupView && members.length === 1 ? members[0] : null
  );

  useEffect(() => {
    if (!isGroupView) {
      setSelectedMember(members.length === 1 ? members[0] : null);
      return;
    }

    setSelectedMember((current: any) => {
      if (!current) return null;
      return members.find((m: any) => m.id === current.id) ?? null;
    });
  }, [isGroupView, members]);

  if (selectedMember) {
    return (
      <MemberDetail
        member={selectedMember}
        loans={loans.filter((l: any) => l.memberId === selectedMember.id)}
        contributions={contributions.filter(
          (c: any) => c.memberId === selectedMember.id && c.status === "approved"
        )}
        wallet={wallet.filter((w: any) => w.memberId === selectedMember.id)}
        canGoBack={isGroupView}
        showActivityLists={showActivityLists}
        onBack={() => setSelectedMember(null)}
        onExportContributions={(format: "excel" | "pdf") =>
          onExportContributions(selectedMember.id, format)
        }
      />
    );
  }

  const approvedContributions = contributions.filter((c: any) => c.status === "approved");

  return (
    <View>
      <View style={[styles.previewHeader, { flexWrap: "wrap" }]}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text style={styles.resultsCount}>
            {members.length} member{members.length !== 1 ? "s" : ""}
          </Text>

          <Text style={styles.resultsSubtext}>
            {approvedContributions.length} approved contribution
            {approvedContributions.length !== 1 ? "s" : ""}
          </Text>
        </View>

        <View style={styles.exportActions}>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => onExportContributions(undefined, "excel")}
            disabled={!approvedContributions.length}
            activeOpacity={0.8}
          >
            <Text style={styles.exportBtnText}>📈 Contributions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => onExport("excel")}
            disabled={!exportRows.length}
            activeOpacity={0.8}
          >
            <Text style={styles.exportBtnText}>📊 Members</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Card style={styles.card}>
        {members.length === 0 ? (
          <Empty message="No members found" icon="👥" />
        ) : (
          members.map((m: any, i: number) => {
            const waiverCount = Array.isArray(m.lateFeeExemptions)
              ? m.lateFeeExemptions.length
              : 0;

            return (
              <TouchableOpacity key={m.id} onPress={() => setSelectedMember(m)} activeOpacity={0.7}>
                <View style={styles.memberRow}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {m.fullName
                        .split(" ")
                        .map((w: string) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.fullName}
                    </Text>

                    <Text style={styles.memberContact} numberOfLines={1}>
                      {m.phone || m.email || "No contact"}
                    </Text>

                    {waiverCount > 0 && (
                      <View style={styles.memberWaiverPill}>
                        <Text style={styles.memberWaiverPillText}>
                          ⚠️ {waiverCount} waiver{waiverCount !== 1 ? "s" : ""}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.memberStats}>
                    <Text style={styles.memberAmount} numberOfLines={1}>
                      {fmtCurrency(m.totalContributions || 0)}
                    </Text>

                    <Text style={styles.memberRole} numberOfLines={1}>
                      {m.role}
                    </Text>
                  </View>

                  <Text style={styles.chevron}>›</Text>
                </View>

                {i < members.length - 1 && <Divider />}
              </TouchableOpacity>
            );
          })
        )}
      </Card>
    </View>
  );
}

function WaiverCard({
  exemption,
  onRemove,
  removing,
}: {
  exemption: any;
  onRemove: () => void;
  removing: boolean;
}) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const scope = exemption.scope ?? "contribution";
  const scopeStyle =
    scope === "loan"
      ? { bg: C.goldBg, fg: C.goldText, label: "Loan" }
      : scope === "both"
      ? { bg: C.tealBg, fg: C.tealText, label: "Both" }
      : { bg: C.infoBg, fg: C.infoText, label: "Contribution" };

  return (
    <View style={styles.waiverCard}>
      <View style={styles.waiverCardHeader}>
        <View style={[styles.waiverScopeBadge, { backgroundColor: scopeStyle.bg, borderColor: scopeStyle.fg }]}>
          <Text style={[styles.waiverScopeText, { color: scopeStyle.fg }]}>
            {scopeStyle.label}
          </Text>
        </View>
      </View>

      <Text style={styles.waiverPeriod}>
        {fmtDate(exemption.periodStart)} → {fmtDate(exemption.periodEnd)}
      </Text>

      {typeof exemption.amount === "number" && exemption.amount > 0 ? (
        <Text style={styles.waiverAmount}>
          {fmtCurrency(exemption.amount)} frozen
        </Text>
      ) : null}

      {exemption.reason ? (
        <Text style={styles.waiverReason}>{exemption.reason}</Text>
      ) : null}

      <Text style={styles.waiverMeta}>
        Added by {exemption.createdByName || "—"}
        {exemption.createdAt ? ` · ${fmtDate(exemption.createdAt)}` : ""}
      </Text>

      <TouchableOpacity
        style={[styles.waiverRemoveBtn, removing && { opacity: 0.6 }]}
        onPress={onRemove}
        disabled={removing}
        activeOpacity={0.8}
      >
        <Text style={styles.waiverRemoveBtnText}>
          {removing ? "Removing…" : "Remove Waiver"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function MemberDetail({
  member,
  loans,
  contributions,
  wallet,
  canGoBack,
  showActivityLists = true,
  onBack,
  onExportContributions,
}: any) {
  const C = useTheme();
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const styles = isDark ? darkStyles : lightStyles;

  const { show } = useToast();
  const removeLateFeeExemption = useStore((s) => s.removeLateFeeExemption);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const totalContributions = contributions.reduce((s: number, c: any) => s + c.amount, 0);

  const loanBalance = loans
    .filter((l: any) => l.status === "disbursed")
    .reduce((s: number, l: any) => s + (l.balance || 0), 0);

  const interestFromLedger = wallet
    .filter((t: any) => t.type === "loan_interest_income" && t.amount > 0)
    .reduce((s: number, t: any) => s + t.amount, 0);

  const interestLegacy = wallet
    .filter((t: any) => t.type === "loan_repayment" && t.amount > 0)
    .reduce((s: number, t: any) => {
      const loan = loans.find((l: any) => l.id === t.loanId);
      if (!loan?.totalRepayable) return s;
      return s + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
    }, 0);

  const interestEarned = round2(interestFromLedger + interestLegacy);

  const accruedInterestUnpaid = round2(
    loans
      .filter(
        (l: any) =>
          l.status === "disbursed" &&
          l.interestMethod === "reducing_balance",
      )
      .reduce((sum: number, loan: any) => {
        const acc = computeTodayAccrued(loan);
        return sum + (acc?.total ?? 0);
      }, 0),
  );

  const recentWallet = [...wallet]
    .sort(
      (a: any, b: any) =>
        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    )
    .slice(0, 8);

  const sortedContributions = [...contributions].sort(
    (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const exemptions: any[] = Array.isArray(member.lateFeeExemptions)
    ? member.lateFeeExemptions
    : [];

  const contribWaivers = exemptions.filter(
    (e) => e.scope === "contribution" || e.scope === "both",
  );
  const loanWaivers = exemptions.filter(
    (e) => e.scope === "loan" || e.scope === "both",
  );

  const handleRemove = (exemptionId: string) => {
    showConfirm(
      "Remove Exemption",
      "Future fees for this period will start accruing again. Fees that were already cleared when the waiver was created are NOT restored by this action.",
      async () => {
        setRemovingId(exemptionId);
        try {
          await removeLateFeeExemption(member.id, exemptionId);
          show("Exemption removed");
        } catch (e: any) {
          show(e.message || "Failed to remove exemption", "error");
        } finally {
          setRemovingId(null);
        }
      },
      undefined,
      true,
    );
  };

  return (
    <View>
      {canGoBack && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back to Directory</Text>
        </TouchableOpacity>
      )}

      <View style={styles.memberDetailCard}>
        <View style={styles.memberDetailHeader}>
          <View style={[styles.memberAvatar, { marginRight: 14 }]}>
            <Text style={styles.memberAvatarText}>
              {member.fullName
                .split(" ")
                .map((w: string) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.memberDetailName} numberOfLines={2}>
              {member.fullName}
            </Text>

            <Text style={styles.memberDetailRole} numberOfLines={1}>
              {member.role.replace(/_/g, " ")} · {member.status}
            </Text>
          </View>
        </View>

        <View style={styles.memberContactBlock}>
          {member.phone ? (
            <Text style={styles.memberDetailText}>📞 {member.phone}</Text>
          ) : null}

          {member.email ? (
            <Text style={styles.memberDetailText}>✉️ {member.email}</Text>
          ) : null}

          <Text style={styles.memberDetailText}>📅 Joined {fmtDate(member.dateJoined)}</Text>
        </View>
      </View>

      <View style={styles.memberKpiGrid}>
        <View style={styles.memberKpi}>
          <Text style={styles.memberKpiLabel}>Contributions</Text>

          <Text style={[styles.memberKpiValue, { color: C.accent }]}>
            {fmtCurrency(totalContributions)}
          </Text>
        </View>

        <View style={styles.memberKpi}>
          <Text style={styles.memberKpiLabel}>Loan Balance</Text>

          <Text style={[styles.memberKpiValue, { color: C.error }]}>
            {fmtCurrency(loanBalance)}
          </Text>
        </View>

        <View style={styles.memberKpi}>
          <Text style={styles.memberKpiLabel}>Interest Earned</Text>

          <Text style={[styles.memberKpiValue, { color: C.gold }]}>
            {fmtCurrency(interestEarned)}
          </Text>
        </View>

        <View style={styles.memberKpi}>
          <Text style={styles.memberKpiLabel}>Accrued (Unpaid)</Text>

          <Text style={[styles.memberKpiValue, { color: C.purple }]}>
            {fmtCurrency(accruedInterestUnpaid)}
          </Text>
        </View>
      </View>

      <View style={styles.waiverSection}>
        <View style={styles.waiverHeader}>
          <View style={styles.waiverTitleRow}>
            <Text style={styles.cardTitle}>Waived Fees & Exemptions</Text>
            {exemptions.length > 0 && (
              <View style={styles.waiverCountBadge}>
                <Text style={styles.waiverCountText}>{exemptions.length}</Text>
              </View>
            )}
          </View>
        </View>

        {exemptions.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.waiverEmpty}>
              No active fee exemptions for this member.
            </Text>
          </Card>
        ) : (
          <Card style={styles.card}>
            {contribWaivers.length > 0 && (
              <>
                <Text style={styles.waiverGroupLabel}>Contribution fees</Text>
                {contribWaivers.map((ex) => (
                  <WaiverCard
                    key={ex.id}
                    exemption={ex}
                    removing={removingId === ex.id}
                    onRemove={() => handleRemove(ex.id)}
                  />
                ))}
              </>
            )}

            {loanWaivers.length > 0 && (
              <>
                <Text
                  style={[
                    styles.waiverGroupLabel,
                    contribWaivers.length > 0 && { marginTop: 16 },
                  ]}
                >
                  Loan fees
                </Text>
                {loanWaivers.map((ex) => (
                  <WaiverCard
                    key={ex.id}
                    exemption={ex}
                    removing={removingId === ex.id}
                    onRemove={() => handleRemove(ex.id)}
                  />
                ))}
              </>
            )}
          </Card>
        )}
      </View>

      {showActivityLists && (
        <>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>Contributions</Text>

          <Text style={styles.sectionSubtext}>
            {contributions.length} approved contribution{contributions.length !== 1 ? "s" : ""}
          </Text>
        </View>

        <View style={styles.exportActions}>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => onExportContributions("excel")}
            disabled={!contributions.length}
            activeOpacity={0.8}
          >
            <Text style={styles.exportBtnText}>📊 Excel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exportBtn}
            onPress={() => onExportContributions("pdf")}
            disabled={!contributions.length}
            activeOpacity={0.8}
          >
            <Text style={styles.exportBtnText}>🖨 PDF</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Card style={styles.cardWithBottomMargin}>
        {sortedContributions.length === 0 ? (
          <Text style={styles.emptyInline}>No contributions yet</Text>
        ) : (
          sortedContributions.map((c: any, i: number) => (
            <React.Fragment key={`${c.id}_${i}`}>
              <View style={styles.contributionRow}>
                <View style={styles.contributionIcon}>
                  <Text>📈</Text>
                </View>

                <View style={styles.contributionInfo}>
                  <Text style={styles.contributionType} numberOfLines={1}>
                    {c.contributionType || "Contribution"}
                  </Text>

                  <Text style={styles.contributionDate} numberOfLines={1}>
                    {fmtDate(c.date)}
                  </Text>

                  {c.description ? (
                    <Text style={styles.contributionDescription} numberOfLines={1}>
                      {c.description}
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.contributionAmount} numberOfLines={1}>
                  {fmtCurrency(c.amount)}
                </Text>
              </View>

              {i < sortedContributions.length - 1 && <Divider />}
            </React.Fragment>
          ))
        )}
      </Card>

      <Text style={styles.cardTitle}>Recent Transactions</Text>

      <Card style={styles.cardWithTopMargin}>
        {recentWallet.length === 0 ? (
          <Text style={styles.emptyInline}>No transactions yet</Text>
        ) : (
          recentWallet.map((w: any, i: number) => (
            <React.Fragment key={`${w.id}_${i}`}>
              <View style={styles.transactionRow}>
                <View
                  style={[
                    styles.txDot,
                    { backgroundColor: w.amount > 0 ? C.greenBg : C.redBg },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: w.amount > 0 ? C.success : C.error,
                    }}
                  >
                    {w.amount > 0 ? "↓" : "↑"}
                  </Text>
                </View>

                <View style={styles.transactionInfo}>
                  <Text style={styles.transactionType} numberOfLines={1}>
                    {w.type.replace(/_/g, " ")}
                  </Text>

                  <Text style={styles.transactionDate} numberOfLines={1}>
                    {fmtDate(w.date || w.createdAt)}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.transactionAmount,
                    { color: w.amount > 0 ? C.success : C.error },
                  ]}
                  numberOfLines={1}
                >
                  {w.amount > 0 ? "+" : ""}
                  {fmtCurrency(w.amount)}
                </Text>
              </View>

              {i < recentWallet.length - 1 && <Divider />}
            </React.Fragment>
          ))
        )}
          </Card>
        </>
      )}
    </View>
  );
}

const Divider = () => {
  const C = useTheme();
  return (
    <View style={{ height: 1, backgroundColor: C.borderLight, marginHorizontal: 16 }} />
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const makeStyles = (C: Palette) => StyleSheet.create({
  page: { paddingHorizontal: Layout.gutter, paddingVertical: 16 },

  contentContainer: { width: "100%" },

  contentContainerWide: { maxWidth: Layout.maxWidth, alignSelf: "center" },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20, marginBottom: 16 },

  kpiCard: {
    flexBasis: "31%" as any,
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderTopWidth: 3,
    padding: 14,
  },

  kpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },

  kpiValue: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3, marginBottom: 2 },

  kpiSubtext: { fontSize: 10, color: C.text3 },

  donutContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
    flexWrap: "wrap",
    paddingVertical: 4,
  },

  donutVisual: {
    width: 148,
    height: 148,
    alignItems: "center",
    justifyContent: "center",
  },

  donutCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 26,
  },

  donutCenterLabel: {
    fontSize: 10,
    color: C.text3,
    fontWeight: "600",
    marginBottom: 2,
  },

  donutCenterValue: {
    fontSize: 12,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
    maxWidth: 90,
  },

  donutLegend: {
    flex: 1,
    minWidth: 220,
    gap: 9,
  },

  donutLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  donutLegendName: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    gap: 7,
  },

  donutLegendDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
    flexShrink: 0,
  },

  donutLegendText: {
    fontSize: 11,
    color: C.text2,
    flex: 1,
  },

  donutLegendPct: {
    width: 36,
    textAlign: "right",
    fontSize: 11,
    fontWeight: "800",
    color: C.text,
    flexShrink: 0,
  },

  donutLegendAmount: {
    width: 86,
    textAlign: "right",
    fontSize: 11,
    color: C.text2,
    flexShrink: 0,
  },

  donutEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },

  donutEmptyCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 16,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  donutEmptyText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
  },

  donutEmptySubtext: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
  },

  gaugeContainer: {
    alignSelf: "center",
    alignItems: "center",
  },

  gaugeValueWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 2,
    alignItems: "center",
  },

  gaugeValue: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
  },

  gaugeCaption: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },

  collectionBody: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginTop: 4,
  },

  collectionTable: {
    flex: 1,
    minWidth: 190,
  },

  collectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  collectionRowLast: { borderBottomWidth: 0 },

  collectionLabel: { fontSize: 11, color: C.text3 },

  collectionValue: { fontSize: 12, fontWeight: "800", color: C.text, flexShrink: 1 },

  categoryChartWrap: {
    width: "100%",
    marginTop: 2,
  },

  categoryAxisLabels: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 24,
    width: 36,
    justifyContent: "space-between",
    zIndex: 2,
  },

  categoryAxisText: {
    fontSize: 9,
    color: C.text3,
  },

  categoryPlot: {
    marginLeft: 40,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  categoryBarColumn: {
    width: 62,
    height: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
  },

  categoryBarArea: {
    width: 30,
    height: 140,
    alignItems: "center",
    justifyContent: "flex-end",
  },

  categoryBar: {
    width: 22,
    borderRadius: 4,
  },

  categoryBarLabel: {
    width: 62,
    fontSize: 9,
    color: C.text3,
    textAlign: "center",
    marginTop: 6,
  },

  cashflowHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },

  cashflowLegend: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 2,
  },

  cashflowLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  cashflowLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },

  cashflowLegendText: {
    fontSize: 10,
    color: C.text3,
  },

  cashflowWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  cashflowAxisText: {
    position: "absolute",
    right: 6,
    fontSize: 9,
    color: C.text3,
  },

  cashflowGridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: C.borderLight,
  },

  cashflowBars: {
    height: 108,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
  },

  cashflowBar: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },

  cashflowMonthLabel: {
    height: 22,
    fontSize: 9,
    color: C.text3,
    textAlign: "center",
    paddingTop: 6,
  },

  chartCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },

  chartTitle: { fontSize: 13, fontWeight: "700", color: C.text, marginBottom: 3 },

  chartSubtitle: { fontSize: 11, color: C.text3, marginBottom: 10 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },

  cardWithBottomMargin: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 18,
  },

  cardWithTopMargin: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginTop: 8,
  },

  cardTitle: { fontSize: 14, fontWeight: "800", color: C.text },

  // ── Overview header ─────────────────────────────────────────────────
  ovHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },

  ovHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },

  ovHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  ovTitle: { fontSize: 18, fontWeight: "800", color: C.text, letterSpacing: -0.3 },

  ovSubtitle: { fontSize: 11, color: C.text3, marginTop: 1 },

  ovYearWrap: { width: 130 },

  // ── Financial Position panel ─────────────────────────────────────────
  // Outer panel that groups the KPI cells — matches the "Group Financial
  // Position" section in the reference design.
  positionPanel: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },

  positionPanelTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: C.text,
    marginBottom: 12,
  },

  positionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  positionCell: {
    flexBasis: "48%" as any,
    flexGrow: 1,
    minWidth: 0,
  },

  positionCard: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },

  positionCardLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    color: C.text3,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  positionCardValue: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.2,
  },

  positionCardSub: {
    fontSize: 10.5,
    color: C.text3,
  },

  ovMidRow: { flexDirection: "column", gap: 12, marginBottom: 12 },

  ovMidRowWide: { flexDirection: "row" },

  ovMidCard: { marginBottom: 0, minWidth: 0 },

  // ── Financial activity card ─────────────────────────────────────────
  activityCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },

  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 10,
  },

  activityHeaderStack: { flexDirection: "column", alignItems: "stretch", gap: 10 },

  activityTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  activityTitleLeft: { flexDirection: "row", alignItems: "center", gap: 8 },

  activityIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  activityTitle: { fontSize: 13, fontWeight: "800", color: C.text },

  activityFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },

  activityFilterItem: { flexGrow: 1, flexBasis: 140, minWidth: 120, maxWidth: 220 },

  activityFilterItemMobile: { flexBasis: "47%" as any, maxWidth: "100%" as any },

  activitySearch: {
    flex: 2,
    flexBasis: 200,
    minWidth: 160,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: C.surface,
  },

  activitySearchMobile: { flexBasis: "100%" as any },

  activitySearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: C.text,
    paddingVertical: 0,
    minHeight: 38,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },

  activityClearSearch: { fontSize: 11, color: C.text3 },

  activityDivider: { height: 1, backgroundColor: C.borderLight, marginVertical: 14 },

  chartCaption: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  // ── Data table ──────────────────────────────────────────────────────
  tableHeadRow: {
    flexDirection: "row",
    backgroundColor: C.elevated,
    borderRadius: 8,
  },

  tableHeadCell: {
    flex: 1,
    minWidth: 0,
    fontSize: 9.5,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  tableCell: {
    flex: 1,
    minWidth: 0,
    fontSize: 11.5,
    color: C.text2,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },

  tableCellBadgeWrap: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "flex-start",
  },

  tableBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },

  tableBadgeText: { fontSize: 10, fontWeight: "700" },

  pagerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },

  pagerInfo: { fontSize: 11, color: C.text3 },

  pagerBtns: { flexDirection: "row", gap: 5 },

  pagerBtn: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  pagerBtnActive: { borderColor: C.primary, backgroundColor: C.pill },

  pagerBtnDisabled: { opacity: 0.4 },

  pagerBtnText: { fontSize: 11, fontWeight: "700", color: C.text2 },

  pagerBtnTextActive: { color: C.primary },

  categoryScroller: { marginTop: 4, marginBottom: 12 },

  categoryContent: { flexDirection: "row", gap: 8, paddingRight: 10 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  pillActive: { backgroundColor: C.primary, borderColor: C.primary },

  pillIcon: { fontSize: 6 },

  pillLabel: { fontSize: 12, fontWeight: "700", color: C.text2 },

  pillLabelActive: { color: "#fff" },

  filterArea: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 8,
    marginBottom: 12,
  },

  filterDropdown: { flex: 1, minWidth: 0 },

  filterDropdownWeb: { maxWidth: 280 },

  filterBtn: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.elevated,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    gap: 5,
  },

  filterBtnIcon: { width: 40, paddingHorizontal: 0 },

  filterBtnActive: { borderColor: C.teal },

  filterBtnIconText: { fontSize: 12 },

  filterBtnText: { fontSize: 12, fontWeight: "600", color: C.text2 },

  filterBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: C.teal,
    alignItems: "center",
    justifyContent: "center",
  },

  filterBadgeText: { fontSize: 9, fontWeight: "800", color: "#fff" },

  clearBtn: { minHeight: 40, justifyContent: "center", paddingHorizontal: 6 },

  clearBtnIcon: { width: 26, alignItems: "center", paddingHorizontal: 0 },

  clearBtnText: { fontSize: 11, fontWeight: "700", color: C.error },

  inlineFilterCard: {
    backgroundColor: C.goldBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.gold,
    padding: 12,
    marginBottom: 12,
  },

  inlineFilterLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.goldText,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  searchIndicator: { fontSize: 12, color: C.primary, marginBottom: 16 },

  dropdownTrigger: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  dropdownLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },

  dropdownValue: { fontSize: 12, fontWeight: "600", color: C.text },

  dropdownChevron: { fontSize: 8, color: C.text3, marginLeft: 6 },

  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  dropdownModal: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 20,
  },

  dropdownModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  dropdownModalTitle: { fontSize: 14, fontWeight: "800", color: C.text },

  dropdownModalSubtitle: { fontSize: 10, color: C.text3, marginTop: 1 },

  dropdownClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.elevated,
  },

  dropdownCloseText: { fontSize: 12, color: C.text3 },

  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  dropdownItemActive: { backgroundColor: C.pill },

  dropdownRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  dropdownRadioActive: { borderColor: C.primary },

  dropdownRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.primary },

  dropdownItemText: { flex: 1, fontSize: 13, color: C.text2 },

  dropdownItemTextActive: { color: C.primary, fontWeight: "700" },

  reportColumns: { flexDirection: "column", gap: 16 },

  reportColumnsWide: { flexDirection: "row" },

  reportColumn: { flex: 1, minWidth: 0 },

  kpiMiniRow: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8, marginBottom: 12 },

  kpiMini: { minWidth: 90, maxWidth: 170 },

  kpiMiniLabel: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 2,
  },

  kpiMiniValue: { fontSize: 15, fontWeight: "800", color: C.text },

  noData: { color: C.text3, fontSize: 12, paddingVertical: 24, textAlign: "center" },
  emptyInline: { color: C.text3, fontSize: 11, paddingVertical: 14, textAlign: "center" },

  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },

  exportActions: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },

  exportBtn: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },

  exportBtnText: { fontSize: 11, fontWeight: "700", color: C.text2 },

  previewRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.borderLight },

  previewHeadCell: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 120,
  },

  previewCell: {
    fontSize: 12,
    color: C.text2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 120,
  },

  previewCount: { fontSize: 11, color: C.text3, marginTop: 10 },

  resultsCount: { fontSize: 11, color: C.text3 },

  resultsSubtext: { fontSize: 10, color: C.text3, marginTop: 2 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },

  sectionSubtext: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
  },

  contributionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  contributionIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  contributionInfo: {
    flex: 1,
    minWidth: 0,
  },

  contributionType: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },

  contributionDate: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
  },

  contributionDescription: {
    fontSize: 10,
    color: C.text3,
    marginTop: 1,
  },

  contributionAmount: {
    fontSize: 12,
    fontWeight: "800",
    color: C.success,
  },

  memberRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },

  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  memberAvatarText: { fontSize: 12, fontWeight: "800", color: C.primary },

  memberInfo: { flex: 1, minWidth: 0 },

  memberName: { fontSize: 13, fontWeight: "700", color: C.text },

  memberContact: { fontSize: 10, color: C.text3, marginTop: 1 },

  memberStats: { alignItems: "flex-end", flexShrink: 0, maxWidth: 120 },

  memberAmount: { fontSize: 12, fontWeight: "700", color: C.primary },

  memberRole: { fontSize: 9.5, color: C.text3, textTransform: "capitalize", marginTop: 1 },

  chevron: { fontSize: 18, color: C.text3, flexShrink: 0 },

  backButton: { marginBottom: 14, alignSelf: "flex-start" },

  backButtonText: { color: C.primary, fontSize: 13, fontWeight: "600" },

  memberDetailCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 14,
  },

  memberDetailHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },

  memberDetailName: { fontSize: 18, fontWeight: "800", color: C.text, marginBottom: 3 },

  memberDetailRole: { fontSize: 12, color: C.text3 },

  memberContactBlock: { alignItems: "center", gap: 3 },

  memberDetailText: { fontSize: 11, color: C.text2 },

  memberKpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 16 },

  memberKpi: { flex: 1, minWidth: 110 },

  memberKpiLabel: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 2,
  },

  memberKpiValue: { fontSize: 16, fontWeight: "800" },

  transactionRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 10 },

  txDot: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },

  transactionInfo: { flex: 1, minWidth: 0 },

  transactionType: { fontSize: 12, fontWeight: "600", color: C.text },

  transactionDate: { fontSize: 10, color: C.text3, marginTop: 1 },

  transactionAmount: { fontSize: 12, fontWeight: "700", marginLeft: 8, flexShrink: 0 },

  modalIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: C.text3,
    marginBottom: 16,
  },

  filterSection: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  filterSectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },

  filterSectionHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: C.text3,
    marginBottom: 10,
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },

  chipRowScroll: { flexDirection: "row", flexWrap: "nowrap", gap: 8, paddingRight: 4 },

  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  statusChipActive: { backgroundColor: C.primary, borderColor: C.primary },

  statusChipText: { fontSize: 11, fontWeight: "600", color: C.text2 },

  statusChipTextActive: { color: "#fff" },

  conditionGroupLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  conditionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    marginBottom: 8,
  },

  conditionCardActive: { borderColor: C.primary, backgroundColor: C.pill },

  conditionRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },

  conditionRadioActive: { borderColor: C.primary },

  conditionRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.primary },

  conditionCardTitle: { fontSize: 12, fontWeight: "700", color: C.text },

  conditionCardDesc: { fontSize: 10.5, color: C.text3, marginTop: 2, lineHeight: 14 },

  activeFiltersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },

  activeFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: C.pill,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: "100%",
  },

  activeFilterChipText: { fontSize: 10, fontWeight: "600", color: C.primary, flexShrink: 1 },

  activeFilterChipClose: { fontSize: 10, fontWeight: "800", color: C.primary, opacity: 0.7 },

  earningsModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },

  earningsModeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  earningsModeBtnActive: { backgroundColor: C.primary, borderColor: C.primary },

  earningsModeBtnText: { fontSize: 11, fontWeight: "700", color: C.text2 },

  earningsModeBtnTextActive: { color: "#fff" },

  modalSectionLabel: { fontSize: 12, fontWeight: "700", color: C.text, marginTop: 12, marginBottom: 8 },

  modalRow: { flexDirection: "row", gap: 10, marginBottom: 10 },

  modalHalf: { flex: 1, minWidth: 0 },

  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 18 },

  modalClearBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },

  modalClearBtnText: { fontSize: 13, fontWeight: "600", color: C.text2 },

  modalApplyBtn: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },

  modalApplyBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // ── Waiver section ────────────────────────────────────────────────────
  waiverSection: { marginBottom: 18 },
  waiverHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  waiverTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  waiverCountBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" },
  waiverCountText: { fontSize: 10, fontWeight: "800", color: C.primary },
  waiverGroupLabel: { fontSize: 9, fontWeight: "800", color: C.text3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  waiverCard: { backgroundColor: C.goldBg, borderRadius: 10, borderWidth: 1, borderColor: C.gold, padding: 10, marginBottom: 8 },
  waiverCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 8 },
  waiverScopeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  waiverScopeText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  waiverPeriod: { fontSize: 12, fontWeight: "700", color: C.text, marginBottom: 3 },
  waiverAmount: { fontSize: 12, fontWeight: "800", color: C.goldText, marginBottom: 5 },
  waiverReason: { fontSize: 11, color: C.text2, lineHeight: 15, marginBottom: 5 },
  waiverMeta: { fontSize: 9.5, color: C.text3, marginBottom: 8 },
  waiverRemoveBtn: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: C.error, backgroundColor: C.redBg },
  waiverRemoveBtnText: { fontSize: 10, fontWeight: "700", color: C.redText },
  waiverEmpty: { fontSize: 11, color: C.text3, textAlign: "center", paddingVertical: 14 },
  memberWaiverPill: { marginTop: 3, alignSelf: "flex-start", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.gold },
  memberWaiverPillText: { fontSize: 9, fontWeight: "800", color: C.goldText, letterSpacing: 0.2 },
});

const lightStyles = makeStyles(LightPalette);
const darkStyles = makeStyles(DarkPalette);
