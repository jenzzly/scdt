// app/(tabs)/dashboard.tsx
import React, { useMemo } from "react";
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Platform, StatusBar, useWindowDimensions} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useActiveGroup, useGroupLoans, useGroupContributions,
  useGroupWallet, useCurrentUserRole, useCurrentMember,
  useIsAdminView, useUnreadNotifs,
} from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";
import { Colors, S, R, C, T, fmtCurrency, fmtFull, fmtDate, round2} from "../../utils/theme";
import type { Loan, Contribution, WalletTransaction, Member } from "../../types";
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

// ─── Main screen ──────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { authName, members, activeGroupId, approveContribution } = useStore();
  const group     = useActiveGroup();
  const loans     = useGroupLoans();
  const contributions = useGroupContributions();
  const wallet    = useGroupWallet();
  const role      = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isAdminView = useIsAdminView();
  const isAdmin   = role === "admin";
  const permissions = useCurrentMemberPermissions();
  // Contribution approval: loan_officer and accountant always can; committee needs permission
  const canApproveContributions =
    ["admin", "loan_officer", "accountant"].includes(role) ||
    (role === "committee" && permissions.approveContributions);
  const unreadCount = useUnreadNotifs();

  useRecalcTotals();

  const myLoans   = useMemo(() => isAdminView ? loans  : loans.filter(l  => l.memberId === currentMember?.id), [loans, isAdminView, currentMember]);
  const myContribs = useMemo(() => isAdminView ? contributions : contributions.filter(c => c.memberId === currentMember?.id), [contributions, isAdminView, currentMember]);
  const myWallet  = useMemo(() => isAdminView ? wallet : wallet.filter(t => t.memberId === currentMember?.id), [wallet, isAdminView, currentMember]);

  const activeLoans   = useMemo(() => myLoans.filter(l => l.status === "disbursed"), [myLoans]);
  const pendingLoans  = useMemo(() => myLoans.filter(l => l.status.startsWith("pending_")), [myLoans]);
  const pendingContribs = useMemo(() => myContribs.filter(c => c.status === "pending"), [myContribs]);
  const defaulters    = useMemo(() => myLoans.filter(l => l.status === "defaulted").length, [myLoans]);
  const recentTxs     = useMemo(() => {
    // Deduplicate by ID before rendering — prevents React key collision
    // when Firestore subscription fires alongside optimistic local add
    const seen = new Set<string>();
    const deduped: typeof myWallet = [];
    for (const tx of myWallet) {
      if (!seen.has(tx.id)) { seen.add(tx.id); deduped.push(tx); }
    }
    return deduped.slice(0, 5);
  }, [myWallet]);

  const getMemberName = (id: string) =>
    members.find(m => m.id === id)?.fullName ?? "Unknown";

  const actualBalance = useMemo(
    () => round2(wallet.reduce((s: number, t: WalletTransaction) => s + t.amount, 0)),
    [wallet],
  );

  const loanEarnings = useMemo(() => {
    const src = isAdminView ? loans : myLoans;
    return src.reduce((sum, l) => {
      if (l.status === "repaid" || l.status === "disbursed") {
        const ratio = l.totalRepayable > 0 ? (l.totalInterest / l.totalRepayable) : 0;
        return sum + round2((l.amountRepaid || 0) * ratio);
      }
      return sum;
    }, 0);
  }, [myLoans, loans, isAdminView]);

  const myTotalContributions = currentMember?.totalContributions ?? 0;

  const QUICK_ACTIONS = [
    { label: "Contribute", icon: "↑",  route: "/modals/add-contribution", show: permissions.addContribution },
    { label: "New Loan",   icon: "₣",  route: "/modals/add-loan",         show: permissions.addLoan },
    { label: "Invest",     icon: "◈",  route: "/modals/add-investment",   show: permissions.addInvestment },
    { label: "Expense",    icon: "↓",  route: "/modals/add-expense",      show: isAdmin },
  ].filter(a => a.show);

  const totalPending = pendingLoans.length + pendingContribs.length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* ── Top bar ── */}
      <View style={st.topBar}>
        <View>
          <Text style={st.greeting}>Good day</Text>
          <Text style={st.userName}>{authName?.split(" ")[0] ?? "User"}</Text>
        </View>
        <TouchableOpacity
          style={st.notifBtn}
          onPress={() => router.push("/notifications")}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 10 }}>N</Text>
          {(unreadCount > 0) && (
            <View style={st.badge}>
              <Text style={st.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100, maxWidth: isWide ? 960 : undefined, alignSelf: isWide ? "center" as any : undefined, width: "100%" as any }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Account card ── */}
        <View style={st.accountCard}>
          {/* subtle grid lines for texture */}
          <View style={[st.cardGrid, { pointerEvents: "none" }]} />

          <Text style={st.cardLabel}>
            {isAdminView ? "GROUP BALANCE" : "MY SAVINGS"}
          </Text>
          <Text style={st.cardAmount}>
            {fmtFull(isAdminView ? actualBalance : myTotalContributions)}
          </Text>
          <Text style={st.cardSub}>{group?.name ?? BRAND.defaultGroupName}</Text>

          <View style={st.cardPills}>
            {isAdminView ? (
              <>
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>SAVINGS</Text>
                  <Text style={st.cardPillVal}>{fmtCurrency(group?.totalSavings ?? 0)}</Text>
                </View>
                <View style={st.cardPillDivider} />
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>LOANS</Text>
                  <Text style={st.cardPillVal}>{fmtCurrency(group?.totalLoans ?? 0)}</Text>
                </View>
                <View style={st.cardPillDivider} />
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>INTEREST</Text>
                  <Text style={st.cardPillVal}>{fmtCurrency(loanEarnings)}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>PAYMENTS</Text>
                  <Text style={st.cardPillVal}>{myContribs.filter(c => c.status === "approved").length}</Text>
                </View>
                <View style={st.cardPillDivider} />
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>ACTIVE LOANS</Text>
                  <Text style={st.cardPillVal}>{activeLoans.length}</Text>
                </View>
                <View style={st.cardPillDivider} />
                <View style={st.cardPill}>
                  <Text style={st.cardPillLabel}>INTEREST</Text>
                  <Text style={st.cardPillVal}>{fmtCurrency(loanEarnings)}</Text>
                </View>
              </>
            )}
          </View>
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



        {/* ── Group Financial Position ── */}
        {(
          <View style={st.block}>
            <SectionHeader title="Group Financial Position" />
            <View style={[st.statsCard, { padding: 0, overflow: 'hidden' }]}>
              {/* Row 1 */}
              <View style={st.statRow}>
                <View style={[st.stat, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <Text style={T.label}>Members</Text>
                  <Text style={st.statValue}>
                    {members.filter(m => m.groupId === activeGroupId && m.status === 'active').length}
                  </Text>
                  <Text style={T.small}>active</Text>
                </View>
                <View style={st.statDivider} />
                <View style={[st.stat, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <Text style={T.label}>Total Net Assets</Text>
                  <Text style={[st.statValue, { color: C.primary, fontSize: 16 }]}>
                    {fmtCurrency(round2((group?.totalSavings ?? 0) + (group?.totalInterestEarned ?? 0)))}
                  </Text>
                  <Text style={T.small}>savings + interest</Text>
                </View>
              </View>
              <View style={st.statRow}>
                <View style={[st.stat, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <Text style={T.label}>Contributions</Text>
                  <Text style={[st.statValue, { fontSize: 16 }]}>
                    {fmtCurrency(group?.totalSavings ?? 0)}
                  </Text>
                  <Text style={T.small}>total collected</Text>
                </View>
                <View style={st.statDivider} />
                <View style={[st.stat, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <Text style={T.label}>Interest Earned</Text>
                  <Text style={[st.statValue, { color: C.gold, fontSize: 16 }]}>
                    {fmtCurrency(round2(group?.totalInterestEarned ?? 0))}
                  </Text>
                  <Text style={T.small}>from loan repayments</Text>
                </View>
              </View>
              <View style={st.statRow}>
                <View style={st.stat}>
                  <Text style={T.label}>Value Per Share</Text>
                  <Text style={[st.statValue, { color: C.primary, fontSize: 16 }]}>
                    {(() => {
                      const active = members.filter(m => m.groupId === activeGroupId && m.status === 'active').length;
                      const netAssets = round2((group?.totalSavings ?? 0) + (group?.totalInterestEarned ?? 0));
                      return active > 0 ? fmtCurrency(round2(netAssets / active)) : 'N/A';
                    })()}
                  </Text>
                  <Text style={T.small}>per active member</Text>
                </View>
                <View style={st.statDivider} />
                <View style={st.stat}>
                  <Text style={T.label}>Dividend Per Share</Text>
                  <Text style={[st.statValue, { color: C.gold, fontSize: 16 }]}>
                    {(() => {
                      const active = members.filter(m => m.groupId === activeGroupId && m.status === 'active').length;
                      return active > 0 ? fmtCurrency(round2((group?.totalInterestEarned ?? 0) / active)) : 'N/A';
                    })()}
                  </Text>
                  <Text style={T.small}>interest per member</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── Pending actions ── */}
        {isAdmin && totalPending > 0 && (
          <View style={st.block}>
            <SectionHeader
              title={`Pending Actions`}
              action={() => router.push("/(tabs)/loans")}
              actionLabel="Review all"
            />
            <View style={st.card}>
              {pendingLoans.slice(0, 3).map((loan, i) => (
                <React.Fragment key={loan.id}>
                  <View style={st.pendingRow}>
                    <View style={st.pendingLeft}>
                      <Chip label="LOAN" bg={C.goldBg} color={C.goldText} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={st.pendingName}>{getMemberName(loan.memberId)}</Text>
                        <Text style={T.small}>
                          {fmtCurrency(loan.amount)} · {loan.status.replace("pending_", "Awaiting ").replace(/_/g, " ")}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => router.push("/(tabs)/loans")}
                      style={st.reviewBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={st.reviewBtnText}>Review</Text>
                    </TouchableOpacity>
                  </View>
                  {(i < pendingLoans.slice(0, 3).length - 1 || pendingContribs.length > 0) && <Divider />}
                </React.Fragment>
              ))}
              {pendingContribs.slice(0, 3).map((c: Contribution, i) => (
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
                  {i < pendingContribs.slice(0, 3).length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {/* ── Recent activity ── */}
        <View style={st.block}>
          <SectionHeader
            title="Recent Activity"
            action={isAdminView ? () => router.push("/(tabs)/wallet") : undefined}
            actionLabel="See all"
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
  // top bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14,
    backgroundColor: C.bg,
  },
  greeting: { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.5, textTransform: "uppercase" },
  userName: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.5, marginTop: 1 },
  notifBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: C.debit, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  // account card
  accountCard: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
    borderRadius: 20,
    backgroundColor: C.card,
    padding: 24,
    overflow: "hidden",
  },
  cardGrid: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.45)", letterSpacing: 1.2, textTransform: "uppercase" },
  cardAmount: { fontSize: 34, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1.2, marginTop: 6 },
  cardSub: { fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, fontWeight: "500" },
  cardPills: {
    flexDirection: "row", marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  cardPill: { flex: 1, alignItems: "center" },
  cardPillLabel: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.4)", letterSpacing: 0.8, textTransform: "uppercase" },
  cardPillVal: { fontSize: 13, fontWeight: "700", color: "#FFFFFF", marginTop: 3 },
  cardPillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },

  // quick actions
  block: { marginHorizontal: 16, marginBottom: 16 },
  qaRow: { flexDirection: "row", gap: 10 },
  qaItem: {
    flex: 1, backgroundColor: C.surface,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingVertical: 16, alignItems: "center", gap: 8,
  },
  qaIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.pill, alignItems: "center", justifyContent: "center",
  },
  qaIconText: { fontSize: 16, color: C.primary, fontWeight: "700" },
  qaLabel: { fontSize: 10, fontWeight: "700", color: C.text2, textTransform: "uppercase", letterSpacing: 0.4 },

  // section header
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 10,
  },

  // stats card
  statsCard: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  statRow: { flexDirection: "row" },
  stat: { flex: 1, padding: 16, gap: 3 },
  statValue: { fontSize: 20, fontWeight: "800", color: C.text, letterSpacing: -0.5 },
  statDivider: { width: 1, backgroundColor: C.border },

  // generic card
  card: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },

  // pending row
  pendingRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
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
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  txDot: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txAmount: { fontSize: 13, fontWeight: "700" },

  // empty
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 28 },
});