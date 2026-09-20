// app/(tabs)/dashboard.tsx
import React, { useMemo } from "react";
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, StatusBar, useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useActiveGroup, useGroupLoans, useGroupContributions,
  useGroupWallet, useGroupInvestments, useGroupMembers,
  useCurrentUserRole, useCurrentMember, useIsGroupView,
} from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";
import { C, T, fmtCurrency, fmtFull, fmtDate, round2 } from "../../utils/theme";
import type { Contribution, WalletTransaction } from "../../types";
import { BRAND } from "../../lib/brand";
import { useRecalcTotals } from "../../hooks/useRecalcTotals";

// ─── Tiny components ──────────────────────────────────────────────
const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
);

const SectionHeader = ({
  title, action, actionLabel,
}: { title: string; action?: () => void; actionLabel?: string }) => (
  <View style={st.sectionHeader}>
    <Text style={T.h2}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={action} activeOpacity={0.7}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: C.primary }}>{actionLabel ?? "See all"}</Text>
      </TouchableOpacity>
    )}
  </View>
);

const Chip = ({ label, bg, color }: { label: string; bg: string; color: string }) => (
  <View style={[st.chip, { backgroundColor: bg }]}>
    <Text style={[st.chipText, { color }]}>{label}</Text>
  </View>
);

interface KpiCardProps {
  label: string;
  value: string;
  icon: string;
  subtext?: string;
  accentColor?: string;
  onPress?: () => void;
}

function KpiCard({ label, value, icon, subtext, accentColor = C.primary, onPress }: KpiCardProps) {
  return (
    <TouchableOpacity
      style={st.kpiCard}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.75 : 1}
    >
      <View style={st.kpiHeader}>
        <Text style={st.kpiLabel} numberOfLines={1}>{label}</Text>
        <View style={[st.kpiIconWrap, { backgroundColor: C.elevated }]}>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
        </View>
      </View>
      <Text style={[st.kpiValue, { color: accentColor }]} numberOfLines={1}>{value}</Text>
      {subtext ? <Text style={st.kpiSubtext} numberOfLines={1}>{subtext}</Text> : null}
    </TouchableOpacity>
  );
}

// ─── Year-grouped activity chart ─────────────────────────────────
//
// Three series per year: contributions, loans, fees. Plain-View bars —
// no SVG dependency, works identically on web and native.
//
// Personal view: only this member's own records.
// Group view: the whole group's records (readable via the same
// list rules that already gate the Members tab).
type ActivityYear = {
  year: number;
  contributions: number;
  loans: number;
  fees: number;
};

