// app/(tabs)/contributions.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  TextInput,
} from "react-native";

import { useRouter } from "expo-router";

import {
  useStore,
  useGroupContributions,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMember,
  useIsGroupView,
  useCurrentMemberPermissions,
  useActiveGroup,
  useGroupWallet,
} from "../../stores/useStore";

import {
  SearchBar,
  Badge,
  Empty,
  BottomModal,
  useToast,
  Toast,
  DatePicker,
  TabRow,
  Input,
} from "../../components/ui";

import { Colors, C, T, S, R, fmtCurrency, fmtDate } from "../../utils/theme";

import { exportXlsx, importXlsx, exportPdf } from "../../utils/export";
import { findOverdueContributions } from "../../utils/lateFees";
import { getCurrentGoalPeriod } from "../../lib/firestore/contributionGoals";

import type {
  Contribution,
  ContributionGoalPeriod,
  LateFeeExemption,
  Member,
} from "../../types";

import { KpiCard } from "../../components/ui/KpiCard";
import {
  canApproveContributions as canApproveContributionsPerm,
  canManageWallet,
  canViewAllContributions,
} from "@/lib/auth/permissions";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PAGE_SIZE = 20;

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

const STATUS_TABS = ["All", "Approved", "Pending", "Late Fee"] as const;

// Matches EDIT_ROLES in edit-contribution.tsx — kept in sync manually
// since that file is a separate route/bundle.
const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

type SortKey = "date_desc" | "date_asc" | "month" | "year";

const SORT_COMPARATORS: Record<
  SortKey,
  (a: Contribution, b: Contribution) => number
