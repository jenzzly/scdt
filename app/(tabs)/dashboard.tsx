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

  // Personal data
  const myLoans    = useMemo(() => loans.filter(l => l.memberId === currentMember?.id), [loans, currentMember]);
  const myContribs = useMemo(() => contributions.filter(c => c.memberId === currentMember?.id), [contributions, currentMember]);
  const myWallet   = useMemo(() => wallet.filter(t => t.memberId === currentMember?.id), [wallet, currentMember]);

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

  const activeLoans     = useMemo(() => myLoans.filter(l => l.status === "disbursed"), [myLoans]);
  const pendingLoans    = useMemo(() => myLoans.filter(l => l.status.startsWith("pending_")), [myLoans]);
  const approvedLoans   = useMemo(() => myLoans.filter(l => l.status === "approved"), [myLoans]);
  const myTotalContribs = currentMember?.totalContributions ?? 0;

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

  // Recent transactions (personal vs group)
  const txList = isGroupView ? wallet : myWallet;
  const recentTxs = useMemo(() => {
    const seen = new Set<string>();
    const deduped: typeof txList = [];
    for (const tx of txList) {
      if (!seen.has(tx.id)) { seen.add(tx.id); deduped.push(tx); }
    }
    return deduped.slice(0, 5);
  }, [txList]);

  const QUICK_ACTIONS = [
    { label: "Contribute", icon: "↑",  route: "/modals/add-contribution", show: permissions.addContribution },
    { label: "New Loan",   icon: "₣",  route: "/modals/add-loan",         show: permissions.addLoan },
    { label: "Invest",     icon: "◈",  route: "/modals/add-investment",   show: permissions.addInvestment },
    { label: "Expense",    icon: "↓",  route: "/modals/add-expense",      show: isAdmin },
  ].filter(a => a.show);

  // Render role-specific group KPI cards
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
              label="Total Savings"
              value={fmtCurrency(group?.totalSavings || 0)}
              icon="📊"
              subtext="All members"
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
              label="Total Contributions"
              value={fmtCurrency(group?.totalSavings || 0)}
              icon="💵"
              subtext={`${groupMembers.filter(m => m.status === "active").length} active members`}
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/contributions")}
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
            <Chip
              label="GROUP"
              bg={C.primary}
              color="#FFFFFF"
            />
          </View>
        ) : (
          /* ── Account card — Personal View ── */
          <View style={st.accountCard}>
            <View style={[st.cardGrid, { pointerEvents: "none" }]} />
            <Text style={st.cardLabel}>MY SAVINGS</Text>
            <Text style={st.cardAmount}>{fmtFull(myTotalContribs)}</Text>
            <Text style={st.cardSub}>{group?.name ?? BRAND.defaultGroupName}</Text>

            <View style={st.cardPills}>
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>PAYMENTS</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {myContribs.filter(c => c.status === "approved").length}
                </Text>
              </View>
              <View style={st.cardPillDivider} />
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>ACTIVE LOANS</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {activeLoans.length}
                </Text>
              </View>
              <View style={st.cardPillDivider} />
              <View style={st.cardPill}>
                <Text style={st.cardPillLabel} numberOfLines={1}>INTEREST</Text>
                <Text style={st.cardPillVal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {fmtCurrency(loanEarnings)}
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
                label="Interest Earned"
                value={fmtCurrency(loanEarnings)}
                icon="📈"
                subtext="From group earnings"
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

        {/* ── Pending actions queue (when in Group View) ── */}
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
                <Text style={T.body}>No transactions yet</Text>
              </View>
            ) : (
              recentTxs.map((tx: WalletTransaction, i) => {
                const isCredit = tx.amount > 0;
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
                        {isCredit ? "+" : "−"}{fmtCurrency(Math.abs(tx.amount))}
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
    // A fixed pixel minWidth (150) needs 310px+ of usable width for a
    // 2-up row once the 10px gap is added. On a 320-375px phone with
    // 16-32px of screen padding, only ~288-343px is actually available,
    // so the grid falls back to a lopsided "1 card, then 1 card alone on
    // its own row" instead of a clean 2-column layout. A percentage
    // flexBasis scales with whatever width the parent actually has.
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
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txAmount: { fontSize: 13, fontWeight: "700" },

  // empty
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 28 },
});