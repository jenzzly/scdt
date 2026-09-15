// app/(tabs)/reports.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  useWindowDimensions,
  Modal,
  Platform,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  useActiveGroup,
  useGroupMembers,
  useGroupLoans,
  useGroupContributions,
  useGroupInvestments,
  useGroupWallet,
  useCurrentMember,
  useCurrentMemberPermissions,
  useIsAdminView,
  useIsGroupView,
} from "../../stores/useStore";

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
  C,
  T,
  fmtCurrency,
  fmtDate,
  round2,
} from "../../utils/theme";

import {
  exportXlsx,
  exportPdf,
} from "../../utils/export";

import {
  findOverdueContributions,
  findOverdueInstallments,
} from "../../utils/lateFees";

// Shared with loans.tsx and record-repayment.tsx — same anchor chain,
// same daily-rate math. Used here only for the "Accrued (unpaid)"
// snapshot figure; the "Interest Earned" and "Projected Interest"
// figures below still measure different things (see comments there).
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

// Member-status advanced filter. "all" = no member-status restriction.
type MemberStatusFilter =
  | "all"
  | "has_unpaid_fees"
  | "late_contribution_fees"
  | "late_loans"
  | "no_contributions_in_period"
  | "no_loans";

// Profits tab: which slice of earnings to show. "all" combines what's
// already been collected with what's still expected; "actual" shows only
// money that has actually landed (repayments + fees already paid);
// "projected" shows only what's still outstanding/expected.
type EarningsViewMode = "all" | "actual" | "projected";

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
  // { key: "expenses", label: "Expenses", icon: "🧾" },
  // { key: "investments", label: "Investments", icon: "📊" },
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

// Simple chip-row options for Loan/Contribution status — short label +
// short helper shown under the row, no nested modal (avoids stacking a
// dropdown-modal inside the already-open filter modal).
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

// Member Condition, grouped with one-line explanations so it's clear
// what each option actually checks for — this is the part of the old
// modal that was most likely to confuse people (six flat options with no
// context for what "late" or "no activity" means here).
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

// Counts how many distinct filter GROUPS are active (not individual
// fields) — a date range counts once even though it's two fields, so the
// number matches how many chips a person would see, not how many state
// variables changed.
function countActiveFilters(opts: {
  search: string;
  fromDate: string;
  toDate: string;
  loanStatus: string;
  contributionStatus: string;
  memberStatus: string;
}) {
  let n = 0;
  if (opts.search) n++;
  if (opts.fromDate || opts.toDate) n++;
  if (opts.loanStatus !== "all") n++;
  if (opts.contributionStatus !== "all") n++;
  if (opts.memberStatus !== "all") n++;
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

// Loan interest projection for a single loan, scoped to a date window.
// Pulled out as a standalone helper (not a hook) so it can safely be
// called from multiple useMemo blocks without violating the Rules of
// Hooks and without duplicating the implementation.
//
// NOTE on what this measures: this is the SCHEDULE-BASED projection —
// the interest that will be earned IF every remaining installment is
// paid exactly on its scheduled due date. For reducing-balance loans,
// the real interest earned depends on actual payment timing (late
// payments accrue more; early payments accrue less), which is what
// groupAccruedInterestUnpaid captures live. The two figures answer
// different questions:
//   - this one: "what does the plan say we'll earn?"
//   - accruedUnpaid: "what has already accrued but isn't yet paid?"
//
// FIX: previously this only summed installments whose due date fell
// between the loan's start and "now" (or the selected toDate). That
// meant a freshly-disbursed loan with no installment due yet always
// projected $0 interest, even though the full schedule clearly has
// interest attached to it.
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

    projectedInterest += installment.interest;
  });

  return round2(projectedInterest);
}

// ─────────────────────────────────────────────────────────────────────────
// KPI
// ─────────────────────────────────────────────────────────────────────────

