// app/(tabs)/contributions.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";

import {
  useStore,
  useGroupContributions,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMember,
  useCanSeeAllFinancial,
  useIsGroupView,
  useCurrentMemberPermissions,
  useActiveGroup,
  useGroupWallet,
  useDataViewMode,
} from "../../stores/useStore";

import {
  SearchBar,
  Card,
  Badge,
  Empty,
  BottomModal,
  useToast,
  Toast,
  Select,
  DatePicker,
  TabRow,
} from "../../components/ui";

import { Colors, C, T, S, R, fmtCurrency, fmtDate } from "../../utils/theme";

import {
  exportXlsx,
  importXlsx,
  exportPdf,
  generatePaymentScheduleHtml as _unused,
} from "../../utils/export";
import { findOverdueContributions } from "../../utils/lateFees";
import { getCurrentGoalPeriod } from "../../lib/firestore/contributionGoals";

import type { Contribution, ContributionGoalPeriod } from "../../types";

import { KpiCard } from "../../components/ui/KpiCard";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, "teal" | "gold" | "green" | "red" | "muted"> = {
  approved: "green",
  pending: "gold",
  rejected: "red",
};

const TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  loan_repayment: "Loan Repayment",
  loan_interest: "Loan Interest",
  late_fee: "Late Fee",
  investment_funding: "Investment Funding",
  investment_return: "Investment Return",
  penalty: "Penalty",
  other: "Other",
};

const SORT_OPTIONS = [
  { label: "Newest first", value: "date_desc" },
  { label: "Oldest first", value: "date_asc" },
  { label: "Month", value: "month" },
  { label: "Year", value: "year" },
];

const TYPE_OPTIONS = [
  { label: "All types", value: "all" },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ label, value })),
];

const STATUS_TABS = ["All", "Approved", "Pending", "Late Fee"] as const;

// Matches EDIT_ROLES in edit-contribution.tsx — kept in sync manually
// since that file is a separate route/bundle.
const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

// -----------------------------------------------------------------------------
// Small shared pieces
// -----------------------------------------------------------------------------

const Divider = () => <View style={st.divider} />;

const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

/** Card width caps content at 900px and centers it on wide/desktop layouts. */
const wideCardStyle = (isWide: boolean) =>
  isWide ? { maxWidth: 900, alignSelf: "center" as const, width: "100%" as const } : null;

