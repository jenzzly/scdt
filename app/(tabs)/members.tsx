// app/(tabs)/members.tsx
//
// Redesigned with per-member risk assessment and rankings.
//
// The risk model is composed of four independent sub-scores, each
// derived from data the screen already has access to:
//
//   Contributions  0-30  on-time ratio × arrears deduction
//   Loans          0-30  overdue count + balance-to-contributions ratio
//   Fees           0-25  unpaid contribution + loan + meeting penalties
//   Attendance     0-15  present/late rate across recorded meetings
//
//   score = sum → 0-100
//   tier  = Excellent (85+) | Good (70-84) | Watch (50-69) | At Risk (<50)
//
// Personal view shows the current user's own breakdown. Group view
// shows everyone, ranked by the currently selected sort.
import React, { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import {
  useStore,
  useGroupMembers,
  useGroupWallet,
  useGroupContributions,
  useGroupLoans,
  useGroupMeetings,
  useActiveGroup,
  useCurrentUserRole,
  useCurrentMember,
  useIsAdminView,
  useCurrentMemberPermissions,
  useIsGroupView,
} from "../../stores/useStore";
import { useMyMemberIds } from "../../stores/selectors";
import {
  Card,
  Badge,
  Empty,
  Button,
  BottomModal,
  Input,
  Select,
  useToast,
  Toast,
  InfoRow,
} from "../../components/ui";
import { KpiCard } from "../../components/ui/KpiCard";
import {
  Colors,
  C,
  T,
  S,
  R,
  fmtCurrency,
  fmtDate,
  showConfirm,
  round2,
} from "../../utils/theme";
import {
  createUserAsAdmin,
  resetUserPasswordAsAdmin,
} from "../../lib/auth/adminUsers";
import { USER_ROLES, ROLE_LABELS } from "../../types/roles";
import type { Member } from "../../types";
import * as FS from "../../lib/firestore";
import { exportXlsx, exportPdf } from "../../utils/export";
import {
  findOverdueContributions,
  findOverdueInstallments,
} from "../../utils/lateFees";

// ═════════════════════════════════════════════════════════════════════════
// Risk model
// ═════════════════════════════════════════════════════════════════════════

type RiskTier = "excellent" | "good" | "watch" | "at_risk";

interface MemberRisk {
  score: number;
  tier: RiskTier;
  contributionScore: number;
  loanScore: number;
  feeScore: number;
  attendanceScore: number;
  totalContributions: number;
  arrears: number;
  activeLoanCount: number;
  outstandingBalance: number;
  overdueInstallmentCount: number;
  unpaidFeesTotal: number;
  unpaidContributionFees: number;
  unpaidLoanFees: number;
  unpaidMeetingFees: number;
  meetingAttendancePct: number;
  totalMeetings: number;
  monthsSinceJoined: number;
  lastContributionDate: string | null;
}

const TIER_META: Record<
  RiskTier,
  { label: string; color: string; bg: string; icon: string }
> = {
  excellent: {
    label: "Excellent",
    color: C.success,
    bg: C.greenBg,
    icon: "✓",
  },
  good: {
    label: "Good",
    color: C.primary,
    bg: C.pill,
    icon: "✓",
  },
  watch: {
    label: "Watch",
    color: C.gold,
    bg: C.goldBg,
    icon: "⚠",
  },
  at_risk: {
    label: "At Risk",
    color: C.error,
    bg: C.redBg,
    icon: "!",
  },
};

function tierFromScore(score: number): RiskTier {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "watch";
  return "at_risk";
}

// ═════════════════════════════════════════════════════════════════════════
// Compact tier summary + donut chart
// ═════════════════════════════════════════════════════════════════════════

/**
 * Small SVG donut showing the tier distribution. No dependencies — just
 * react-native-svg circles with dasharray offsets, same approach as the
 * EarningsDonut in reports.tsx.
 */
function RiskDistributionDonut({
  counts,
  size = 96,
  strokeWidth = 12,
}: {
  counts: { excellent: number; good: number; watch: number; at_risk: number };
  size?: number;
  strokeWidth?: number;
}) {
  const total =
    counts.excellent + counts.good + counts.watch + counts.at_risk;

  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { value: counts.excellent, color: C.success },
    { value: counts.good, color: C.primary },
    { value: counts.watch, color: C.gold },
    { value: counts.at_risk, color: C.error },
  ].filter((s) => s.value > 0);

  let cumulative = 0;

  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={C.borderLight}
          strokeWidth={strokeWidth}
          fill="none"
        />

        {segments.map((seg, i) => {
          const pct = seg.value / Math.max(1, total);
          const dashLength = pct * circumference;
          const dashOffset = -cumulative * circumference;
          cumulative += pct;

          return (
            <Circle
              key={i}
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

      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={st.donutCenterValue}>{total}</Text>
        <Text style={st.donutCenterLabel}>
          {total === 1 ? "member" : "members"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Group-view tier summary card — donut + tappable legend.
 * Replaces the previous four stretched KpiCards.
 */
function TierSummary({
  counts,
  tierFilter,
  onSelect,
}: {
  counts: { excellent: number; good: number; watch: number; at_risk: number };
  tierFilter: TierFilter;
  onSelect: (t: TierFilter) => void;
}) {
  const tiers: {
    key: TierFilter;
    label: string;
    color: string;
    count: number;
    icon: string;
  }[] = [
    {
      key: "excellent",
      label: "Excellent",
      color: C.success,
      count: counts.excellent,
      icon: "✓",
    },
    {
      key: "good",
      label: "Good",
      color: C.primary,
      count: counts.good,
      icon: "●",
    },
    {
      key: "watch",
      label: "Watch",
      color: C.gold,
      count: counts.watch,
      icon: "⚠",
    },
    {
      key: "at_risk",
      label: "At Risk",
      color: C.error,
      count: counts.at_risk,
      icon: "!",
    },
  ];

  const total = counts.excellent + counts.good + counts.watch + counts.at_risk;

  return (
    <View style={st.tierSummaryCard}>
      <RiskDistributionDonut counts={counts} size={96} strokeWidth={12} />

      <View style={st.tierLegend}>
        {tiers.map((t) => {
          const active = tierFilter === t.key;
          const empty = t.count === 0;
          return (
            <TouchableOpacity
              key={t.key}
              style={[
                st.tierLegendRow,
                active && {
                  backgroundColor: C.elevated,
                  borderColor: t.color,
                },
                empty && { opacity: 0.4 },
              ]}
              onPress={() => onSelect(active ? "all" : t.key)}
              activeOpacity={empty ? 1 : 0.7}
              disabled={empty}
              accessibilityRole="button"
              accessibilityLabel={`${t.label}: ${t.count} members`}
            >
              <View
                style={[st.tierLegendDot, { backgroundColor: t.color }]}
              />
              <Text style={st.tierLegendLabel} numberOfLines={1}>
                {t.label}
              </Text>
              <Text
                style={[st.tierLegendCount, { color: t.color }]}
              >
                {t.count}
              </Text>
            </TouchableOpacity>
          );
        })}

        {total > 0 && tierFilter !== "all" ? (
          <TouchableOpacity
            style={st.tierClearBtn}
            onPress={() => onSelect("all")}
            activeOpacity={0.7}
          >
            <Text style={st.tierClearText}>Clear filter</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Personal-view card — a user's own tier, score, and a one-line hint
 * about what's contributing. No donut (a single-segment donut would be
 * meaningless).
 */
function PersonalRiskCard({
  tier,
  score,
  topConcern,
}: {
  tier: RiskTier | null;
  score: number;
  topConcern: string | null;
}) {
  if (!tier) return null;
  const meta = TIER_META[tier];

  return (
    <View style={[st.personalRiskCard, { borderLeftColor: meta.color }]}>
      <View style={[st.personalRiskIcon, { backgroundColor: meta.bg }]}>
        <Text style={[st.personalRiskIconText, { color: meta.color }]}>
          {meta.icon}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.personalRiskLabel}>Your risk tier</Text>
        <Text
          style={[st.personalRiskTier, { color: meta.color }]}
          numberOfLines={1}
        >
          {meta.label}
        </Text>
        {topConcern ? (
          <Text style={st.personalRiskHint} numberOfLines={2}>
            {topConcern}
          </Text>
        ) : (
          <Text style={st.personalRiskHint} numberOfLines={1}>
            You're in good standing
          </Text>
        )}
      </View>

      <View style={st.personalRiskScoreCol}>
        <Text style={[st.personalRiskScore, { color: meta.color }]}>
          {score}
        </Text>
        <Text style={st.personalRiskScoreLabel}>of 100</Text>
      </View>
    </View>
  );
}

interface RiskContext {
  contributions: any[];
  loans: any[];
  wallet: any[];
  meetings: any[];
  group: any;
  overdueContributions: any[];
  overdueInstallments: any[];
}

function computeMemberRisk(member: Member, ctx: RiskContext): MemberRisk {
  const {
    contributions,
    loans,
    wallet,
    meetings,
    group,
    overdueContributions,
    overdueInstallments,
  } = ctx;

  const memberAlias = (member as any).userId as string | undefined;
  const isMine = (id?: string) =>
    !!id && (id === member.id || (memberAlias && id === memberAlias));

  // ── Contributions ───────────────────────────────────────────────────
  const approved = contributions.filter(
    (c) => isMine(c.memberId) && c.status === "approved",
  );
  const pending = contributions.filter(
    (c) => isMine(c.memberId) && c.status === "pending",
  );

  const totalContributions = round2(
    approved.reduce((s, c) => s + (c.amount || 0), 0),
  );
  const arrears = round2(
    pending.reduce((s, c) => s + (c.amount || 0), 0),
  );

  const monthsSinceJoined = Math.max(
    1,
    Math.round(
      (Date.now() - new Date(member.dateJoined || Date.now()).getTime()) /
        (30 * 86_400_000),
    ),
  );

  const contributionBase = group?.contributionAmount ?? 0;
  const expectedContrib = contributionBase * monthsSinceJoined;

  const ratio =
    expectedContrib > 0
      ? Math.min(1, totalContributions / expectedContrib)
      : 1;

  // 20 pts from "paid their expected share"
  let contributionScore = ratio * 20;

  // 10 pts from "no pending arrears"; degrades linearly as arrears
  // approach 2× the base contribution.
  const arrearsRatio = contributionBase
    ? Math.min(1, arrears / (contributionBase * 2))
    : 0;
  contributionScore += 10 * (1 - arrearsRatio);
  contributionScore = round2(contributionScore);

  // ── Loans ───────────────────────────────────────────────────────────
  const memberLoans = loans.filter((l) => isMine(l.memberId));
  const activeLoans = memberLoans.filter((l) => l.status === "disbursed");
  const outstandingBalance = round2(
    activeLoans.reduce((s, l) => s + (l.balance || 0), 0),
  );
  const overdue = overdueInstallments.filter((o) => isMine(o.memberId));
  const overdueInstallmentCount = overdue.length;

  let loanScore: number;
  if (activeLoans.length === 0) {
    // Never borrowed → no loan-side risk.
    loanScore = 30;
  } else if (overdueInstallmentCount > 0) {
    // Each overdue installment costs 10 pts, capped at 30.
    loanScore = Math.max(0, 30 - overdueInstallmentCount * 10);
  } else {
    // No overdue, but balance relative to contributions matters.
    // Balance = 1× contributions → full credit. 3× → half credit.
    const ratio =
      totalContributions > 0
        ? outstandingBalance / totalContributions
        : outstandingBalance > 0
        ? 3
        : 0;
    loanScore = Math.max(15, 30 - Math.min(15, ratio * 5));
  }
  loanScore = round2(loanScore);

  // ── Fees ────────────────────────────────────────────────────────────
  const contribFees = overdueContributions.filter((o) => isMine(o.memberId));
  const loanFees = overdue.filter((o) => isMine(o.memberId));

  // Meeting penalties live on the meeting doc. Aggregate unpaid here.
  let unpaidMeetingFees = 0;
  for (const m of meetings) {
    if (m.status === "cancelled") continue;
    for (const a of m.attendees ?? []) {
      if (!isMine(a.memberId)) continue;
      const amt = a.penaltyAmount ?? 0;
      if (amt > 0 && !a.penaltyPaid) {
        unpaidMeetingFees += amt;
      }
    }
  }

  // Applied-but-unpaid late-fee wallet txs are additional exposure
  // beyond the "overdue" lists. Wallet may be unreadable for members —
  // if so, these are 0 and we fall back to the overdue-list totals
  // only, which is the safe direction.
  const appliedContribFees = wallet
    .filter(
      (t) =>
        t.type === "late_fee" &&
        isMine(t.memberId) &&
        !(t as any).feePaid &&
        !(t as any).deletedAt &&
        typeof t.id === "string" &&
        t.id.startsWith("late-fee-contrib-"),
    )
    .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

  const appliedLoanFees = wallet
    .filter(
      (t) =>
        t.type === "late_fee" &&
        isMine(t.memberId) &&
        !(t as any).feePaid &&
        !(t as any).deletedAt &&
        typeof t.id === "string" &&
        t.id.startsWith("late-fee-loan-"),
    )
    .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

  const unpaidContributionFees = round2(
    contribFees.reduce((s, o) => s + (o.feeAmount || 0), 0) +
      appliedContribFees,
  );
  const unpaidLoanFees = round2(
    loanFees.reduce((s, o) => s + (o.feeAmount || 0), 0) + appliedLoanFees,
  );
  unpaidMeetingFees = round2(unpaidMeetingFees);
  const unpaidFeesTotal = round2(
    unpaidContributionFees + unpaidLoanFees + unpaidMeetingFees,
  );

  let feeScore = 25;
  if (unpaidFeesTotal > 0) {
    if (contributionBase > 0) {
      const feeRatio = Math.min(
        1,
        unpaidFeesTotal / (contributionBase * 2),
      );
      feeScore = round2(25 * (1 - feeRatio));
    } else {
      feeScore = 15;
    }
  }
  feeScore = round2(Math.max(0, feeScore));

  // ── Attendance ──────────────────────────────────────────────────────
  let totalMeetings = 0;
  let presentOrLate = 0;
  for (const m of meetings) {
    if (m.status === "cancelled") continue;
    const a = (m.attendees ?? []).find((x: any) => isMine(x.memberId));
    if (!a) continue;
    totalMeetings++;
    const status = a.status ?? (a.attended ? "present" : "absent");
    if (status === "present" || status === "late") presentOrLate++;
  }
  const meetingAttendancePct =
    totalMeetings > 0 ? Math.round((presentOrLate / totalMeetings) * 100) : 100;
  const attendanceScore =
    totalMeetings > 0 ? round2((meetingAttendancePct / 100) * 15) : 15;

  const score = round2(
    contributionScore + loanScore + feeScore + attendanceScore,
  );
  const tier = tierFromScore(score);

  const sortedApproved = [...approved].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const lastContributionDate = sortedApproved[0]?.date ?? null;

  return {
    score,
    tier,
    contributionScore,
    loanScore,
    feeScore,
    attendanceScore,
    totalContributions,
    arrears,
    activeLoanCount: activeLoans.length,
    outstandingBalance,
    overdueInstallmentCount,
    unpaidFeesTotal,
    unpaidContributionFees,
    unpaidLoanFees,
    unpaidMeetingFees,
    meetingAttendancePct,
    totalMeetings,
    monthsSinceJoined,
    lastContributionDate,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Screen
// ═════════════════════════════════════════════════════════════════════════

type TierFilter = "all" | RiskTier;
type SortBy = "risk" | "contributions" | "loan_balance" | "fees" | "name";

const STATUS_BADGE: Record<
  string,
  "teal" | "gold" | "green" | "red" | "muted"
> = {
  active: "green",
  pending: "gold",
  inactive: "muted",
  suspended: "red",
  exited: "muted",
};

const ROLE_BADGE: Record<
  string,
  "teal" | "gold" | "blue" | "green" | "red" | "muted"
> = {
  admin: "red",
  accountant: "blue",
  loan_officer: "green",
  committee: "gold",
  member: "teal",
  audit: "muted",
  groups: "muted",
};

export default function MembersScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === "web" && width >= 768;
  const { show, visible, msg, type } = useToast();

  const activeGroupId = useStore((s) => s.activeGroupId);
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isGroupView = useIsGroupView();
  const isAdminView = useIsAdminView();
  const { deleteMember } = useStore();
  const permissions = useCurrentMemberPermissions();
  const myIds = useMyMemberIds();

  const members = useGroupMembers();
  const wallet = useGroupWallet();
  const contributions = useGroupContributions();
  const loans = useGroupLoans();
  const meetings = useGroupMeetings();
  const group = useActiveGroup();

  const isAdmin = role === "admin";
  const canCreateMember = permissions?.editMembers || isAdmin;
  const canExport =
    permissions?.downloadReports || isAdmin;

  // ── State ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("risk");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const [createForm, setCreateForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    role: "member",
  });

  // ── Compute overdue pools once — shared by every member's risk ─────
  const overdueContributions = useMemo(() => {
    if (!group) return [];
    try {
      return (
        findOverdueContributions(group, members, contributions, wallet) ||
        []
      );
    } catch (e) {
      console.error("[members] findOverdueContributions failed:", e);
      return [];
    }
  }, [group, members, contributions, wallet]);

  const overdueInstallments = useMemo(() => {
    if (!group) return [];
    try {
      return (
        findOverdueInstallments(group, members, loans, wallet) || []
      );
    } catch (e) {
      console.error("[members] findOverdueInstallments failed:", e);
      return [];
    }
  }, [group, members, loans, wallet]);

  // ── Compute risk for every member ──────────────────────────────────
  const risksById = useMemo(() => {
    const ctx: RiskContext = {
      contributions,
      loans,
      wallet,
      meetings,
      group,
      overdueContributions,
      overdueInstallments,
    };
    const map = new Map<string, MemberRisk>();
    for (const m of members) {
      map.set(m.id, computeMemberRisk(m, ctx));
    }
    return map;
  }, [
    members,
    contributions,
    loans,
    wallet,
    meetings,
    group,
    overdueContributions,
    overdueInstallments,
  ]);

  // ── Scope to view mode ─────────────────────────────────────────────
  const visibleMembers = useMemo(() => {
    if (isGroupView) return members;
    return members.filter(
      (m) => myIds.has(m.id) || myIds.has((m as any).userId),
    );
  }, [members, isGroupView, myIds]);

  // ── Apply search, filter, sort ─────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...visibleMembers];

    if (tierFilter !== "all") {
      list = list.filter((m) => {
        const r = risksById.get(m.id);
        return r?.tier === tierFilter;
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const name = (m.fullName || "").toLowerCase();
        const email = (m.email || "").toLowerCase();
        const phone = (m.phone || "").toLowerCase();
        return (
          name.includes(q) || email.includes(q) || phone.includes(q)
        );
      });
    }

    list.sort((a, b) => {
      const ra = risksById.get(a.id);
      const rb = risksById.get(b.id);

      switch (sortBy) {
        case "risk":
          // Worst first when in group view (surfaces problems); best
          // first in personal view (there's only one member so this
          // is a no-op).
          return isGroupView
            ? (ra?.score ?? 0) - (rb?.score ?? 0)
            : (rb?.score ?? 0) - (ra?.score ?? 0);
        case "contributions":
          return (
            (rb?.totalContributions ?? 0) -
            (ra?.totalContributions ?? 0)
          );
        case "loan_balance":
          return (
            (rb?.outstandingBalance ?? 0) -
            (ra?.outstandingBalance ?? 0)
          );
        case "fees":
          return (
            (rb?.unpaidFeesTotal ?? 0) - (ra?.unpaidFeesTotal ?? 0)
          );
        case "name":
        default:
          return (a.fullName || "").localeCompare(b.fullName || "");
      }
    });

    return list;
  }, [visibleMembers, tierFilter, search, sortBy, risksById, isGroupView]);

  // ── Tier counts (over visibleMembers, before search filter) ────────
  const tierCounts = useMemo(() => {
    let excellent = 0;
    let good = 0;
    let watch = 0;
    let at_risk = 0;
    for (const m of visibleMembers) {
      const r = risksById.get(m.id);
      if (!r) continue;
      if (r.tier === "excellent") excellent++;
      else if (r.tier === "good") good++;
      else if (r.tier === "watch") watch++;
      else at_risk++;
    }
    return { excellent, good, watch, at_risk, total: visibleMembers.length };
  }, [visibleMembers, risksById]);

  // ── Handlers ───────────────────────────────────────────────────────
  const handleCreateUser = async () => {
    if (!createForm.fullName.trim()) {
      show("Full name is required", "error");
      return;
    }
    if (!createForm.email.trim()) {
      show("Email is required", "error");
      return;
    }
    if (!activeGroupId || !currentMember?.userId) {
      show("Group or user not loaded", "error");
      return;
    }

    setCreatingUser(true);
    try {
      const result = await createUserAsAdmin(
        {
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          phone: createForm.phone.trim(),
          role: createForm.role as any,
          groupId: activeGroupId,
        },
        currentMember.userId,
        currentMember.fullName || "Admin",
      );

      if (!result.success) {
        show(result.error || "Failed to create user", "error");
        return;
      }

      show(
        `User ${createForm.fullName} created! Password reset email sent.`,
      );
      setShowCreateModal(false);
      setCreateForm({ fullName: "", email: "", phone: "", role: "member" });
    } catch (e: any) {
      show(e.message || "Failed to create user", "error");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedMember?.email || !activeGroupId || !currentMember?.userId) {
      show("Missing information", "error");
      return;
    }

    setResettingPassword(true);
    try {
      const result = await resetUserPasswordAsAdmin(
        selectedMember.email,
        currentMember.userId,
        currentMember.fullName || "Admin",
        activeGroupId,
      );

      if (!result.success) {
        show(
          result.error || "Failed to send password reset email",
          "error",
        );
        return;
      }

      show("Password reset email sent to " + selectedMember.email);
      setShowActionModal(false);
    } catch (e: any) {
      show(e.message || "Failed to send password reset email", "error");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!selectedMember || !activeGroupId) return;

    const hasHistory =
      contributions.some((c) => c.memberId === selectedMember.id) ||
      wallet.some((w) => w.memberId === selectedMember.id);

    if (hasHistory) {
      show(
        "Cannot delete member with financial history. Deactivate instead.",
        "error",
      );
      return;
    }

    try {
      await deleteMember(selectedMember.id);
      show(`Member ${selectedMember.fullName} removed`);
      setShowDeleteModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to delete member", "error");
    }
  };

  const handleApproveMember = async () => {
    if (!selectedMember || !activeGroupId) return;
    try {
      await FS.updateMember(activeGroupId, selectedMember.id, {
        status: "active",
      });
      show(`${selectedMember.fullName} approved`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to approve member", "error");
    }
  };

  const handleDeactivateMember = async () => {
    if (!selectedMember || !activeGroupId) return;
    try {
      await FS.updateMember(activeGroupId, selectedMember.id, {
        status: "inactive",
      });
      show(`${selectedMember.fullName} deactivated`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to deactivate member", "error");
    }
  };

  const handleReactivateMember = async () => {
    if (!selectedMember || !activeGroupId) return;
    try {
      await FS.updateMember(activeGroupId, selectedMember.id, {
        status: "active",
      });
      show(`${selectedMember.fullName} reactivated`);
      setShowActionModal(false);
      setSelectedMember(null);
    } catch (e: any) {
      show(e.message || "Failed to reactivate member", "error");
    }
  };

  const openMemberActions = (member: Member) => {
    setSelectedMember(member);
    setShowActionModal(true);
  };

  const openDeleteConfirm = (member: Member) => {
    setSelectedMember(member);
    setShowDeleteModal(true);
  };

  const handleExport = async (format: "csv" | "pdf") => {
    const headers = [
      "Rank",
      "Name",
      "Email",
      "Phone",
      "Role",
      "Status",
      "Risk tier",
      "Risk score",
      "Contributions",
      "Loan balance",
      "Unpaid fees",
      "Attendance %",
    ];
    const rows = filtered.map((m, i) => {
      const r = risksById.get(m.id);
      return [
        String(i + 1),
        m.fullName,
        m.email || "",
        m.phone || "",
        m.role,
        m.status,
        r ? TIER_META[r.tier].label : "",
        r ? String(r.score) : "",
        r ? fmtCurrency(r.totalContributions) : "",
        r ? fmtCurrency(r.outstandingBalance) : "",
        r ? fmtCurrency(r.unpaidFeesTotal) : "",
        r ? `${r.meetingAttendancePct}%` : "",
      ];
    });

    if (format === "csv") {
      await exportXlsx("Members_Risk_Report", headers, rows);
    } else {
      const html = `<table><thead><tr>${headers
        .map((h) => `<th>${h}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;
      await exportPdf("Members_Risk_Report", "Members Risk Report", html);
    }
    show(`Exported as ${format.toUpperCase()}`);
  };

  // ── Personal-view helper: current user's risk + top concern ────────
  const myRisk = useMemo(() => {
    if (isGroupView) return null;
    const me = visibleMembers[0];
    if (!me) return null;
    return risksById.get(me.id) ?? null;
  }, [isGroupView, visibleMembers, risksById]);

  const myTopConcern = useMemo(() => {
    if (!myRisk) return null;
    if (myRisk.overdueInstallmentCount > 0) {
      return `${myRisk.overdueInstallmentCount} overdue loan installment${
        myRisk.overdueInstallmentCount !== 1 ? "s" : ""
      }`;
    }
    if (myRisk.unpaidFeesTotal > 0) {
      return `${fmtCurrency(myRisk.unpaidFeesTotal)} in unpaid fees`;
    }
    if (myRisk.arrears > 0) {
      return `${fmtCurrency(myRisk.arrears)} in pending contributions`;
    }
    return null;
  }, [myRisk]);

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  const renderControls = () => {
    // Filter, sort, search, export, add — all group-view concepts.
    // In personal view (a member looking at their own card) there's
    // nothing to filter and nothing to add.
    if (!isGroupView) return null;

    // ── Desktop: single row of controls ─────────────────────────────
    if (isWide) {
      return (
        <View style={st.controlsSection}>
          <View style={st.controlsLeft}>
            <View style={[st.searchWrap, { minWidth: 220 }]}>
              <Text style={st.searchIcon}>🔍</Text>
              <TextInput
                style={st.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search name, email, phone…"
                placeholderTextColor={C.text3}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search ? (
                <TouchableOpacity
                  onPress={() => setSearch("")}
                  hitSlop={8}
                >
                  <Text style={st.searchClear}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Select
              options={[
                { label: "All tiers", value: "all" },
                { label: "Excellent", value: "excellent" },
                { label: "Good", value: "good" },
                { label: "Watch", value: "watch" },
                { label: "At Risk", value: "at_risk" },
              ]}
              value={tierFilter}
              onChange={(v) => setTierFilter(v as TierFilter)}
              label="Filter"
              style={st.controlSelect}
            />

            <Select
              options={[
                { label: "Risk", value: "risk" },
                { label: "Contributions", value: "contributions" },
                { label: "Loan balance", value: "loan_balance" },
                { label: "Fees owed", value: "fees" },
                { label: "Name", value: "name" },
              ]}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortBy)}
              label="Rank by"
              style={st.controlSelect}
            />
          </View>

          <View style={st.controlsRight}>
            <View style={st.resultsBadge}>
              <Text style={st.resultsCount}>
                {filtered.length} member{filtered.length !== 1 ? "s" : ""}
              </Text>
            </View>

            {canExport && (
              <View style={st.exportGroup}>
                <TouchableOpacity
                  style={[st.exportBtn, { backgroundColor: C.primary }]}
                  onPress={() => handleExport("csv")}
                  activeOpacity={0.8}
                >
                  <Text style={st.exportBtnText}>CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.exportBtn, { backgroundColor: C.redText }]}
                  onPress={() => handleExport("pdf")}
                  activeOpacity={0.8}
                >
                  <Text style={st.exportBtnText}>PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {canCreateMember && (
              <TouchableOpacity
                style={st.addBtn}
                onPress={() => setShowCreateModal(true)}
                activeOpacity={0.8}
              >
                <Text style={st.addBtnText}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    // ── Mobile: search row, tier chips row, sort + count row ────────
    const tierChips: { value: TierFilter; label: string; color: string }[] = [
      { value: "all", label: "All", color: C.text2 },
      { value: "excellent", label: "Excellent", color: C.success },
      { value: "good", label: "Good", color: C.primary },
      { value: "watch", label: "Watch", color: C.gold },
      { value: "at_risk", label: "At Risk", color: C.error },
    ];

    return (
      <View style={st.mobileControls}>
        {/* Row 1: search + add */}
        <View style={st.mobileSearchRow}>
          <View style={st.searchWrapMobile}>
            <Text style={st.searchIcon}>🔍</Text>
            <TextInput
              style={st.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search…"
              placeholderTextColor={C.text3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search ? (
              <TouchableOpacity
                onPress={() => setSearch("")}
                hitSlop={8}
              >
                <Text style={st.searchClear}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {canCreateMember && (
            <TouchableOpacity
              style={st.mobileAddBtn}
              onPress={() => setShowCreateModal(true)}
              activeOpacity={0.8}
            >
              <Text style={st.mobileAddBtnText}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Row 2: tier filter chips (horizontal scroll) */}
        <Text style={st.mobileFilterLabel}>Filter by tier</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.mobileTierChipsRow}
        >
          {tierChips.map((chip) => {
            const active = tierFilter === chip.value;
            return (
              <TouchableOpacity
                key={chip.value}
                style={[
                  st.mobileTierChip,
                  active && {
                    backgroundColor: chip.color,
                    borderColor: chip.color,
                  },
                ]}
                onPress={() => setTierFilter(chip.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    st.mobileTierChipText,
                    active && { color: "#fff" },
                  ]}
                >
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Row 3: sort + result count + exports */}
        <View style={st.mobileSortRow}>
          <Select
            options={[
              { label: "Risk", value: "risk" },
              { label: "Contributions", value: "contributions" },
              { label: "Loan balance", value: "loan_balance" },
              { label: "Fees owed", value: "fees" },
              { label: "Name", value: "name" },
            ]}
            value={sortBy}
            onChange={(v) => setSortBy(v as SortBy)}
            label="Rank by"
            style={st.mobileSortSelect}
          />

          <View style={st.mobileSortRight}>
            <Text style={st.mobileResultCount}>
              {filtered.length} member{filtered.length !== 1 ? "s" : ""}
            </Text>

            {canExport && (
              <View style={st.mobileExportRow}>
                <TouchableOpacity
                  style={[st.mobileExportChip, { backgroundColor: C.primary }]}
                  onPress={() => handleExport("csv")}
                  activeOpacity={0.8}
                >
                  <Text style={st.mobileExportChipText}>CSV</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mobileExportChip, { backgroundColor: C.redText }]}
                  onPress={() => handleExport("pdf")}
                  activeOpacity={0.8}
                >
                  <Text style={st.mobileExportChipText}>PDF</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderMemberCard = (member: Member, index: number) => {
    const risk = risksById.get(member.id);
    if (!risk) return null;
    const meta = TIER_META[risk.tier];
    const isMe = myIds.has(member.id) || myIds.has((member as any).userId);
    const rank = index + 1;

    return (
      <Card
        key={member.id}
        onPress={() => openMemberActions(member)}
        style={[st.memberCard, { borderLeftColor: meta.color }]}
        activeOpacity={0.8}
      >
        <View style={st.memberCardContent}>
          {/* Header: rank + avatar + name + tier badge */}
          <View style={st.memberHeader}>
            {isGroupView ? (
              <View style={[st.rankBadge, { backgroundColor: meta.bg }]}>
                <Text style={[st.rankText, { color: meta.color }]}>
                  #{rank}
                </Text>
              </View>
            ) : null}

            <View style={st.memberInfo}>
              <Text style={T.bold} numberOfLines={1}>
                {member.fullName || "Unknown"}
                {isMe ? " (You)" : ""}
              </Text>
              <View style={st.memberMetaRow}>
                <Badge
                  label={ROLE_LABELS[member.role] || member.role}
                  color={ROLE_BADGE[member.role] || "muted"}
                />
                <Badge
                  label={member.status}
                  color={STATUS_BADGE[member.status] || "muted"}
                />
              </View>
            </View>

            <View style={[st.tierBadge, { backgroundColor: meta.bg }]}>
              <Text style={[st.tierBadgeIcon, { color: meta.color }]}>
                {meta.icon}
              </Text>
              <Text style={[st.tierBadgeLabel, { color: meta.color }]}>
                {meta.label}
              </Text>
              <Text style={[st.tierBadgeScore, { color: meta.color }]}>
                {risk.score}
              </Text>
            </View>
          </View>

          {/* Metric strip */}
          <View style={st.memberStats}>
            <View style={st.statItem}>
              <Text style={st.statLabel}>Contributions</Text>
              <Text
                style={[st.statValue, { color: C.primary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {fmtCurrency(risk.totalContributions)}
              </Text>
            </View>

            <View style={st.statItem}>
              <Text style={st.statLabel}>Loan balance</Text>
              <Text
                style={[
                  st.statValue,
                  {
                    color:
                      risk.outstandingBalance > 0 ? C.error : C.text3,
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {risk.outstandingBalance > 0
                  ? fmtCurrency(risk.outstandingBalance)
                  : "—"}
              </Text>
            </View>

            <View style={st.statItem}>
              <Text style={st.statLabel}>Fees owed</Text>
              <Text
                style={[
                  st.statValue,
                  {
                    color:
                      risk.unpaidFeesTotal > 0 ? C.error : C.success,
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {risk.unpaidFeesTotal > 0
                  ? fmtCurrency(risk.unpaidFeesTotal)
                  : "Clear"}
              </Text>
            </View>
          </View>

          {/* Score bar */}
          <View style={st.scoreBarWrap}>
            <View style={st.scoreBarTrack}>
              <View
                style={[
                  st.scoreBarFill,
                  {
                    width: `${Math.max(3, risk.score)}%` as any,
                    backgroundColor: meta.color,
                  },
                ]}
              />
            </View>
            <Text style={[st.scoreBarLabel, { color: meta.color }]}>
              {risk.score}/100
            </Text>
          </View>

          {/* Warning chips for anything overdue */}
          {risk.overdueInstallmentCount > 0 ||
          risk.unpaidFeesTotal > 0 ||
          risk.arrears > 0 ? (
            <View style={st.warnChips}>
              {risk.overdueInstallmentCount > 0 ? (
                <View style={[st.warnChip, { backgroundColor: C.redBg }]}>
                  <Text style={[st.warnChipText, { color: C.error }]}>
                    {risk.overdueInstallmentCount} overdue installment
                    {risk.overdueInstallmentCount !== 1 ? "s" : ""}
                  </Text>
                </View>
              ) : null}
              {risk.unpaidFeesTotal > 0 ? (
                <View style={[st.warnChip, { backgroundColor: C.goldBg }]}>
                  <Text style={[st.warnChipText, { color: C.gold }]}>
                    {fmtCurrency(risk.unpaidFeesTotal)} in fees
                  </Text>
                </View>
              ) : null}
              {risk.arrears > 0 ? (
                <View style={[st.warnChip, { backgroundColor: C.infoBg }]}>
                  <Text style={[st.warnChipText, { color: C.infoText }]}>
                    {fmtCurrency(risk.arrears)} pending
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Card>
    );
  };

  // ── Detail modal body ──────────────────────────────────────────────
  const renderDetailBreakdown = (member: Member) => {
    const risk = risksById.get(member.id);
    if (!risk) return null;
    const meta = TIER_META[risk.tier];

    const scoreRows: { label: string; value: number; max: number }[] = [
      { label: "Contributions", value: risk.contributionScore, max: 30 },
      { label: "Loans", value: risk.loanScore, max: 30 },
      { label: "Fees", value: risk.feeScore, max: 25 },
      { label: "Attendance", value: risk.attendanceScore, max: 15 },
    ];

    return (
      <View style={st.detailBody}>
        <View style={[st.detailHero, { backgroundColor: meta.bg }]}>
          <Text style={[st.detailHeroIcon, { color: meta.color }]}>
            {meta.icon}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[st.detailHeroTier, { color: meta.color }]}>
              {meta.label}
            </Text>
            <Text style={st.detailHeroSub}>Risk score {risk.score}/100</Text>
          </View>
        </View>

        <Text style={st.detailSectionLabel}>Score breakdown</Text>
        {scoreRows.map((row) => {
          const pct = row.max > 0 ? (row.value / row.max) * 100 : 0;
          const barColor =
            pct >= 80 ? C.success : pct >= 50 ? C.gold : C.error;
          return (
            <View key={row.label} style={st.detailRow}>
              <Text style={st.detailRowLabel}>{row.label}</Text>
              <View style={st.detailRowBarTrack}>
                <View
                  style={[
                    st.detailRowBarFill,
                    {
                      width: `${pct}%` as any,
                      backgroundColor: barColor,
                    },
                  ]}
                />
              </View>
              <Text style={[st.detailRowValue, { color: barColor }]}>
                {row.value}/{row.max}
              </Text>
            </View>
          );
        })}

        <Text style={[st.detailSectionLabel, { marginTop: 16 }]}>
          Metrics
        </Text>
        <View style={st.detailMetrics}>
          <InfoRow
            label="Total contributions"
            value={fmtCurrency(risk.totalContributions)}
          />
          <InfoRow
            label="Pending / arrears"
            value={risk.arrears > 0 ? fmtCurrency(risk.arrears) : "None"}
          />
          <InfoRow
            label="Active loans"
            value={String(risk.activeLoanCount)}
          />
          <InfoRow
            label="Loan balance"
            value={
              risk.outstandingBalance > 0
                ? fmtCurrency(risk.outstandingBalance)
                : "None"
            }
          />
          {risk.overdueInstallmentCount > 0 ? (
            <InfoRow
              label="Overdue installments"
              value={String(risk.overdueInstallmentCount)}
            />
          ) : null}
          <InfoRow
            label="Unpaid fees"
            value={
              risk.unpaidFeesTotal > 0
                ? fmtCurrency(risk.unpaidFeesTotal)
                : "Clear"
            }
          />
          {risk.unpaidContributionFees > 0 ? (
            <InfoRow
              label="  • contribution fees"
              value={fmtCurrency(risk.unpaidContributionFees)}
            />
          ) : null}
          {risk.unpaidLoanFees > 0 ? (
            <InfoRow
              label="  • loan fees"
              value={fmtCurrency(risk.unpaidLoanFees)}
            />
          ) : null}
          {risk.unpaidMeetingFees > 0 ? (
            <InfoRow
              label="  • meeting fees"
              value={fmtCurrency(risk.unpaidMeetingFees)}
            />
          ) : null}
          <InfoRow
            label="Meeting attendance"
            value={
              risk.totalMeetings > 0
                ? `${risk.meetingAttendancePct}% (${risk.totalMeetings} meetings)`
                : "No records"
            }
          />
          <InfoRow
            label="Member since"
            value={`${risk.monthsSinceJoined} month${
              risk.monthsSinceJoined !== 1 ? "s" : ""
            }`}
          />
          {risk.lastContributionDate ? (
            <InfoRow
              label="Last contribution"
              value={fmtDate(risk.lastContributionDate)}
            />
          ) : null}
        </View>

        {/* Actionable red flags */}
        {(risk.overdueInstallmentCount > 0 ||
          risk.unpaidFeesTotal > 0 ||
          risk.arrears > 0) && (
          <>
            <Text style={[st.detailSectionLabel, { marginTop: 16 }]}>
              Needs attention
            </Text>
            {risk.overdueInstallmentCount > 0 ? (
              <Text style={st.redFlag}>
                • {risk.overdueInstallmentCount} overdue loan installment
                {risk.overdueInstallmentCount !== 1 ? "s" : ""}
              </Text>
            ) : null}
            {risk.unpaidFeesTotal > 0 ? (
              <Text style={st.redFlag}>
                • {fmtCurrency(risk.unpaidFeesTotal)} in unpaid fees
              </Text>
            ) : null}
            {risk.arrears > 0 ? (
              <Text style={st.redFlag}>
                • {fmtCurrency(risk.arrears)} in pending contributions
              </Text>
            ) : null}
          </>
        )}
      </View>
    );
  };

  // ═══════════════════════════════════════════════════════════════════
  // Layouts
  // ═══════════════════════════════════════════════════════════════════

  if (isWide) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Toast visible={visible} msg={msg} type={type} />
        <ScrollView
          contentContainerStyle={st.container}
          showsVerticalScrollIndicator={false}
        >
          <Text style={st.viewModeLabel}>
            {isGroupView ? "Group view — all members" : "Personal view — you only"}
          </Text>

          {isGroupView ? (
            <TierSummary
              counts={tierCounts}
              tierFilter={tierFilter}
              onSelect={setTierFilter}
            />
          ) : (
            <PersonalRiskCard
              tier={myRisk?.tier ?? null}
              score={myRisk?.score ?? 0}
              topConcern={myTopConcern}
            />
          )}

          {renderControls()}

          {filtered.length === 0 ? (
            <Empty
              message={
                search
                  ? "No members match your search"
                  : "No members found"
              }
              icon="👥"
            />
          ) : (
            <View style={st.membersList}>
              {filtered.map((member, i) => renderMemberCard(member, i))}
            </View>
          )}
        </ScrollView>

        <BottomModal
          visible={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create New User"
        >
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Input
              label="Full Name"
              value={createForm.fullName}
              onChangeText={(t) =>
                setCreateForm((p) => ({ ...p, fullName: t }))
              }
              placeholder="John Doe"
            />
            <Input
              label="Email"
              value={createForm.email}
              onChangeText={(t) =>
                setCreateForm((p) => ({ ...p, email: t }))
              }
              placeholder="john@example.com"
              keyboardType="email-address"
            />
            <Input
              label="Phone"
              value={createForm.phone}
              onChangeText={(t) =>
                setCreateForm((p) => ({ ...p, phone: t }))
              }
              placeholder="+250-7XX-XXX-XXX"
            />
            <Select
              options={USER_ROLES.map((r) => ({
                label: ROLE_LABELS[r],
                value: r,
              }))}
              value={createForm.role}
              onChange={(r) => setCreateForm((p) => ({ ...p, role: r }))}
              label="Role"
            />
            <Button
              label="Create User"
              onPress={handleCreateUser}
              loading={creatingUser}
              fullWidth
            />
          </View>
        </BottomModal>

        <BottomModal
          visible={showActionModal}
          onClose={() => setShowActionModal(false)}
          title={selectedMember?.fullName}
        >
          {selectedMember && (
            <View style={{ gap: 12, paddingBottom: 20 }}>
              {renderDetailBreakdown(selectedMember)}

              {isAdmin && (
                <View style={st.adminActionsSection}>
                  <Text style={st.adminActionsTitle}>Admin Actions</Text>

                  {selectedMember.status === "pending" && (
                    <TouchableOpacity
                      style={[st.actionButton, st.approveButton]}
                      onPress={handleApproveMember}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          st.actionButtonText,
                          { color: "#fff" },
                        ]}
                      >
                        ✓ Approve Member
                      </Text>
                    </TouchableOpacity>
                  )}

                  {selectedMember.status === "active" &&
                    selectedMember.userId !== currentMember?.userId && (
                      <TouchableOpacity
                        style={[st.actionButton, st.warningButton]}
                        onPress={handleDeactivateMember}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            st.actionButtonText,
                            { color: "#fff" },
                          ]}
                        >
                          ⛔ Deactivate Member
                        </Text>
                      </TouchableOpacity>
                    )}

                  {selectedMember.status === "inactive" && (
                    <TouchableOpacity
                      style={[st.actionButton, st.successButton]}
                      onPress={handleReactivateMember}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          st.actionButtonText,
                          { color: "#fff" },
                        ]}
                      >
                        🔄 Reactivate Member
                      </Text>
                    </TouchableOpacity>
                  )}

                  {selectedMember.userId && (
                    <TouchableOpacity
                      style={[st.actionButton, st.passwordButton]}
                      onPress={handleResetPassword}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          st.actionButtonText,
                          { color: "#fff" },
                        ]}
                      >
                        🔑 Reset Password
                      </Text>
                    </TouchableOpacity>
                  )}

                  {selectedMember.userId !== currentMember?.userId && (
                    <TouchableOpacity
                      style={[st.actionButton, st.dangerButton]}
                      onPress={() => {
                        setShowActionModal(false);
                        openDeleteConfirm(selectedMember);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          st.actionButtonText,
                          { color: "#fff" },
                        ]}
                      >
                        🗑 Delete Member
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={[st.actionButton, st.closeButton]}
                onPress={() => setShowActionModal(false)}
                activeOpacity={0.8}
              >
                <Text
                  style={[st.actionButtonText, { color: C.text2 }]}
                >
                  Close
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </BottomModal>

        <BottomModal
          visible={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Delete Member?"
        >
          {selectedMember && (
            <View style={{ gap: 12, paddingBottom: 20 }}>
              <Text style={[T.small, { color: C.text2 }]}>
                This will remove {selectedMember.fullName} from the group.
                This action cannot be undone.
              </Text>
              <Button
                label="Cancel"
                onPress={() => setShowDeleteModal(false)}
                variant="outline"
                fullWidth
              />
              <Button
                label="Delete Member"
                onPress={handleDeleteMember}
                variant="danger"
                fullWidth
              />
            </View>
          )}
        </BottomModal>
      </View>
    );
  }

  // ── Mobile ─────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Toast visible={visible} msg={msg} type={type} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={st.viewModeLabel}>
          {isGroupView ? "Group view" : "Personal view"}
        </Text>

        {isGroupView ? (
          <TierSummary
            counts={tierCounts}
            tierFilter={tierFilter}
            onSelect={setTierFilter}
          />
        ) : (
          <PersonalRiskCard
            tier={myRisk?.tier ?? null}
            score={myRisk?.score ?? 0}
            topConcern={myTopConcern}
          />
        )}

        {renderControls()}

        {filtered.length === 0 ? (
          <Empty
            message={
              search
                ? "No members match your search"
                : "No members found"
            }
            icon="👥"
          />
        ) : (
          filtered.map((member, i) => renderMemberCard(member, i))
        )}

        {isGroupView && canCreateMember && (
          <TouchableOpacity
            style={st.mobileFab}
            onPress={() => setShowCreateModal(true)}
            activeOpacity={0.8}
          >
            <Text style={st.mobileFabText}>+</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create User"
      >
        <View style={{ gap: 12, paddingBottom: 20 }}>
          <Input
            label="Full Name"
            value={createForm.fullName}
            onChangeText={(t) =>
              setCreateForm((p) => ({ ...p, fullName: t }))
            }
            placeholder="John Doe"
          />
          <Input
            label="Email"
            value={createForm.email}
            onChangeText={(t) =>
              setCreateForm((p) => ({ ...p, email: t }))
            }
            placeholder="john@example.com"
            keyboardType="email-address"
          />
          <Input
            label="Phone"
            value={createForm.phone}
            onChangeText={(t) =>
              setCreateForm((p) => ({ ...p, phone: t }))
            }
            placeholder="+250-XXX-XXX-XXX"
          />
          <Select
            options={USER_ROLES.map((r) => ({
              label: ROLE_LABELS[r],
              value: r,
            }))}
            value={createForm.role}
            onChange={(r) => setCreateForm((p) => ({ ...p, role: r }))}
            label="Role"
          />
          <Button
            label="Create User"
            onPress={handleCreateUser}
            loading={creatingUser}
            fullWidth
          />
        </View>
      </BottomModal>

      <BottomModal
        visible={showActionModal}
        onClose={() => setShowActionModal(false)}
        title={selectedMember?.fullName}
      >
        {selectedMember && (
          <View style={{ gap: 12, paddingBottom: 20 }}>
            {renderDetailBreakdown(selectedMember)}

            {isAdmin && (
              <View style={st.adminActionsSection}>
                <Text style={st.adminActionsTitle}>Admin Actions</Text>

                {selectedMember.status === "pending" && (
                  <Button
                    label="✓ Approve"
                    onPress={handleApproveMember}
                    size="sm"
                    fullWidth
                  />
                )}

                {selectedMember.status === "active" &&
                  selectedMember.userId !== currentMember?.userId && (
                    <Button
                      label="⛔ Deactivate"
                      onPress={handleDeactivateMember}
                      size="sm"
                      fullWidth
                      variant="warning"
                    />
                  )}

                {selectedMember.status === "inactive" && (
                  <Button
                    label="🔄 Reactivate"
                    onPress={handleReactivateMember}
                    size="sm"
                    fullWidth
                    variant="success"
                  />
                )}

                {selectedMember.userId && (
                  <Button
                    label="🔑 Reset Password"
                    onPress={handleResetPassword}
                    loading={resettingPassword}
                    size="sm"
                    fullWidth
                  />
                )}

                {selectedMember.userId !== currentMember?.userId && (
                  <Button
                    label="🗑 Delete"
                    onPress={() => {
                      setShowActionModal(false);
                      openDeleteConfirm(selectedMember);
                    }}
                    size="sm"
                    fullWidth
                    variant="danger"
                  />
                )}
              </View>
            )}
          </View>
        )}
      </BottomModal>

      <BottomModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Member?"
      >
        {selectedMember && (
          <View style={{ gap: 12, paddingBottom: 20 }}>
            <Text style={[T.small, { color: C.text2 }]}>
              This will remove {selectedMember.fullName} from the group.
              This action cannot be undone.
            </Text>
            <Button
              label="Cancel"
              onPress={() => setShowDeleteModal(false)}
              variant="outline"
              fullWidth
            />
            <Button
              label="Delete Member"
              onPress={handleDeleteMember}
              variant="danger"
              fullWidth
            />
          </View>
        )}
      </BottomModal>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════════

const st = StyleSheet.create({
  // ── Tier summary (group view) ────────────────────────────────────
  tierSummaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  donutCenterValue: {
    fontSize: 20,
    fontWeight: "800",
    color: C.text,
    lineHeight: 24,
  },
  donutCenterLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 1,
  },
  tierLegend: {
    flex: 1,
    minWidth: 180,
    gap: 4,
  },
  tierLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  tierLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  tierLegendLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: C.text2,
  },
  tierLegendCount: {
    fontSize: 15,
    fontWeight: "800",
    minWidth: 24,
    textAlign: "right",
  },
  tierClearBtn: {
    alignSelf: "flex-end",
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  tierClearText: {
    fontSize: 11,
    color: C.error,
    fontWeight: "700",
  },

  // ── Personal risk card (personal view) ────────────────────────────
  personalRiskCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    borderLeftColor: C.primary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  personalRiskIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  personalRiskIconText: { fontSize: 20, fontWeight: "800" },
  personalRiskLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  personalRiskTier: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 2,
  },
  personalRiskHint: {
    fontSize: 11,
    color: C.text3,
    lineHeight: 15,
  },
  personalRiskScoreCol: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  personalRiskScore: {
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 30,
  },
  personalRiskScoreLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  container: { paddingHorizontal: 24, paddingVertical: 16 },

  // ── Mobile controls (2026 refresh) ─────────────────────────────
  mobileSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  searchWrapMobile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    height: 40,
  },
  mobileAddBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileAddBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },

  mobileFilterLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  mobileTierChipsRow: {
    gap: 8,
    paddingRight: 8,
    paddingBottom: 12,
  },
  mobileTierChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  mobileTierChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
  },

  mobileSortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  mobileSortSelect: {
    flex: 1,
    minWidth: 140,
  },
  mobileSortRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  mobileResultCount: {
    fontSize: 12,
    color: C.text3,
    fontWeight: "600",
  },
  mobileExportRow: {
    flexDirection: "row",
    gap: 6,
  },
  mobileExportChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  mobileExportChipText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },


  viewModeLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },

  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },

  // ── Controls ──
  controlsSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 10,
  },
  controlsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  controlsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  controlSelect: { minWidth: 140 },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    height: 40,
  },
  searchIcon: { fontSize: 13, marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: C.text,
    paddingVertical: 0,
    minWidth: 100,
  },
  searchClear: {
    fontSize: 13,
    color: C.text3,
    fontWeight: "700",
    paddingHorizontal: 6,
  },

  resultsBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.elevated,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  resultsCount: {
    fontSize: 13,
    color: C.text2,
    fontWeight: "600",
  },
  exportGroup: { flexDirection: "row", gap: 6 },
  exportBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  exportBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  addBtn: {
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // ── Member cards ──
  membersList: { gap: 12 },
  memberCard: {
    padding: 0,
    borderLeftWidth: 4,
  },
  memberCardContent: { padding: 16, gap: 12 },

  memberHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  rankBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  rankText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: -0.3,
  },

  memberInfo: { flex: 1, minWidth: 0, gap: 4 },
  memberMetaRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },

  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    flexShrink: 0,
  },
  tierBadgeIcon: { fontSize: 12, fontWeight: "800" },
  tierBadgeLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tierBadgeScore: {
    fontSize: 11,
    fontWeight: "800",
    opacity: 0.75,
    marginLeft: 2,
  },

  memberStats: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 4,
  },
  statItem: { flex: 1, minWidth: 0, gap: 3 },
  statLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  statValue: { fontSize: 14, fontWeight: "800" },

  scoreBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  scoreBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
    overflow: "hidden",
  },
  scoreBarFill: { height: "100%" as any, borderRadius: 3 },
  scoreBarLabel: {
    fontSize: 11,
    fontWeight: "800",
    minWidth: 50,
    textAlign: "right",
  },

  warnChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  warnChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  warnChipText: {
    fontSize: 10,
    fontWeight: "700",
  },

  // ── Detail modal (risk breakdown) ──
  detailBody: { gap: 6 },
  detailHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
  },
  detailHeroIcon: { fontSize: 24, fontWeight: "800" },
  detailHeroTier: {
    fontSize: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailHeroSub: {
    fontSize: 12,
    color: C.text2,
    marginTop: 2,
  },

  detailSectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  detailRowLabel: {
    fontSize: 12,
    color: C.text2,
    fontWeight: "600",
    width: 100,
  },
  detailRowBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
    overflow: "hidden",
  },
  detailRowBarFill: { height: "100%" as any, borderRadius: 3 },
  detailRowValue: {
    fontSize: 11,
    fontWeight: "800",
    width: 44,
    textAlign: "right",
  },

  detailMetrics: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  redFlag: {
    fontSize: 12,
    color: C.error,
    fontWeight: "600",
    marginBottom: 4,
    lineHeight: 17,
  },

  // ── Admin actions ──
  adminActionsSection: {
    gap: 8,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  adminActionsTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text2,
  },
  approveButton: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  warningButton: {
    backgroundColor: C.gold,
    borderColor: C.gold,
  },
  successButton: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  dangerButton: {
    backgroundColor: C.error,
    borderColor: C.error,
  },
  passwordButton: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  closeButton: {
    backgroundColor: C.elevated,
    borderColor: C.border,
    marginTop: 8,
  },

  // ── Mobile ──
  mobileKpiScroll: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mobileKpiRow: { flexDirection: "row", gap: 10 },

  mobileControls: { marginBottom: 12 },
  mobileFilterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  mobileFilterSelect: { flex: 1, minWidth: 120 },
  mobileResultsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  mobileFab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  mobileFabText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
});