function ActivityChart({
  years,
  mode,
}: {
  years: ActivityYear[];
  mode: "personal" | "group";
}) {
  if (years.length === 0) {
    return (
      <View style={st.chartEmpty}>
        <Text style={st.chartEmptyText}>No activity yet</Text>
      </View>
    );
  }

  const maxValue = Math.max(
    1,
    ...years.flatMap(y => [y.contributions, y.loans, y.fees]),
  );

  // Cap at the 6 most recent years so the chart doesn't overflow on
  // long-lived groups.
  const shown = years.slice(-6);

  return (
    <View style={st.chartWrap}>
      <View style={st.chartPlotRow}>
        {shown.map((y) => {
          const cH = y.contributions > 0 ? Math.max(3, (y.contributions / maxValue) * 100) : 0;
          const lH = y.loans         > 0 ? Math.max(3, (y.loans         / maxValue) * 100) : 0;
          const fH = y.fees          > 0 ? Math.max(3, (y.fees          / maxValue) * 100) : 0;
          return (
            <View key={y.year} style={st.chartYearColumn}>
              <View style={st.chartBars}>
                <View style={[st.chartBar, { height: cH, backgroundColor: C.primary }]} />
                <View style={[st.chartBar, { height: lH, backgroundColor: C.brandBlue }]} />
                <View style={[st.chartBar, { height: fH, backgroundColor: C.gold }]} />
              </View>
              <Text style={st.chartYearLabel} numberOfLines={1}>{y.year}</Text>
            </View>
          );
        })}
      </View>

      <View style={st.chartLegend}>
        <View style={st.chartLegendItem}>
          <View style={[st.chartLegendDot, { backgroundColor: C.primary }]} />
          <Text style={st.chartLegendText}>Contributions</Text>
        </View>
        <View style={st.chartLegendItem}>
          <View style={[st.chartLegendDot, { backgroundColor: C.brandBlue }]} />
          <Text style={st.chartLegendText}>Loans</Text>
        </View>
        <View style={st.chartLegendItem}>
          <View style={[st.chartLegendDot, { backgroundColor: C.gold }]} />
          <Text style={st.chartLegendText}>Fees</Text>
        </View>
        <Text style={st.chartModeText}>
          {mode === "personal" ? "· my data" : "· group data"}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { members, approveContribution } = useStore();
  const group         = useActiveGroup();
  const loans         = useGroupLoans();
  const contributions = useGroupContributions();
  const wallet        = useGroupWallet();
  const investments   = useGroupInvestments();
  const groupMembers  = useGroupMembers();
  const role          = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isGroupView   = useIsGroupView();
  const isAdmin       = role === "admin";
  const permissions   = useCurrentMemberPermissions();

  const canApproveContributions =
    ["admin", "loan_officer", "accountant"].includes(role) ||
    (role === "committee" && permissions.approveContributions);

  useRecalcTotals();

  // Personal records — dual-keyed so records written under either
  // `memberId` or legacy `userId` are picked up.
  const myLoans = useMemo(
    () =>
      loans.filter(
        (l) =>
          l.memberId === currentMember?.id ||
          (l as any).userId === currentMember?.userId ||
          l.memberId === currentMember?.userId,
      ),
    [loans, currentMember],
  );
  const myContribs = useMemo(
    () =>
      contributions.filter(
        (c) =>
          c.memberId === currentMember?.id ||
          (c as any).userId === currentMember?.userId ||
          c.memberId === currentMember?.userId,
      ),
    [contributions, currentMember],
  );
  const myWallet = useMemo(
    () =>
      wallet.filter(
        (t) =>
          t.memberId === currentMember?.id ||
          (t as any).userId === currentMember?.userId ||
          t.memberId === currentMember?.userId,
      ),
    [wallet, currentMember],
  );

  // Review queues by role
  const ROLE_LOAN_STATUS: Record<string, string> = {
    loan_officer: "pending_loan_officer",
    committee: "pending_committee",
    accountant: "approved",
  };

  const reviewLoans = useMemo(() => {
    if (!isGroupView) return [];
    if (isAdmin) return loans.filter(l => l.status.startsWith("pending_") || l.status === "approved");
    const targetStatus = ROLE_LOAN_STATUS[role];
    return targetStatus ? loans.filter(l => l.status === targetStatus) : [];
  }, [loans, isGroupView, role, isAdmin]);

  const reviewContribs = useMemo(
    () => (isGroupView && canApproveContributions) ? contributions.filter(c => c.status === "pending") : [],
    [contributions, isGroupView, canApproveContributions],
  );

  const activeLoans   = useMemo(() => myLoans.filter(l => l.status === "disbursed"), [myLoans]);
  const pendingLoans  = useMemo(() => myLoans.filter(l => l.status.startsWith("pending_")), [myLoans]);
  const approvedLoans = useMemo(() => myLoans.filter(l => l.status === "approved"), [myLoans]);

  // ── MY TOTAL CONTRIBUTIONS ───────────────────────────────────────
  //
  // Sum of THIS member's own approved contribution records. Deliberately
  // computed from the contributions collection rather than reading
  // `currentMember.totalContributions`: recalcGroupTotals recomputes
  // that field from walletTransactions, and a plain member cannot read
  // the wallet collection, so the field silently reads back as 0 for
  // non-staff roles regardless of how many approved contributions exist.
  const myTotalContribs = useMemo(
    () =>
      round2(
        myContribs
          .filter((c) => c.status === "approved")
          .reduce((sum, c) => sum + (c.amount || 0), 0),
      ),
    [myContribs],
  );

  const getMemberName = (id: string) =>
    members.find(m => m.id === id)?.fullName ?? "Unknown";

  const loanEarnings = useMemo(() => {
    return myLoans.reduce((sum, l) => {
      if (l.status === "repaid" || l.status === "disbursed") {
        const ratio = l.totalRepayable > 0 ? (l.totalInterest / l.totalRepayable) : 0;
        return sum + round2((l.amountRepaid || 0) * ratio);
      }
      return sum;
    }, 0);
  }, [myLoans]);

  const myLoanBalance = useMemo(() => {
    return activeLoans.reduce((sum, l) => sum + (l.balance ?? l.amount), 0);
  }, [activeLoans]);

  // ── MY SHARE ─────────────────────────────────────────────────────
  //
  // Model:
  //   My Share = my own approved contributions
  //            + (group profit pool ÷ active member count)
  //
  // Your savings are yours. Only the profit the GROUP earned is split
  // equally across active members — that's the honest reading of "all
  // profit is shared among members."
  //
  // The profit pool is composed of two things, both readable by every
  // role from the SAME sources so that a member, an accountant, and the
  // admin all compute an identical value for a given member:
  //
  //   • Already-earned interest — persisted on the group doc as
  //     `totalInterestEarned`, maintained by recalcGroupTotals. Read
  //     from the group doc, which every authenticated user may `get`.
  //
  //   • Projected interest — for every currently-disbursed loan,
  //     (totalInterest ÷ totalRepayable) × remaining balance. Computed
  //     from the loans collection, which is list-readable by every
  //     active member.
  //
  // Deliberately NOT sourcing this from `walletTransactions` — a plain
  // member can't read that collection, so the value would silently
  // differ by role (the exact bug this replaces).
  const groupInterestEarned = group?.totalInterestEarned ?? 0;

  const projectedGroupInterest = useMemo(() => {
    return loans.reduce((sum, l) => {
      if (l.status !== "disbursed") return sum;
      if (!l.totalRepayable || l.totalRepayable <= 0) return sum;
      const ratio = l.totalInterest / l.totalRepayable;
      return sum + round2((l.balance ?? 0) * ratio);
    }, 0);
  }, [loans]);

  const groupProfitPool = round2(groupInterestEarned + projectedGroupInterest);

  const activeMemberCount = Math.max(
    1,
    groupMembers.filter((m) => m.status === "active").length,
  );

  const myProfitShare = round2(groupProfitPool / activeMemberCount);

  const myShare = round2(myTotalContribs + myProfitShare);

  // ── Recent Activity ──────────────────────────────────────────────
  //
  // Group view: whole wallet.
  // Personal view (staff): the member's own wallet txs.
  // Personal view (plain member): wallet is unreadable → synthesize
  //   from contributions + loans.
  type ActivityRow = {
    id: string;
    date: string;
    description: string;
    amount: number;
    kind?: "credit" | "debit";
  };

  const recentTxs: ActivityRow[] = useMemo(() => {
    const dedupWallet = (source: WalletTransaction[]): ActivityRow[] => {
      const seen = new Set<string>();
      const out: ActivityRow[] = [];
      for (const tx of source) {
        if (seen.has(tx.id)) continue;
        seen.add(tx.id);
        out.push({
          id: tx.id,
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
        });
      }
      return out;
    };

    if (isGroupView) {
      return dedupWallet(wallet).slice(0, 5);
    }

    if (myWallet.length > 0) {
      return dedupWallet(myWallet).slice(0, 5);
    }

    const items: ActivityRow[] = [];
    for (const c of myContribs) {
      if (c.status !== "approved") continue;
      items.push({
        id: `contrib-${c.id}`,
        date: c.date,
        description:
          c.description ||
          `${(c.contributionType || "regular").replace(/_/g, " ")} contribution`,
        amount: c.amount,
        kind: "credit",
      });
    }
    for (const l of myLoans) {
      if (l.disbursementDate) {
        items.push({
          id: `loan-${l.id}`,
          date: l.disbursementDate,
          description: `Loan disbursed — ${l.purpose || "Loan"}`,
          amount: l.amount,
          kind: "debit",
        });
      }
    }
    return items
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [isGroupView, wallet, myWallet, myContribs, myLoans]);

  // ── Chart data ───────────────────────────────────────────────────
  //
  // Year-bucketed activity series. Personal view: this member's records
  // only. Group view: whole group. Fees come from meeting penalties
  // (readable by every role) and, where the caller can read the wallet,
  // also from `late_fee` wallet txs.
  const chartYears: ActivityYear[] = useMemo(() => {
    const byYear = new Map<
      number,
      { contributions: number; loans: number; fees: number }
    >();

    const ensure = (y: number) => {
      if (!byYear.has(y)) byYear.set(y, { contributions: 0, loans: 0, fees: 0 });
      return byYear.get(y)!;
    };

    const yearOf = (d?: string) => {
      if (!d) return null;
      const dt = new Date(d);
      if (Number.isNaN(dt.getTime())) return null;
      return dt.getFullYear();
    };

    const scopeContribs = isGroupView ? contributions : myContribs;
    const scopeLoans    = isGroupView ? loans : myLoans;
    const scopeWallet   = isGroupView ? wallet : myWallet;

    for (const c of scopeContribs) {
      if (c.status !== "approved") continue;
      const y = yearOf(c.date);
      if (y === null) continue;
      ensure(y).contributions += c.amount || 0;
    }

    for (const l of scopeLoans) {
      const y = yearOf((l as any).disbursementDate);
      if (y === null) continue;
      ensure(y).loans += l.amount || 0;
    }

    for (const tx of scopeWallet) {
      if (tx.type !== "late_fee") continue;
      const y = yearOf(tx.date);
      if (y === null) continue;
      ensure(y).fees += Math.abs(tx.amount || 0);
    }

    return Array.from(byYear.entries())
      .map(([year, v]) => ({
        year,
        contributions: round2(v.contributions),
        loans: round2(v.loans),
        fees: round2(v.fees),
      }))
      .sort((a, b) => a.year - b.year);
  }, [isGroupView, contributions, myContribs, loans, myLoans, wallet, myWallet]);

  const QUICK_ACTIONS = [
    { label: "Contribute", icon: "↑",  route: "/modals/add-contribution", show: permissions.addContribution },
    { label: "New Loan",   icon: "₣",  route: "/modals/add-loan",         show: permissions.addLoan },
    { label: "Invest",     icon: "◈",  route: "/modals/add-investment",   show: permissions.addInvestment },
    { label: "Expense",    icon: "↓",  route: "/modals/add-expense",      show: isAdmin },
  ].filter(a => a.show);

  const renderGroupKpis = () => {
    switch (role) {
      case "accountant":
        return (
          <View style={st.kpiGrid}>
            <KpiCard
              label="Pending Contributions"
              value={String(contributions.filter(c => c.status === "pending").length)}
              icon="💵"
              subtext="Awaiting review"
              accentColor={C.brandAmber}
              onPress={() => router.push("/(tabs)/contributions")}
            />
            <KpiCard
              label="Ready for Disbursement"
              value={String(loans.filter(l => l.status === "approved").length)}
              icon="💳"
              subtext="Approved loans"
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Group Balance"
              value={fmtCurrency(group?.availableBalance || 0)}
              icon="💰"
              subtext="Available in vault"
              accentColor={C.accent}
              onPress={() => router.push("/(tabs)/wallet")}
            />
            <KpiCard
              label="Group Profit Pool"
              value={fmtCurrency(groupProfitPool)}
              icon="📊"
              subtext="Interest + projections"
              accentColor={C.brandBlue}
              onPress={() => router.push("/(tabs)/reports")}
            />
          </View>
        );

      case "loan_officer":
        return (
          <View style={st.kpiGrid}>
            <KpiCard
              label="Pending Applications"
              value={String(loans.filter(l => l.status === "pending_loan_officer").length)}
              icon="⏳"
              subtext="Needs your approval"
              accentColor={C.brandAmber}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Awaiting Committee"
              value={String(loans.filter(l => l.status === "pending_committee").length)}
              icon="👥"
              subtext="In review pipeline"
              accentColor={C.brandBlue}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Active Portfolio"
              value={fmtCurrency(group?.totalLoans || 0)}
              icon="💳"
              subtext={`${loans.filter(l => l.status === "disbursed").length} active loans`}
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Approved Loans"
              value={String(loans.filter(l => l.status === "approved" || l.status === "disbursed").length)}
              icon="✅"
              subtext="Total successful"
              accentColor={C.accent}
              onPress={() => router.push("/(tabs)/loans")}
            />
          </View>
        );

      case "committee":
        return (
          <View style={st.kpiGrid}>
            <KpiCard
              label="Loans for Approval"
              value={String(loans.filter(l => l.status === "pending_committee").length)}
              icon="📋"
              subtext="Needs committee sign-off"
              accentColor={C.brandAmber}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Investment Proposals"
              value={String(investments.filter(i => i.status === "pending" || i.status === "pending_committee").length)}
              icon="📈"
              subtext="Awaiting review"
              accentColor={C.brandBlue}
              onPress={() => router.push("/(tabs)/investments")}
            />
            <KpiCard
              label="Active Investments"
              value={String(investments.filter(i => i.status === "open").length)}
              icon="◈"
              subtext={fmtCurrency(group?.totalInvestments || 0)}
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/investments")}
            />
            <KpiCard
              label="Group Balance"
              value={fmtCurrency(group?.availableBalance || 0)}
              icon="💰"
              subtext="Available funds"
              accentColor={C.accent}
              onPress={() => router.push("/(tabs)/reports")}
            />
          </View>
        );

      case "admin":
      default:
        return (
          <View style={st.kpiGrid}>
            <KpiCard
              label="Group Profit Pool"
              value={fmtCurrency(groupProfitPool)}
              icon="💵"
              subtext={`÷ ${activeMemberCount} active members`}
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/reports")}
            />
            <KpiCard
              label="Active Loans"
              value={fmtCurrency(group?.totalLoans || 0)}
              icon="💳"
              subtext={`${loans.filter(l => l.status === "disbursed").length} disbursed`}
              accentColor={C.brandBlue}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Pending Approvals"
              value={String(reviewLoans.length + reviewContribs.length)}
              icon="⏳"
              subtext="Requires attention"
              accentColor={C.brandAmber}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Group Balance"
              value={fmtCurrency(group?.availableBalance || 0)}
              icon="💰"
              subtext="Available in vault"
              accentColor={C.accent}
              onPress={() => router.push("/(tabs)/wallet")}
            />
          </View>
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: 100,
          maxWidth: isWide ? 960 : undefined,
          alignSelf: isWide ? "center" : undefined,
          width: "100%",
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── View Banner if in Group View ── */}
        {isGroupView ? (
          <View style={st.groupBanner}>
            <View style={st.groupBannerLeft}>
              <Text style={st.groupBannerTag}>{role?.toUpperCase()} · GROUP VIEW</Text>
              <Text style={st.groupBannerTitle}>{group?.name ?? BRAND.defaultGroupName}</Text>
            </View>
            <Chip label="GROUP" bg={C.primary} color="#FFFFFF" />
          </View>
        ) : (
          /* ── Account card — Personal View ──
              MY SHARE = your own contributions + an equal slice of the
              group's profit pool. Because the formula sources only
              collections readable by every role, the number is
              identical whether a member, an accountant, or the admin
              is looking at it. */
          <View style={st.accountCard}>
            <View style={[st.cardGrid, { pointerEvents: "none" }]} />
            <Text style={st.cardLabel}>MY SHARE</Text>
            <Text style={st.cardAmount}>{fmtFull(myShare)}</Text>
            <Text style={st.cardSub}>{group?.name ?? BRAND.defaultGroupName}</Text>

            <View style={st.cardPills}>
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>MY SAVINGS</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {fmtCurrency(myTotalContribs)}
                </Text>
              </View>
              <View style={st.cardPillDivider} />
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>PROFIT SHARE</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {fmtCurrency(myProfitShare)}
                </Text>
              </View>
              <View style={st.cardPillDivider} />
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>ACTIVE LOANS</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {activeLoans.length}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── KPI Cards: Group View or Personal View Cards ── */}
        <View style={st.block}>
          {isGroupView ? (
            renderGroupKpis()
          ) : (
            <View style={st.kpiGrid}>
              <KpiCard
                label="My Total Contributions"
                value={fmtCurrency(myTotalContribs)}
                icon="💵"
                subtext={`${myContribs.filter(c => c.status === "approved").length} approved payments`}
                accentColor={C.primary}
                onPress={() => router.push("/(tabs)/contributions")}
              />
              <KpiCard
                label="Active Loan Balance"
                value={fmtCurrency(myLoanBalance)}
                icon="💳"
                subtext={activeLoans.length > 0 ? `${activeLoans.length} active loan(s)` : "No active loans"}
                accentColor={C.brandBlue}
                onPress={() => router.push("/(tabs)/loans")}
              />
              <KpiCard
                label="Profit Share"
                value={fmtCurrency(myProfitShare)}
                icon="📈"
                subtext={`1/${activeMemberCount} of group profit`}
                accentColor={C.accent}
              />
              <KpiCard
                label="Pending Submissions"
                value={String(pendingLoans.length + myContribs.filter(c => c.status === "pending").length)}
                icon="⏳"
                subtext={approvedLoans.length > 0 ? `${approvedLoans.length} approved awaiting payout` : "Under review"}
                accentColor={C.brandAmber}
                onPress={() => router.push("/(tabs)/loans")}
              />
            </View>
          )}
        </View>

        {/* ── Quick actions ── */}
        {QUICK_ACTIONS.length > 0 && (
          <View style={st.block}>
            <View style={st.qaRow}>
              {QUICK_ACTIONS.map(a => (
                <TouchableOpacity
                  key={a.label}
                  style={st.qaItem}
                  onPress={() => router.push(a.route as any)}
                  activeOpacity={0.75}
                >
                  <View style={st.qaIcon}>
                    <Text style={st.qaIconText}>{a.icon}</Text>
                  </View>
                  <Text style={st.qaLabel}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Activity Chart ── */}
        <View style={st.block}>
          <SectionHeader
            title={isGroupView ? "Group Activity by Year" : "My Activity by Year"}
          />
          <View style={st.card}>
            <ActivityChart
              years={chartYears}
              mode={isGroupView ? "group" : "personal"}
            />
          </View>
        </View>

        {/* ── Pending actions queue (Group View only) ── */}
        {isGroupView && (reviewLoans.length > 0 || reviewContribs.length > 0) && (
          <View style={st.block}>
            <SectionHeader
              title="Pending..."
              action={() => router.push("/(tabs)/loans")}
              actionLabel="Review all"
            />
            <View style={st.card}>
              {reviewLoans.slice(0, 3).map((loan, i) => (
                <React.Fragment key={loan.id}>
                  <View style={st.pendingRow}>
                    <View style={st.pendingLeft}>
                      <Chip label="LOAN" bg={C.goldBg} color={C.goldText} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={st.pendingName}>{getMemberName(loan.memberId)}</Text>
                        <Text style={T.small}>
                          {fmtCurrency(loan.amount)} · {loan.status === "approved" ? "Ready to disburse" : loan.status.replace("pending_", "Awaiting ").replace(/_/g, " ")}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => router.push("/(tabs)/loans")}
                      style={st.reviewBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={st.reviewBtnText}>{loan.status === "approved" ? "Disburse" : "Review"}</Text>
                    </TouchableOpacity>
                  </View>
                  {(i < reviewLoans.slice(0, 3).length - 1 || reviewContribs.length > 0) && <Divider />}
                </React.Fragment>
              ))}
              {reviewContribs.slice(0, 3).map((c: Contribution, i) => (
                <React.Fragment key={c.id}>
                  <View style={st.pendingRow}>
                    <View style={st.pendingLeft}>
                      <Chip label="CONTRIB" bg={C.greenBg} color={C.greenText} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={st.pendingName}>{getMemberName(c.memberId)}</Text>
                        <Text style={T.small}>{fmtCurrency(c.amount)} · {fmtDate(c.date)}</Text>
                      </View>
                    </View>
                    {canApproveContributions && (
                      <TouchableOpacity
                        style={st.approveBtn}
                        onPress={() => approveContribution(c.id)}
                        activeOpacity={0.8}
                      >
                        <Text style={st.approveBtnText}>Approve</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {i < reviewContribs.slice(0, 3).length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {/* ── Recent Activity ── */}
        <View style={st.block}>
          <SectionHeader
            title={isGroupView ? "Group Activity" : "Recent Activity"}
            action={() => router.push(isGroupView ? "/(tabs)/wallet" : "/(tabs)/contributions")}
            actionLabel="View all"
          />
          <View style={st.card}>
            {recentTxs.length === 0 ? (
              <View style={st.empty}>
                <Text style={st.emptyIcon}>📋</Text>
                <Text style={T.body}>No activity yet</Text>
              </View>
            ) : (
              recentTxs.map((tx, i) => {
                const isCredit =
                  tx.kind !== undefined
                    ? tx.kind === "credit"
                    : (tx.amount ?? 0) > 0;
                const displayAmount = Math.abs(tx.amount ?? 0);
                return (
                  <React.Fragment key={tx.id}>
                    <View style={st.txRow}>
                      <View style={[st.txDot, { backgroundColor: isCredit ? C.greenBg : C.redBg }]}>
                        <Text style={{ fontSize: 13, color: isCredit ? C.accent : C.debit }}>
                          {isCredit ? "↓" : "↑"}
                        </Text>
                      </View>
                      <View style={st.txMid}>
                        <Text style={st.txDesc} numberOfLines={1}>{tx.description}</Text>
                        <Text style={T.small}>{fmtDate(tx.date)}</Text>
                      </View>
                      <Text style={[st.txAmount, { color: isCredit ? C.accent : C.debit }]}>
                        {isCredit ? "+" : "−"}{fmtCurrency(displayAmount)}
                      </Text>
                    </View>
                    {i < recentTxs.length - 1 && <Divider />}
                  </React.Fragment>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────
const st = StyleSheet.create({
  // group banner
  groupBanner: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: C.surface,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupBannerLeft: { flex: 1, minWidth: 0 },
  groupBannerTag: { fontSize: 10, fontWeight: "700", color: C.primary, letterSpacing: 0.8 },
  groupBannerTitle: { fontSize: 16, fontWeight: "800", color: C.text, marginTop: 2 },

  // account card
  accountCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: C.card,
    padding: 22,
    overflow: "hidden",
  },
  cardGrid: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.45)", letterSpacing: 1.2, textTransform: "uppercase" },
  cardAmount: { fontSize: 32, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1, marginTop: 4 },
  cardSub: { fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4, fontWeight: "500" },
  cardPills: {
    flexDirection: "row", marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  cardPill: { flex: 1, minWidth: 0, alignItems: "center" },
  cardPillLabel: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.4)", letterSpacing: 0.8, textTransform: "uppercase" },
  cardPillVal: { fontSize: 13, fontWeight: "700", color: "#FFFFFF", marginTop: 3 },
  cardPillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },

  // KPI grid
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  kpiCard: {
    flexBasis: "47%" as any,
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "space-between",
  },
  kpiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
    minWidth: 0,
    marginRight: 6,
  },
  kpiIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  kpiSubtext: {
    fontSize: 11,
    color: C.text3,
    fontWeight: "500",
    marginTop: 3,
  },

  // quick actions
  block: { marginHorizontal: 16, marginBottom: 14 },
  qaRow: { flexDirection: "row", gap: 10 },
  qaItem: {
    flex: 1, backgroundColor: C.surface,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingVertical: 14, alignItems: "center", gap: 6,
  },
  qaIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: C.pill, alignItems: "center", justifyContent: "center",
  },
  qaIconText: { fontSize: 15, color: C.primary, fontWeight: "700" },
  qaLabel: { fontSize: 10, fontWeight: "700", color: C.text2, textTransform: "uppercase", letterSpacing: 0.4 },

  // section header
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 10,
  },

  // generic card
  card: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },

  // pending row
  pendingRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 13,
  },
  pendingLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 10 },
  pendingName: { fontSize: 13, fontWeight: "600", color: C.text },
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  chipText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  reviewBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, backgroundColor: C.pill,
  },
  reviewBtnText: { fontSize: 11, fontWeight: "700", color: C.primary },
  approveBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, backgroundColor: C.greenBg,
    borderWidth: 1, borderColor: "rgba(16,185,129,0.2)",
  },
  approveBtnText: { fontSize: 11, fontWeight: "700", color: C.greenText },

  // tx row
  txRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 13, gap: 12,
  },
  txDot: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  txMid: { flex: 1, minWidth: 0 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txAmount: { fontSize: 13, fontWeight: "700" },

  // empty
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 28 },

  // activity chart
  chartWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  chartPlotRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    height: 130,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    paddingBottom: 4,
  },
  chartYearColumn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 0,
  },
  chartBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 3,
    height: 100,
  },
  chartBar: {
    width: 12,
    borderRadius: 3,
  },
  chartYearLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    marginTop: 6,
    textAlign: "center",
  },
  chartLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
  },
  chartLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chartLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  chartLegendText: {
    fontSize: 10,
    fontWeight: "600",
    color: C.text3,
  },
  chartModeText: {
    fontSize: 10,
    color: C.text3,
    fontStyle: "italic",
    marginLeft: "auto",
  },
  chartEmpty: {
    paddingVertical: 40,
    alignItems: "center",
  },
  chartEmptyText: {
    fontSize: 12,
    color: C.text3,
  },
});