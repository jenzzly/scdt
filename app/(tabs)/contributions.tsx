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

import {
  Colors,
  C,
  T,
  S,
  R,
  fmtCurrency,
  fmtDate,
} from "../../utils/theme";

import { exportCsv, exportPdf } from "../../utils/export";
import { findOverdueContributions } from "../../utils/lateFees";
import { getCurrentGoalPeriod } from "../../lib/firestore/contributionGoals";

import type {
  Contribution,
  ContributionGoalPeriod,
} from "../../types";

import { KpiCard } from "../../components/ui/KpiCard";

const STATUS_COLOR: Record<
  string,
  "teal" | "gold" | "green" | "red" | "muted"
> = {
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

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { label: "Newest first", value: "date_desc" },
  { label: "Oldest first", value: "date_asc" },
  { label: "Month", value: "month" },
  { label: "Year", value: "year" },
];

const TYPE_OPTIONS = [
  { label: "All types", value: "all" },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({
    label,
    value,
  })),
];

function generateHtmlTable(headers: string[], rows: any[][]) {
  return `
    <table>
      <thead>
        <tr>
          ${headers.map((h) => `<th>${h}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${cell}</td>`)
                .join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

const Divider = () => (
  <View
    style={{
      height: 1,
      backgroundColor: C.border,
      marginHorizontal: 16,
    }}
  />
);

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

  const canManageFees = [
    "admin",
    "accountant",
    "loan_officer",
  ].includes(role);

  // ---------------------------------------------------------------------------
  // Scope contributions to either group view or personal view.
  // ---------------------------------------------------------------------------

  const contributions = useMemo(
    () =>
      isGroupView
        ? allContributions
        : allContributions.filter(
            (c) => c.memberId === currentMember?.id
          ),
    [
      isGroupView,
      allContributions,
      currentMember?.id,
    ]
  );

  // ---------------------------------------------------------------------------
  // Filters / UI state
  // ---------------------------------------------------------------------------

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [selectedContrib, setSelectedContrib] =
    useState<Contribution | null>(null);

  const [approvingId, setApprovingId] =
    useState<string | null>(null);

  const [applyingFeeId, setApplyingFeeId] =
    useState<string | null>(null);

  const [goalPeriod, setGoalPeriod] =
    useState<ContributionGoalPeriod | null>(null);

  const [dateRangeStart, setDateRangeStart] =
    useState("");

  const [dateRangeEnd, setDateRangeEnd] =
    useState("");

  const [viewMode, setViewMode] =
    useState<"list" | "monthly">("list");

  // ---------------------------------------------------------------------------
  // Late fees
  //
  // IMPORTANT:
  // allWallet MUST be a dependency because applying/clearing a fee changes
  // wallet state and therefore changes the late-fee lifecycle.
  // ---------------------------------------------------------------------------

  const overdueContributions = useMemo(() => {
    if (!group) return [];

    return findOverdueContributions(
      group,
      allMembers,
      allContributions,
      allWallet
    );
  }, [
    group,
    allMembers,
    allContributions,
    allWallet,
  ]);

  // ---------------------------------------------------------------------------
  // Visible late fees
  //
  // A late-fee chunk is identified by:
  //
  //     item.feeTxId === walletTransaction.id
  //
  // NOT:
  //
  //     item.feeTxId === walletTransaction.sourceId
  //
  // sourceId is the member/contribution source, while feeTxId is the actual
  // wallet transaction ID.
  //
  // State:
  //
  //   no transaction              -> Apply
  //   transaction feePaid=false   -> Clear
  //   transaction feePaid=true    -> hidden
  //
  // Clearing a late-fee transaction does NOT stop future accrual.
  // The underlying contribution must still be unpaid for accrual to continue.
  // ---------------------------------------------------------------------------

  const visibleLateFees = useMemo(() => {
    if (!allWallet) return [];

    const fees = overdueContributions
      .map((item) => {
        const matchingTx = allWallet.find(
          (tx) =>
            tx.id === item.feeTxId &&
            tx.type === "late_fee"
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
      : fees.filter(
          (item) =>
            item.memberId === currentMember?.id
        );
  }, [
    overdueContributions,
    allWallet,
    isGroupView,
    currentMember?.id,
  ]);

  // ---------------------------------------------------------------------------
  // Collection statistics
  // ---------------------------------------------------------------------------

  const collectionStats = useMemo(() => {
    if (
      !group ||
      !allMembers ||
      !allContributions
    ) {
      return null;
    }

    const contributionAmount =
      group.contributionAmount || 0;

    if (contributionAmount <= 0) {
      return null;
    }

    const activeMembers = allMembers.filter(
      (m) => m.status === "active"
    );

    const now = new Date();

    let totalExpected = 0;

    activeMembers.forEach((member) => {
      if (!member.dateJoined) return;

      const joinDate = new Date(
        member.dateJoined
      );

      let periods =
        Math.floor(
          (now.getTime() -
            joinDate.getTime()) /
            (365 * 24 * 60 * 60 * 1000)
        ) + 1;

      periods = Math.max(0, periods);

      totalExpected +=
        contributionAmount * periods;
    });

    const totalCollected = allContributions
      .filter(
        (c) =>
          c.status === "approved" &&
          c.contributionType === "regular"
      )
      .reduce(
        (sum, c) =>
          sum + (c.amount || 0),
        0
      );

    const collectionRate =
      totalExpected > 0
        ? (totalCollected /
            totalExpected) *
          100
        : 0;

    // Only currently visible unpaid chunks count here.
    const totalLateFeesRemaining =
      visibleLateFees.reduce(
        (sum, item) =>
          sum + (item.feeAmount || 0),
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
  ]);

  // ---------------------------------------------------------------------------
  // Per-member goal progress
  // ---------------------------------------------------------------------------

  const memberGoalRows = useMemo(() => {
    if (
      !goalPeriod ||
      !allMembers ||
      !allContributions
    ) {
      return [];
    }

    const periodStart = new Date(
      goalPeriod.periodStart
    );

    const periodEnd = new Date(
      goalPeriod.periodEnd
    );

    const target =
      goalPeriod.targetAmount;

    const scopedMembers = isGroupView
      ? allMembers.filter(
          (m) => m.status === "active"
        )
      : allMembers.filter(
          (m) =>
            m.status === "active" &&
            m.id === currentMember?.id
        );

    return scopedMembers
      .map((member) => {
        const paid = allContributions
          .filter(
            (c) =>
              c.memberId === member.id &&
              c.status === "approved" &&
              c.contributionType ===
                "regular" &&
              new Date(c.date) >=
                periodStart &&
              new Date(c.date) <=
                periodEnd
          )
          .reduce(
            (sum, c) =>
              sum + (c.amount || 0),
            0
          );

        const remaining = Math.max(
          0,
          target - paid
        );

        const percentage =
          target > 0
            ? Math.round(
                (paid / target) * 100
              )
            : 0;

        const lateFees =
          visibleLateFees
            .filter(
              (f) =>
                f.memberId === member.id
            )
            .reduce(
              (sum, f) =>
                sum + (f.feeAmount || 0),
              0
            );

        return {
          memberId: member.id,
          memberName: member.fullName,
          paid,
          remaining,
          percentage,
          lateFees,
          isCompleted:
            paid >= target,
        };
      })
      .sort(
        (a, b) =>
          b.percentage -
          a.percentage
      );
  }, [
    goalPeriod,
    allMembers,
    allContributions,
    isGroupView,
    currentMember?.id,
    visibleLateFees,
  ]);

  // ---------------------------------------------------------------------------
  // Load current goal period
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    if (!activeGroupId) return;

    (async () => {
      try {
        const period =
          await getCurrentGoalPeriod(
            activeGroupId
          );

        setGoalPeriod(period);
      } catch (e) {
        console.error(
          "[Contributions] Failed to load goal period:",
          e
        );
      }
    })();
  }, [activeGroupId]);

  // ---------------------------------------------------------------------------
  // Goal progress
  // ---------------------------------------------------------------------------

  const goalProgress = useMemo(() => {
    if (!goalPeriod) return null;

    const now = new Date();

    const periodStart = new Date(
      goalPeriod.periodStart
    );

    const periodEnd = new Date(
      goalPeriod.periodEnd
    );

    const periodContributions =
      allContributions.filter((c) => {
        const cDate = new Date(c.date);

        if (
          cDate < periodStart ||
          cDate > periodEnd ||
          c.status !== "approved"
        ) {
          return false;
        }

        if (
          !isGroupView &&
          c.memberId !==
            currentMember?.id
        ) {
          return false;
        }

        return true;
      });

    const totalContributed =
      periodContributions.reduce(
        (sum, c) =>
          sum + (c.amount || 0),
        0
      );

    const groupTotalContributed =
      allContributions
        .filter((c) => {
          const cDate = new Date(c.date);

          return (
            cDate >= periodStart &&
            cDate <= periodEnd &&
            c.status === "approved"
          );
        })
        .reduce(
          (sum, c) =>
            sum + (c.amount || 0),
          0
        );

    const target =
      goalPeriod.targetAmount;

    const percentage =
      target > 0
        ? Math.round(
            (totalContributed /
              target) *
              100
          )
        : 0;

    const groupPercentage =
      target > 0
        ? Math.round(
            (groupTotalContributed /
              target) *
              100
          )
        : 0;

    const remaining = Math.max(
      0,
      target - totalContributed
    );

    const daysLeft = Math.max(
      0,
      Math.ceil(
        (periodEnd.getTime() -
          now.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    );

    return {
      totalContributed,
      groupTotalContributed,
      target,
      remaining,
      percentage,
      groupPercentage,
      daysLeft,
      isCompleted:
        totalContributed >= target,
      isGroupScoped: isGroupView,
    };
  }, [
    goalPeriod,
    allContributions,
    isGroupView,
    currentMember?.id,
  ]);

  // ---------------------------------------------------------------------------
  // Apply late fee
  // ---------------------------------------------------------------------------

  const handleApplyContributionFee =
    async (item: any) => {
      setApplyingFeeId(
        item.feeTxId
      );

      try {
        await applyContributionLateFee(
          item
        );

        show(
          `Late fee of ${fmtCurrency(
            item.feeAmount
          )} applied to ${
            item.memberName
          }`
        );

        recalcTotals();
      } catch (e: any) {
        show(
          e?.message ||
            "Failed to apply late fee",
          "error"
        );
      } finally {
        setApplyingFeeId(null);
      }
    };

  // ---------------------------------------------------------------------------
  // Clear standalone late fee
  //
  // IMPORTANT:
  // This only marks the individual late-fee transaction as paid.
  // It does NOT mark the underlying contribution as paid.
  // ---------------------------------------------------------------------------

  const handleClearContributionFee =
    async (item: any) => {
      setApplyingFeeId(
        item.feeTxId
      );

      try {
        await useStore
          .getState()
          .clearStandaloneLateFee(
            item.feeTxId
          );

        show(
          `Late fee of ${fmtCurrency(
            item.feeAmount
          )} cleared`
        );

        recalcTotals();
      } catch (e: any) {
        show(
          e?.message ||
            "Failed to clear late fee",
          "error"
        );
      } finally {
        setApplyingFeeId(null);
      }
    };

  const getMemberName = (
    id: string
  ) =>
    allMembers.find(
      (m) => m.id === id
    )?.fullName ?? "Unknown";

  // ---------------------------------------------------------------------------
  // Filter + sort + pagination
  // ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let list = [
      ...contributions,
    ];

    if (statusFilter !== "all") {
      if (
        statusFilter === "approved"
      ) {
        list = list.filter(
          (c) =>
            c.status ===
            "approved"
        );
      } else if (
        statusFilter === "pending"
      ) {
        list = list.filter(
          (c) =>
            c.status ===
            "pending"
        );
      } else if (
        statusFilter === "rejected"
      ) {
        list = list.filter(
          (c) =>
            c.status ===
            "rejected"
        );
      }
    }

    if (
      typeFilter !== "all"
    ) {
      list = list.filter(
        (c) =>
          c.contributionType ===
          typeFilter
      );
    }

    if (dateRangeStart) {
      const startDate =
        new Date(
          dateRangeStart
        );

      list = list.filter(
        (c) =>
          new Date(c.date) >=
          startDate
      );
    }

    if (dateRangeEnd) {
      const endDate =
        new Date(dateRangeEnd);

      endDate.setHours(
        23,
        59,
        59,
        999
      );

      list = list.filter(
        (c) =>
          new Date(c.date) <=
          endDate
      );
    }

    if (search) {
      const term =
        search.toLowerCase();

      list = list.filter(
        (c) =>
          getMemberName(
            c.memberId
          )
            .toLowerCase()
            .includes(term) ||
          c.description
            ?.toLowerCase()
            .includes(term) ||
          c.contributionType
            ?.toLowerCase()
            .includes(term)
      );
    }

    if (
      sort === "date_asc"
    ) {
      list.sort(
        (a, b) =>
          new Date(
            a.date
          ).getTime() -
          new Date(
            b.date
          ).getTime()
      );
    } else if (
      sort === "date_desc"
    ) {
      list.sort(
        (a, b) =>
          new Date(
            b.date
          ).getTime() -
          new Date(
            a.date
          ).getTime()
      );
    } else if (
      sort === "month"
    ) {
      list.sort((a, b) => {
        const da =
          new Date(a.date);

        const db =
          new Date(b.date);

        const ma =
          da.getFullYear() *
            12 +
          da.getMonth();

        const mb =
          db.getFullYear() *
            12 +
          db.getMonth();

        return mb - ma;
      });
    } else if (
      sort === "year"
    ) {
      list.sort(
        (a, b) =>
          new Date(
            b.date
          ).getFullYear() -
          new Date(
            a.date
          ).getFullYear()
      );
    }

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
    () =>
      Math.ceil(
        filtered.length /
          PAGE_SIZE
      ),
    [filtered]
  );

  const paginated = useMemo(
    () =>
      filtered.slice(
        (page - 1) *
          PAGE_SIZE,
        page * PAGE_SIZE
      ),
    [filtered, page]
  );

  const totalAmount = useMemo(
    () =>
      statusFilter ===
      "late_fee"
        ? visibleLateFees.reduce(
            (sum, item) =>
              sum +
              (item.feeAmount ||
                0),
            0
          )
        : filtered.reduce(
            (sum, c) =>
              sum +
              (c.amount || 0),
            0
          ),
    [
      statusFilter,
      visibleLateFees,
      filtered,
    ]
  );

  const pendingCount =
    useMemo(
      () =>
        filtered.filter(
          (c) =>
            c.status ===
            "pending"
        ).length,
      [filtered]
    );

  const approvedCount =
    useMemo(
      () =>
        filtered.filter(
          (c) =>
            c.status ===
            "approved"
        ).length,
      [filtered]
    );

  const handleTabChange = (
    t: string
  ) => {
    setStatusFilter(
      t === "Late Fee"
        ? "late_fee"
        : t.toLowerCase()
    );

    setPage(1);
  };

  const handleSearch = (
    v: string
  ) => {
    setSearch(v);
    setPage(1);
  };

  const handleSort = (
    v: string
  ) => {
    setSort(v);
    setPage(1);
  };

  // ---------------------------------------------------------------------------
  // Approve contribution
  // ---------------------------------------------------------------------------

  const handleApprove =
    async (id: string) => {
      setApprovingId(id);

      try {
        await approveContribution(
          id
        );

        show(
          "Contribution approved"
        );

        setSelectedContrib(
          null
        );
      } catch (e: any) {
        show(
          e.message ||
            "Failed to approve",
          "error"
        );
      } finally {
        setApprovingId(null);
      }
    };

  // ---------------------------------------------------------------------------
  // Reject contribution
  // ---------------------------------------------------------------------------

  const handleReject =
    async (id: string) => {
      setApprovingId(id);

      try {
        await rejectContribution(
          id,
          "Rejected by admin/officer"
        );

        show(
          "Contribution rejected"
        );

        setSelectedContrib(
          null
        );
      } catch (e: any) {
        show(
          e.message ||
            "Failed to reject",
          "error"
        );
      } finally {
        setApprovingId(null);
      }
    };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  const handleExport =
    async (
      format: "csv" | "pdf"
    ) => {
      const headers = [
        "Date",
        "Member",
        "Type",
        "Amount",
        "Status",
        "Description",
      ];

      const rows =
        filtered.map((c) => [
          fmtDate(c.date),
          getMemberName(
            c.memberId
          ),
          TYPE_LABELS[
            c.contributionType
          ] ??
            c.contributionType,
          fmtCurrency(
            c.amount
          ),
          c.status,
          c.description ?? "",
        ]);

      const fileName =
        dateRangeStart ||
        dateRangeEnd
          ? `Contributions_Report_${
              dateRangeStart ||
              "start"
            }_to_${
              dateRangeEnd ||
              "end"
            }`
          : "Contributions_Report";

      if (format === "csv") {
        await exportCsv(
          fileName,
          headers,
          rows
        );
      } else {
        await exportPdf(
          fileName,
          "Contributions Report",
          generateHtmlTable(
            headers,
            rows
          )
        );
      }

      show(
        `Exported as ${format.toUpperCase()}`
      );
    };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
      }}
    >
      {/* Page action bar */}

      <View
        style={[
          st.topBar,
          isWide && {
            maxWidth: 900,
            alignSelf:
              "center" as any,
            width:
              "100%" as any,
          },
        ]}
      >
        <View>
          <Text
            style={
              st.pageSummaryLabel
            }
          >
            {isGroupView
              ? "Group"
              : "Personal"}
          </Text>

          <Text
            style={
              st.pageSummaryTitle
            }
          >
            {statusFilter ===
            "late_fee"
              ? "Late Fees Record"
              : "History"}
          </Text>
        </View>

        <View
          style={{
            flexDirection:
              "row",
            gap: 8,
            alignItems:
              "center",
          }}
        >
          {canExport && (
            <TouchableOpacity
              style={
                st.iconBtn
              }
              onPress={() =>
                handleExport(
                  "csv"
                )
              }
              activeOpacity={0.8}
            >
              <Text
                style={
                  st.iconBtnText
                }
              >
                Export
              </Text>
            </TouchableOpacity>
          )}

          {canAdd && (
            <TouchableOpacity
              style={
                st.primaryBtn
              }
              onPress={() =>
                router.push(
                  "/modals/add-contribution"
                )
              }
              activeOpacity={0.8}
            >
              <Text
                style={
                  st.primaryBtnText
                }
              >
                + Add
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          {
            paddingBottom: 100,
          },
          isWide && {
            paddingHorizontal: 24,
          },
        ]}
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* Contribution Goals Card */}

        {goalProgress && (
          <View
            style={[
              st.goalCard,
              isWide && {
                marginHorizontal: 0,
                maxWidth: 900,
                alignSelf:
                  "center" as any,
                width:
                  "100%" as any,
              },
            ]}
          >
            <View
              style={
                st.cardAccentDot
              }
            />

            <View
              style={{
                flexDirection:
                  "row",
                justifyContent:
                  "space-between",
                alignItems:
                  "flex-start",
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <Text
                  style={
                    st.goalLabel
                  }
                  numberOfLines={
                    1
                  }
                >
                  {goalProgress.isCompleted
                    ? "✓ GOAL ACHIEVED"
                    : isGroupView
                    ? "GROUP CONTRIBUTION GOAL"
                    : "MY CONTRIBUTION GOAL"}
                </Text>

                <Text
                  style={
                    st.goalAmount
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.8
                  }
                >
                  <Text
                    style={
                      st.balanceCurrency
                    }
                  >
                    {group?.currency ??
                      "RWF"}{" "}
                  </Text>

                  {fmtCurrency(
                    goalProgress.totalContributed,
                    group?.currency ??
                      "RWF"
                  ).replace(
                    `${
                      group?.currency ??
                      "RWF"
                    } `,
                    ""
                  )}
                </Text>
              </View>

              <View
                style={{
                  alignItems:
                    "flex-end",
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                <Text
                  style={[
                    st.goalPercentage,
                    goalProgress.isCompleted && {
                      color:
                        Colors.green,
                    },
                  ]}
                  numberOfLines={
                    1
                  }
                >
                  {
                    goalProgress.percentage
                  }
                  %
                </Text>

                <Text
                  style={
                    st.goalDaysLeft
                  }
                  numberOfLines={
                    1
                  }
                >
                  {goalProgress.daysLeft >
                  0
                    ? `${goalProgress.daysLeft}d left`
                    : "Period ended"}
                </Text>
              </View>
            </View>

            {/* Progress bar */}

            <View
              style={
                st.progressBarContainer
              }
            >
              <View
                style={[
                  st.progressBar,
                  {
                    width: `${
                      Math.min(
                        100,
                        goalProgress.percentage
                      )
                    }%`,
                    backgroundColor:
                      goalProgress.isCompleted
                        ? Colors.green
                        : Colors.primary,
                  },
                ]}
              />
            </View>

            {!isGroupView && (
              <View
                style={{
                  flexDirection:
                    "row",
                  alignItems:
                    "center",
                  justifyContent:
                    "space-between",
                  marginTop: 8,
                  gap: 8,
                }}
              >
                <Text
                  style={
                    st.goalDaysLeft
                  }
                  numberOfLines={
                    1
                  }
                >
                  Group total:{" "}
                  {fmtCurrency(
                    goalProgress.groupTotalContributed
                  )}
                </Text>

                <Text
                  style={
                    st.goalDaysLeft
                  }
                  numberOfLines={
                    1
                  }
                >
                  {
                    goalProgress.groupPercentage
                  }
                  % of goal
                </Text>
              </View>
            )}

            <View
              style={{
                marginTop: 12,
                flexDirection:
                  "row",
                gap: 12,
              }}
            >
              <View
                style={
                  st.goalStat
                }
              >
                <Text
                  style={
                    st.goalStatLabel
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.85
                  }
                >
                  Target
                </Text>

                <Text
                  style={
                    st.goalStatValue
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.75
                  }
                >
                  {fmtCurrency(
                    goalProgress.target
                  )}
                </Text>
              </View>

              <View
                style={
                  st.goalStat
                }
              >
                <Text
                  style={
                    st.goalStatLabel
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.85
                  }
                >
                  Remaining
                </Text>

                <Text
                  style={[
                    st.goalStatValue,
                    goalProgress.isCompleted && {
                      color:
                        Colors.bgWhite,
                    },
                  ]}
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.75
                  }
                >
                  {fmtCurrency(
                    goalProgress.remaining
                  )}
                </Text>
              </View>

              <View
                style={
                  st.goalStat
                }
              >
                <Text
                  style={
                    st.goalStatLabel
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.85
                  }
                >
                  Min Contribution
                </Text>

                <Text
                  style={
                    st.goalStatValue
                  }
                  numberOfLines={
                    1
                  }
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.75
                  }
                >
                  {fmtCurrency(
                    goalPeriod?.minimumContribution ??
                      0
                  )}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* KPI Cards */}

        <View
          style={[
            st.block,
            isWide && {
              maxWidth: 900,
              alignSelf:
                "center" as any,
              width:
                "100%" as any,
            },
          ]}
        >
          <View
            style={
              st.kpiGrid
            }
          >
            <KpiCard
              label="Total Expected"
              value={
                collectionStats
                  ? fmtCurrency(
                      collectionStats.totalExpected
                    )
                  : "—"
              }
              icon="📋"
              subtext="Expected contributions"
              accentColor={
                C.accent
              }
              onPress={() => {}}
            />

            <KpiCard
              label="Total Collected"
              value={
                collectionStats
                  ? fmtCurrency(
                      collectionStats.totalCollected
                    )
                  : "—"
              }
              icon="💰"
              subtext="Collected contributions"
              accentColor={
                C.success
              }
              onPress={() =>
                setStatusFilter(
                  "approved"
                )
              }
            />

            <KpiCard
              label="Collection Rate"
              value={
                collectionStats
                  ? `${collectionStats.collectionRate.toFixed(
                      1
                    )}%`
                  : "—"
              }
              icon="📊"
              subtext="Collection efficiency"
              accentColor={
                C.primary
              }
              onPress={() => {}}
            />

            <KpiCard
              label="Late Fees Due"
              value={
                collectionStats
                  ? fmtCurrency(
                      collectionStats.totalLateFeesRemaining
                    )
                  : "—"
              }
              icon="⚠️"
              subtext="Unpaid late fees"
              accentColor={
                C.gold
              }
              onPress={() =>
                setStatusFilter(
                  "late_fee"
                )
              }
            />
          </View>
        </View>

        {/* Controls */}

        <View
          style={[
            st.controls,
            isWide && {
              maxWidth: 900,
              alignSelf:
                "center" as any,
              width:
                "100%" as any,
            },
          ]}
        >
          <View
            style={
              st.controlsTop
            }
          >
            <View
              style={{
                flex: 2,
              }}
            >
              <SearchBar
                value={search}
                onChange={
                  handleSearch
                }
                placeholder="Search contributions…"
              />
            </View>
          </View>

          {/* View mode toggle */}

          <View
            style={
              st.viewModeRow
            }
          >
            <TouchableOpacity
              style={[
                st.viewModeBtn,
                viewMode ===
                  "list" &&
                  st.viewModeBtnActive,
              ]}
              onPress={() =>
                setViewMode(
                  "list"
                )
              }
              activeOpacity={
                0.7
              }
            >
              <Text
                style={[
                  st.viewModeBtnText,
                  viewMode ===
                    "list" &&
                    st.viewModeBtnTextActive,
                ]}
              >
                List View
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                st.viewModeBtn,
                viewMode ===
                  "monthly" &&
                  st.viewModeBtnActive,
              ]}
              onPress={() =>
                setViewMode(
                  "monthly"
                )
              }
              activeOpacity={
                0.7
              }
            >
              <Text
                style={[
                  st.viewModeBtnText,
                  viewMode ===
                    "monthly" &&
                    st.viewModeBtnTextActive,
                ]}
              >
                Goal Progress
              </Text>
            </TouchableOpacity>
          </View>

          {/* Date filters */}

          <View
            style={
              st.dateFilterRow
            }
          >
            <View
              style={{
                flex: 1,
                marginRight: 8,
              }}
            >
              <DatePicker
                label="From Date"
                value={
                  dateRangeStart
                }
                onChange={(
                  value
                ) => {
                  setDateRangeStart(
                    value
                  );
                  setPage(1);
                }}
                placeholder="Start date"
              />
            </View>

            <View
              style={{
                flex: 1,
                marginLeft: 8,
              }}
            >
              <DatePicker
                label="To Date"
                value={
                  dateRangeEnd
                }
                onChange={(
                  value
                ) => {
                  setDateRangeEnd(
                    value
                  );
                  setPage(1);
                }}
                placeholder="End date"
              />
            </View>
          </View>

          {/* Status tabs */}

          <View
            style={
              st.statusRow
            }
          >
            <TabRow
              tabs={[
                "All",
                "Approved",
                "Pending",
                "Late Fee",
              ]}
              active={
                statusFilter ===
                "all"
                  ? "All"
                  : statusFilter ===
                    "late_fee"
                  ? "Late Fee"
                  : statusFilter
              }
              onChange={
                handleTabChange
              }
            />
          </View>
        </View>

        {/* Contribution / late fee list */}

        <View
          style={[
            {
              marginTop: 8,
            },
            isWide && {
              maxWidth: 900,
              alignSelf:
                "center" as any,
              width:
                "100%" as any,
            },
          ]}
        >
          {viewMode ===
          "monthly" ? (
            !goalPeriod ? (
              <View
                style={
                  st.empty
                }
              >
                <Text
                  style={
                    st.emptyIcon
                  }
                >
                  🎯
                </Text>

                <Text
                  style={
                    st.emptyText
                  }
                >
                  No contribution
                  goal is set up
                  for this group
                </Text>
              </View>
            ) : memberGoalRows.length ===
              0 ? (
              <View
                style={
                  st.empty
                }
              >
                <Text
                  style={
                    st.emptyIcon
                  }
                >
                  👥
                </Text>

                <Text
                  style={
                    st.emptyText
                  }
                >
                  No active
                  members to show
                </Text>
              </View>
            ) : isWide ? (
              <View
                style={
                  st.table
                }
              >
                <View
                  style={[
                    st.tableRow,
                    st.tableHeadRow,
                  ]}
                >
                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        flex: 2,
                      },
                    ]}
                  >
                    MEMBER
                  </Text>

                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 130,
                        textAlign:
                          "right",
                      },
                    ]}
                  >
                    PAID
                  </Text>

                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 130,
                        textAlign:
                          "right",
                      },
                    ]}
                  >
                    REMAINING
                  </Text>

                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 90,
                        textAlign:
                          "right",
                      },
                    ]}
                  >
                    PROGRESS
                  </Text>

                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 110,
                        textAlign:
                          "right",
                      },
                    ]}
                  >
                    LATE FEES
                  </Text>

                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 90,
                        textAlign:
                          "center",
                      },
                    ]}
                  >
                    STATUS
                  </Text>
                </View>

                {memberGoalRows.map(
                  (row) => (
                    <View
                      key={
                        row.memberId
                      }
                      style={[
                        st.tableRow,
                        {
                          borderBottomWidth: 1,
                          borderBottomColor:
                            C.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          st.tableCell,
                          {
                            flex: 2,
                          },
                        ]}
                        numberOfLines={
                          1
                        }
                      >
                        {
                          row.memberName
                        }
                      </Text>

                      <Text
                        style={[
                          st.tableCell,
                          {
                            width: 130,
                            textAlign:
                              "right",
                            fontWeight:
                              "700",
                            color:
                              C.accent,
                          },
                        ]}
                      >
                        {fmtCurrency(
                          row.paid
                        )}
                      </Text>

                      <Text
                        style={[
                          st.tableCell,
                          {
                            width: 130,
                            textAlign:
                              "right",
                          },
                        ]}
                      >
                        {row.isCompleted
                          ? "—"
                          : fmtCurrency(
                              row.remaining
                            )}
                      </Text>

                      <Text
                        style={[
                          st.tableCell,
                          {
                            width: 90,
                            textAlign:
                              "right",
                            fontWeight:
                              "600",
                          },
                        ]}
                      >
                        {
                          row.percentage
                        }
                        %
                      </Text>

                      <Text
                        style={[
                          st.tableCell,
                          {
                            width: 110,
                            textAlign:
                              "right",
                            color:
                              row.lateFees >
                              0
                                ? C.gold
                                : C.text3,
                          },
                        ]}
                      >
                        {row.lateFees >
                        0
                          ? fmtCurrency(
                              row.lateFees
                            )
                          : "—"}
                      </Text>

                      <View
                        style={{
                          width: 90,
                          alignItems:
                            "center",
                        }}
                      >
                        <Badge
                          label={
                            row.isCompleted
                              ? "Done"
                              : "In progress"
                          }
                          color={
                            row.isCompleted
                              ? "green"
                              : "gold"
                          }
                        />
                      </View>
                    </View>
                  )
                )}
              </View>
            ) : (
              <View
                style={
                  st.card
                }
              >
                {memberGoalRows.map(
                  (
                    row,
                    i
                  ) => (
                    <React.Fragment
                      key={
                        row.memberId
                      }
                    >
                      <View
                        style={
                          st.txRow
                        }
                      >
                        <View
                          style={{
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Text
                            style={
                              st.txDesc
                            }
                            numberOfLines={
                              1
                            }
                          >
                            {
                              row.memberName
                            }
                          </Text>

                          <Text
                            style={
                              st.txMeta
                            }
                            numberOfLines={
                              1
                            }
                          >
                            {fmtCurrency(
                              row.paid
                            )}{" "}
                            paid ·{" "}
                            {
                              row.percentage
                            }
                            % of goal
                            {row.lateFees >
                            0
                              ? ` · ${fmtCurrency(
                                  row.lateFees
                                )} late fees`
                              : ""}
                          </Text>
                        </View>

                        <View
                          style={{
                            alignItems:
                              "flex-end",
                            flexShrink: 0,
                            marginLeft: 8,
                          }}
                        >
                          <Text
                            style={[
                              st.txAmount,
                              {
                                color:
                                  row.isCompleted
                                    ? C.success
                                    : C.accent,
                              },
                            ]}
                            numberOfLines={
                              1
                            }
                          >
                            {row.isCompleted
                              ? "Done"
                              : fmtCurrency(
                                  row.remaining
                                )}
                          </Text>

                          {!row.isCompleted && (
                            <Text
                              style={{
                                fontSize: 10,
                                color:
                                  C.text3,
                                marginTop: 2,
                              }}
                            >
                              remaining
                            </Text>
                          )}
                        </View>
                      </View>

                      {i <
                        memberGoalRows.length -
                          1 && (
                        <Divider />
                      )}
                    </React.Fragment>
                  )
                )}
              </View>
            )
          ) : statusFilter ===
            "late_fee" ? (
            visibleLateFees.length ===
            0 ? (
              <View
                style={
                  st.empty
                }
              >
                <Text
                  style={
                    st.emptyIcon
                  }
                >
                  ✓
                </Text>

                <Text
                  style={
                    st.emptyText
                  }
                >
                  No late fees owed
                </Text>
              </View>
            ) : (
              <View
                style={
                  st.block
                }
              >
                {visibleLateFees.map(
                  (
                    item,
                    index
                  ) => (
                    <React.Fragment
                      key={
                        item.feeTxId
                      }
                    >
                      <View
                        style={
                          st.lateFeeRow
                        }
                      >
                        <View
                          style={{
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Text
                            style={
                              st.lateFeeMemberName
                            }
                            numberOfLines={
                              1
                            }
                          >
                            {isGroupView
                              ? item.memberName
                              : item.periodLabel}
                          </Text>

                          <Text
                            style={
                              st.lateFeeDetail
                            }
                            numberOfLines={
                              2
                            }
                          >
                            {item.applied
                              ? `${item.periodLabel} · Unpaid late fee`
                              : `${
                                  isGroupView
                                    ? `${item.periodLabel} · `
                                    : ""
                                }${
                                  item.daysNewlyOwed
                                }d @ ${
                                  group?.contributionLateFeeRatePct ??
                                  0
                                }%/day · ${
                                  item.daysLate
                                }d late`}
                          </Text>
                        </View>

                        <View
                          style={
                            st.lateFeeAmountWrap
                          }
                        >
                          <Text
                            style={
                              st.lateFeeAmount
                            }
                          >
                            {fmtCurrency(
                              item.feeAmount
                            )}
                          </Text>

                          {canManageFees && (
                            <TouchableOpacity
                              style={
                                st.lateFeeApplyBtn
                              }
                              onPress={() =>
                                item.applied
                                  ? handleClearContributionFee(
                                      item
                                    )
                                  : handleApplyContributionFee(
                                      item
                                    )
                              }
                              disabled={
                                applyingFeeId ===
                                item.feeTxId
                              }
                              activeOpacity={
                                0.8
                              }
                            >
                              <Text
                                style={
                                  st.lateFeeApplyBtnText
                                }
                              >
                                {applyingFeeId ===
                                item.feeTxId
                                  ? "Saving…"
                                  : item.applied
                                  ? "Clear"
                                  : "Apply"}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {index <
                        visibleLateFees.length -
                          1 && (
                        <Divider />
                      )}
                    </React.Fragment>
                  )
                )}
              </View>
            )
          ) : paginated.length ===
            0 ? (
            <View
              style={
                st.empty
              }
            >
              <Text
                style={
                  st.emptyIcon
                }
              >
                💰
              </Text>

              <Text
                style={
                  st.emptyText
                }
              >
                No contributions found
              </Text>
            </View>
          ) : isWide ? (
            <View
              style={
                st.table
              }
            >
              <View
                style={[
                  st.tableRow,
                  st.tableHeadRow,
                ]}
              >
                <View
                  style={{
                    width: 40,
                  }}
                />

                <Text
                  style={[
                    st.tableHeadCell,
                    {
                      flex: 2,
                    },
                  ]}
                >
                  DESCRIPTION
                </Text>

                <Text
                  style={[
                    st.tableHeadCell,
                    {
                      width: 160,
                    },
                  ]}
                >
                  TYPE
                </Text>

                {isGroupView && (
                  <Text
                    style={[
                      st.tableHeadCell,
                      {
                        width: 150,
                      },
                    ]}
                  >
                    MEMBER
                  </Text>
                )}

                <Text
                  style={[
                    st.tableHeadCell,
                    {
                      width: 120,
                    },
                  ]}
                >
                  DATE
                </Text>

                <Text
                  style={[
                    st.tableHeadCell,
                    {
                      width: 120,
                      textAlign:
                        "right",
                    },
                  ]}
                >
                  AMOUNT
                </Text>

                {canApprove && (
                  <View
                    style={{
                      width: 60,
                    }}
                  />
                )}
              </View>

              {paginated.map(
                (c) => (
                  <React.Fragment
                    key={c.id}
                  >
                    <TableRow
                      contribution={
                        c
                      }
                      showMember={
                        isGroupView
                      }
                    />
                  </React.Fragment>
                )
              )}
            </View>
          ) : (
            <View
              style={
                st.card
              }
            >
              {paginated.map(
                (c, i) => (
                  <React.Fragment
                    key={c.id}
                  >
                    <ContributionRow
                      contribution={
                        c
                      }
                      memberName={
                        isGroupView
                          ? getMemberName(
                              c.memberId
                            )
                          : ""
                      }
                      canApprove={
                        canApprove
                      }
                      onApprove={() =>
                        handleApprove(
                          c.id
                        )
                      }
                      onReject={() =>
                        handleReject(
                          c.id
                        )
                      }
                      onView={() =>
                        setSelectedContrib(
                          c
                        )
                      }
                    />

                    {i <
                      paginated.length -
                        1 && (
                      <Divider />
                    )}
                  </React.Fragment>
                )
              )}
            </View>
          )}

          {viewMode !==
            "monthly" && (
            <Pagination
              page={page}
              totalPages={
                totalPages
              }
              setPage={setPage}
              filtered={
                filtered
              }
            />
          )}
        </View>
      </ScrollView>

      <Toast
        visible={visible}
        msg={msg}
        type={type}
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Desktop table row
// -----------------------------------------------------------------------------

const TableRow = ({
  contribution,
  showMember,
}: {
  contribution: Contribution;
  showMember: boolean;
}) => {
  const role =
    useCurrentUserRole();

  const canApprove = [
    "admin",
    "loan_officer",
    "accountant",
  ].includes(role);

  const allMembers =
    useGroupMembers();

  const getMemberName = (
    id: string
  ) =>
    allMembers.find(
      (m) => m.id === id
    )?.fullName ?? "Unknown";

  const memberName =
    getMemberName(
      contribution.memberId
    );

  return (
    <View
      style={[
        st.tableRow,
        {
          borderBottomWidth: 1,
          borderBottomColor:
            C.border,
        },
      ]}
    >
      <View
        style={[
          st.tableCell,
          {
            width: 40,
          },
        ]}
      >
        <View
          style={[
            st.txIconSm,
            {
              backgroundColor:
                contribution.status ===
                "approved"
                  ? C.greenBg
                  : contribution.status ===
                    "pending"
                  ? C.goldBg
                  : C.redBg,
            },
          ]}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: "800",
              color:
                contribution.status ===
                "approved"
                  ? C.greenText
                  : contribution.status ===
                    "pending"
                  ? C.goldText
                  : C.redText,
            }}
          >
            {contribution.status ===
            "approved"
              ? "✓"
              : contribution.status ===
                "pending"
              ? "⏳"
              : "✗"}
          </Text>
        </View>
      </View>

      <Text
        style={[
          st.tableCell,
          {
            flex: 2,
          },
        ]}
        numberOfLines={
          1
        }
      >
        {contribution.description ||
          TYPE_LABELS[
            contribution
              .contributionType
          ]}
      </Text>

      <Text
        style={[
          st.tableCell,
          {
            width: 160,
          },
        ]}
      >
        {TYPE_LABELS[
          contribution
            .contributionType
        ] ??
          contribution.contributionType}
      </Text>

      {showMember && (
        <Text
          style={[
            st.tableCell,
            {
              width: 150,
            },
          ]}
        >
          {memberName}
        </Text>
      )}

      <Text
        style={[
          st.tableCell,
          {
            width: 120,
          },
        ]}
      >
        {fmtDate(
          contribution.date
        )}
      </Text>

      <Text
        style={[
          st.tableCell,
          {
            width: 120,
            textAlign:
              "right",
            fontWeight: "700",
            color: C.accent,
          },
        ]}
      >
        {fmtCurrency(
          contribution.amount
        )}
      </Text>

      {canApprove &&
        contribution.status ===
          "pending" && (
          <View
            style={[
              st.tableCell,
              {
                width: 60,
                alignItems:
                  "center",
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => {
                // Existing desktop behavior.
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  color:
                    C.success,
                  fontWeight:
                    "600",
                }}
              >
                Approve
              </Text>
            </TouchableOpacity>
          </View>
        )}
    </View>
  );
};

// -----------------------------------------------------------------------------
// Mobile contribution row
// -----------------------------------------------------------------------------

function ContributionRow({
  contribution,
  memberName,
  canApprove,
  onApprove,
  onReject,
  onView,
}: any) {
  const isApproved =
    contribution.status ===
    "approved";

  const abbr =
    isApproved
      ? "✓"
      : contribution.status ===
        "pending"
      ? "⏳"
      : "✗";

  return (
    <View
      style={
        st.txRow
      }
    >
      <View
        style={[
          st.txIcon,
          {
            backgroundColor:
              isApproved
                ? C.greenBg
                : contribution.status ===
                  "pending"
                ? C.goldBg
                : C.redBg,
          },
        ]}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            color:
              isApproved
                ? C.greenText
                : contribution.status ===
                  "pending"
                ? C.goldText
                : C.redText,
            letterSpacing: 0.3,
          }}
        >
          {abbr}
        </Text>
      </View>

      <View
        style={
          st.txMid
        }
      >
        <Text
          style={
            st.txDesc
          }
          numberOfLines={
            1
          }
        >
          {contribution.description ||
            TYPE_LABELS[
              contribution
                .contributionType
            ]}
        </Text>

        <Text
          style={
            st.txMeta
          }
          numberOfLines={
            1
          }
        >
          {fmtDate(
            contribution.date
          )}
          {memberName
            ? ` · ${memberName}`
            : ""}
          {" · "}
          {TYPE_LABELS[
            contribution
              .contributionType
          ] ??
            contribution.contributionType}
        </Text>
      </View>

      <View
        style={{
          alignItems:
            "flex-end",
          flexShrink: 0,
          marginLeft: 8,
        }}
      >
        <Text
          style={[
            st.txAmount,
            {
              color:
                C.accent,
            },
          ]}
          numberOfLines={
            1
          }
          adjustsFontSizeToFit
          minimumFontScale={
            0.8
          }
        >
          {fmtCurrency(
            contribution.amount
          )}
        </Text>

        {canApprove &&
          contribution.status ===
            "pending" && (
            <View
              style={{
                flexDirection:
                  "row",
                gap: 8,
                marginTop: 3,
              }}
            >
              <TouchableOpacity
                onPress={
                  onApprove
                }
                style={{
                  backgroundColor:
                    C.greenBg,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    color:
                      C.success,
                    fontWeight:
                      "600",
                  }}
                >
                  Approve
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={
                  onReject
                }
                style={{
                  backgroundColor:
                    C.redBg,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    color:
                      C.error,
                    fontWeight:
                      "600",
                  }}
                >
                  Reject
                </Text>
              </TouchableOpacity>
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
  if (totalPages <= 1)
    return null;

  return (
    <View
      style={
        st.pagination
      }
    >
      <TouchableOpacity
        style={[
          st.pageBtn,
          page === 1 &&
            st.pageBtnDisabled,
        ]}
        onPress={() =>
          page > 1 &&
          setPage(page - 1)
        }
        disabled={
          page === 1
        }
      >
        <Text
          style={[
            st.pageBtnText,
            page === 1 && {
              color:
                C.text3,
            },
          ]}
        >
          ← Prev
        </Text>
      </TouchableOpacity>

      <Text
        style={
          st.pageInfo
        }
      >
        {(page - 1) *
          PAGE_SIZE +
          1}
        –
        {Math.min(
          page *
            PAGE_SIZE,
          filtered.length
        )}{" "}
        of{" "}
        {filtered.length}
      </Text>

      <TouchableOpacity
        style={[
          st.pageBtn,
          page >=
            totalPages &&
            st.pageBtnDisabled,
        ]}
        onPress={() =>
          page <
            totalPages &&
          setPage(page + 1)
        }
        disabled={
          page >=
          totalPages
        }
      >
        <Text
          style={[
            st.pageBtnText,
            page >=
              totalPages && {
              color:
                C.text3,
            },
          ]}
        >
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
    flexDirection:
      "row",
    alignItems:
      "center",
    justifyContent:
      "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },

  pageSummaryLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.primary,
    textTransform:
      "uppercase",
    letterSpacing: 0.6,
  },

  pageSummaryTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    marginTop: 1,
  },

  primaryBtn: {
    backgroundColor:
      C.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  primaryBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  iconBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      C.border,
    backgroundColor:
      Colors.surface,
  },

  iconBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
  },

  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor:
      C.border,
    backgroundColor:
      Colors.surface,
  },

  toggleBtnActive: {
    backgroundColor:
      C.primary,
    borderColor:
      C.primary,
  },

  toggleBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
  },

  toggleBtnTextActive: {
    color: "#fff",
  },

  block: {
    marginHorizontal: 16,
    marginBottom: 14,
  },

  kpiGrid: {
    flexDirection:
      "row",
    flexWrap:
      "wrap",
    gap: 10,
  },

  balanceCard: {
    margin: 16,
    borderRadius: 20,
    backgroundColor:
      C.card,
    padding: 24,
    overflow:
      "hidden",
  },

  cardAccentDot: {
    position:
      "absolute",
    top: -50,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor:
      "rgba(26,86,219,0.15)",
  },

  balanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    color:
      "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform:
      "uppercase",
  },

  balanceAmount: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1.2,
    marginTop: 6,
  },

  balanceCurrency: {
    fontSize: 14,
    fontWeight: "600",
    color:
      "rgba(255,255,255,0.45)",
  },

  balancePills: {
    flexDirection:
      "row",
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor:
      "rgba(255,255,255,0.1)",
  },

  balancePill: {
    flex: 1,
    alignItems:
      "center",
  },

  balancePillLabel: {
    fontSize: 9,
    fontWeight: "700",
    color:
      "rgba(255,255,255,0.4)",
    letterSpacing: 0.8,
    textTransform:
      "uppercase",
  },

  balancePillValue: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },

  balancePillDivider: {
    width: 1,
    backgroundColor:
      "rgba(255,255,255,0.1)",
  },

  goalCard: {
    margin: 16,
    borderRadius: 20,
    backgroundColor:
      C.card,
    padding: 24,
    overflow:
      "hidden",
    marginTop: 8,
  },

  goalLabel: {
    fontSize: 10,
    fontWeight: "700",
    color:
      "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform:
      "uppercase",
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
    color:
      "rgba(255,255,255,0.5)",
    marginTop: 2,
  },

  progressBarContainer: {
    height: 8,
    backgroundColor:
      "rgba(255,255,255,0.1)",
    borderRadius: 4,
    overflow:
      "hidden",
    marginTop: 12,
  },

  progressBar: {
    height: "100%",
    backgroundColor:
      C.primary,
    borderRadius: 4,
  },

  goalStat: {
    flex: 1,
    minWidth: 0,
    alignItems:
      "center",
  },

  goalStatLabel: {
    fontSize: 9,
    fontWeight: "700",
    color:
      "rgba(255,255,255,0.4)",
    letterSpacing: 0.8,
    textTransform:
      "uppercase",
    marginBottom: 4,
    textAlign:
      "center",
  },

  goalStatValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },

  controls: {
    paddingHorizontal: 16,
    marginTop: 8,
  },

  controlsTop: {
    flexDirection:
      "row",
    alignItems:
      "flex-start",
    gap: 10,
    marginBottom: 8,
    flexWrap:
      "wrap",
  },

  filterSelect: {
    width: 150,
    marginBottom: -16,
  },

  viewModeRow: {
    flexDirection:
      "row",
    alignItems:
      "center",
    gap: 8,
    marginBottom: 8,
  },

  viewModeBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor:
      C.elevated,
    borderWidth: 1,
    borderColor:
      C.border,
    alignItems:
      "center",
  },

  viewModeBtnActive: {
    backgroundColor:
      C.primary,
    borderColor:
      C.primary,
  },

  viewModeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text3,
  },

  viewModeBtnTextActive: {
    color: "#fff",
  },

  dateFilterRow: {
    flexDirection:
      "row",
    alignItems:
      "flex-start",
    gap: 10,
    marginBottom: 8,
    flexWrap:
      "wrap",
  },

  statusRow: {
    flexDirection:
      "row",
    alignItems:
      "center",
    gap: 8,
  },

  addTabBtn: {
    backgroundColor:
      C.primary,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },

  sortRow: {
    flexDirection:
      "row",
    flexWrap:
      "wrap",
    gap: 6,
  },

  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor:
      C.border,
    backgroundColor:
      C.elevated,
  },

  sortChipActive: {
    backgroundColor:
      C.primary,
    borderColor:
      C.primary,
  },

  sortChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text3,
  },

  sortChipTextActive: {
    color: "#fff",
  },

  card: {
    backgroundColor:
      C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      C.border,
    marginHorizontal: 16,
    overflow:
      "hidden",
  },

  txRow: {
    flexDirection:
      "row",
    alignItems:
      "center",
    padding: 14,
    gap: 12,
  },

  txIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems:
      "center",
    justifyContent:
      "center",
    flexShrink: 0,
  },

  txMid: {
    flex: 1,
    minWidth: 0,
  },

  txDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
    marginBottom: 2,
  },

  txMeta: {
    fontSize: 11,
    color: C.text3,
  },

  txAmount: {
    fontSize: 14,
    fontWeight: "700",
  },

  table: {
    backgroundColor:
      C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      C.border,
    overflow:
      "hidden",
  },

  tableRow: {
    flexDirection:
      "row",
    alignItems:
      "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },

  tableHeadRow: {
    backgroundColor:
      C.elevated,
    borderBottomWidth: 1,
    borderBottomColor:
      C.border,
  },

  tableCell: {
    fontSize: 12,
    color: C.text2,
    paddingHorizontal: 6,
  },

  tableHeadCell: {
    fontSize: 10,
    fontWeight: "700",
    color: C.text3,
    textTransform:
      "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: 6,
  },

  txIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems:
      "center",
    justifyContent:
      "center",
  },

  empty: {
    alignItems:
      "center",
    paddingVertical: 48,
  },

  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },

  emptyText: {
    fontSize: 14,
    color: C.text3,
  },

  pagination: {
    flexDirection:
      "row",
    alignItems:
      "center",
    justifyContent:
      "center",
    paddingVertical: 16,
    gap: 16,
  },

  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor:
      C.border,
    backgroundColor:
      C.elevated,
  },

  pageBtnDisabled: {
    opacity: 0.4,
  },

  pageBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
  },

  pageInfo: {
    fontSize: 12,
    color: C.text3,
  },

  lateFeeCard: {
    backgroundColor:
      C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor:
      "#fca5a5",
    padding: 16,
    marginBottom: 16,
  },

  lateFeeTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#b91c1c",
    marginBottom: 2,
  },

  lateFeeSubtitle: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
    marginBottom: 12,
  },

  lateFeeRow: {
    flexDirection:
      "row",
    alignItems:
      "center",
    justifyContent:
      "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor:
      "#fee2e2",
  },

  lateFeeMemberName: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
  },

  lateFeeDetail: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },

  lateFeeApplyBtn: {
    backgroundColor:
      "#fef2f2",
    borderWidth: 1,
    borderColor:
      "#fca5a5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginLeft: 10,
  },

  lateFeeApplyBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#b91c1c",
  },

  lateFeeAmountWrap: {
    alignItems:
      "flex-end",
    marginLeft: 10,
  },

  lateFeeAmount: {
    fontSize: 13,
    fontWeight: "800",
    color: "#b91c1c",
    marginBottom: 5,
  },
});