> = {
  date_asc: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  date_desc: (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  month: (a, b) => {
    const idx = (d: Contribution) => {
      const date = new Date(d.date);
      return date.getFullYear() * 12 + date.getMonth();
    };
    return idx(b) - idx(a);
  },
  year: (a, b) => new Date(b.date).getFullYear() - new Date(a.date).getFullYear(),
};

// -----------------------------------------------------------------------------
// Small shared pieces
// -----------------------------------------------------------------------------

const Divider = () => <View style={st.divider} />;

const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

const wideCardStyle = (isWide: boolean) =>
  isWide
    ? { maxWidth: 900, alignSelf: "center" as const, width: "100%" as const }
    : null;

// -----------------------------------------------------------------------------
// Main screen
// -----------------------------------------------------------------------------

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
  } = useStore();

  const allContributions = useGroupContributions();
  const allMembers = useGroupMembers();
  const group = useActiveGroup();
  const allWallet = useGroupWallet();

  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isGroupView = useIsGroupView();
  const permissions = useCurrentMemberPermissions();

  const { show, visible, msg, type } = useToast();

  const isAdmin = role === "admin";

  // Permission gates — routed through the shared helpers in
  // lib/auth/permissions.ts so client checks stay aligned with what
  // firestore.rules actually authorizes.
  const canApprove =
    canApproveContributionsPerm(role, permissions) || role === "loan_officer";

  const canManageFees =
    canManageWallet(role, permissions) || role === "loan_officer";

  const canSeeAllContribs = canViewAllContributions(role, permissions);

  const canAdd = permissions.addContribution || isAdmin;
  const canExport = permissions.downloadReports || isAdmin;
  const canEditContribution = EDIT_ROLES.includes(role);

  const getMemberName = (id: string) =>
    allMembers.find((m) => m.id === id)?.fullName ?? "Unknown";

  const handleEditPress = (id: string) => {
    router.push(`/modals/edit-contribution?id=${id}`);
  };

  // ---------------------------------------------------------------------------
  // Scope contributions — group view or personal view.
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
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [page, setPage] = useState(1);

  const [applyingFeeId, setApplyingFeeId] = useState<string | null>(null);
  const [goalPeriod, setGoalPeriod] = useState<ContributionGoalPeriod | null>(
    null
  );

  const [dateRangeStart, setDateRangeStart] = useState("");
  const [dateRangeEnd, setDateRangeEnd] = useState("");

  const [viewMode, setViewMode] = useState<"list" | "monthly">("list");
  const [importing, setImporting] = useState(false);

  // Late-fee waiver modal state
  const [waiverTarget, setWaiverTarget] = useState<any | null>(null);
  const [waiverSaving, setWaiverSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Late fees
  // ---------------------------------------------------------------------------

  const overdueContributions = useMemo(() => {
    if (!group) return [];
    return findOverdueContributions(group, allMembers, allContributions, allWallet);
  }, [group, allMembers, allContributions, allWallet]);

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

    const collectionRate =
      totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

    const totalLateFeesRemaining = visibleLateFees.reduce(
      (sum, item) => sum + (item.feeAmount || 0),
      0
    );

    return {
      totalExpected,
      totalCollected,
      collectionRate,
      totalLateFeesRemaining,
    };
  }, [
    group,
    allMembers,
    allContributions,
    visibleLateFees,
    goalPeriod,
    isGroupView,
    currentMember?.id,
  ]);

  const memberGoalRows = useMemo(() => {
    if (!goalPeriod || !allMembers || !allContributions) return [];

    const periodStart = new Date(goalPeriod.periodStart);
    const periodEnd = new Date(goalPeriod.periodEnd);
    const target = goalPeriod.targetAmount;

    const scopedMembers = isGroupView
      ? allMembers.filter((m) => m.status === "active")
      : allMembers.filter(
          (m) => m.status === "active" && m.id === currentMember?.id
        );

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

  const goalProgress = useMemo(() => {
    if (!goalPeriod) return null;

    const now = new Date();
    const periodStart = new Date(goalPeriod.periodStart);
    const periodEnd = new Date(goalPeriod.periodEnd);
    const target = goalPeriod.targetAmount;

    const isApprovedInPeriod = (c: Contribution) => {
      const cDate = new Date(c.date);
      return (
        cDate >= periodStart && cDate <= periodEnd && c.status === "approved"
      );
    };

    const totalContributed = allContributions
      .filter(
        (c) =>
          isApprovedInPeriod(c) &&
          (isGroupView || c.memberId === currentMember?.id)
      )
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const groupTotalContributed = allContributions
      .filter(isApprovedInPeriod)
      .reduce((sum, c) => sum + (c.amount || 0), 0);

    const activeMemberCount = allMembers.filter(
      (m) => m.status === "active"
    ).length;
    const groupTarget = target * activeMemberCount;

    const percentage =
      target > 0 ? Math.round((totalContributed / target) * 100) : 0;
    const groupPercentage =
      groupTarget > 0
        ? Math.round((groupTotalContributed / groupTarget) * 100)
        : 0;

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
  }, [
    goalPeriod,
    allContributions,
    allMembers,
    isGroupView,
    currentMember?.id,
  ]);

  // ---------------------------------------------------------------------------
  // Apply / clear late fee
  // ---------------------------------------------------------------------------

  const handleApplyContributionFee = async (
    item: any,
    customAmount?: number
  ) => {
    setApplyingFeeId(item.feeTxId);

    try {
      await applyContributionLateFee(item, customAmount);
      const appliedAmount =
        customAmount != null && customAmount > 0
          ? customAmount
          : item.feeAmount;
      show(
        `Late fee of ${fmtCurrency(appliedAmount)} applied to ${item.memberName}`
      );
      recalcTotals();
    } catch (e: any) {
      show(e?.message || "Failed to apply late fee", "error");
    } finally {
      setApplyingFeeId(null);
    }
  };

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

  // ── Late-fee waiver ──────────────────────────────────────────────
  //
  // Called from the "Waive" link on each late-fee card. Opens a modal
  // that records a per-member exemption covering the fee's period, with
  // an optional scope widening to loans too, and — for fees that have
  // already been applied to the ledger — marks that specific fee paid.

  const openWaiverModal = (feeItem: any) => {
    setWaiverTarget(feeItem);
  };

  const closeWaiverModal = () => {
    setWaiverTarget(null);
  };

  const handleConfirmWaiver = async (
    scope: "contribution" | "loan" | "both",
    periodStart: string,
    periodEnd: string,
    reason: string
  ) => {
    if (!waiverTarget) return;

    setWaiverSaving(true);
    try {
      await useStore.getState().addLateFeeExemption(
        waiverTarget.memberId,
        { scope, periodStart, periodEnd, reason: reason || undefined },
        // Only pass the fee tx id when the fee is already on the ledger.
        // Accrued-but-not-yet-applied fees have no wallet tx to clear.
        waiverTarget.applied ? waiverTarget.feeTxId : undefined
      );

      show("Late fee waiver saved");
      recalcTotals();
      closeWaiverModal();
    } catch (e: any) {
      show(e?.message || "Failed to save waiver", "error");
    } finally {
      setWaiverSaving(false);
    }
  };

  const handleRemoveExemption = async (exemptionId: string) => {
    if (!waiverTarget) return;

    try {
      await useStore
        .getState()
        .removeLateFeeExemption(waiverTarget.memberId, exemptionId);
      show("Waiver removed");
      recalcTotals();
    } catch (e: any) {
      show(e?.message || "Failed to remove waiver", "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Filter + sort + pagination
  // ---------------------------------------------------------------------------

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
  }, [
    contributions,
    statusFilter,
    typeFilter,
    search,
    sort,
    allMembers,
    dateRangeStart,
    dateRangeEnd,
  ]);

  const totalPages = useMemo(
    () => Math.ceil(filtered.length / PAGE_SIZE),
    [filtered]
  );

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const handleTabChange = (t: string) => {
    setStatusFilter(t === "Late Fee" ? "late_fee" : t.toLowerCase());
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleSort = (v: SortKey) => {
    setSort(v);
    setPage(1);
  };

  const handleApprove = async (id: string) => {
    try {
      await approveContribution(id);
      show("Contribution approved");
    } catch (e: any) {
      show(e.message || "Failed to approve", "error");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectContribution(id, "Rejected by admin/officer");
      show("Contribution rejected");
    } catch (e: any) {
      show(e.message || "Failed to reject", "error");
    }
  };

  const handleExport = async () => {
    const headers = [
      "Date",
      "Member",
      "Type",
      "Amount",
      "Status",
      "Description",
    ];

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
        ? `Contributions_Report_${dateRangeStart || "start"}_to_${
            dateRangeEnd || "end"
          }`
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
      const count = result?.count ?? 0;
      const skipped = result?.skipped ?? 0;
      const firstError =
        Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors[0]
          : null;

      if (count === 0) {
        show(
          firstError
            ? `Nothing imported — ${firstError}`
            : "Nothing imported — check the file format",
          "error"
        );
      } else if (skipped > 0) {
        show(
          `Imported ${count} contribution${count !== 1 ? "s" : ""}, ${skipped} skipped`
        );
      } else {
        show(`Imported ${count} contribution${count !== 1 ? "s" : ""}`);
      }

      recalcTotals();
    } catch (e: any) {
      if (e?.message !== "Cancelled") {
        show(e?.message || "Failed to import file", "error");
      }
    } finally {
      setImporting(false);
    }
  };

  const handleAddPress = () => {
    router.push("/modals/add-contribution");
  };

  const cardWide = wideCardStyle(isWide);
  const activeTab =
    statusFilter === "all"
      ? "All"
      : statusFilter === "late_fee"
      ? "Late Fee"
      : statusFilter;

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
        contentContainerStyle={[
          { paddingBottom: 100 },
          isWide && { paddingHorizontal: 24 },
        ]}
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
              label={isGroupView ? "Total Expected" : "My Target"}
              value={
                collectionStats
                  ? fmtCurrency(collectionStats.totalExpected)
                  : "—"
              }
              icon="📋"
              subtext={
                isGroupView
                  ? "Goal target × active members"
                  : "Your goal for this period"
              }
              accentColor={C.accent}
              onPress={() => {}}
            />

            <KpiCard
              label={isGroupView ? "Total Collected" : "My Contributions"}
              value={
                collectionStats
                  ? fmtCurrency(collectionStats.totalCollected)
                  : "—"
              }
              icon="💰"
              subtext={
                isGroupView
                  ? "Group collections"
                  : "Your approved contributions"
              }
              accentColor={C.success}
              onPress={() => setStatusFilter("approved")}
            />

            <KpiCard
              label={isGroupView ? "Collection Rate" : "My Progress"}
              value={
                collectionStats
                  ? `${collectionStats.collectionRate.toFixed(1)}%`
                  : "—"
              }
              icon="📊"
              subtext={
                isGroupView ? "Collection efficiency" : "Toward your goal"
              }
              accentColor={C.primary}
              onPress={() => {}}
            />

            <KpiCard
              label={isGroupView ? "Late Fees Due" : "My Late Fees"}
              value={
                collectionStats
                  ? fmtCurrency(collectionStats.totalLateFeesRemaining)
                  : "—"
              }
              icon="⚠️"
              subtext={
                isGroupView ? "Unpaid group late fees" : "Fees you owe"
              }
              accentColor={C.gold}
              onPress={() => setStatusFilter("late_fee")}
            />
          </View>
        </View>

        <View style={[st.controls, cardWide]}>
          <View style={st.controlsTop}>
            <View style={{ flex: 2 }}>
              <SearchBar
                value={search}
                onChange={handleSearch}
                placeholder="Search contributions…"
              />
            </View>
          </View>

          {isGroupView && (
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
          )}

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
            <TabRow
              tabs={[...STATUS_TABS]}
              active={activeTab}
              onChange={handleTabChange}
            />
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
              onWaive={openWaiverModal}
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
              onApprove={handleApprove}
              onReject={handleReject}
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
                    onEdit={() => handleEditPress(c.id)}
                  />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          {viewMode !== "monthly" && statusFilter !== "late_fee" && (
            <Pagination
              page={page}
              totalPages={totalPages}
              setPage={setPage}
              filtered={filtered}
            />
          )}
        </View>
      </ScrollView>

      <LateFeeWaiverModal
        visible={!!waiverTarget}
        onClose={closeWaiverModal}
        target={waiverTarget}
        member={
          waiverTarget
            ? allMembers.find((m) => m.id === waiverTarget.memberId) ?? null
            : null
        }
        group={group}
        saving={waiverSaving}
        onConfirm={handleConfirmWaiver}
        onRemoveExemption={handleRemoveExemption}
      />

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
        <Text style={st.pageSummaryLabel}>
          {isGroupView ? "Group" : "Personal"}
        </Text>
        <Text style={st.pageSummaryTitle}>
          {isLateFeeView ? "Late Fees Record" : "History"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {canExport && (
          <TouchableOpacity
            style={st.iconBtn}
            onPress={onExport}
            activeOpacity={0.8}
          >
            <Text style={st.iconBtnText}>Export</Text>
          </TouchableOpacity>
        )}

        {isGroupView && (
          <TouchableOpacity
            style={st.iconBtn}
            onPress={onImport}
            activeOpacity={0.8}
            disabled={importing}
          >
            <Text style={st.iconBtnText}>
              {importing ? "Importing…" : "Import"}
            </Text>
          </TouchableOpacity>
        )}

        {isGroupView && canAdd && (
          <TouchableOpacity
            style={st.primaryBtn}
            onPress={onAdd}
            activeOpacity={0.8}
          >
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
      <Text
        style={[st.viewModeBtnText, active && st.viewModeBtnTextActive]}
      >
        {label}
      </Text>
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
// Goal card
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
    <View
      style={[
        st.goalCard,
        wideCardStyle(isWide) && {
          ...wideCardStyle(isWide),
          marginHorizontal: 0,
        },
      ]}
    >
      <View style={st.cardAccentDot} />

      <View style={st.goalHeaderRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.goalLabel} numberOfLines={1}>
            {goalProgress.isCompleted
              ? "✓ MY GOAL ACHIEVED"
              : "MY CONTRIBUTION GOAL"}
          </Text>

          <Text
            style={st.goalAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            <Text style={st.balanceCurrency}>{currency} </Text>
            {amountText(goalProgress.totalContributed)}
          </Text>
        </View>

        <View style={st.goalHeaderRight}>
          <Text
            style={[
              st.goalPercentage,
              goalProgress.isCompleted && { color: Colors.green },
            ]}
            numberOfLines={1}
          >
            {goalProgress.percentage}%
          </Text>
          <Text style={st.goalDaysLeft} numberOfLines={1}>
            {goalProgress.daysLeft > 0
              ? `${goalProgress.daysLeft}d left`
              : "Period ended"}
          </Text>
        </View>
      </View>

      <ProgressBar
        percentage={goalProgress.percentage}
        color={
          goalProgress.isCompleted ? Colors.green : Colors.primary
        }
      />

      {isGroupView && (
        <>
          <View style={st.goalDividerLine} />

          <View
            style={[
              st.goalHeaderRow,
              { marginTop: 12, marginBottom: 0 },
            ]}
          >
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
                  goalProgress.groupPercentage >= 100 && {
                    color: Colors.green,
                  },
                ]}
                numberOfLines={1}
              >
                {goalProgress.groupPercentage}%
              </Text>
            </View>
          </View>

          <ProgressBar
            percentage={goalProgress.groupPercentage}
            color={
              goalProgress.groupPercentage >= 100
                ? Colors.green
                : Colors.accent
            }
          />
        </>
      )}

      <View style={st.goalStatsRow}>
        <GoalStat
          label="Target"
          value={fmtCurrency(
            isGroupView ? goalProgress.groupTarget : goalProgress.target
          )}
        />
        <GoalStat
          label="Remaining"
          value={fmtCurrency(goalProgress.remaining)}
          dimWhenComplete={goalProgress.isCompleted}
        />
        <GoalStat
          label="Min Contribution"
          value={fmtCurrency(minimumContribution)}
        />
      </View>
    </View>
  );
}

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

function ProgressBar({
  percentage,
  color,
}: {
  percentage: number;
  color: string;
}) {
  return (
    <View style={st.progressBarContainer}>
      <View
        style={[
          st.progressBar,
          {
            width: `${Math.min(100, percentage)}%`,
            backgroundColor: color,
          },
        ]}
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
        style={[
          st.goalStatValue,
          dimWhenComplete && { color: Colors.bgWhite },
        ]}
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
// Goal progress (per member)
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
    return (
      <EmptyState
        icon="🎯"
        text="No contribution goal is set up for this group"
      />
    );
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
                  {row.lateFees > 0
                    ? ` · ${fmtCurrency(row.lateFees)} late fees`
                    : ""}
                </Text>
              </View>

              <View
                style={{
                  alignItems: "flex-end",
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                <Text
                  style={[
                    st.txAmount,
                    {
                      color: row.isCompleted ? C.success : C.accent,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {row.isCompleted
                    ? "Done"
                    : fmtCurrency(row.remaining)}
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
        <Text
          style={[
            st.tableHeadCell,
            { width: 130, textAlign: "right" },
          ]}
        >
          PAID
        </Text>
        <Text
          style={[
            st.tableHeadCell,
            { width: 130, textAlign: "right" },
          ]}
        >
          REMAINING
        </Text>
        <Text
          style={[
            st.tableHeadCell,
            { width: 90, textAlign: "right" },
          ]}
        >
          PROGRESS
        </Text>
        <Text
          style={[
            st.tableHeadCell,
            { width: 110, textAlign: "right" },
          ]}
        >
          LATE FEES
        </Text>
        <Text
          style={[
            st.tableHeadCell,
            { width: 90, textAlign: "center" },
          ]}
        >
          STATUS
        </Text>
      </View>

      {rows.map((row) => (
        <View key={row.memberId} style={[st.tableRow, st.tableRowBordered]}>
          <Text
            style={[st.tableCell, { flex: 2 }]}
            numberOfLines={1}
          >
            {row.memberName}
          </Text>

          <Text style={[st.tableCell, st.tableCellPaid]}>
            {fmtCurrency(row.paid)}
          </Text>

          <Text
            style={[
              st.tableCell,
              { width: 130, textAlign: "right" },
            ]}
          >
            {row.isCompleted ? "—" : fmtCurrency(row.remaining)}
          </Text>

          <Text
            style={[
              st.tableCell,
              {
                width: 90,
                textAlign: "right",
                fontWeight: "600",
              },
            ]}
          >
            {row.percentage}%
          </Text>

          <Text
            style={[
              st.tableCell,
              {
                width: 110,
                textAlign: "right",
                color: row.lateFees > 0 ? C.gold : C.text3,
              },
            ]}
          >
            {row.lateFees > 0 ? fmtCurrency(row.lateFees) : "—"}
          </Text>

          <View style={{ width: 90, alignItems: "center" }}>
            <Badge
              label={row.isCompleted ? "Done" : "In progress"}
              color={row.isCompleted ? "green" : "gold"}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Late fee list
//
// Applied fees swap the action row for a single "Clear Fee" button plus
// a "Waive Period" link. Accrued fees get an optional custom-amount
// input, a primary "Apply {full amount}" button, and a "Waive period
// instead" link. Tapping "Custom amount" expands an input below and
// changes the primary action to apply the custom value instead.
// -----------------------------------------------------------------------------

function LateFeeList({
  items,
  isGroupView,
  group,
  canManageFees,
  applyingFeeId,
  onApply,
  onClear,
  onWaive,
}: {
  items: any[];
  isGroupView: boolean;
  group: any;
  canManageFees: boolean;
  applyingFeeId: string | null;
  onApply: (item: any, customAmount?: number) => void;
  onClear: (item: any) => void;
  onWaive: (item: any) => void;
}) {
  const [customAmounts, setCustomAmounts] = useState<
    Record<string, string>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState icon="✓" text="No late fees owed" />;
  }

  const totalOwed = items.reduce(
    (sum, item) => sum + (item.feeAmount || 0),
    0
  );
  const appliedCount = items.filter((i) => i.applied).length;
  const accruedCount = items.length - appliedCount;

  return (
    <View style={st.feeList}>
      <View style={st.feeSummary}>
        <View style={st.feeSummaryIcon}>
          <Text style={{ fontSize: 22 }}>⚠️</Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.feeSummaryLabel}>Total Owed</Text>
          <Text
            style={st.feeSummaryValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {fmtCurrency(totalOwed)}
          </Text>
        </View>

        <View style={st.feeSummaryCount}>
          <Text style={st.feeSummaryCountNumber}>{items.length}</Text>
          <Text style={st.feeSummaryCountLabel}>
            fee{items.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      {(appliedCount > 0 || accruedCount > 0) && (
        <View style={st.feeStatusRow}>
          {appliedCount > 0 && (
            <View style={st.feeStatusChipWrap}>
              <View
                style={[
                  st.feeStatusChipDot,
                  { backgroundColor: C.info },
                ]}
              />
              <Text style={st.feeStatusChipText}>
                {appliedCount} recorded
              </Text>
            </View>
          )}
          {accruedCount > 0 && (
            <View style={st.feeStatusChipWrap}>
              <View
                style={[
                  st.feeStatusChipDot,
                  { backgroundColor: C.gold },
                ]}
              />
              <Text style={st.feeStatusChipText}>
                {accruedCount} accruing
              </Text>
            </View>
          )}
        </View>
      )}

      {items.map((item) => {
        const isSaving = applyingFeeId === item.feeTxId;
        const customVal = customAmounts[item.feeTxId] ?? "";
        const isExpanded = expandedId === item.feeTxId;

        const statusLabel = item.applied ? "RECORDED" : "ACCRUING";
        const statusColor = item.applied ? C.info : C.gold;
        const statusBg = item.applied ? C.infoBg : C.goldBg;

        const headline = isGroupView
          ? item.memberName
          : item.periodLabel;
        const subline = isGroupView ? item.periodLabel : null;

        const customNum = customVal.trim() ? Number(customVal) : undefined;
        const effectiveAmount =
          customNum != null && Number.isFinite(customNum) && customNum > 0
            ? customNum
            : item.feeAmount;

        return (
          <View key={item.feeTxId} style={st.feeCard}>
            <View style={st.feeCardTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={st.feeCardNameRow}>
                  <Text style={st.feeMember} numberOfLines={1}>
                    {headline}
                  </Text>
                  <View
                    style={[
                      st.feeStatusPill,
                      { backgroundColor: statusBg },
                    ]}
                  >
                    <Text
                      style={[
                        st.feeStatusPillText,
                        { color: statusColor },
                      ]}
                    >
                      {statusLabel}
                    </Text>
                  </View>
                </View>

                {subline && (
                  <Text style={st.feePeriod} numberOfLines={1}>
                    {subline}
                  </Text>
                )}
              </View>

              <Text
                style={st.feeAmount}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {fmtCurrency(item.feeAmount)}
              </Text>
            </View>

            <View style={st.feeDetailStrip}>
              <View style={st.feeDetailCell}>
                <Text style={st.feeDetailCellLabel}>Days late</Text>
                <Text style={st.feeDetailCellValue}>
                  {item.daysLate ?? 0}
                </Text>
              </View>

              <View style={st.feeDetailDivider} />

              <View style={st.feeDetailCell}>
                <Text style={st.feeDetailCellLabel}>Newly owed</Text>
                <Text style={st.feeDetailCellValue}>
                  {item.daysNewlyOwed ?? 0}
                </Text>
              </View>

              <View style={st.feeDetailDivider} />

              <View style={st.feeDetailCell}>
                <Text style={st.feeDetailCellLabel}>Rate</Text>
                <Text style={st.feeDetailCellValue}>
                  {group?.contributionLateFeeRatePct ?? 0}%
                </Text>
              </View>
            </View>

            {canManageFees && (
              <>
                {item.applied ? (
                  <View style={st.feeActionRow}>
                    <TouchableOpacity
                      style={st.feeSecondaryBtn}
                      onPress={() => onWaive(item)}
                      activeOpacity={0.8}
                    >
                      <Text style={st.feeSecondaryBtnText}>
                        Waive Period
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={st.feeClearBtn}
                      onPress={() => onClear(item)}
                      disabled={isSaving}
                      activeOpacity={0.8}
                    >
                      <Text style={st.feeClearBtnText}>
                        {isSaving ? "Clearing…" : "Clear Fee"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={st.feeActionRow}>
                      <TouchableOpacity
                        style={[
                          st.feeSecondaryBtn,
                          isExpanded && st.feeSecondaryBtnActive,
                        ]}
                        onPress={() =>
                          setExpandedId(
                            isExpanded ? null : item.feeTxId
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            st.feeSecondaryBtnText,
                            isExpanded &&
                              st.feeSecondaryBtnTextActive,
                          ]}
                        >
                          {isExpanded ? "Cancel" : "Custom amount"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={st.feePrimaryBtn}
                        onPress={() => onApply(item, customNum)}
                        disabled={isSaving}
                        activeOpacity={0.8}
                      >
                        <Text style={st.feePrimaryBtnText}>
                          {isSaving
                            ? "Applying…"
                            : `Apply ${fmtCurrency(effectiveAmount)}`}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={st.feeWaiveLink}
                      onPress={() => onWaive(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={st.feeWaiveLinkText}>
                        Waive period instead
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                {!item.applied && isExpanded && (
                  <View style={st.feeCustomWrap}>
                    <Text style={st.feeCustomLabel}>
                      Custom amount
                    </Text>
                    <TextInput
                      style={st.feeCustomInput}
                      placeholder={String(item.feeAmount)}
                      placeholderTextColor={C.text3}
                      keyboardType="numeric"
                      value={customVal}
                      onChangeText={(v) =>
                        setCustomAmounts((prev) => ({
                          ...prev,
                          [item.feeTxId]: v,
                        }))
                      }
                    />
                    <Text style={st.feeCustomHint}>
                      Leave blank to apply the full{" "}
                      {fmtCurrency(item.feeAmount)}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Late Fee Waiver Modal
//
// Records a per-member exemption that suppresses late fees for a period.
// Two effects on confirm:
//
//   1. A LateFeeExemption is appended to the member's record.
//      findOverdueContributions / findOverdueInstallments skip any
//      period that falls inside an exemption, so no new fees accrue
//      for that window going forward.
//
//   2. If the fee the admin clicked on is ALREADY on the ledger, that
//      specific fee's wallet tx is marked `feePaid: true` so it stops
//      appearing in the list. Accrued-but-not-yet-applied fees have no
//      wallet tx, so the exemption alone is enough for those.
//
// Existing exemptions for the same member are listed inside the modal
// with a "Revoke" link so the admin can undo a waiver they added
// earlier. Revoking does NOT resurrect cleared fees.
// -----------------------------------------------------------------------------

function LateFeeWaiverModal({
  visible,
  onClose,
  target,
  member,
  group,
  saving,
  onConfirm,
  onRemoveExemption,
}: {
  visible: boolean;
  onClose: () => void;
  target: any;
  member: Member | null;
  group: any;
  saving: boolean;
  onConfirm: (
    scope: "contribution" | "loan" | "both",
    periodStart: string,
    periodEnd: string,
    reason: string
  ) => void;
  onRemoveExemption: (exemptionId: string) => void;
}) {
  const [scope, setScope] = useState<"contribution" | "loan" | "both">(
    "contribution"
  );
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reason, setReason] = useState("");

  // Default the period to the calendar month containing the clicked
  // fee's periodStart.
  React.useEffect(() => {
    if (!visible || !target) return;

    const rawPeriodStart =
      typeof target.periodStart === "string"
        ? target.periodStart.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    setScope("contribution");
    setReason("");

    const start = new Date(rawPeriodStart + "T00:00:00");
    if (!isNaN(start.getTime())) {
      const firstOfMonth = new Date(
        start.getFullYear(),
        start.getMonth(),
        1
      );
      const lastOfMonth = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0
      );
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(d.getDate()).padStart(2, "0")}`;
      setPeriodStart(iso(firstOfMonth));
      setPeriodEnd(iso(lastOfMonth));
    } else {
      setPeriodStart(rawPeriodStart);
      setPeriodEnd(rawPeriodStart);
    }
  }, [visible, target?.feeTxId, target?.periodStart]);

  if (!member) return null;

  const existingExemptions: LateFeeExemption[] =
    (member.lateFeeExemptions ?? []) as LateFeeExemption[];

  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Waive Late Fees"
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={st.waiverIntro}>
          Record a per-member waiver for a period. No late fees of the
          selected scope will accrue for {member.fullName} between the
          dates below — including fees on loan installments that fall
          inside the window if you widen the scope.
        </Text>

        <View style={st.waiverTargetCard}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.waiverTargetLabel}>Member</Text>
            <Text style={st.waiverTargetName} numberOfLines={1}>
              {member.fullName}
            </Text>
            {target?.periodLabel && (
              <Text style={st.waiverTargetSub} numberOfLines={1}>
                Fee period: {target.periodLabel}
              </Text>
            )}
          </View>
        </View>

        <Text style={st.waiverSectionTitle}>Scope</Text>
        <Text style={st.waiverSectionHelp}>
          Pick whether to waive only the fee you clicked, all
          contribution fees, all loan fees, or both. Loans are included
          only when you choose "Loans" or "Both".
        </Text>

        <View style={st.waiverScopeRow}>
          {[
            { label: "This Contribution", value: "contribution" as const },
            { label: "Loans", value: "loan" as const },
            { label: "Both", value: "both" as const },
          ].map((opt) => {
            const active = scope === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  st.waiverScopeBtn,
                  active && st.waiverScopeBtnActive,
                ]}
                onPress={() => setScope(opt.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    st.waiverScopeBtnText,
                    active && st.waiverScopeBtnTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[st.waiverSectionTitle, { marginTop: 20 }]}>
          Period
        </Text>
        <Text style={st.waiverSectionHelp}>
          Defaults to the calendar month of the fee you clicked.
        </Text>

        <DatePicker
          label="From Date"
          value={periodStart}
          onChange={setPeriodStart}
          placeholder="YYYY-MM-DD"
        />
        <DatePicker
          label="To Date"
          value={periodEnd}
          onChange={setPeriodEnd}
          placeholder="YYYY-MM-DD"
        />

        <Text style={[st.waiverSectionTitle, { marginTop: 12 }]}>
          Reason
        </Text>
        <Input
          value={reason}
          onChangeText={setReason}
          placeholder="Optional note (shown on the exemption list)"
          multiline
        />

        {existingExemptions.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={st.waiverSectionTitle}>
              Existing Waivers ({existingExemptions.length})
            </Text>
            <Text style={st.waiverSectionHelp}>
              Revoke a waiver to allow fees to accrue for its period
              again. Fees already cleared when the waiver was created
              are not restored.
            </Text>

            {existingExemptions.map((ex) => (
              <View key={ex.id} style={st.waiverExistingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={st.waiverExistingTitle}
                    numberOfLines={1}
                  >
                    {ex.scope === "both"
                      ? "Contributions + Loans"
                      : ex.scope === "contribution"
                      ? "Contributions"
                      : "Loans"}
                  </Text>
                  <Text
                    style={st.waiverExistingPeriod}
                    numberOfLines={1}
                  >
                    {ex.periodStart} → {ex.periodEnd}
                  </Text>
                  {ex.reason && (
                    <Text
                      style={st.waiverExistingReason}
                      numberOfLines={2}
                    >
                      {ex.reason}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={st.waiverRevokeBtn}
                  onPress={() => onRemoveExemption(ex.id)}
                  activeOpacity={0.8}
                >
                  <Text style={st.waiverRevokeBtnText}>Revoke</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={st.waiverButtonRow}>
          <TouchableOpacity
            style={st.waiverCancelBtn}
            onPress={onClose}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={st.waiverCancelBtnText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              st.waiverSaveBtn,
              saving && { opacity: 0.6 },
            ]}
            onPress={() =>
              onConfirm(scope, periodStart, periodEnd, reason)
            }
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={st.waiverSaveBtnText}>
              {saving ? "Saving…" : "Save Waiver"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </BottomModal>
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
  onApprove,
  onReject,
}: {
  rows: Contribution[];
  isGroupView: boolean;
  canApprove: boolean;
  canEdit: boolean;
  onEdit: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <View style={st.table}>
      <View style={[st.tableRow, st.tableHeadRow]}>
        <View style={{ width: 40 }} />
        <Text style={[st.tableHeadCell, { flex: 2 }]}>DESCRIPTION</Text>
        <Text style={[st.tableHeadCell, { width: 160 }]}>TYPE</Text>
        {isGroupView && (
          <Text style={[st.tableHeadCell, { width: 150 }]}>MEMBER</Text>
        )}
        <Text style={[st.tableHeadCell, { width: 120 }]}>DATE</Text>
        <Text
          style={[
            st.tableHeadCell,
            { width: 120, textAlign: "right" },
          ]}
        >
          AMOUNT
        </Text>
        {canApprove && <View style={{ width: 100 }} />}
        {canEdit && <View style={{ width: 50 }} />}
      </View>

      {rows.map((c) => (
        <TableRow
          key={c.id}
          contribution={c}
          showMember={isGroupView}
          canEdit={canEdit}
          canApprove={canApprove}
          onEdit={() => onEdit(c.id)}
          onApprove={() => onApprove(c.id)}
          onReject={() => onReject(c.id)}
        />
      ))}
    </View>
  );
}

const TableRow = ({
  contribution,
  showMember,
  canEdit,
  canApprove,
  onEdit,
  onApprove,
  onReject,
}: {
  contribution: Contribution;
  showMember: boolean;
  canEdit: boolean;
  canApprove: boolean;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
}) => {
  const allMembers = useGroupMembers();
  const memberName =
    allMembers.find((m) => m.id === contribution.memberId)?.fullName ??
    "Unknown";

  const { icon, bg, color } = statusBadge(contribution.status);
  const showApproveReject =
    canApprove && contribution.status === "pending";

  return (
    <View style={[st.tableRow, st.tableRowBordered]}>
      <View style={[st.tableCell, { width: 40 }]}>
        <View style={[st.txIconSm, { backgroundColor: bg }]}>
          <Text style={{ fontSize: 9, fontWeight: "800", color }}>
            {icon}
          </Text>
        </View>
      </View>

      <Text style={[st.tableCell, { flex: 2 }]} numberOfLines={1}>
        {contribution.description ||
          typeLabel(contribution.contributionType)}
      </Text>

      <Text style={[st.tableCell, { width: 160 }]}>
        {typeLabel(contribution.contributionType)}
      </Text>

      {showMember && (
        <Text style={[st.tableCell, { width: 150 }]}>
          {memberName}
        </Text>
      )}

      <Text style={[st.tableCell, { width: 120 }]}>
        {fmtDate(contribution.date)}
      </Text>

      <Text style={[st.tableCell, st.tableCellAmount]}>
        {fmtCurrency(contribution.amount)}
      </Text>

      {showApproveReject && (
        <View
          style={[
            st.tableCell,
            {
              width: 100,
              alignItems: "center",
              flexDirection: "row",
              gap: 4,
              justifyContent: "center",
            },
          ]}
        >
          <TouchableOpacity
            onPress={onApprove}
            style={st.tableApproveBtn}
          >
            <Text style={st.tableApproveText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onReject}
            style={st.tableRejectBtn}
          >
            <Text style={st.tableRejectText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}

      {canEdit && (
        <View
          style={[st.tableCell, { width: 50, alignItems: "center" }]}
        >
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
  if (status === "approved")
    return { icon: "✓", bg: C.greenBg, color: C.greenText };
  if (status === "pending")
    return { icon: "⏳", bg: C.goldBg, color: C.goldText };
  return { icon: "✗", bg: C.redBg, color: C.redText };
}

function ContributionRow({
  contribution,
  memberName,
  canApprove,
  canEdit,
  onApprove,
  onReject,
  onEdit,
}: {
  contribution: Contribution;
  memberName: string;
  canApprove: boolean;
  canEdit: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const { icon, bg, color } = statusBadge(contribution.status);

  const metaParts = [
    fmtDate(contribution.date),
    memberName || null,
    typeLabel(contribution.contributionType),
  ].filter(Boolean);

  const showApproveReject =
    canApprove && contribution.status === "pending";

  return (
    <View style={st.txRow}>
      <View style={[st.txIcon, { backgroundColor: bg }]}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            color,
            letterSpacing: 0.3,
          }}
        >
          {icon}
        </Text>
      </View>

      <View style={st.txMid}>
        <Text style={st.txDesc} numberOfLines={1}>
          {contribution.description ||
            typeLabel(contribution.contributionType)}
        </Text>
        <Text style={st.txMeta} numberOfLines={1}>
          {metaParts.join(" · ")}
        </Text>
      </View>

      <View
        style={{
          alignItems: "flex-end",
          flexShrink: 0,
          marginLeft: 8,
        }}
      >
        <Text
          style={[st.txAmount, { color: C.accent }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {fmtCurrency(contribution.amount)}
        </Text>

        {(showApproveReject || canEdit) && (
          <View
            style={{ flexDirection: "row", gap: 8, marginTop: 3 }}
          >
            {showApproveReject && (
              <>
                <TouchableOpacity
                  onPress={onApprove}
                  style={st.rowApproveBtn}
                >
                  <Text style={st.rowApproveText}>Approve</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onReject}
                  style={st.rowRejectBtn}
                >
                  <Text style={st.rowRejectText}>Reject</Text>
                </TouchableOpacity>
              </>
            )}

            {canEdit && (
              <TouchableOpacity
                onPress={onEdit}
                style={st.rowEditBtn}
              >
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
        <Text
          style={[st.pageBtnText, isFirst && { color: C.text3 }]}
        >
          ← Prev
        </Text>
      </TouchableOpacity>

      <Text style={st.pageInfo}>
        {rangeStart}–{rangeEnd} of {filtered.length}
      </Text>

      <TouchableOpacity
        style={[st.pageBtn, isLast && st.pageBtnDisabled]}
        onPress={() => !isLast && setPage(page + 1)}
        disabled={isLast}
      >
        <Text style={[st.pageBtnText, isLast && { color: C.text3 }]}>
          Next →
        </Text>
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

  balanceCurrency: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
  },

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

  goalHeaderRight: {
    alignItems: "flex-end",
    flexShrink: 0,
    marginLeft: 8,
  },

  goalLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },

  goalAmount: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1,
    marginTop: 4,
  },

  goalPercentage: {
    fontSize: 20,
    fontWeight: "800",
    color: C.primary,
  },

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

  viewModeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

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

  viewModeBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },

  viewModeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text3,
  },

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

  txRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },

  txIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  txMid: { flex: 1, minWidth: 0 },

  txDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
    marginBottom: 2,
  },

  txMeta: { fontSize: 11, color: C.text3 },

  txAmount: { fontSize: 14, fontWeight: "700" },

  remainingLabel: { fontSize: 10, color: C.text3, marginTop: 2 },

  rowApproveBtn: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rowApproveText: { fontSize: 10, color: C.success, fontWeight: "600" },

  rowRejectBtn: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.error,
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

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },

  tableRowBordered: { borderBottomWidth: 1, borderBottomColor: C.border },

  tableHeadRow: {
    backgroundColor: C.elevated,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  tableCell: { fontSize: 12, color: C.text2, paddingHorizontal: 6 },

  tableCellPaid: {
    width: 130,
    textAlign: "right",
    fontWeight: "700",
    color: C.accent,
  },

  tableCellAmount: {
    width: 120,
    textAlign: "right",
    fontWeight: "700",
    color: C.accent,
  },

  tableApproveBtn: {
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: C.green,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tableApproveText: {
    fontSize: 11,
    color: C.success,
    fontWeight: "600",
  },

  tableRejectBtn: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: C.error,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tableRejectText: { fontSize: 11, color: C.error, fontWeight: "600" },

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

  // Late fee list
  feeList: {
    marginHorizontal: 16,
    gap: 12,
  },

  feeSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 14,
    padding: 16,
  },
  feeSummaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  feeSummaryLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9A3412",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  feeSummaryValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#991B1B",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  feeSummaryCount: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    minWidth: 56,
  },
  feeSummaryCountNumber: {
    fontSize: 18,
    fontWeight: "800",
    color: "#991B1B",
    lineHeight: 22,
  },
  feeSummaryCountLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#9A3412",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  feeStatusRow: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 4,
  },
  feeStatusChipWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  feeStatusChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  feeStatusChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text2,
  },

  feeCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },

  feeCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  feeCardNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  feeMember: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    flexShrink: 1,
  },
  feeStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
  },
  feeStatusPillText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  feePeriod: {
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
  },
  feeAmount: {
    fontSize: 18,
    fontWeight: "800",
    color: "#991B1B",
    flexShrink: 0,
    letterSpacing: -0.3,
  },

  feeDetailStrip: {
    flexDirection: "row",
    backgroundColor: C.elevated,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  feeDetailCell: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  feeDetailDivider: {
    width: 1,
    backgroundColor: C.border,
    marginVertical: 2,
  },
  feeDetailCellLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  feeDetailCellValue: {
    fontSize: 14,
    fontWeight: "800",
    color: C.text,
  },

  feeActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  feeSecondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  feeSecondaryBtnActive: {
    backgroundColor: C.pill,
    borderColor: C.primary,
  },
  feeSecondaryBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
  },
  feeSecondaryBtnTextActive: {
    color: C.primary,
  },
  feePrimaryBtn: {
    flex: 1.4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  feePrimaryBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#fff",
  },

  feeClearBtn: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  feeClearBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },

  feeWaiveLink: {
    alignSelf: "center",
    paddingVertical: 6,
  },
  feeWaiveLinkText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    textDecorationLine: "underline",
  },

  feeCustomWrap: {
    paddingTop: 4,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 6,
  },
  feeCustomLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  feeCustomInput: {
    height: 40,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: C.text,
    fontWeight: "600",
  },
  feeCustomHint: {
    fontSize: 10,
    color: C.text3,
    fontStyle: "italic",
  },

  // Waiver modal
  waiverIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: C.text3,
    marginBottom: 14,
  },
  waiverTargetCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },
  waiverTargetLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  waiverTargetName: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    marginTop: 2,
  },
  waiverTargetSub: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  waiverSectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  waiverSectionHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: C.text3,
    marginBottom: 10,
  },
  waiverScopeRow: {
    flexDirection: "row",
    gap: 8,
  },
  waiverScopeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
  },
  waiverScopeBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  waiverScopeBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
    textAlign: "center",
  },
  waiverScopeBtnTextActive: {
    color: "#fff",
  },
  waiverExistingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  waiverExistingTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  waiverExistingPeriod: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  waiverExistingReason: {
    fontSize: 11,
    color: C.text2,
    marginTop: 2,
    fontStyle: "italic",
  },
  waiverRevokeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  waiverRevokeBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.error,
  },
  waiverButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  waiverCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
  },
  waiverCancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text2,
  },
  waiverSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
  },
  waiverSaveBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },
});