export default function ContributionsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const {
    approveContribution,
    rejectContribution,
    activeGroupId,
    applyContributionLateFee,
    recalcTotals,
    setDataViewMode,
  } = useStore();

  const allContributions = useGroupContributions();
  const allMembers = useGroupMembers();
  const group = useActiveGroup();
  const allWallet = useGroupWallet();

  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();

  const canSeeAll = useCanSeeAllFinancial();
  const isGroupView = useIsGroupView();
  const dataViewMode = useDataViewMode();
  const permissions = useCurrentMemberPermissions();

  const { show, visible, msg, type } = useToast();

  const isAdmin = role === "admin";

  const canApprove =
    ["admin", "loan_officer", "accountant"].includes(role) ||
    (role === "committee" && permissions.approveContributions);

  const canAdd = permissions.addContribution || isAdmin;
  const canExport = permissions.downloadReports || isAdmin;

  // Only these three roles may apply or clear a late fee. Members and
  // committee can still SEE the late fee tab/list/amounts — this flag only
  // gates the Apply/Clear action button.
  const canManageFees = ["admin", "accountant", "loan_officer"].includes(role);

  const canEditContribution = EDIT_ROLES.includes(role);

  const getMemberName = (id: string) =>
    allMembers.find((m) => m.id === id)?.fullName ?? "Unknown";

  const handleEditPress = (id: string) => {
    router.push(`/modals/edit-contribution?id=${id}`);
  };

  // ---------------------------------------------------------------------------
  // Scope contributions to either group view or personal view.
  // ---------------------------------------------------------------------------

  const contributions = useMemo(
    () =>
      isGroupView
        ? allContributions
        : allContributions.filter((c) => c.memberId === currentMember?.id),
    [isGroupView, allContributions, currentMember?.id]
  );

  // ---------------------------------------------------------------------------
  // Filters / UI state
  // ---------------------------------------------------------------------------

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [selectedContrib, setSelectedContrib] = useState<Contribution | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [applyingFeeId, setApplyingFeeId] = useState<string | null>(null);
  const [goalPeriod, setGoalPeriod] = useState<ContributionGoalPeriod | null>(null);

  const [dateRangeStart, setDateRangeStart] = useState("");
  const [dateRangeEnd, setDateRangeEnd] = useState("");

  const [viewMode, setViewMode] = useState<"list" | "monthly">("list");
  const [importing, setImporting] = useState(false);

  // ---------------------------------------------------------------------------
  // Late fees
  //
  // allWallet MUST be a dependency below because applying/clearing a fee
  // changes wallet state and therefore the late-fee lifecycle.
  // ---------------------------------------------------------------------------

  const overdueContributions = useMemo(() => {
    if (!group) return [];
    return findOverdueContributions(group, allMembers, allContributions, allWallet);
  }, [group, allMembers, allContributions, allWallet]);

  // ---------------------------------------------------------------------------
  // Visible late fees
  //
  // A late-fee chunk is identified by item.feeTxId === walletTransaction.id
  // (NOT walletTransaction.sourceId — sourceId is the member/contribution
  // source, while feeTxId is the actual wallet transaction ID).
  //
  // State:
  //   no transaction              -> Apply
  //   transaction feePaid=false   -> Clear
  //   transaction feePaid=true    -> hidden
  //
  // Clearing a late-fee transaction does NOT stop future accrual — the
  // underlying contribution must still be unpaid for accrual to continue.
  //
  // NOTE: visibility of this list itself is NOT role-gated — members and
  // committee can see their own/group late fees. Only the Apply/Clear
  // action (see canManageFees) is restricted.
  // ---------------------------------------------------------------------------

  const visibleLateFees = useMemo(() => {
    if (!allWallet) return [];

    const fees = overdueContributions
      .map((item) => {
        const matchingTx = allWallet.find(
          (tx) => tx.id === item.feeTxId && tx.type === "late_fee"
        );

        return {
          ...item,
          applied: !!matchingTx,
          isPaid: !!matchingTx?.feePaid,
        };
      })
      .filter((item) => !item.isPaid);

    return isGroupView
      ? fees
      : fees.filter((item) => item.memberId === currentMember?.id);
  }, [overdueContributions, allWallet, isGroupView, currentMember?.id]);

  // ---------------------------------------------------------------------------
  // Load current goal period
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    if (!activeGroupId) return;

    (async () => {
      try {
        const period = await getCurrentGoalPeriod(activeGroupId);
        setGoalPeriod(period);
      } catch (e) {
        console.error("[Contributions] Failed to load goal period:", e);
      }
    })();
  }, [activeGroupId]);

  // ---------------------------------------------------------------------------
  // Collection statistics
  //
  // totalExpected is driven directly by the group's goal target — NOT a
  // "periods elapsed since joining" estimate, which drifted from what's
  // actually configured in group settings.
  //
  //   Group view:    totalExpected = goal target × active member count
  //   Personal view: totalExpected = goal target (single member)
  //
  // Falls back to the plain contributionAmount if no goal period is
  // configured yet, so the KPI still shows something sensible.
  // ---------------------------------------------------------------------------

  const collectionStats = useMemo(() => {
    if (!group || !allMembers) return null;

    const contributionAmount = group.contributionAmount || 0;
    const perMemberTarget = goalPeriod?.targetAmount ?? contributionAmount;

    if (perMemberTarget <= 0) return null;

    const activeMembers = allMembers.filter((m) => m.status === "active");

    const totalExpected = isGroupView
      ? perMemberTarget * activeMembers.length
      : perMemberTarget;

    const totalCollected = allContributions
      .filter(
        (c) =>
          c.status === "approved" &&
          c.contributionType === "regular" &&
          (isGroupView || c.memberId === currentMember?.id)
      )
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

    // Only currently visible unpaid chunks count here.
    const totalLateFeesRemaining = visibleLateFees.reduce(
      (sum, item) => sum + (item.feeAmount || 0),
      0
    );

    return { totalExpected, totalCollected, collectionRate, totalLateFeesRemaining };
  }, [
    group,
    allMembers,
    allContributions,
    visibleLateFees,
    goalPeriod,
    isGroupView,
    currentMember?.id,
  ]);

  // ---------------------------------------------------------------------------
  // Per-member goal progress
  // ---------------------------------------------------------------------------

  const memberGoalRows = useMemo(() => {
    if (!goalPeriod || !allMembers || !allContributions) return [];

    const periodStart = new Date(goalPeriod.periodStart);
    const periodEnd = new Date(goalPeriod.periodEnd);
    const target = goalPeriod.targetAmount;

    const scopedMembers = isGroupView
      ? allMembers.filter((m) => m.status === "active")
      : allMembers.filter((m) => m.status === "active" && m.id === currentMember?.id);

    return scopedMembers
      .map((member) => {
        const paid = allContributions
          .filter(
            (c) =>
              c.memberId === member.id &&
              c.status === "approved" &&
              c.contributionType === "regular" &&
              new Date(c.date) >= periodStart &&
              new Date(c.date) <= periodEnd
          )
          .reduce((sum, c) => sum + (c.amount || 0), 0);

        const remaining = Math.max(0, target - paid);
        const percentage = target > 0 ? Math.round((paid / target) * 100) : 0;

        const lateFees = visibleLateFees
          .filter((f) => f.memberId === member.id)
          .reduce((sum, f) => sum + (f.feeAmount || 0), 0);

        return {
          memberId: member.id,
          memberName: member.fullName,
          paid,
          remaining,
          percentage,
          lateFees,
          isCompleted: paid >= target,
        };
      })
      .sort((a, b) => b.percentage - a.percentage);
  }, [
    goalPeriod,
    allMembers,
    allContributions,
    isGroupView,
    currentMember?.id,
    visibleLateFees,
  ]);

  // ---------------------------------------------------------------------------
  // Goal progress
  //
  // - target          → personal goal (single member's target for the period)
  // - groupTarget     → target × active member count (matches collectionStats)
  // - percentage      → my progress vs my target
  // - groupPercentage → group progress vs groupTarget
  //
  // Both figures are always computed regardless of isGroupView, so the goal
  // card can show Personal AND Group side by side rather than swapping.
  // ---------------------------------------------------------------------------

  const goalProgress = useMemo(() => {
    if (!goalPeriod) return null;

    const now = new Date();
    const periodStart = new Date(goalPeriod.periodStart);
    const periodEnd = new Date(goalPeriod.periodEnd);
    const target = goalPeriod.targetAmount;

    const isApprovedInPeriod = (c: Contribution) => {
      const cDate = new Date(c.date);
      return cDate >= periodStart && cDate <= periodEnd && c.status === "approved";
    };

    const totalContributed = allContributions
      .filter(
        (c) => isApprovedInPeriod(c) && (isGroupView || c.memberId === currentMember?.id)
      )
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const groupTotalContributed = allContributions
      .filter(isApprovedInPeriod)
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    // Group target = personal target × active members — matches
    // collectionStats.totalExpected exactly.
    const activeMemberCount = allMembers.filter((m) => m.status === "active").length;
    const groupTarget = target * activeMemberCount;

    const percentage = target > 0 ? Math.round((totalContributed / target) * 100) : 0;
    const groupPercentage =
      groupTarget > 0 ? Math.round((groupTotalContributed / groupTarget) * 100) : 0;

    const remaining = Math.max(0, target - totalContributed);
    const daysLeft = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );

    return {
      totalContributed,
      groupTotalContributed,
      target,
      groupTarget,
      remaining,
      percentage,
      groupPercentage,
      daysLeft,
      isCompleted: totalContributed >= target,
      isGroupScoped: isGroupView,
    };
  }, [goalPeriod, allContributions, allMembers, isGroupView, currentMember?.id]);

  // ---------------------------------------------------------------------------
  // Apply / clear late fee
  // ---------------------------------------------------------------------------

  const handleApplyContributionFee = async (item: any) => {
    setApplyingFeeId(item.feeTxId);

    try {
      await applyContributionLateFee(item);
      show(`Late fee of ${fmtCurrency(item.feeAmount)} applied to ${item.memberName}`);
      recalcTotals();
    } catch (e: any) {
      show(e?.message || "Failed to apply late fee", "error");
    } finally {
      setApplyingFeeId(null);
    }
  };

  // This only marks the individual late-fee transaction as paid.
  // It does NOT mark the underlying contribution as paid.
  const handleClearContributionFee = async (item: any) => {
    setApplyingFeeId(item.feeTxId);

    try {
      await useStore.getState().clearStandaloneLateFee(item.feeTxId);
      show(`Late fee of ${fmtCurrency(item.feeAmount)} cleared`);
      recalcTotals();
    } catch (e: any) {
      show(e?.message || "Failed to clear late fee", "error");
    } finally {
      setApplyingFeeId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Filter + sort + pagination
  // ---------------------------------------------------------------------------

  const SORT_COMPARATORS: Record<string, (a: Contribution, b: Contribution) => number> = {
    date_asc: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    date_desc: (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    month: (a, b) => {
      const monthIndex = (d: Contribution) => {
        const date = new Date(d.date);
        return date.getFullYear() * 12 + date.getMonth();
      };
      return monthIndex(b) - monthIndex(a);
    },
    year: (a, b) => new Date(b.date).getFullYear() - new Date(a.date).getFullYear(),
  };

  const filtered = useMemo(() => {
    let list = [...contributions];

    if (statusFilter !== "all") {
      list = list.filter((c) => c.status === statusFilter);
    }

    if (typeFilter !== "all") {
      list = list.filter((c) => c.contributionType === typeFilter);
    }

    if (dateRangeStart) {
      const startDate = new Date(dateRangeStart);
      list = list.filter((c) => new Date(c.date) >= startDate);
    }

    if (dateRangeEnd) {
      const endDate = new Date(dateRangeEnd);
      endDate.setHours(23, 59, 59, 999);
      list = list.filter((c) => new Date(c.date) <= endDate);
    }

    if (search) {
      const term = search.toLowerCase();
      list = list.filter(
        (c) =>
          getMemberName(c.memberId).toLowerCase().includes(term) ||
          c.description?.toLowerCase().includes(term) ||
          c.contributionType?.toLowerCase().includes(term)
      );
    }

    const comparator = SORT_COMPARATORS[sort];
    if (comparator) list.sort(comparator);

    return list;
  }, [contributions, statusFilter, typeFilter, search, sort, allMembers, dateRangeStart, dateRangeEnd]);

  const totalPages = useMemo(() => Math.ceil(filtered.length / PAGE_SIZE), [filtered]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const totalAmount = useMemo(
    () =>
      statusFilter === "late_fee"
        ? visibleLateFees.reduce((sum, item) => sum + (item.feeAmount || 0), 0)
        : filtered.reduce((sum, c) => sum + (c.amount || 0), 0),
    [statusFilter, visibleLateFees, filtered]
  );

  const pendingCount = useMemo(
    () => filtered.filter((c) => c.status === "pending").length,
    [filtered]
  );

  const approvedCount = useMemo(
    () => filtered.filter((c) => c.status === "approved").length,
    [filtered]
  );

  const handleTabChange = (t: string) => {
    setStatusFilter(t === "Late Fee" ? "late_fee" : t.toLowerCase());
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleSort = (v: string) => {
    setSort(v);
    setPage(1);
  };

  // ---------------------------------------------------------------------------
  // Approve / reject contribution
  // ---------------------------------------------------------------------------

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await approveContribution(id);
      show("Contribution approved");
      setSelectedContrib(null);
    } catch (e: any) {
      show(e.message || "Failed to approve", "error");
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setApprovingId(id);
    try {
      await rejectContribution(id, "Rejected by admin/officer");
      show("Contribution rejected");
      setSelectedContrib(null);
    } catch (e: any) {
      show(e.message || "Failed to reject", "error");
    } finally {
      setApprovingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Export / Import — Excel (.xlsx) only. CSV has been removed.
  // ---------------------------------------------------------------------------

  const handleExport = async () => {
    const headers = ["Date", "Member", "Type", "Amount", "Status", "Description"];

    const rows = filtered.map((c) => [
      fmtDate(c.date),
      getMemberName(c.memberId),
      typeLabel(c.contributionType),
      c.amount,
      c.status,
      c.description ?? "",
    ]);

    const fileName =
      dateRangeStart || dateRangeEnd
        ? `Contributions_Report_${dateRangeStart || "start"}_to_${dateRangeEnd || "end"}`
        : "Contributions_Report";

    try {
      await exportXlsx(fileName, headers, rows);
      show("Exported as Excel");
    } catch (e: any) {
      show(e?.message || "Failed to export", "error");
    }
  };

  const handleImport = async () => {
    if (!activeGroupId) {
      show("No active group", "error");
      return;
    }

    setImporting(true);
    try {
      // Expected columns, in order: Date, Member, Type, Amount, Status, Description
      const rows = await importXlsx();

      if (!rows || rows.length === 0) {
        show("No data found in file", "error");
        return;
      }

      const bulkImport = (useStore.getState() as any).bulkImportContributions;

      if (typeof bulkImport !== "function") {
        show(
          "Import is not wired up yet — bulkImportContributions is missing from the store",
          "error"
        );
        return;
      }

      const result = await bulkImport(rows, activeGroupId);
      show(`Imported ${result?.count ?? rows.length} contributions`);
      recalcTotals();
    } catch (e: any) {
      if (e?.message !== "Cancelled") {
        show(e?.message || "Failed to import file", "error");
      }
    } finally {
      setImporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // "+ Add" — always routes to the add-contribution modal fresh, with no
  // contribution id in the URL, so the modal can't mistake this for an edit.
  // ---------------------------------------------------------------------------

  const handleAddPress = () => {
    setSelectedContrib(null);
    router.push("/modals/add-contribution");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cardWide = wideCardStyle(isWide);
  const activeTab =
    statusFilter === "all" ? "All" : statusFilter === "late_fee" ? "Late Fee" : statusFilter;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        isWide={isWide}
        isGroupView={isGroupView}
        isLateFeeView={statusFilter === "late_fee"}
        canExport={canExport}
        canAdd={canAdd}
        importing={importing}
        onExport={handleExport}
        onImport={handleImport}
        onAdd={handleAddPress}
      />

      <ScrollView
        contentContainerStyle={[{ paddingBottom: 100 }, isWide && { paddingHorizontal: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {goalProgress && (
          <GoalCard
            isWide={isWide}
            isGroupView={isGroupView}
            currency={group?.currency ?? "RWF"}
            goalProgress={goalProgress}
            minimumContribution={goalPeriod?.minimumContribution ?? 0}
          />
        )}

        <View style={[st.block, cardWide]}>
          <View style={st.kpiGrid}>
            <KpiCard
              label="Total Expected"
              value={collectionStats ? fmtCurrency(collectionStats.totalExpected) : "—"}
              icon="📋"
              subtext={isGroupView ? "Goal target × active members" : "Your goal target"}
              accentColor={C.accent}
              onPress={() => {}}
            />

            <KpiCard
              label="Total Collected"
              value={collectionStats ? fmtCurrency(collectionStats.totalCollected) : "—"}
              icon="💰"
              subtext="Collected contributions"
              accentColor={C.success}
              onPress={() => setStatusFilter("approved")}
            />

            <KpiCard
              label="Collection Rate"
              value={collectionStats ? `${collectionStats.collectionRate.toFixed(1)}%` : "—"}
              icon="📊"
              subtext="Collection efficiency"
              accentColor={C.primary}
              onPress={() => {}}
            />

            <KpiCard
              label="Late Fees Due"
              value={
                collectionStats ? fmtCurrency(collectionStats.totalLateFeesRemaining) : "—"
              }
              icon="⚠️"
              subtext="Unpaid late fees"
              accentColor={C.gold}
              onPress={() => setStatusFilter("late_fee")}
            />
          </View>
        </View>

        <View style={[st.controls, cardWide]}>
          <View style={st.controlsTop}>
            <View style={{ flex: 2 }}>
              <SearchBar value={search} onChange={handleSearch} placeholder="Search contributions…" />
            </View>
          </View>

          <View style={st.viewModeRow}>
            <ViewModeButton
              label="List View"
              active={viewMode === "list"}
              onPress={() => setViewMode("list")}
            />
            <ViewModeButton
              label="Goal Progress"
              active={viewMode === "monthly"}
              onPress={() => setViewMode("monthly")}
            />
          </View>

          <View style={st.dateFilterRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <DatePicker
                label="From Date"
                value={dateRangeStart}
                onChange={(value) => {
                  setDateRangeStart(value);
                  setPage(1);
                }}
                placeholder="Start date"
              />
            </View>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <DatePicker
                label="To Date"
                value={dateRangeEnd}
                onChange={(value) => {
                  setDateRangeEnd(value);
                  setPage(1);
                }}
                placeholder="End date"
              />
            </View>
          </View>

          <View style={st.statusRow}>
            <TabRow tabs={[...STATUS_TABS]} active={activeTab} onChange={handleTabChange} />
          </View>
        </View>

        <View style={[{ marginTop: 8 }, cardWide]}>
          {viewMode === "monthly" ? (
            <GoalProgressList
              isWide={isWide}
              goalPeriod={goalPeriod}
              rows={memberGoalRows}
            />
          ) : statusFilter === "late_fee" ? (
            <LateFeeList
              items={visibleLateFees}
              isGroupView={isGroupView}
              group={group}
              canManageFees={canManageFees}
              applyingFeeId={applyingFeeId}
              onApply={handleApplyContributionFee}
              onClear={handleClearContributionFee}
            />
          ) : paginated.length === 0 ? (
            <EmptyState icon="💰" text="No contributions found" />
          ) : isWide ? (
            <ContributionTable
              rows={paginated}
              isGroupView={isGroupView}
              canApprove={canApprove}
              canEdit={canEditContribution}
              onEdit={handleEditPress}
            />
          ) : (
            <View style={st.card}>
              {paginated.map((c, i) => (
                <React.Fragment key={c.id}>
                  <ContributionRow
                    contribution={c}
                    memberName={isGroupView ? getMemberName(c.memberId) : ""}
                    canApprove={canApprove}
                    canEdit={canEditContribution}
                    onApprove={() => handleApprove(c.id)}
                    onReject={() => handleReject(c.id)}
                    onView={() => setSelectedContrib(c)}
                    onEdit={() => handleEditPress(c.id)}
                  />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          {viewMode !== "monthly" && (
            <Pagination page={page} totalPages={totalPages} setPage={setPage} filtered={filtered} />
          )}
        </View>
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Top action bar
// -----------------------------------------------------------------------------

function TopBar({
  isWide,
  isGroupView,
  isLateFeeView,
  canExport,
  canAdd,
  importing,
  onExport,
  onImport,
  onAdd,
}: {
  isWide: boolean;
  isGroupView: boolean;
  isLateFeeView: boolean;
  canExport: boolean;
  canAdd: boolean;
  importing: boolean;
  onExport: () => void;
  onImport: () => void;
  onAdd: () => void;
}) {
  return (
    <View style={[st.topBar, wideCardStyle(isWide)]}>
      <View>
        <Text style={st.pageSummaryLabel}>{isGroupView ? "Group" : "Personal"}</Text>
        <Text style={st.pageSummaryTitle}>
          {isLateFeeView ? "Late Fees Record" : "History"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {canExport && (
          <TouchableOpacity style={st.iconBtn} onPress={onExport} activeOpacity={0.8}>
            <Text style={st.iconBtnText}>Export</Text>
          </TouchableOpacity>
        )}

        {canExport && (
          <TouchableOpacity
            style={st.iconBtn}
            onPress={onImport}
            activeOpacity={0.8}
            disabled={importing}
          >
            <Text style={st.iconBtnText}>{importing ? "Importing…" : "Import"}</Text>
          </TouchableOpacity>
        )}

        {canAdd && (
          <TouchableOpacity style={st.primaryBtn} onPress={onAdd} activeOpacity={0.8}>
            <Text style={st.primaryBtnText}>+ Add</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function ViewModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[st.viewModeBtn, active && st.viewModeBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[st.viewModeBtnText, active && st.viewModeBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={st.empty}>
      <Text style={st.emptyIcon}>{icon}</Text>
      <Text style={st.emptyText}>{text}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Goal card — shows BOTH personal and group goal, always
// -----------------------------------------------------------------------------

function GoalCard({
  isWide,
  isGroupView,
  currency,
  goalProgress,
  minimumContribution,
}: {
  isWide: boolean;
  isGroupView: boolean;
  currency: string;
  goalProgress: NonNullable<ReturnType<typeof useGoalProgressType>>;
  minimumContribution: number;
}) {
  const amountText = (value: number) =>
    fmtCurrency(value, currency).replace(`${currency} `, "");

  return (
    <View style={[st.goalCard, wideCardStyle(isWide) && { ...wideCardStyle(isWide), marginHorizontal: 0 }]}>
      <View style={st.cardAccentDot} />

      {/* Personal goal */}
      <View style={st.goalHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.goalLabel} numberOfLines={1}>
            {goalProgress.isCompleted ? "✓ MY GOAL ACHIEVED" : "MY CONTRIBUTION GOAL"}
          </Text>

          <Text style={st.goalAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            <Text style={st.balanceCurrency}>{currency} </Text>
            {amountText(goalProgress.totalContributed)}
          </Text>
        </View>

        <View style={st.goalHeaderRight}>
          <Text
            style={[st.goalPercentage, goalProgress.isCompleted && { color: Colors.green }]}
            numberOfLines={1}
          >
            {goalProgress.percentage}%
          </Text>
          <Text style={st.goalDaysLeft} numberOfLines={1}>
            {goalProgress.daysLeft > 0 ? `${goalProgress.daysLeft}d left` : "Period ended"}
          </Text>
        </View>
      </View>

      <ProgressBar
        percentage={goalProgress.percentage}
        color={goalProgress.isCompleted ? Colors.green : Colors.primary}
      />

      {/* Group goal — always shown, not just in one view */}
      <View style={st.goalDividerLine} />

      <View style={[st.goalHeaderRow, { marginTop: 12, marginBottom: 0 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.goalLabel} numberOfLines={1}>
            {goalProgress.groupPercentage >= 100
              ? "✓ GROUP GOAL ACHIEVED"
              : "GROUP CONTRIBUTION GOAL"}
          </Text>

          <Text
            style={[st.goalAmount, { fontSize: 20 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            <Text style={st.balanceCurrency}>{currency} </Text>
            {amountText(goalProgress.groupTotalContributed)}
          </Text>
        </View>

        <View style={st.goalHeaderRight}>
          <Text
            style={[
              st.goalPercentage,
              { fontSize: 16 },
              goalProgress.groupPercentage >= 100 && { color: Colors.green },
            ]}
            numberOfLines={1}
          >
            {goalProgress.groupPercentage}%
          </Text>
        </View>
      </View>

      <ProgressBar
        percentage={goalProgress.groupPercentage}
        color={goalProgress.groupPercentage >= 100 ? Colors.green : Colors.accent}
      />

      <View style={st.goalStatsRow}>
        <GoalStat
          label="Target"
          value={fmtCurrency(isGroupView ? goalProgress.groupTarget : goalProgress.target)}
        />
        <GoalStat
          label="Remaining"
          value={fmtCurrency(goalProgress.remaining)}
          dimWhenComplete={goalProgress.isCompleted}
        />
        <GoalStat label="Min Contribution" value={fmtCurrency(minimumContribution)} />
      </View>
    </View>
  );
}

// Type-only helper so GoalCard's prop type can reference the shape produced
// by the goalProgress useMemo above without re-declaring it by hand.
function useGoalProgressType() {
  return null as unknown as {
    totalContributed: number;
    groupTotalContributed: number;
    target: number;
    groupTarget: number;
    remaining: number;
    percentage: number;
    groupPercentage: number;
    daysLeft: number;
    isCompleted: boolean;
    isGroupScoped: boolean;
  } | null;
}

function ProgressBar({ percentage, color }: { percentage: number; color: string }) {
  return (
    <View style={st.progressBarContainer}>
      <View
        style={[st.progressBar, { width: `${Math.min(100, percentage)}%`, backgroundColor: color }]}
      />
    </View>
  );
}

function GoalStat({
  label,
  value,
  dimWhenComplete,
}: {
  label: string;
  value: string;
  dimWhenComplete?: boolean;
}) {
  return (
    <View style={st.goalStat}>
      <Text
        style={st.goalStatLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
      <Text
        style={[st.goalStatValue, dimWhenComplete && { color: Colors.bgWhite }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Goal progress (per member) — table on wide layouts, card list on mobile
// -----------------------------------------------------------------------------

function GoalProgressList({
  isWide,
  goalPeriod,
  rows,
}: {
  isWide: boolean;
  goalPeriod: ContributionGoalPeriod | null;
  rows: {
    memberId: string;
    memberName: string;
    paid: number;
    remaining: number;
    percentage: number;
    lateFees: number;
    isCompleted: boolean;
  }[];
}) {
  if (!goalPeriod) {
    return <EmptyState icon="🎯" text="No contribution goal is set up for this group" />;
  }

  if (rows.length === 0) {
    return <EmptyState icon="👥" text="No active members to show" />;
  }

  if (!isWide) {
    return (
      <View style={st.card}>
        {rows.map((row, i) => (
          <React.Fragment key={row.memberId}>
            <View style={st.txRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.txDesc} numberOfLines={1}>
                  {row.memberName}
                </Text>
                <Text style={st.txMeta} numberOfLines={1}>
                  {fmtCurrency(row.paid)} paid · {row.percentage}% of goal
                  {row.lateFees > 0 ? ` · ${fmtCurrency(row.lateFees)} late fees` : ""}
                </Text>
              </View>

              <View style={{ alignItems: "flex-end", flexShrink: 0, marginLeft: 8 }}>
                <Text
                  style={[st.txAmount, { color: row.isCompleted ? C.success : C.accent }]}
                  numberOfLines={1}
                >
                  {row.isCompleted ? "Done" : fmtCurrency(row.remaining)}
                </Text>
                {!row.isCompleted && (
                  <Text style={st.remainingLabel}>remaining</Text>
                )}
              </View>
            </View>

            {i < rows.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </View>
    );
  }

  return (
    <View style={st.table}>
      <View style={[st.tableRow, st.tableHeadRow]}>
        <Text style={[st.tableHeadCell, { flex: 2 }]}>MEMBER</Text>
        <Text style={[st.tableHeadCell, { width: 130, textAlign: "right" }]}>PAID</Text>
        <Text style={[st.tableHeadCell, { width: 130, textAlign: "right" }]}>REMAINING</Text>
        <Text style={[st.tableHeadCell, { width: 90, textAlign: "right" }]}>PROGRESS</Text>
        <Text style={[st.tableHeadCell, { width: 110, textAlign: "right" }]}>LATE FEES</Text>
        <Text style={[st.tableHeadCell, { width: 90, textAlign: "center" }]}>STATUS</Text>
      </View>

      {rows.map((row) => (
        <View key={row.memberId} style={[st.tableRow, st.tableRowBordered]}>
          <Text style={[st.tableCell, { flex: 2 }]} numberOfLines={1}>
            {row.memberName}
          </Text>

          <Text style={[st.tableCell, st.tableCellPaid]}>{fmtCurrency(row.paid)}</Text>

          <Text style={[st.tableCell, { width: 130, textAlign: "right" }]}>
            {row.isCompleted ? "—" : fmtCurrency(row.remaining)}
          </Text>

          <Text style={[st.tableCell, { width: 90, textAlign: "right", fontWeight: "600" }]}>
            {row.percentage}%
          </Text>

          <Text
            style={[
              st.tableCell,
              { width: 110, textAlign: "right", color: row.lateFees > 0 ? C.gold : C.text3 },
            ]}
          >
            {row.lateFees > 0 ? fmtCurrency(row.lateFees) : "—"}
          </Text>

          <View style={{ width: 90, alignItems: "center" }}>
            <Badge label={row.isCompleted ? "Done" : "In progress"} color={row.isCompleted ? "green" : "gold"} />
          </View>
        </View>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Late fee list
// -----------------------------------------------------------------------------

function LateFeeList({
  items,
  isGroupView,
  group,
  canManageFees,
  applyingFeeId,
  onApply,
  onClear,
}: {
  items: any[];
  isGroupView: boolean;
  group: any;
  canManageFees: boolean;
  applyingFeeId: string | null;
  onApply: (item: any) => void;
  onClear: (item: any) => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon="✓" text="No late fees owed" />;
  }

  return (
    <View style={st.block}>
      {items.map((item, index) => {
        const detail = item.applied
          ? `${item.periodLabel} · Unpaid late fee`
          : `${isGroupView ? `${item.periodLabel} · ` : ""}${item.daysNewlyOwed}d @ ${
              group?.contributionLateFeeRatePct ?? 0
            }%/day · ${item.daysLate}d late`;

        const isSaving = applyingFeeId === item.feeTxId;

        return (
          <React.Fragment key={item.feeTxId}>
            <View style={st.lateFeeRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.lateFeeMemberName} numberOfLines={1}>
                  {isGroupView ? item.memberName : item.periodLabel}
                </Text>
                <Text style={st.lateFeeDetail} numberOfLines={2}>
                  {detail}
                </Text>
              </View>

              <View style={st.lateFeeAmountWrap}>
                <Text style={st.lateFeeAmount}>{fmtCurrency(item.feeAmount)}</Text>

                {/*
                  Apply/Clear action is restricted to admin, accountant, and
                  loan_officer. Everyone else can still see the fee amount
                  and detail above — this button is the only thing gated.
                */}
                {canManageFees && (
                  <TouchableOpacity
                    style={st.lateFeeApplyBtn}
                    onPress={() => (item.applied ? onClear(item) : onApply(item))}
                    disabled={isSaving}
                    activeOpacity={0.8}
                  >
                    <Text style={st.lateFeeApplyBtnText}>
                      {isSaving ? "Saving…" : item.applied ? "Clear" : "Apply"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {index < items.length - 1 && <Divider />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Desktop table
// -----------------------------------------------------------------------------

function ContributionTable({
  rows,
  isGroupView,
  canApprove,
  canEdit,
  onEdit,
}: {
  rows: Contribution[];
  isGroupView: boolean;
  canApprove: boolean;
  canEdit: boolean;
  onEdit: (id: string) => void;
}) {
  return (
    <View style={st.table}>
      <View style={[st.tableRow, st.tableHeadRow]}>
        <View style={{ width: 40 }} />
        <Text style={[st.tableHeadCell, { flex: 2 }]}>DESCRIPTION</Text>
        <Text style={[st.tableHeadCell, { width: 160 }]}>TYPE</Text>
        {isGroupView && <Text style={[st.tableHeadCell, { width: 150 }]}>MEMBER</Text>}
        <Text style={[st.tableHeadCell, { width: 120 }]}>DATE</Text>
        <Text style={[st.tableHeadCell, { width: 120, textAlign: "right" }]}>AMOUNT</Text>
        {canApprove && <View style={{ width: 60 }} />}
        {canEdit && <View style={{ width: 50 }} />}
      </View>

      {rows.map((c) => (
        <TableRow
          key={c.id}
          contribution={c}
          showMember={isGroupView}
          canEdit={canEdit}
          onEdit={() => onEdit(c.id)}
        />
      ))}
    </View>
  );
}

const TableRow = ({
  contribution,
  showMember,
  canEdit,
  onEdit,
}: {
  contribution: Contribution;
  showMember: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) => {
  const role = useCurrentUserRole();
  const canApprove = ["admin", "loan_officer", "accountant"].includes(role);

  const allMembers = useGroupMembers();
  const memberName =
    allMembers.find((m) => m.id === contribution.memberId)?.fullName ?? "Unknown";

  const { icon, bg, color } = statusBadge(contribution.status);

  return (
    <View style={[st.tableRow, st.tableRowBordered]}>
      <View style={[st.tableCell, { width: 40 }]}>
        <View style={[st.txIconSm, { backgroundColor: bg }]}>
          <Text style={{ fontSize: 9, fontWeight: "800", color }}>{icon}</Text>
        </View>
      </View>

      <Text style={[st.tableCell, { flex: 2 }]} numberOfLines={1}>
        {contribution.description || typeLabel(contribution.contributionType)}
      </Text>

      <Text style={[st.tableCell, { width: 160 }]}>{typeLabel(contribution.contributionType)}</Text>

      {showMember && <Text style={[st.tableCell, { width: 150 }]}>{memberName}</Text>}

      <Text style={[st.tableCell, { width: 120 }]}>{fmtDate(contribution.date)}</Text>

      <Text style={[st.tableCell, st.tableCellAmount]}>{fmtCurrency(contribution.amount)}</Text>

      {canApprove && contribution.status === "pending" && (
        <View style={[st.tableCell, { width: 60, alignItems: "center" }]}>
          <TouchableOpacity onPress={() => {/* Existing desktop behavior. */}}>
            <Text style={st.tableApproveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}

      {canEdit && (
        <View style={[st.tableCell, { width: 50, alignItems: "center" }]}>
          <TouchableOpacity onPress={onEdit}>
            <Text style={st.tableEditText}>Edit</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// -----------------------------------------------------------------------------
// Mobile contribution row
// -----------------------------------------------------------------------------

function statusBadge(status: string) {
  if (status === "approved") return { icon: "✓", bg: C.greenBg, color: C.greenText };
  if (status === "pending") return { icon: "⏳", bg: C.goldBg, color: C.goldText };
  return { icon: "✗", bg: C.redBg, color: C.redText };
}

function ContributionRow({
  contribution,
  memberName,
  canApprove,
  canEdit,
  onApprove,
  onReject,
  onView,
  onEdit,
}: any) {
  const { icon, bg, color } = statusBadge(contribution.status);

  const metaParts = [
    fmtDate(contribution.date),
    memberName || null,
    typeLabel(contribution.contributionType),
  ].filter(Boolean);

  const showApproveReject = canApprove && contribution.status === "pending";

  return (
    <View style={st.txRow}>
      <View style={[st.txIcon, { backgroundColor: bg }]}>
        <Text style={{ fontSize: 11, fontWeight: "800", color, letterSpacing: 0.3 }}>{icon}</Text>
      </View>

      <View style={st.txMid}>
        <Text style={st.txDesc} numberOfLines={1}>
          {contribution.description || typeLabel(contribution.contributionType)}
        </Text>
        <Text style={st.txMeta} numberOfLines={1}>
          {metaParts.join(" · ")}
        </Text>
      </View>

      <View style={{ alignItems: "flex-end", flexShrink: 0, marginLeft: 8 }}>
        <Text
          style={[st.txAmount, { color: C.accent }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {fmtCurrency(contribution.amount)}
        </Text>

        {(showApproveReject || canEdit) && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 3 }}>
            {showApproveReject && (
              <>
                <TouchableOpacity onPress={onApprove} style={st.rowApproveBtn}>
                  <Text style={st.rowApproveText}>Approve</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={onReject} style={st.rowRejectBtn}>
                  <Text style={st.rowRejectText}>Reject</Text>
                </TouchableOpacity>
              </>
            )}

            {canEdit && (
              <TouchableOpacity onPress={onEdit} style={st.rowEditBtn}>
                <Text style={st.rowEditText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

const Pagination = ({
  page,
  totalPages,
  setPage,
  filtered,
}: {
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
  filtered: any[];
}) => {
  if (totalPages <= 1) return null;

  const isFirst = page === 1;
  const isLast = page >= totalPages;
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length);

  return (
    <View style={st.pagination}>
      <TouchableOpacity
        style={[st.pageBtn, isFirst && st.pageBtnDisabled]}
        onPress={() => !isFirst && setPage(page - 1)}
        disabled={isFirst}
      >
        <Text style={[st.pageBtnText, isFirst && { color: C.text3 }]}>← Prev</Text>
      </TouchableOpacity>

      <Text style={st.pageInfo}>
        {rangeStart}–{rangeEnd} of {filtered.length}
      </Text>

      <TouchableOpacity
        style={[st.pageBtn, isLast && st.pageBtnDisabled]}
        onPress={() => !isLast && setPage(page + 1)}
        disabled={isLast}
      >
        <Text style={[st.pageBtnText, isLast && { color: C.text3 }]}>Next →</Text>
      </TouchableOpacity>
    </View>
  );
};

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const st = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },

  pageSummaryLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.primary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  pageSummaryTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    marginTop: 1,
  },

  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  iconBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: Colors.surface,
  },

  iconBtnText: { fontSize: 12, fontWeight: "700", color: C.text2 },

  block: { marginHorizontal: 16, marginBottom: 14 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  cardAccentDot: {
    position: "absolute",
    top: -50,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(26,86,219,0.15)",
  },

  balanceCurrency: { fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.45)" },

  goalCard: {
    margin: 16,
    borderRadius: 20,
    backgroundColor: C.card,
    padding: 24,
    overflow: "hidden",
    marginTop: 8,
  },

  goalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },

  goalHeaderRight: { alignItems: "flex-end", flexShrink: 0, marginLeft: 8 },

  goalLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },

  goalAmount: { fontSize: 24, fontWeight: "800", color: "#fff", letterSpacing: -1, marginTop: 4 },

  goalPercentage: { fontSize: 20, fontWeight: "800", color: C.primary },

  goalDaysLeft: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
    marginTop: 2,
  },

  goalDividerLine: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginTop: 4,
  },

  progressBarContainer: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 12,
  },

  progressBar: { height: "100%", borderRadius: 4 },

  goalStatsRow: { marginTop: 12, flexDirection: "row", gap: 12 },

  goalStat: { flex: 1, minWidth: 0, alignItems: "center" },

  goalStatLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
    textAlign: "center",
  },

  goalStatValue: { fontSize: 11, fontWeight: "700", color: "#fff" },

  controls: { paddingHorizontal: 16, marginTop: 8 },

  controlsTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  },

  viewModeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },

  viewModeBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
  },

  viewModeBtnActive: { backgroundColor: C.primary, borderColor: C.primary },

  viewModeBtnText: { fontSize: 12, fontWeight: "600", color: C.text3 },

  viewModeBtnTextActive: { color: "#fff" },

  dateFilterRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginHorizontal: 16,
    overflow: "hidden",
  },

  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },

  txRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },

  txIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  txMid: { flex: 1, minWidth: 0 },

  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },

  txMeta: { fontSize: 11, color: C.text3 },

  txAmount: { fontSize: 14, fontWeight: "700" },

  remainingLabel: { fontSize: 10, color: C.text3, marginTop: 2 },

  rowApproveBtn: {
    backgroundColor: C.greenBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rowApproveText: { fontSize: 10, color: C.success, fontWeight: "600" },

  rowRejectBtn: {
    backgroundColor: C.redBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rowRejectText: { fontSize: 10, color: C.error, fontWeight: "600" },

  rowEditBtn: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rowEditText: { fontSize: 10, color: C.text2, fontWeight: "600" },

  table: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },

  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12 },

  tableRowBordered: { borderBottomWidth: 1, borderBottomColor: C.border },

  tableHeadRow: {
    backgroundColor: C.elevated,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  tableCell: { fontSize: 12, color: C.text2, paddingHorizontal: 6 },

  tableCellPaid: { width: 130, textAlign: "right", fontWeight: "700", color: C.accent },

  tableCellAmount: { width: 120, textAlign: "right", fontWeight: "700", color: C.accent },

  tableApproveText: { fontSize: 11, color: C.success, fontWeight: "600" },

  tableEditText: { fontSize: 11, color: C.text2, fontWeight: "600" },

  tableHeadCell: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 6,
  },

  txIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  empty: { alignItems: "center", paddingVertical: 48 },

  emptyIcon: { fontSize: 36, marginBottom: 10 },

  emptyText: { fontSize: 14, color: C.text3 },

  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 16,
  },

  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
  },

  pageBtnDisabled: { opacity: 0.4 },

  pageBtnText: { fontSize: 13, fontWeight: "600", color: C.text },

  pageInfo: { fontSize: 12, color: C.text3 },

  lateFeeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#fee2e2",
  },

  lateFeeMemberName: { fontSize: 13, fontWeight: "600", color: C.text },

  lateFeeDetail: { fontSize: 11, color: C.text3, marginTop: 2 },

  lateFeeApplyBtn: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 10,
  },

  lateFeeApplyBtnText: { fontSize: 12, fontWeight: "700", color: "#b91c1c" },

  lateFeeAmountWrap: { alignItems: "flex-end", marginLeft: 10 },

  lateFeeAmount: { fontSize: 13, fontWeight: "800", color: "#b91c1c", marginBottom: 5 },
});