const KpiCard = ({
  label,
  value,
  color,
  subtext,
}: {
  label: string;
  value: string;
  color: string;
  subtext?: string;
}) => (
  <View style={[styles.kpiCard, { borderTopColor: color }]}>
    <Text style={styles.kpiLabel} numberOfLines={1}>
      {label}
    </Text>

    <Text
      style={[styles.kpiValue, { color }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
    >
      {value}
    </Text>

    {subtext ? (
      <Text style={styles.kpiSubtext} numberOfLines={1}>
        {subtext}
      </Text>
    ) : null}
  </View>
);

// ─────────────────────────────────────────────────────────────────────────
// Earnings donut — source breakdown with side legend
// ─────────────────────────────────────────────────────────────────────────
function EarningsDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const positiveSegments = segments.filter(
    (s) => Number.isFinite(s.value) && s.value > 0
  );
  const total = positiveSegments.reduce((sum, s) => sum + s.value, 0);

  const size = 150;
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
        <Svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Track makes the donut look complete even with rounded segment caps. */}
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
                <View
                  style={[
                    styles.donutLegendDot,
                    { backgroundColor: seg.color },
                  ]}
                />
                <Text
                  style={styles.donutLegendText}
                  numberOfLines={1}
                >
                  {seg.label}
                </Text>
              </View>
              <Text style={styles.donutLegendPct}>{pct}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Gauge — single percentage metric, semicircular
// ─────────────────────────────────────────────────────────────────────────
function Gauge({
  value,
  max = 100,
  color = C.success,
  trackColor = C.border,
}: {
  value: number;
  max?: number;
  color?: string;
  trackColor?: string;
}) {
  const size = 190;
  const strokeWidth = 16;
  const padding = strokeWidth / 2 + 2;
  const centerX = size / 2;
  const centerY = size / 2 + 4;
  const radius = (size - strokeWidth) / 2 - 2;
  const left = centerX - radius;
  const right = centerX + radius;
  const arcLength = Math.PI * radius;

  const safeMax = max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(1, safeValue / safeMax));
  const progressLength = pct * arcLength;

  // A real SVG arc is used instead of a dashed Circle. Dashed circles are
  // easy to clip/misalign because their dash pattern is based on the full
  // circumference, not the visible semicircle.
  const arcPath = `M ${left} ${centerY} A ${radius} ${radius} 0 0 1 ${right} ${centerY}`;

  return (
    <View style={styles.gaugeContainer}>
      <Svg
        width={size}
        height={size / 2 + padding}
        viewBox={`0 0 ${size} ${size / 2 + padding}`}
      >
        <Path
          d={arcPath}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />

        {progressLength > 0 && (
          <Path
            d={arcPath}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${progressLength} ${arcLength}`}
          />
        )}
      </Svg>

      <View style={styles.gaugeValueWrap}>
        <Text style={styles.gaugeValue}>
          {Math.round(Math.max(0, safeValue))}%
        </Text>
      </View>
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
  const safeIncome = income.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const safeExpenses = expenses.map((v) =>
    Number.isFinite(v) ? Math.max(0, v) : 0
  );
  const max = Math.max(1, ...safeIncome, ...safeExpenses);
  const chartWidth = Math.max(320, months.length * 72);

  return (
    <View style={{ marginTop: 8 }}>
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.cashflowPlot, { width: chartWidth }]}>
          {months.map((m, i) => {
            const incH = safeIncome[i] > 0 ? Math.max(3, (safeIncome[i] / max) * 120) : 0;
            const expH = safeExpenses[i] > 0 ? Math.max(3, (safeExpenses[i] / max) * 120) : 0;

            return (
              <View key={`${m}_${i}`} style={styles.cashflowMonth}>
                <View style={styles.cashflowBars}>
                  {incH > 0 && (
                    <View style={[styles.cashflowBar, { height: incH, backgroundColor: C.success }]} />
                  )}
                  {expH > 0 && (
                    <View style={[styles.cashflowBar, { height: expH, backgroundColor: C.error }]} />
                  )}
                </View>

                <Text
                  style={styles.cashflowMonthLabel}
                  numberOfLines={1}
                >
                  {m}
                </Text>
              </View>
            );
          })}
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

// Small single-select chip row — used for Loan/Contribution status so
// the filter modal doesn't have to nest another dropdown-modal inside
// itself. Chips are always all visible at once (max 4 options), so
// there's no extra tap needed to see what's available.
function StatusChipRow({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.statusChip, active && styles.statusChipActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
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
  onApply,
  searchTerm,
  onSearchChange,
  onClear,
  activeFilterCount,
}: any) {
  return (
    <BottomModal visible={visible} onClose={onClose} title="Advanced Filters">
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.modalIntro}>
          Every filter below narrows the same list further — a record has
          to match ALL of the ones you set, not just one.
        </Text>

        {/* ── Search ──────────────────────────────────────────────── */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Search</Text>
          <Input
            value={searchTerm}
            onChangeText={onSearchChange}
            placeholder="Search by member, ID, description..."
            leftIcon="🔍"
          />
        </View>

        {/* ── Time period ─────────────────────────────────────────── */}
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

        {/* ── Loan status ─────────────────────────────────────────── */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Loan Status</Text>
          <Text style={styles.filterSectionHelp}>Only affects the Loans report tab.</Text>
          <StatusChipRow value={loanStatus} options={LOAN_STATUS_CHIPS} onChange={onLoanStatusChange} />
        </View>

        {/* ── Contribution status ─────────────────────────────────── */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionTitle}>Contribution Status</Text>
          <Text style={styles.filterSectionHelp}>Only affects the Contributions report tab.</Text>
          <StatusChipRow
            value={contributionStatus}
            options={CONTRIBUTION_STATUS_CHIPS}
            onChange={onContributionStatusChange}
          />
        </View>

        {/* ── Member condition ────────────────────────────────────── */}
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
      </ScrollView>
    </BottomModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { width } = useWindowDimensions();

  const isWide = width >= 1024;
  const isMobile = width < 600;

  const group = useActiveGroup();
  const allMembers = useGroupMembers();
  const allLoans = useGroupLoans();
  const allContributions = useGroupContributions();
  const allInvestments = useGroupInvestments();
  const allWallet = useGroupWallet();
  const permissions = useCurrentMemberPermissions();
  const currentMember = useCurrentMember();
  const canSeeAll = useIsAdminView();

  // View mode now comes from the shared header toggle (ViewSwitch in
  // _layout.tsx / useDataViewMode), not a local scope state — this screen
  // no longer renders its own Group/Personal buttons.
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

  // Member-status advanced filter (fees/late/no-contribution/no-loan conditions).
  const [memberStatusFilter, setMemberStatusFilter] =
    useState<MemberStatusFilter>("all");

  // Profits tab only: which slice of earnings to show (see EarningsViewMode).
  const [earningsMode, setEarningsMode] = useState<EarningsViewMode>("all");

  const [tempSearch, setTempSearch] = useState("");
  const [tempFromDate, setTempFromDate] = useState("");
  const [tempToDate, setTempToDate] = useState("");
  const [tempLoanStatus, setTempLoanStatus] = useState<typeof loanStatus>("all");
  const [tempContributionStatus, setTempContributionStatus] =
    useState<typeof contributionStatus>("all");
  const [tempMemberStatus, setTempMemberStatus] =
    useState<MemberStatusFilter>("all");

  // Reset member filter whenever the header toggle flips personal <-> group,
  // since "all members" only makes sense in group view.
  useEffect(() => {
    if (isPersonalView) {
      setMemberIdFilter("all");
    }
  }, [isPersonalView]);

  // ───────────────────────────────────────────────────────────────────────
  // Scope
  // ───────────────────────────────────────────────────────────────────────

  const members = isPersonalView
    ? allMembers.filter((m) => m.id === currentMember?.id)
    : allMembers;

  const loans = isPersonalView
    ? allLoans.filter((l) => l.memberId === currentMember?.id)
    : allLoans;

  const contributions = isPersonalView
    ? allContributions.filter((c) => c.memberId === currentMember?.id)
    : allContributions;

  const investments = isPersonalView
    ? allInvestments.filter(
        (i: any) => i.createdBy === currentMember?.id || i.memberId === currentMember?.id
      )
    : allInvestments;

  const wallet = isPersonalView
    ? allWallet.filter((t) => t.memberId === currentMember?.id)
    : allWallet;

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
    setShowFilterModal(true);
  };

  const applyFilters = () => {
    setSearchTerm(tempSearch);
    setSelectedFromDate(tempFromDate);
    setSelectedToDate(tempToDate);
    setLoanStatus(tempLoanStatus);
    setContributionStatus(tempContributionStatus);
    setMemberStatusFilter(tempMemberStatus);
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

    setTempSearch("");
    setTempFromDate("");
    setTempToDate("");
    setTempLoanStatus("all");
    setTempContributionStatus("all");
    setTempMemberStatus("all");
  };

  const hasActiveFilters =
    selectedFromDate !== "" ||
    selectedToDate !== "" ||
    loanStatus !== "all" ||
    contributionStatus !== "all" ||
    searchTerm !== "" ||
    memberIdFilter !== "all" ||
    memberStatusFilter !== "all";

  const inDateRange = (dStr?: string) => {
    if (!dStr) return true;
    const d = dStr.slice(0, 10);
    if (selectedFromDate && d < selectedFromDate) return false;
    if (selectedToDate && d > selectedToDate) return false;
    return true;
  };

  const inMember = (id?: string) => memberIdFilter === "all" || id === memberIdFilter;

  const matchesSearch = (item: any, fields: string[]) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return fields.some((field) => item[field]?.toString().toLowerCase().includes(term));
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
      .filter((item: any) => (isPersonalView ? item.memberId === currentMember?.id : true));
  }, [overdue, allWallet, isPersonalView, currentMember?.id]);

  // ───────────────────────────────────────────────────────────────────────
  // Overdue loans — derived from findOverdueInstallments, which returns
  // one record per overdue installment: { memberId, loanId, daysLate, ... }.
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

  // ───────────────────────────────────────────────────────────────────────
  // Member-status derived sets — computed once per render from full
  // (unfiltered-by-category) group data, then intersected into each
  // category's row filter below.
  // ───────────────────────────────────────────────────────────────────────

  const unpaidFeeMemberIds = useMemo(
    () => new Set(lateFees.filter((f: any) => !f.isPaid).map((f: any) => f.memberId)),
    [lateFees]
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

  // Members with zero approved contributions inside the active date range
  // (selectedFromDate/selectedToDate, or all-time if neither is set).
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
  }, [contributions, members, selectedFromDate, selectedToDate]);

  // Members who have never taken out a loan (no loan records at all).
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
        return null; // "all" — no restriction
    }
  };

  const memberStatusSet = memberStatusSetFor(memberStatusFilter);

  const passesMemberStatus = (id?: string) =>
    !memberStatusSet || (!!id && memberStatusSet.has(id));

  // "No contributions in period" filtered against the Contributions
  // category — and "No loans taken" filtered against the Loans category —
  // can never produce a transaction row by definition: those members are
  // in the set precisely because they have zero matching records. Detect
  // that combination so we can show the qualifying MEMBERS instead of an
  // structurally-guaranteed-empty transaction list.
  const isNoActivityMemberView =
    (category === "contributions" &&
      memberStatusFilter === "no_contributions_in_period") ||
    (category === "loans" && memberStatusFilter === "no_loans");

  // ───────────────────────────────────────────────────────────────────────
  // Overview financial calculations
  // ───────────────────────────────────────────────────────────────────────

  const EARNING_TYPES_OVERVIEW = [
    "loan_interest_income",
    "interest",
    "late_fee",
    "investment_return",
    "bank_fee",
    "other_credit",
    "other_debit",
  ];

  const groupWalletEarnings = useMemo(
    () =>
      round2(
        wallet.reduce((sum, t) => {
          if (t.type === "loan_repayment") {
            const loan = loans.find((l) => l.id === t.loanId);
            if (!loan?.totalRepayable) return sum;
            return sum + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
          }

          if (EARNING_TYPES_OVERVIEW.includes(t.type)) {
            return sum + t.amount;
          }

          return sum;
        }, 0)
      ),
    [wallet, loans]
  );

  const groupExpenses = useMemo(
    () =>
      wallet
        .filter((t) => ["bank_fee", "other_debit"].includes(t.type))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [wallet]
  );

  const groupInterestOnly = useMemo(
    () =>
      round2(
        wallet.reduce((sum, t) => {
          if (t.type === "loan_repayment") {
            const loan = loans.find((l) => l.id === t.loanId);
            if (!loan?.totalRepayable) return sum;
            return sum + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
          }

          if ((t.type === "loan_interest_income" || t.type === "interest") && t.amount > 0) {
            return sum + t.amount;
          }

          return sum;
        }, 0)
      ),
    [wallet, loans]
  );

  const groupContributionsOnly = useMemo(
    () =>
      round2(
        wallet
          .filter((t) => t.type === "contribution" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [wallet]
  );

  const groupPenaltiesOnly = useMemo(
    () =>
      round2(
        wallet
          .filter((t) => t.type === "late_fee" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [wallet]
  );

  const groupInvestmentReturnsOnly = useMemo(
    () =>
      round2(
        wallet
          .filter((t) => t.type === "investment_return" && t.amount > 0)
          .reduce((s, t) => s + t.amount, 0)
      ),
    [wallet]
  );

  // Total principal currently disbursed across active loans — replaces the
  // old "Projected Late Fees" card, which was often $0 and less useful than
  // seeing loan exposure at a glance. groupTotalInvestments is also kept
  // here in case "Total Investments" is preferred in that slot instead.
  const groupTotalLoansDisbursed = useMemo(
    () =>
      round2(
        loans
          .filter((l) => l.status === "disbursed")
          .reduce((s, l) => s + (l.amount || 0), 0)
      ),
    [loans]
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
    const known = [
      "contribution",
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "loan_disbursement",
      "loan_repayment",
      "loan_principal_recovery",
    ];

    return round2(
      wallet.filter((t) => !known.includes(t.type)).reduce((s, t) => s + t.amount, 0)
    );
  }, [wallet]);

  const groupTotalNetAssets = useMemo(
    () => round2(wallet.reduce((s, t) => s + t.amount, 0)),
    [wallet]
  );

  // ───────────────────────────────────────────────────────────────────────
  // Accrued (unpaid) interest — current snapshot, "how much interest has
  // built up on reducing-balance loans that hasn't been collected yet".
  //
  // Uses the SAME computeTodayAccrued() helper as loans.tsx's loan detail
  // modal and record-repayment.tsx, so this figure matches exactly what
  // each individual loan shows when you open it.
  //
  // Respects the Member filter (only this member's loans, if scoped) and
  // the Member Condition filter, but NOT the date range — it's a live
  // "as of right now" balance, not a period-bounded figure, the same way
  // Total Net Assets and Total Loans above also ignore the date range.
  // ───────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────
  // Projected calculations — based on user-selected date range. These two
  // hooks are the single source of truth for loan-interest and
  // loan-late-fee projections. They are declared once, at the top level
  // (never inside another hook's callback), and used by BOTH the Overview
  // cards further down AND the Profits/Earnings report tab via `view`.
  // ───────────────────────────────────────────────────────────────────────

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

  const totalProjectedEarnings = round2(
    projectedLoanInterest + projectedLoanLateFees
  );

  // ───────────────────────────────────────────────────────────────────────
  // Collection rate — drives the gauge. Personal: my contributions vs my
  // goal-period target. Group: total collected vs (target × active
  // members), matching the same math used on the Contributions screen.
  // ───────────────────────────────────────────────────────────────────────

  const collectionRatePct = useMemo(() => {
    if (!group) return 0;

    const target = group.contributionAmount || 0;
    if (target <= 0) return 0;

    const activeCount = allMembers.filter((m) => m.status === "active").length;
    const expected = isPersonalView ? target : target * Math.max(1, activeCount);

    const collected = contributions
      .filter((c) => c.status === "approved" && c.contributionType === "regular")
      .reduce((s, c) => s + (c.amount || 0), 0);

    return expected > 0 ? Math.min(999, Math.round((collected / expected) * 100)) : 0;
  }, [group, allMembers, contributions, isPersonalView]);

  // ───────────────────────────────────────────────────────────────────────
  // Cashflow
  // ───────────────────────────────────────────────────────────────────────

  const cashflow = useMemo(() => {
    const months: string[] = [];
    const income: number[] = [];
    const expenses: number[] = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);

      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const monthTxs = wallet.filter((t) => {
        const txDate = new Date(t.date);
        return txDate >= startOfMonth && txDate <= endOfMonth;
      });

      months.push(d.toLocaleDateString("en", { month: "short" }));

      income.push(monthTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));

      expenses.push(
        Math.abs(monthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0))
      );
    }

    return { months, income, expenses };
  }, [wallet]);

  // ───────────────────────────────────────────────────────────────────────
  // Member savings chart
  // ───────────────────────────────────────────────────────────────────────

  const memberPie = useMemo(() => {
    const top = members
      .filter((m) => m.status === "active" && m.totalContributions > 0)
      .slice(0, 5);

    const palette = [C.accent, C.gold, C.info, C.success, "#7C3AED"];

    return top.map((m, i) => ({
      name: m.fullName.split(" ")[0],
      population: m.totalContributions,
      color: palette[i % palette.length],
    }));
  }, [members]);

  // ───────────────────────────────────────────────────────────────────────
  // Month options
  // ───────────────────────────────────────────────────────────────────────

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
        source = lateFees;
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
  }, [category, contributions, loans, lateFees, members, wallet, investments]);

  // ───────────────────────────────────────────────────────────────────────
  // Member options
  // ───────────────────────────────────────────────────────────────────────

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
      let list = lateFees.filter(
        (f: any) =>
          inDateRange(f.periodStart) &&
          inMember(f.memberId) &&
          passesMemberStatus(f.memberId)
      );

      list = list.filter((f: any) => matchesSearch(f, ["memberId", "periodLabel"]));

      const chart = monthlyTotals(list, "periodStart", "feeAmount");

      return {
        rows: list,
        headers: ["Member", "Period", "Days Late", "Fee Amount", "Status"],
        toRow: (f: any) => [
          getMemberName(f.memberId),
          f.periodLabel ?? "—",
          f.daysLate ?? 0,
          fmtCurrency(f.feeAmount || 0),
          f.isPaid ? "Paid" : "Unpaid",
        ],
        chart,
        chartColor: C.error,
        kpis: [
          {
            label: "Total Owed",
            value: fmtCurrency(
              list
                .filter((f: any) => !f.isPaid)
                .reduce((s: number, f: any) => s + (f.feeAmount || 0), 0)
            ),
          },
          { label: "Records", value: String(list.length) },
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

    // ─────────────────────────────────────────────────────────────────────
    // Earnings ("Profits" tab). loanInterestProjections and loanLateFees
    // are computed ONCE at the top level of the component (see above) and
    // simply referenced here — no hooks are called inside this branch.
    //
    // The chart sums real dollar amounts for both actual and projected
    // rows. The KPIs are broken out by source (interest / late fees /
    // projected) instead of one vague "Actual Collected" bucket, and each
    // shows the ALL-IN total (actual + projected combined) where that
    // makes sense, plus a standalone "Projected Earnings" figure for the
    // forward-looking piece alone.
    // ─────────────────────────────────────────────────────────────────────

    const EARNING_TYPES = [
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "bank_fee",
      "other_credit",
      "other_debit",
    ];

    const earningAmount = (t: any) => {
      if (t.type !== "loan_repayment") return t.amount;

      // Legacy combined tx only — estimate the interest slice of a
      // blended repayment using the loan's fixed schedule ratio. Modern
      // loans already have a dedicated loan_interest_income row with the
      // exact amount, so they never reach this branch.
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

    // ── Actual earnings, broken down by source ────────────────────────
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

    // ── Projected (top-level memos, independent of wallet history) ────
    const totalProjectedInterest = projectedLoanInterest;
    const totalLoanLateFees = projectedLoanLateFees;
    const totalProjected = round2(totalProjectedInterest + totalLoanLateFees);

    // ── Combined, all-in totals shown on the KPI row ───────────────────
    const combinedTotal = round2(totalEarnings + totalProjected);
    const totalInterestAllIn = round2(actualInterest + totalProjectedInterest);
    const totalLateFeesAllIn = round2(actualLateFees + totalLoanLateFees);

    // Line-item rows for the projected interest / projected late fees,
    // built from the shared top-level memos.
    const projectedRows = [
      ...loanInterestProjections.map((item) => ({
        type: "projected_interest",
        date: item.applicationDate,
        memberId: item.memberId,
        memberName: item.memberName,
        description: `Projected interest for loan ${item.loanId.slice(0, 8)}...`,
        amount: item.projectedInterest,
        loanId: item.loanId,
      })),
      ...loanLateFees.map((item) => ({
        type: "loan_late_fee",
        date: item.dueDate,
        memberId: item.memberId,
        memberName: item.memberName,
        description: `Late fee - Installment ${item.installmentIndex + 1} (${item.daysLate} days late)`,
        amount: item.feeAmount,
        loanId: item.loanId,
      })),
    ];

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

    // earningsMode picks which rows/kpis the Profits tab actually shows.
    // "all" keeps the original combined view; "actual" and "projected"
    // isolate one side so someone can check "what have we actually
    // collected (including fees already paid)" separately from "what's
    // still expected."
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
        { label: "Total Projected", value: fmtCurrency(totalProjected) },
        { label: "Projected Interest", value: fmtCurrency(totalProjectedInterest) },
        { label: "Projected Late Fees", value: fmtCurrency(totalLoanLateFees) },
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

    // Chart sums real dollar amounts (not record counts) per month, for
    // whichever row set is currently selected.
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
    lateFees,
    members,
    wallet,
    investments,
    selectedFromDate,
    selectedToDate,
    memberIdFilter,
    searchTerm,
    loanStatus,
    contributionStatus,
    memberStatusFilter,
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
  ]);

  // ───────────────────────────────────────────────────────────────────────
  // Export current report
  // ───────────────────────────────────────────────────────────────────────

  const exportRows = view.rows.map(view.toRow);

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

  // ───────────────────────────────────────────────────────────────────────
  // Export member contributions
  // ───────────────────────────────────────────────────────────────────────

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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════════════════════════════════════════════════════════════
            OVERVIEW
        ═══════════════════════════════════════════════════════════════ */}

        <View style={[styles.contentContainer, isWide && styles.contentContainerWide]}>
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>
              {isPersonalView ? "Personal Financial Position" : "Group Financial Position"}
            </Text>

            <View style={styles.gfpRow}>
              <View style={[styles.gfpStat, styles.gfpStatBorderRight, styles.gfpStatBorderBottom]}>
                <Text style={T.label} numberOfLines={1}>
                  {isPersonalView ? "My Account" : "Members"}
                </Text>

                <Text
                  style={styles.gfpStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {isPersonalView
                    ? "1"
                    : members.filter((m) => m.status === "active").length}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  {isPersonalView ? "personal" : "active"}
                </Text>
              </View>

              <View style={[styles.gfpStat, styles.gfpStatBorderBottom]}>
                <Text style={T.label} numberOfLines={1}>
                  Total Net Assets
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: C.primary }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {fmtCurrency(groupTotalNetAssets)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  {isPersonalView ? "my wallet" : "everything in wallet"}
                </Text>
              </View>
            </View>

            <View style={styles.gfpRow}>
              <View style={[styles.gfpStat, styles.gfpStatBorderRight, styles.gfpStatBorderBottom]}>
                <Text style={T.label} numberOfLines={1}>
                  Contributions
                </Text>

                <Text
                  style={styles.gfpStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupContributionsOnly)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  {isPersonalView ? "my contributions" : "total collected"}
                </Text>
              </View>

              <View style={[styles.gfpStat, styles.gfpStatBorderBottom]}>
                <Text style={styles.gfpStatLabel} numberOfLines={1}>
                  Interest Earned
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: C.gold }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupInterestOnly)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  {isPersonalView ? "my interest collected" : "already collected"}
                </Text>
              </View>
            </View>

            {/* Interest split: Accrued (unpaid, live) vs Projected
                (schedule-based). Two different ways of looking at the
                same money before it lands in the wallet. */}
            <View style={styles.gfpRow}>
              <View style={[styles.gfpStat, styles.gfpStatBorderRight, styles.gfpStatBorderBottom]}>
                <Text style={styles.gfpStatLabel} numberOfLines={1}>
                  Accrued (unpaid)
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: "#a855f7" }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupAccruedInterestUnpaid)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  reducing-balance loans
                </Text>
              </View>

              <View style={[styles.gfpStat, styles.gfpStatBorderBottom]}>
                <Text style={styles.gfpStatLabel} numberOfLines={1}>
                  Projected Interest
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: "#6366f1" }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(projectedLoanInterest)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  from remaining schedule
                </Text>
              </View>
            </View>

            <View style={styles.gfpRow}>
              <View style={[styles.gfpStat, styles.gfpStatBorderRight, styles.gfpStatBorderBottom]}>
                <Text style={T.label} numberOfLines={1}>
                  Penalties & Late Fees
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: C.error }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupPenaltiesOnly)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  collected
                </Text>
              </View>

              <View style={[styles.gfpStat, styles.gfpStatBorderBottom]}>
                <Text style={T.label} numberOfLines={1}>
                  Total Loans
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: "#f97316" }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupTotalLoansDisbursed)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  {isPersonalView ? "my disbursed balance" : "principal disbursed"}
                </Text>
              </View>
            </View>

            <View style={styles.gfpRow}>
              <View style={[styles.gfpStat, styles.gfpStatBorderRight]}>
                <Text style={T.label} numberOfLines={1}>
                  Investment Returns
                </Text>

                <Text
                  style={[styles.gfpStatValue, { color: C.success }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupInvestmentReturnsOnly)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  from investments
                </Text>
              </View>

              <View style={styles.gfpStat}>
                <Text style={T.label} numberOfLines={1}>
                  Other
                </Text>

                <Text
                  style={styles.gfpStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(groupOtherOnly)}
                </Text>

                <Text style={T.small} numberOfLines={1}>
                  bank fees, misc
                </Text>
              </View>
            </View>
          </View>

          {/* Earnings breakdown donut — the interest numbers are split
              into three distinct buckets: what's been collected
              ("Loan interest (actual)"), what's accrued but not yet paid
              ("Accrued (unpaid)"), and what the schedule says is still
              coming ("Projected interest (schedule)"). */}

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Profits by source</Text>
            <Text style={styles.chartSubtitle}>
              {isPersonalView ? "My earnings this period" : "Group earnings this period"}
              {selectedFromDate || selectedToDate ? ` (${selectedFromDate || "start"} to ${selectedToDate || "now"})` : ""}
            </Text>

            <EarningsDonut
              segments={[
                { label: "Loan interest (actual)", value: groupInterestOnly, color: "#2a78d6" },
                { label: "Late fees (actual)", value: groupPenaltiesOnly, color: "#eb6834" },
                { label: "Investment returns", value: groupInvestmentReturnsOnly, color: "#1baf7a" },
                { label: "Accrued (unpaid)", value: groupAccruedInterestUnpaid, color: "#a855f7" },
                { label: "Projected interest (schedule)", value: projectedLoanInterest, color: "#6366f1" },
                { label: "Projected late fees", value: projectedLoanLateFees, color: "#f97316" },
                { label: "Other", value: groupOtherOnly, color: "#eda100" },
              ]}
            />
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Collection rate</Text>
            <Text style={styles.chartSubtitle}>
              {isPersonalView ? "My contributions vs my goal" : "Group contributions vs target"}
            </Text>

            <Gauge
              value={collectionRatePct}
              color={
                collectionRatePct >= 100
                  ? C.success
                  : collectionRatePct >= 70
                  ? C.gold
                  : C.error
              }
            />
          </View>

          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Cash Flow (Last 6 Months)</Text>

            <CashflowBarChart months={cashflow.months} income={cashflow.income} expenses={cashflow.expenses} />
          </View>

          {memberPie.length > 0 && (
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>
                {isPersonalView ? "My Savings" : "Savings by Member (Top 5)"}
              </Text>

              <MemberSharesChart data={memberPie} />
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════
            REPORT CONTROLS
        ═══════════════════════════════════════════════════════════════ */}

        <View style={[styles.contentContainer, isWide && styles.contentContainerWide]}>
          {/* Categories */}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroller}
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

          {/* Filters */}

          <View style={[styles.filterArea, isMobile && styles.filterAreaMobile]}>
            <View style={[styles.filterDropdown, isMobile && styles.filterDropdownMobile]}>
              <Dropdown label="Month" value={monthFilter} options={monthOptions} onChange={handleMonthChange} />
            </View>

            {!isPersonalView && (
              <View style={[styles.filterDropdown, isMobile && styles.filterDropdownMobile]}>
                <Dropdown
                  label="Member"
                  value={memberIdFilter}
                  options={memberOptions}
                  onChange={setMemberIdFilter}
                />
              </View>
            )}

            <TouchableOpacity style={styles.filterBtn} onPress={openFilterModal} activeOpacity={0.8}>
              <Text style={styles.filterBtnText}>
                {hasActiveFilters ? "🎯 Advanced" : "🔍 Advanced"}
              </Text>

              {hasActiveFilters && <View style={styles.filterDot} />}
            </TouchableOpacity>

            {hasActiveFilters && (
              <TouchableOpacity onPress={clearAllFilters} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>Clear</Text>
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

          {/* ═════════════════════════════════════════════════════════════
              MEMBERS
          ═════════════════════════════════════════════════════════════ */}

          {category === "members" ? (
            <MembersTab
              members={view.rows}
              contributions={contributions}
              loans={loans}
              wallet={wallet}
              isGroupView={!isPersonalView}
              currentMember={currentMember}
              onExport={handleExport}
              onExportContributions={handleExportMemberContributions}
              exportRows={exportRows}
            />
          ) : (
            <View style={[styles.reportColumns, isWide && styles.reportColumnsWide]}>
              {/* Chart */}

              <View style={[styles.card, isWide && styles.reportColumn]}>
                <Text style={styles.cardTitle}>
                  {isNoActivityMemberView
                    ? memberStatusFilter === "no_loans"
                      ? "Members With No Loans"
                      : "Members With No Contributions"
                    : `${CATEGORIES.find((c) => c.key === category)?.label} Overview`}
                </Text>

                {category === "earnings" && !isNoActivityMemberView && (
                  <View style={styles.earningsModeRow}>
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

                {view.chart.labels.length > 0 ? (
                  <CategoryBarChart labels={view.chart.labels} values={view.chart.values} color={view.chartColor} />
                ) : (
                  <Text style={styles.noData}>No data for this selection</Text>
                )}
              </View>

              {/* Data preview */}

              <View style={[styles.card, isWide && styles.reportColumn]}>
                <View style={styles.previewHeader}>
                  <Text style={styles.cardTitle}>Data Preview</Text>

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
                </View>

                {exportRows.length === 0 ? (
                  <Text style={styles.noData}>No records match your filters</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.previewRow}>
                        {view.headers.map((h) => (
                          <Text key={h} style={styles.previewHeadCell}>
                            {h}
                          </Text>
                        ))}
                      </View>

                      <ScrollView
                        style={{ maxHeight: 420 }}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={true}
                      >
                        {exportRows.map((row, i) => (
                          <View
                            key={i}
                            style={[
                              styles.previewRow,
                              i % 2 === 1 && { backgroundColor: C.elevated },
                            ]}
                          >
                            {row.map((cell, j) => (
                              <Text key={j} style={styles.previewCell} numberOfLines={2}>
                                {String(cell)}
                              </Text>
                            ))}
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  </ScrollView>
                )}

                {exportRows.length > 0 && (
                  <Text style={styles.previewCount}>
                    {exportRows.length} record{exportRows.length !== 1 ? "s" : ""}
                  </Text>
                )}
              </View>
            </View>
          )}
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
        })}
      />

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
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
  currentMember,
  onExport,
  onExportContributions,
  exportRows,
}: any) {
  const [selectedMember, setSelectedMember] = useState<any>(
    !isGroupView && members.length === 1 ? members[0] : null
  );

  useEffect(() => {
    if (!isGroupView) {
      setSelectedMember(members.length === 1 ? members[0] : null);
      return;
    }

    setSelectedMember((current: any) =>
      current && members.some((m: any) => m.id === current.id) ? current : null
    );
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
          members.map((m: any, i: number) => (
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
          ))
        )}
      </Card>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Member detail
// ─────────────────────────────────────────────────────────────────────────

function MemberDetail({
  member,
  loans,
  contributions,
  wallet,
  canGoBack,
  onBack,
  onExportContributions,
}: any) {
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

  // Live accrued (unpaid) interest across this member's reducing-balance
  // loans — same helper the loan detail modal and repayment screen use.
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

  return (
    <View>
      {canGoBack && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back to Directory</Text>
        </TouchableOpacity>
      )}

      {/* Member header */}

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

      {/* Member KPIs */}

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

          <Text style={[styles.memberKpiValue, { color: "#a855f7" }]}>
            {fmtCurrency(accruedInterestUnpaid)}
          </Text>
        </View>
      </View>

      {/* Contributions */}

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

      {/* Recent transactions */}

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
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────

const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.borderLight, marginHorizontal: 16 }} />
);

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { padding: 20 },

  contentContainer: { width: "100%" },

  contentContainerWide: { maxWidth: 1100, alignSelf: "center" },

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

  kpiValue: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3, marginBottom: 2 },

  kpiSubtext: { fontSize: 10, color: C.text3 },

  donutContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    flexWrap: "wrap",
    paddingVertical: 4,
  },

  donutVisual: {
    width: 150,
    height: 150,
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
    paddingHorizontal: 22,
  },

  donutCenterLabel: {
    fontSize: 11,
    color: C.text3,
    fontWeight: "600",
    marginBottom: 2,
  },

  donutCenterValue: {
    fontSize: 13,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
    maxWidth: 96,
  },

  donutLegend: {
    flex: 1,
    minWidth: 170,
    maxWidth: 280,
    gap: 9,
  },

  donutLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    width: 10,
    height: 10,
    borderRadius: 3,
    flexShrink: 0,
  },

  donutLegendText: {
    fontSize: 12,
    color: C.text2,
    flex: 1,
  },

  donutLegendPct: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
    flexShrink: 0,
  },

  donutEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },

  donutEmptyCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 18,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  donutEmptyText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
  },

  donutEmptySubtext: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
  },

  gaugeContainer: {
    width: 190,
    height: 118,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "flex-start",
    marginTop: 2,
  },

  gaugeValueWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },

  gaugeValue: {
    fontSize: 24,
    fontWeight: "800",
    color: C.text,
  },

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

  cashflowLegend: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 10,
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
    fontSize: 11,
    color: C.text3,
  },

  cashflowPlot: {
    height: 150,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  cashflowMonth: {
    width: 72,
    height: 150,
    alignItems: "center",
    justifyContent: "flex-end",
  },

  cashflowBars: {
    height: 120,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
  },

  cashflowBar: {
    width: 14,
    borderRadius: 4,
  },

  cashflowMonthLabel: {
    width: 72,
    fontSize: 9,
    color: C.text3,
    textAlign: "center",
    marginTop: 6,
  },

  chartCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
  },

  chartTitle: { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 4 },

  chartSubtitle: { fontSize: 12, color: C.text3, marginBottom: 12 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },

  cardWithBottomMargin: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginBottom: 20,
  },

  cardWithTopMargin: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginTop: 10,
  },

  cardTitle: { fontSize: 15, fontWeight: "800", color: C.text },

  gfpRow: { flexDirection: "row" },

  gfpStat: { flex: 1, minWidth: 0, padding: 14, gap: 3 },

  gfpStatBorderRight: { borderRightWidth: 1, borderRightColor: C.border },

  gfpStatBorderBottom: { borderBottomWidth: 1, borderBottomColor: C.border },

  gfpStatValue: { fontSize: 16, fontWeight: "800", color: C.text, letterSpacing: -0.3 },

  gfpStatLabel: { fontSize: 11, fontWeight: "700", color: C.text3 },

  categoryScroller: { marginTop: 4, marginBottom: 14 },

  categoryContent: { flexDirection: "row", gap: 10, paddingRight: 10 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  pillActive: { backgroundColor: "#2E7D6C", borderColor: "#2E7D6C" },

  pillIcon: { fontSize: 15 },

  pillLabel: { fontSize: 14, fontWeight: "700", color: C.text2 },

  pillLabelActive: { color: "#fff" },

  filterArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 12,
  },

  filterAreaMobile: { flexDirection: "column", alignItems: "stretch" },

  filterDropdown: { width: 190 },

  filterDropdownMobile: { width: "100%" },

  filterBtn: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.elevated,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },

  filterBtnText: { fontSize: 13, fontWeight: "600", color: C.text2 },

  filterDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },

  clearBtn: { minHeight: 46, justifyContent: "center", paddingHorizontal: 6 },

  clearBtnText: { fontSize: 12, fontWeight: "700", color: C.error },

  searchIndicator: { fontSize: 12, color: C.primary, marginBottom: 16 },

  dropdownTrigger: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  dropdownLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 1,
  },

  dropdownValue: { fontSize: 13, fontWeight: "600", color: C.text },

  dropdownChevron: { fontSize: 9, color: C.text3, marginLeft: 8 },

  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  dropdownModal: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: C.surface,
    borderRadius: 18,
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
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  dropdownModalTitle: { fontSize: 16, fontWeight: "800", color: C.text },

  dropdownModalSubtitle: { fontSize: 11, color: C.text3, marginTop: 2 },

  dropdownClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.elevated,
  },

  dropdownCloseText: { fontSize: 13, color: C.text3 },

  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  dropdownItemActive: { backgroundColor: C.pill },

  dropdownRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  dropdownRadioActive: { borderColor: C.primary },

  dropdownRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },

  dropdownItemText: { flex: 1, fontSize: 14, color: C.text2 },

  dropdownItemTextActive: { color: C.primary, fontWeight: "700" },

  reportColumns: { flexDirection: "column", gap: 16 },

  reportColumnsWide: { flexDirection: "row" },

  reportColumn: { flex: 1, minWidth: 0 },

  kpiMiniRow: { flexDirection: "row", flexWrap: "wrap", gap: 20, marginTop: 10, marginBottom: 16 },

  kpiMini: { minWidth: 100, maxWidth: 180 },

  kpiMiniLabel: {
    fontSize: 10,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 3,
  },

  kpiMiniValue: { fontSize: 18, fontWeight: "800", color: C.text },

  noData: { color: C.text3, fontSize: 13, paddingVertical: 30, textAlign: "center" },

  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },

  exportActions: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },

  exportBtn: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },

  exportBtnText: { fontSize: 12, fontWeight: "700", color: C.text2 },

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

  resultsCount: { fontSize: 12, color: C.text3 },

  resultsSubtext: { fontSize: 11, color: C.text3, marginTop: 3 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },

  sectionSubtext: {
    fontSize: 11,
    color: C.text3,
    marginTop: 3,
  },

  contributionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  contributionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  contributionInfo: {
    flex: 1,
    minWidth: 0,
  },

  contributionType: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
  },

  contributionDate: {
    fontSize: 11,
    color: C.text3,
    marginTop: 3,
  },

  contributionDescription: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },

  contributionAmount: {
    fontSize: 13,
    fontWeight: "800",
    color: C.success,
  },

  memberRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },

  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },

  memberAvatarText: { fontSize: 14, fontWeight: "800", color: C.primary },

  memberInfo: { flex: 1, minWidth: 0 },

  memberName: { fontSize: 14, fontWeight: "700", color: C.text },

  memberContact: { fontSize: 11, color: C.text3, marginTop: 2 },

  memberStats: { alignItems: "flex-end", flexShrink: 0, maxWidth: 130 },

  memberAmount: { fontSize: 13, fontWeight: "700", color: C.primary },

  memberRole: { fontSize: 10, color: C.text3, textTransform: "capitalize", marginTop: 2 },

  chevron: { fontSize: 20, color: C.text3, flexShrink: 0 },

  backButton: { marginBottom: 16, alignSelf: "flex-start" },

  backButtonText: { color: C.primary, fontSize: 14, fontWeight: "600" },

  memberDetailCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
  },

  memberDetailHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },

  memberDetailName: { fontSize: 20, fontWeight: "800", color: C.text, marginBottom: 4 },

  memberDetailRole: { fontSize: 13, color: C.text3 },

  memberContactBlock: { alignItems: "center", gap: 4 },

  memberDetailText: { fontSize: 12, color: C.text2 },

  memberKpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 20, marginBottom: 18 },

  memberKpi: { flex: 1, minWidth: 120 },

  memberKpiLabel: {
    fontSize: 10,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 3,
  },

  memberKpiValue: { fontSize: 18, fontWeight: "800" },

  transactionRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },

  txDot: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  transactionInfo: { flex: 1, minWidth: 0 },

  transactionType: { fontSize: 13, fontWeight: "600", color: C.text },

  transactionDate: { fontSize: 11, color: C.text3, marginTop: 2 },

  transactionAmount: { fontSize: 13, fontWeight: "700", marginLeft: 8, flexShrink: 0 },

  modalIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: C.text3,
    marginBottom: 16,
  },

  filterSection: {
    marginBottom: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },

  filterSectionTitle: {
    fontSize: 13,
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

  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  statusChipActive: { backgroundColor: C.primary, borderColor: C.primary },

  statusChipText: { fontSize: 12, fontWeight: "600", color: C.text2 },

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

  conditionCardTitle: { fontSize: 13, fontWeight: "700", color: C.text },

  conditionCardDesc: { fontSize: 11, color: C.text3, marginTop: 2, lineHeight: 15 },

  activeFiltersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },

  activeFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: C.pill,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: "100%",
  },

  activeFilterChipText: { fontSize: 11, fontWeight: "600", color: C.primary, flexShrink: 1 },

  activeFilterChipClose: { fontSize: 11, fontWeight: "800", color: C.primary, opacity: 0.7 },

  earningsModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },

  earningsModeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },

  earningsModeBtnActive: { backgroundColor: "#2E7D6C", borderColor: "#2E7D6C" },

  earningsModeBtnText: { fontSize: 12, fontWeight: "700", color: C.text2 },

  earningsModeBtnTextActive: { color: "#fff" },

  modalSectionLabel: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 12, marginBottom: 8 },

  modalRow: { flexDirection: "row", gap: 10, marginBottom: 10 },

  modalHalf: { flex: 1, minWidth: 0 },

  modalButtonRow: { flexDirection: "row", gap: 10, marginTop: 20 },

  modalClearBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },

  modalClearBtnText: { fontSize: 14, fontWeight: "600", color: C.text2 },

  modalApplyBtn: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },

  modalApplyBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});