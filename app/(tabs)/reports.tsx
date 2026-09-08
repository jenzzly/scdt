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
} from "../../utils/lateFees";

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

type ReportScope = "group" | "personal";

type DropdownOption = {
  label: string;
  value: string;
};

type FilterState = {
  search: string;
  fromDate: string;
  toDate: string;
  loanStatus: "all" | "pending" | "active" | "repaid";
  contributionStatus:
    | "all"
    | "approved"
    | "pending"
    | "rejected";
};

// ─────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────

const CATEGORIES: {
  key: Category;
  label: string;
  icon: string;
}[] = [
  {
    key: "contributions",
    label: "Contributions",
    icon: "📈",
  },
  {
    key: "loans",
    label: "Loans",
    icon: "🏦",
  },
  {
    key: "latefees",
    label: "Late Fees",
    icon: "⚠️",
  },
  {
    key: "members",
    label: "Members",
    icon: "👥",
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: "🧾",
  },
  {
    key: "investments",
    label: "Investments",
    icon: "📊",
  },
  {
    key: "earnings",
    label: "Earnings",
    icon: "💰",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────

function monthKey(dateStr?: string) {
  if (!dateStr) return "";

  const d = new Date(dateStr);

  if (isNaN(d.getTime())) return "";

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);

  if (!y || !m) return key;

  return new Date(
    y,
    m - 1,
    1
  ).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
  });
}

function monthBounds(key: string) {
  const [y, m] = key.split("-").map(Number);

  const start = new Date(y, m - 1, 1);

  const end = new Date(
    y,
    m,
    0
  );

  const iso = (d: Date) =>
    d.toISOString().slice(0, 10);

  return {
    from: iso(start),
    to: iso(end),
  };
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

    const v = amountField
      ? Math.abs(item[amountField] || 0)
      : 1;

    byMonth[k] =
      (byMonth[k] || 0) + v;
  });

  const keys = Object.keys(byMonth).sort();

  return {
    labels: keys.map(monthLabel),
    values: keys.map((k) => byMonth[k]),
  };
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
  <View
    style={[
      styles.kpiCard,
      {
        borderTopColor: color,
      },
    ]}
  >
    <Text
      style={styles.kpiLabel}
      numberOfLines={1}
    >
      {label}
    </Text>

    <Text
      style={[
        styles.kpiValue,
        {
          color,
        },
      ]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
    >
      {value}
    </Text>

    {subtext ? (
      <Text
        style={styles.kpiSubtext}
        numberOfLines={1}
      >
        {subtext}
      </Text>
    ) : null}
  </View>
);

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
  const max = Math.max(
    1,
    ...income,
    ...expenses
  );

  return (
    <View style={{ marginTop: 8 }}>
      <View
        style={{
          flexDirection: "row",
          gap: 14,
          marginBottom: 10,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: C.success,
            }}
          />

          <Text
            style={{
              fontSize: 11,
              color: C.text3,
            }}
          >
            Income
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: C.error,
            }}
          />

          <Text
            style={{
              fontSize: 11,
              color: C.text3,
            }}
          >
            Expenses
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            height: 150,
            minWidth:
              months.length > 6
                ? months.length * 72
                : "100%",
          }}
        >
          {months.map((m, i) => {
            const incH = Math.max(
              2,
              (income[i] / max) * 120
            );

            const expH = Math.max(
              2,
              (expenses[i] / max) * 120
            );

            return (
              <View
                key={`${m}_${i}`}
                style={{
                  width: 62,
                  alignItems: "center",
                  justifyContent:
                    "flex-end",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    height: 120,
                  }}
                >
                  <View
                    style={{
                      width: 12,
                      height: incH,
                      borderRadius: 3,
                      backgroundColor:
                        C.success,
                    }}
                  />

                  <View
                    style={{
                      width: 12,
                      height: expH,
                      borderRadius: 3,
                      backgroundColor:
                        C.error,
                      marginLeft: 3,
                    }}
                  />
                </View>

                <Text
                  style={{
                    fontSize: 9,
                    color: C.text3,
                    marginTop: 6,
                  }}
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
  data: {
    name: string;
    population: number;
    color: string;
  }[];
}) {
  const total =
    data.reduce(
      (s, d) => s + d.population,
      0
    ) || 1;

  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => {
        const pct =
          (d.population / total) * 100;

        return (
          <View key={i}>
            <View
              style={{
                flexDirection: "row",
                justifyContent:
                  "space-between",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: C.text2,
                  flex: 1,
                  minWidth: 0,
                }}
                numberOfLines={1}
              >
                {d.name}
              </Text>

              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: d.color,
                  flexShrink: 0,
                }}
              >
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
  const max = Math.max(
    1,
    ...values
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      <View
        style={{
          height: 200,
          flexDirection: "row",
          minWidth: Math.max(
            320,
            labels.length * 60
          ),
        }}
      >
        <View
          style={{
            justifyContent:
              "space-between",
            paddingBottom: 22,
            paddingRight: 8,
          }}
        >
          {[1, 0.5, 0].map((f) => (
            <Text
              key={f}
              style={{
                fontSize: 10,
                color: C.text3,
              }}
            >
              {Math.round(
                max * f
              ).toLocaleString()}
            </Text>
          ))}
        </View>

        <View
          style={{
            flex: 1,
          }}
        >
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent:
                labels.length > 6
                  ? "flex-start"
                  : "space-around",
              borderBottomWidth: 1,
              borderBottomColor:
                C.borderLight,
            }}
          >
            {labels.map(
              (label, i) => {
                const h = Math.max(
                  2,
                  (values[i] / max) * 100
                );

                return (
                  <View
                    key={
                      label + i
                    }
                    style={{
                      alignItems:
                        "center",
                      width: 52,
                    }}
                  >
                    <View
                      style={{
                        height: 140,
                        justifyContent:
                          "flex-end",
                      }}
                    >
                      <View
                        style={{
                          width: 22,
                          height:
                            `${h}%` as any,
                          backgroundColor:
                            color,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  </View>
                );
              }
            )}
          </View>

          <View
            style={{
              flexDirection: "row",
              justifyContent:
                labels.length > 6
                  ? "flex-start"
                  : "space-around",
              marginTop: 6,
            }}
          >
            {labels.map(
              (label, i) => (
                <Text
                  key={
                    label + i
                  }
                  style={{
                    fontSize: 10,
                    color: C.text3,
                    width: 52,
                    textAlign:
                      "center",
                  }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              )
            )}
          </View>
        </View>
      </View>
    </ScrollView>
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
  const [open, setOpen] =
    useState(false);

  const selected =
    options.find(
      (o) => o.value === value
    );

  return (
    <>
      <TouchableOpacity
        style={styles.dropdownTrigger}
        onPress={() =>
          setOpen(true)
        }
        activeOpacity={0.7}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          <Text
            style={styles.dropdownLabel}
            numberOfLines={1}
          >
            {label}
          </Text>

          <Text
            style={styles.dropdownValue}
            numberOfLines={1}
          >
            {selected?.label ??
              label}
          </Text>
        </View>

        <Text
          style={styles.dropdownChevron}
        >
          ▼
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType={
          Platform.OS === "web"
            ? "fade"
            : "slide"
        }
        onRequestClose={() =>
          setOpen(false)
        }
      >
        <View
          style={styles.dropdownOverlay}
        >
          <TouchableOpacity
            style={
              StyleSheet.absoluteFill
            }
            activeOpacity={1}
            onPress={() =>
              setOpen(false)
            }
          />

          <View
            style={
              styles.dropdownModal
            }
          >
            <View
              style={
                styles.dropdownModalHeader
              }
            >
              <View
                style={{
                  flex: 1,
                }}
              >
                <Text
                  style={
                    styles.dropdownModalTitle
                  }
                >
                  {label}
                </Text>

                <Text
                  style={
                    styles.dropdownModalSubtitle
                  }
                >
                  Select an option
                </Text>
              </View>

              <TouchableOpacity
                style={
                  styles.dropdownClose
                }
                onPress={() =>
                  setOpen(false)
                }
              >
                <Text
                  style={
                    styles.dropdownCloseText
                  }
                >
                  ✕
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{
                maxHeight:
                  Platform.OS === "web"
                    ? 420
                    : 420,
              }}
              contentContainerStyle={{
                paddingBottom: 8,
              }}
              showsVerticalScrollIndicator={
                false
              }
            >
              {options.map(
                (option) => {
                  const active =
                    option.value ===
                    value;

                  return (
                    <TouchableOpacity
                      key={
                        option.value
                      }
                      style={[
                        styles.dropdownItem,
                        active &&
                          styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        onChange(
                          option.value
                        );
                        setOpen(
                          false
                        );
                      }}
                      activeOpacity={
                        0.7
                      }
                    >
                      <View
                        style={[
                          styles.dropdownRadio,
                          active &&
                            styles.dropdownRadioActive,
                        ]}
                      >
                        {active ? (
                          <View
                            style={
                              styles.dropdownRadioDot
                            }
                          />
                        ) : null}
                      </View>

                      <Text
                        style={[
                          styles.dropdownItemText,
                          active &&
                            styles.dropdownItemTextActive,
                        ]}
                        numberOfLines={
                          2
                        }
                      >
                        {
                          option.label
                        }
                      </Text>
                    </TouchableOpacity>
                  );
                }
              )}
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
  onApply,
  searchTerm,
  onSearchChange,
  onClear,
}: any) {
  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Advanced Filters"
    >
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 30,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Search"
          value={searchTerm}
          onChangeText={
            onSearchChange
          }
          placeholder="Search by member, ID, description..."
          leftIcon="🔍"
        />

        <Text
          style={
            styles.modalSectionLabel
          }
        >
          Custom Date Range
        </Text>

        <Text
          style={{
            fontSize: 11,
            color: C.text3,
            marginBottom: 8,
          }}
        >
          Overrides the "All Months"
          quick filter when set
        </Text>

        <DatePicker
          label="From Date"
          value={fromDate}
          onChange={
            onFromDateChange
          }
          placeholder="Start date"
        />

        <DatePicker
          label="To Date"
          value={toDate}
          onChange={
            onToDateChange
          }
          placeholder="End date"
        />

        <Text
          style={
            styles.modalSectionLabel
          }
        >
          Status Filters
        </Text>

        <View
          style={
            styles.modalRow
          }
        >
          <View
            style={
              styles.modalHalf
            }
          >
            <Select
              label="Loans"
              value={loanStatus}
              options={[
                "all",
                "pending",
                "active",
                "repaid",
              ].map((s) => ({
                label:
                  s
                    .charAt(0)
                    .toUpperCase() +
                  s.slice(1),
                value: s,
              }))}
              onChange={
                onLoanStatusChange
              }
            />
          </View>

          <View
            style={
              styles.modalHalf
            }
          >
            <Select
              label="Contributions"
              value={
                contributionStatus
              }
              options={[
                "all",
                "approved",
                "pending",
                "rejected",
              ].map((s) => ({
                label:
                  s
                    .charAt(0)
                    .toUpperCase() +
                  s.slice(1),
                value: s,
              }))}
              onChange={
                onContributionStatusChange
              }
            />
          </View>
        </View>

        <View
          style={
            styles.modalButtonRow
          }
        >
          <TouchableOpacity
            style={
              styles.modalClearBtn
            }
            onPress={onClear}
          >
            <Text
              style={
                styles.modalClearBtnText
              }
            >
              Clear All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.modalApplyBtn
            }
            onPress={onApply}
          >
            <Text
              style={
                styles.modalApplyBtnText
              }
            >
              Apply Filters
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
  const { width } =
    useWindowDimensions();

  const isWide = width >= 1024;
  const isMobile = width < 600;

  const group =
    useActiveGroup();

  const allMembers =
    useGroupMembers();

  const allLoans =
    useGroupLoans();

  const allContributions =
    useGroupContributions();

  const allInvestments =
    useGroupInvestments();

  const allWallet =
    useGroupWallet();

  const permissions =
    useCurrentMemberPermissions();

  const currentMember =
    useCurrentMember();

  const canSeeAll =
    useIsAdminView();

  const {
    show,
    visible,
    msg,
    type,
  } = useToast();

  const [category, setCategory] =
    useState<Category>(
      "contributions"
    );

  const [reportScope, setReportScope] =
    useState<ReportScope>(
      canSeeAll
        ? "group"
        : "personal"
    );

  const [
    monthFilter,
    setMonthFilter,
  ] = useState("all");

  const [
    memberIdFilter,
    setMemberIdFilter,
  ] = useState("all");

  const [
    showFilterModal,
    setShowFilterModal,
  ] = useState(false);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    selectedFromDate,
    setSelectedFromDate,
  ] = useState("");

  const [
    selectedToDate,
    setSelectedToDate,
  ] = useState("");

  const [
    loanStatus,
    setLoanStatus,
  ] = useState<
    "all" |
      "pending" |
      "active" |
      "repaid"
  >("all");

  const [
    contributionStatus,
    setContributionStatus,
  ] = useState<
    "all" |
      "approved" |
      "pending" |
      "rejected"
  >("all");

  const [
    tempSearch,
    setTempSearch,
  ] = useState("");

  const [
    tempFromDate,
    setTempFromDate,
  ] = useState("");

  const [
    tempToDate,
    setTempToDate,
  ] = useState("");

  const [
    tempLoanStatus,
    setTempLoanStatus,
  ] = useState<
    typeof loanStatus
  >("all");

  const [
    tempContributionStatus,
    setTempContributionStatus,
  ] = useState<
    typeof contributionStatus
  >("all");

  // ───────────────────────────────────────────────────────────────────────
  // Keep personal users in personal mode
  // ───────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canSeeAll) {
      setReportScope(
        "personal"
      );
      setMemberIdFilter("all");
    }
  }, [canSeeAll]);

  // ───────────────────────────────────────────────────────────────────────
  // Scope
  // ───────────────────────────────────────────────────────────────────────

  const isPersonalView =
    reportScope ===
    "personal";

  const members = isPersonalView
    ? allMembers.filter(
        (m) =>
          m.id ===
          currentMember?.id
      )
    : allMembers;

  const loans = isPersonalView
    ? allLoans.filter(
        (l) =>
          l.memberId ===
          currentMember?.id
      )
    : allLoans;

  const contributions =
    isPersonalView
      ? allContributions.filter(
          (c) =>
            c.memberId ===
            currentMember?.id
        )
      : allContributions;

  const investments =
    isPersonalView
      ? allInvestments.filter(
          (i: any) =>
            i.createdBy ===
              currentMember?.id ||
            i.memberId ===
              currentMember?.id
        )
      : allInvestments;

  const wallet = isPersonalView
    ? allWallet.filter(
        (t) =>
          t.memberId ===
          currentMember?.id
      )
    : allWallet;

  // ───────────────────────────────────────────────────────────────────────
  // Filters
  // ───────────────────────────────────────────────────────────────────────

  const handleMonthChange = (
    mk: string
  ) => {
    setMonthFilter(mk);

    if (mk === "all") {
      setSelectedFromDate("");
      setSelectedToDate("");
    } else {
      const {
        from,
        to,
      } = monthBounds(mk);

      setSelectedFromDate(
        from
      );

      setSelectedToDate(to);
    }
  };

  const openFilterModal =
    () => {
      setTempSearch(
        searchTerm
      );

      setTempFromDate(
        selectedFromDate
      );

      setTempToDate(
        selectedToDate
      );

      setTempLoanStatus(
        loanStatus
      );

      setTempContributionStatus(
        contributionStatus
      );

      setShowFilterModal(true);
    };

  const applyFilters = () => {
    setSearchTerm(
      tempSearch
    );

    setSelectedFromDate(
      tempFromDate
    );

    setSelectedToDate(
      tempToDate
    );

    setLoanStatus(
      tempLoanStatus
    );

    setContributionStatus(
      tempContributionStatus
    );

    setMonthFilter("all");

    setShowFilterModal(
      false
    );
  };

  const clearAllFilters =
    () => {
      setSearchTerm("");
      setSelectedFromDate("");
      setSelectedToDate("");
      setLoanStatus("all");
      setContributionStatus(
        "all"
      );
      setMonthFilter("all");
      setMemberIdFilter(
        "all"
      );

      setTempSearch("");
      setTempFromDate("");
      setTempToDate("");
      setTempLoanStatus(
        "all"
      );
      setTempContributionStatus(
        "all"
      );
    };

  const hasActiveFilters =
    selectedFromDate !== "" ||
    selectedToDate !== "" ||
    loanStatus !== "all" ||
    contributionStatus !==
      "all" ||
    searchTerm !== "" ||
    memberIdFilter !== "all";

  const inDateRange = (
    dStr?: string
  ) => {
    if (!dStr) return true;

    const d =
      dStr.slice(0, 10);

    if (
      selectedFromDate &&
      d < selectedFromDate
    ) {
      return false;
    }

    if (
      selectedToDate &&
      d > selectedToDate
    ) {
      return false;
    }

    return true;
  };

  const inMember = (
    id?: string
  ) =>
    memberIdFilter ===
      "all" ||
    id === memberIdFilter;

  const matchesSearch = (
    item: any,
    fields: string[]
  ) => {
    if (!searchTerm)
      return true;

    const term =
      searchTerm.toLowerCase();

    return fields.some(
      (field) =>
        item[field]
          ?.toString()
          .toLowerCase()
          .includes(term)
    );
  };

  const getMemberName = (
    id?: string
  ) =>
    allMembers.find(
      (m) => m.id === id
    )?.fullName ??
    "Unknown";

  // ───────────────────────────────────────────────────────────────────────
  // Late fees
  // ───────────────────────────────────────────────────────────────────────

  const overdue = useMemo(() => {
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

  const lateFees =
    useMemo(() => {
      return overdue
        .map((item: any) => {
          const tx =
            allWallet.find(
              (t) =>
                t.id ===
                  item.feeTxId &&
                t.type ===
                  "late_fee"
            );

          return {
            ...item,
            isPaid:
              !!tx?.feePaid,
          };
        })
        .filter(
          (item: any) =>
            isPersonalView
              ? item.memberId ===
                currentMember?.id
              : true
        );
    }, [
      overdue,
      allWallet,
      isPersonalView,
      currentMember?.id,
    ]);

  // ───────────────────────────────────────────────────────────────────────
  // Overview financial calculations
  // ───────────────────────────────────────────────────────────────────────

  const EARNING_TYPES_OVERVIEW =
    [
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "bank_fee",
      "other_credit",
      "other_debit",
    ];

  const groupWalletEarnings =
    useMemo(
      () =>
        round2(
          wallet.reduce(
            (sum, t) => {
              if (
                t.type ===
                "loan_repayment"
              ) {
                const loan =
                  loans.find(
                    (l) =>
                      l.id ===
                      t.loanId
                  );

                if (
                  !loan?.totalRepayable
                ) {
                  return sum;
                }

                return (
                  sum +
                  round2(
                    t.amount *
                      (loan.totalInterest /
                        loan.totalRepayable)
                  )
                );
              }

              if (
                EARNING_TYPES_OVERVIEW.includes(
                  t.type
                )
              ) {
                return (
                  sum +
                  t.amount
                );
              }

              return sum;
            },
            0
          )
        ),
      [wallet, loans]
    );

  const groupExpenses =
    useMemo(
      () =>
        wallet
          .filter((t) =>
            [
              "bank_fee",
              "other_debit",
            ].includes(
              t.type
            )
          )
          .reduce(
            (sum, t) =>
              sum +
              Math.abs(
                t.amount
              ),
            0
          ),
      [wallet]
    );

  const groupInterestOnly =
    useMemo(
      () =>
        round2(
          wallet.reduce(
            (sum, t) => {
              if (
                t.type ===
                "loan_repayment"
              ) {
                const loan =
                  loans.find(
                    (l) =>
                      l.id ===
                      t.loanId
                  );

                if (
                  !loan?.totalRepayable
                ) {
                  return sum;
                }

                return (
                  sum +
                  round2(
                    t.amount *
                      (loan.totalInterest /
                        loan.totalRepayable)
                  )
                );
              }

              if (
                (
                  t.type ===
                    "loan_interest_income" ||
                  t.type ===
                    "interest"
                ) &&
                t.amount > 0
              ) {
                return (
                  sum +
                  t.amount
                );
              }

              return sum;
            },
            0
          )
        ),
      [wallet, loans]
    );

  const groupContributionsOnly =
    useMemo(
      () =>
        round2(
          wallet
            .filter(
              (t) =>
                t.type ===
                  "contribution" &&
                t.amount > 0
            )
            .reduce(
              (s, t) =>
                s + t.amount,
              0
            )
        ),
      [wallet]
    );

  const groupPenaltiesOnly =
    useMemo(
      () =>
        round2(
          wallet
            .filter(
              (t) =>
                t.type ===
                  "late_fee" &&
                t.amount > 0
            )
            .reduce(
              (s, t) =>
                s + t.amount,
              0
            )
        ),
      [wallet]
    );

  const groupOtherOnly =
    useMemo(() => {
      const known = [
        "contribution",
        "loan_interest_income",
        "interest",
        "late_fee",
        "loan_disbursement",
        "loan_repayment",
        "loan_principal_recovery",
      ];

      return round2(
        wallet
          .filter(
            (t) =>
              !known.includes(
                t.type
              )
          )
          .reduce(
            (s, t) =>
              s + t.amount,
            0
          )
      );
    }, [wallet]);

  const groupTotalNetAssets =
    useMemo(
      () =>
        round2(
          wallet.reduce(
            (s, t) =>
              s + t.amount,
            0
          )
        ),
      [wallet]
    );

  // ───────────────────────────────────────────────────────────────────────
  // Cashflow
  // ───────────────────────────────────────────────────────────────────────

  const cashflow =
    useMemo(() => {
      const months: string[] =
        [];

      const income: number[] =
        [];

      const expenses: number[] =
        [];

      for (
        let i = 5;
        i >= 0;
        i--
      ) {
        const d =
          new Date();

        d.setMonth(
          d.getMonth() - i
        );

        const startOfMonth =
          new Date(
            d.getFullYear(),
            d.getMonth(),
            1
          );

        const endOfMonth =
          new Date(
            d.getFullYear(),
            d.getMonth() + 1,
            0,
            23,
            59,
            59,
            999
          );

        const monthTxs =
          wallet.filter(
            (t) => {
              const txDate =
                new Date(
                  t.date
                );

              return (
                txDate >=
                  startOfMonth &&
                txDate <=
                  endOfMonth
              );
            }
          );

        months.push(
          d.toLocaleDateString(
            "en",
            {
              month: "short",
            }
          )
        );

        income.push(
          monthTxs
            .filter(
              (t) =>
                t.amount > 0
            )
            .reduce(
              (s, t) =>
                s + t.amount,
              0
            )
        );

        expenses.push(
          Math.abs(
            monthTxs
              .filter(
                (t) =>
                  t.amount < 0
              )
              .reduce(
                (s, t) =>
                  s + t.amount,
                0
              )
          )
        );
      }

      return {
        months,
        income,
        expenses,
      };
    }, [wallet]);

  // ───────────────────────────────────────────────────────────────────────
  // Member savings chart
  // ───────────────────────────────────────────────────────────────────────

  const memberPie =
    useMemo(() => {
      const top = members
        .filter(
          (m) =>
            m.status ===
              "active" &&
            m.totalContributions >
              0
        )
        .slice(0, 5);

      const palette = [
        C.accent,
        C.gold,
        C.info,
        C.success,
        "#7C3AED",
      ];

      return top.map(
        (m, i) => ({
          name: m.fullName.split(
            " "
          )[0],
          population:
            m.totalContributions,
          color:
            palette[
              i %
                palette.length
            ],
        })
      );
    }, [members]);

  // ───────────────────────────────────────────────────────────────────────
  // Month options
  // ───────────────────────────────────────────────────────────────────────

  const monthOptions =
    useMemo(() => {
      const dateFieldByCat: Record<
        Category,
        string
      > = {
        contributions: "date",
        loans: "applicationDate",
        latefees: "periodStart",
        members: "dateJoined",
        expenses: "date",
        investments: "startDate",
        earnings: "date",
      };

      let source: any[] =
        [];

      switch (category) {
        case "contributions":
          source =
            contributions;
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
          source =
            wallet.filter(
              (t) =>
                [
                  "bank_fee",
                  "other_debit",
                ].includes(
                  t.type
                )
            );
          break;

        case "investments":
          source =
            investments;
          break;

        case "earnings":
          source = wallet;
          break;
      }

      const keys =
        new Set<string>();

      source.forEach(
        (item) => {
          const k =
            monthKey(
              item[
                dateFieldByCat[
                  category
                ]
              ] ??
                item.date
            );

          if (k) {
            keys.add(k);
          }
        }
      );

      const sorted =
        Array.from(
          keys
        ).sort().reverse();

      return [
        {
          label: "All Months",
          value: "all",
        },
        ...sorted.map(
          (k) => ({
            label:
              monthLabel(k),
            value: k,
          })
        ),
      ];
    }, [
      category,
      contributions,
      loans,
      lateFees,
      members,
      wallet,
      investments,
    ]);

  // ───────────────────────────────────────────────────────────────────────
  // Member options
  // ───────────────────────────────────────────────────────────────────────

  const memberOptions =
    useMemo(
      () => [
        {
          label:
            isPersonalView
              ? "My Records"
              : "All Members",
          value: "all",
        },

        ...(isPersonalView
          ? []
          : allMembers.map(
              (m) => ({
                label:
                  m.fullName,
                value: m.id,
              })
            )),
      ],
      [
        allMembers,
        isPersonalView,
      ]
    );

  // ───────────────────────────────────────────────────────────────────────
  // Category view
  // ───────────────────────────────────────────────────────────────────────

  const view = useMemo(() => {
    if (
      category ===
      "contributions"
    ) {
      let list =
        contributions.filter(
          (c) =>
            inDateRange(
              c.date
            ) &&
            inMember(
              c.memberId
            )
        );

      if (
        contributionStatus !==
        "all"
      ) {
        list =
          list.filter(
            (c) =>
              c.status ===
              contributionStatus
          );
      }

      list =
        list.filter(
          (c) =>
            matchesSearch(c, [
              "memberId",
              "description",
              "contributionType",
            ])
        );

      const chart =
        monthlyTotals(
          list.filter(
            (c) =>
              c.status ===
              "approved"
          ),
          "date",
          "amount"
        );

      return {
        rows: list,
        headers: [
          "Date",
          "Member",
          "Type",
          "Amount",
          "Status",
          "Description",
        ],
        toRow: (c: any) => [
          fmtDate(c.date),
          getMemberName(
            c.memberId
          ),
          c.contributionType ??
            "",
          fmtCurrency(
            c.amount
          ),
          c.status,
          c.description ??
            "",
        ],
        chart,
        chartColor: C.primary,
        kpis: [
          {
            label: "Total",
            value:
              fmtCurrency(
                list.reduce(
                  (s, c) =>
                    s +
                    c.amount,
                  0
                )
              ),
          },
          {
            label: "Records",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    if (
      category ===
      "loans"
    ) {
      let list =
        loans.filter(
          (l) =>
            inDateRange(
              l.applicationDate
            ) &&
            inMember(
              l.memberId
            )
        );

      if (
        loanStatus !==
        "all"
      ) {
        if (
          loanStatus ===
          "active"
        ) {
          list =
            list.filter(
              (l) =>
                l.status ===
                "disbursed"
            );
        } else if (
          loanStatus ===
          "pending"
        ) {
          list =
            list.filter(
              (l) =>
                l.status.startsWith(
                  "pending_"
                )
            );
        } else {
          list =
            list.filter(
              (l) =>
                l.status ===
                loanStatus
            );
        }
      }

      list =
        list.filter(
          (l) =>
            matchesSearch(l, [
              "memberId",
              "id",
              "purpose",
            ])
        );

      const chart =
        monthlyTotals(
          list,
          "applicationDate",
          "amount"
        );

      return {
        rows: list,
        headers: [
          "Member",
          "Amount",
          "Repaid",
          "Balance",
          "Status",
          "Applied",
        ],
        toRow: (l: any) => [
          getMemberName(
            l.memberId
          ),
          fmtCurrency(
            l.amount
          ),
          fmtCurrency(
            l.amountRepaid ||
              0
          ),
          fmtCurrency(
            l.balance ??
              0
          ),
          l.status,
          fmtDate(
            l.applicationDate
          ),
        ],
        chart,
        chartColor: C.accent,
        kpis: [
          {
            label:
              "Total Disbursed",
            value:
              fmtCurrency(
                list.reduce(
                  (s, l) =>
                    s +
                    l.amount,
                  0
                )
              ),
          },
          {
            label: "Records",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    if (
      category ===
      "latefees"
    ) {
      let list =
        lateFees.filter(
          (f: any) =>
            inDateRange(
              f.periodStart
            ) &&
            inMember(
              f.memberId
            )
        );

      list =
        list.filter(
          (f: any) =>
            matchesSearch(f, [
              "memberId",
              "periodLabel",
            ])
        );

      const chart =
        monthlyTotals(
          list,
          "periodStart",
          "feeAmount"
        );

      return {
        rows: list,
        headers: [
          "Member",
          "Period",
          "Days Late",
          "Fee Amount",
          "Status",
        ],
        toRow: (f: any) => [
          getMemberName(
            f.memberId
          ),
          f.periodLabel ??
            "—",
          f.daysLate ?? 0,
          fmtCurrency(
            f.feeAmount ||
              0
          ),
          f.isPaid
            ? "Paid"
            : "Unpaid",
        ],
        chart,
        chartColor: C.error,
        kpis: [
          {
            label:
              "Total Owed",
            value:
              fmtCurrency(
                list
                  .filter(
                    (f: any) =>
                      !f.isPaid
                  )
                  .reduce(
                    (
                      s: number,
                      f: any
                    ) =>
                      s +
                      (f.feeAmount ||
                        0),
                    0
                  )
              ),
          },
          {
            label: "Records",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    if (
      category ===
      "members"
    ) {
      const list =
        members.filter(
          (m) =>
            matchesSearch(
              m,
              [
                "fullName",
                "email",
                "phone",
              ]
            )
        );

      return {
        rows: list,
        headers: [
          "Name",
          "Phone",
          "Email",
          "Role",
          "Status",
          "Total Contributions",
          "Joined",
        ],
        toRow: (m: any) => [
          m.fullName,
          m.phone || "",
          m.email || "",
          m.role,
          m.status,
          fmtCurrency(
            m.totalContributions ||
              0
          ),
          fmtDate(
            m.dateJoined
          ),
        ],
        chart: {
          labels: [],
          values: [],
        },
        chartColor: C.gold,
        kpis: [
          {
            label:
              "Active Members",
            value: String(
              list.filter(
                (m) =>
                  m.status ===
                  "active"
              ).length
            ),
          },
          {
            label: "Total",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    if (
      category ===
      "expenses"
    ) {
      let list =
        wallet.filter(
          (t) =>
            [
              "bank_fee",
              "other_debit",
            ].includes(
              t.type
            ) &&
            inDateRange(
              t.date
            ) &&
            inMember(
              t.memberId
            )
        );

      list =
        list.filter(
          (t) =>
            matchesSearch(t, [
              "type",
              "description",
            ])
        );

      const chart =
        monthlyTotals(
          list,
          "date",
          "amount"
        );

      return {
        rows: list,
        headers: [
          "Date",
          "Type",
          "Amount",
          "Description",
        ],
        toRow: (t: any) => [
          fmtDate(t.date),
          t.type.replace(
            /_/g,
            " "
          ),
          fmtCurrency(
            Math.abs(
              t.amount ||
                0
            )
          ),
          t.description ||
            "",
        ],
        chart,
        chartColor: C.error,
        kpis: [
          {
            label:
              "Total Expenses",
            value:
              fmtCurrency(
                list.reduce(
                  (s, t) =>
                    s +
                    Math.abs(
                      t.amount ||
                        0
                    ),
                  0
                )
              ),
          },
          {
            label: "Records",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    if (
      category ===
      "investments"
    ) {
      let list =
        investments.filter(
          (i: any) =>
            inDateRange(
              i.startDate
            )
        );

      list =
        list.filter(
          (i: any) =>
            matchesSearch(
              i,
              [
                "investmentName",
                "type",
              ]
            )
        );

      const chart =
        monthlyTotals(
          list,
          "startDate",
          "investmentAmount"
        );

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
          fmtCurrency(
            i.investmentAmount
          ),
          fmtCurrency(
            i.expectedReturn ||
              0
          ),
          i.status,
          fmtDate(
            i.startDate
          ),
          i.maturityDate
            ? fmtDate(
                i.maturityDate
              )
            : "",
        ],
        chart,
        chartColor: C.success,
        kpis: [
          {
            label:
              "Total Invested",
            value:
              fmtCurrency(
                list.reduce(
                  (
                    s: number,
                    i: any
                  ) =>
                    s +
                    (i.investmentAmount ||
                      0),
                  0
                )
              ),
          },
          {
            label: "Records",
            value: String(
              list.length
            ),
          },
        ],
      };
    }

    // ───────────────────────────────────────────────────────────────────
    // Earnings
    // ───────────────────────────────────────────────────────────────────

    const EARNING_TYPES = [
      "loan_interest_income",
      "interest",
      "late_fee",
      "investment_return",
      "bank_fee",
      "other_credit",
      "other_debit",
    ];

    const earningAmount =
      (t: any) => {
        if (
          t.type !==
          "loan_repayment"
        ) {
          return t.amount;
        }

        const loan =
          loans.find(
            (l) =>
              l.id ===
              t.loanId
          );

        if (
          !loan?.totalRepayable
        ) {
          return 0;
        }

        return round2(
          t.amount *
            (loan.totalInterest /
              loan.totalRepayable)
        );
      };

    let list =
      wallet.filter(
        (t) =>
          (
            EARNING_TYPES.includes(
              t.type
            ) ||
            t.type ===
              "loan_repayment"
          ) &&
          t.amount !== 0 &&
          inDateRange(
            t.date
          ) &&
          inMember(
            t.memberId
          )
      );

    list =
      list.filter(
        (t) =>
          matchesSearch(t, [
            "type",
            "description",
          ])
      );

    const chart =
      monthlyTotals(
        list,
        "date",
        null
      );

    const totalEarnings =
      round2(
        list.reduce(
          (s, t) =>
            s +
            earningAmount(t),
          0
        )
      );

    return {
      rows: list,
      headers: [
        "Date",
        "Member",
        "Type",
        "Description",
        "Amount",
      ],
      toRow: (t: any) => [
        fmtDate(t.date),
        getMemberName(
          t.memberId
        ),
        t.type,
        t.description ??
          "",
        fmtCurrency(
          earningAmount(t)
        ),
      ],
      chart,
      chartColor: C.success,
      kpis: [
        {
          label:
            "Net Earnings",
          value:
            fmtCurrency(
              totalEarnings
            ),
        },
      ],
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
  ]);

  // ───────────────────────────────────────────────────────────────────────
  // Export current report
  // ───────────────────────────────────────────────────────────────────────

  const exportRows =
    view.rows.map(
      view.toRow
    );

  const handleExport =
    async (
      format:
        | "excel"
        | "pdf"
    ) => {
      if (
        !exportRows.length
      ) {
        show(
          "No records to export",
          "error"
        );
        return;
      }

      const fileName = `${category}_report_${monthFilter}_${reportScope}`;

      if (
        format ===
        "excel"
      ) {
        await exportXlsx(
          fileName,
          view.headers,
          exportRows
        );
      } else {
        const html = `
          <table>
            <thead>
              <tr>
                ${view.headers
                  .map(
                    (h) =>
                      `<th>${h}</th>`
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${exportRows
                .map(
                  (row) =>
                    `<tr>${row
                      .map(
                        (c) =>
                          `<td>${c}</td>`
                      )
                      .join("")}</tr>`
                )
                .join("")}
            </tbody>
          </table>
        `;

        await exportPdf(
          fileName,
          `${
            CATEGORIES.find(
              (c) =>
                c.key ===
                category
            )?.label
          } Report`,
          html
        );
      }

      show(
        `Exported as ${
          format ===
          "excel"
            ? "Excel"
            : "PDF"
        }`
      );
    };

  // ───────────────────────────────────────────────────────────────────────
  // Export member contributions
  // ───────────────────────────────────────────────────────────────────────

  const handleExportMemberContributions =
    async (
      memberId?: string,
      format:
        | "excel"
        | "pdf" = "excel"
    ) => {
      const targetContributions =
        contributions
          .filter((c: any) =>
            memberId
              ? c.memberId ===
                memberId
              : true
          )
          .filter(
            (c: any) =>
              c.status ===
              "approved"
          )
          .filter(
            (c: any) =>
              inDateRange(
                c.date
              )
          )
          .filter(
            (c: any) =>
              matchesSearch(c, [
                "memberId",
                "description",
                "contributionType",
              ])
          );

      if (
        !targetContributions.length
      ) {
        show(
          "No contributions found for this selection",
          "error"
        );
        return;
      }

      const headers = [
        "Date",
        "Member",
        "Type",
        "Amount",
        "Status",
        "Description",
      ];

      const rows =
        targetContributions.map(
          (c: any) => [
            fmtDate(c.date),
            getMemberName(
              c.memberId
            ),
            c.contributionType ??
              "",
            fmtCurrency(
              c.amount
            ),
            c.status,
            c.description ??
              "",
          ]
        );

      const scopeName =
        memberId
          ? getMemberName(
              memberId
            ).replace(
              /\s+/g,
              "_"
            )
          : reportScope;

      const fileName =
        `contributions_${scopeName}_${monthFilter}`;

      if (
        format ===
        "excel"
      ) {
        await exportXlsx(
          fileName,
          headers,
          rows
        );
      } else {
        const html = `
          <table>
            <thead>
              <tr>
                ${headers
                  .map(
                    (h) =>
                      `<th>${h}</th>`
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) =>
                    `<tr>${row
                      .map(
                        (c) =>
                          `<td>${c}</td>`
                      )
                      .join("")}</tr>`
                )
                .join("")}
            </tbody>
          </table>
        `;

        await exportPdf(
          fileName,
          "Contributions Report",
          html
        );
      }

      show(
        `Exported ${rows.length} contribution${
          rows.length !== 1
            ? "s"
            : ""
        } as ${
          format ===
          "excel"
            ? "Excel"
            : "PDF"
        }`
      );
    };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
      }}
    >
      <StatusBar
        barStyle="dark-content"
        backgroundColor={C.bg}
      />

      <ScrollView
        contentContainerStyle={[
          styles.page,
          {
            paddingBottom: 80,
          },
        ]}
        showsVerticalScrollIndicator={
          false
        }
      >
        {/* ═══════════════════════════════════════════════════════════════
            OVERVIEW
        ═══════════════════════════════════════════════════════════════ */}

        <View
          style={[
            styles.contentContainer,
            isWide &&
              styles.contentContainerWide,
          ]}
        >
          <View
            style={
              styles.kpiGrid
            }
          >
            <KpiCard
              label="TOTAL EARNINGS"
              value={fmtCurrency(
                groupWalletEarnings
              )}
              color={C.info}
              subtext={
                isPersonalView
                  ? "my interest, fees & other"
                  : "interest, fees & other"
              }
            />

            <KpiCard
              label="INVESTMENTS"
              value={fmtCurrency(
                investments.reduce(
                  (
                    sum: number,
                    item: any
                  ) =>
                    sum +
                    (item.investmentAmount ||
                      0),
                  0
                )
              )}
              color={C.success}
              subtext={
                isPersonalView
                  ? "my investments"
                  : "group total"
              }
            />

            <KpiCard
              label="EXPENSES"
              value={fmtCurrency(
                groupExpenses
              )}
              color={C.error}
              subtext={
                isPersonalView
                  ? "my wallet"
                  : "operational"
              }
            />
          </View>

          <View
            style={
              styles.chartCard
            }
          >
            <Text
              style={
                styles.chartTitle
              }
            >
              {isPersonalView
                ? "Personal Financial Position"
                : "Group Financial Position"}
            </Text>

            <View
              style={
                styles.gfpRow
              }
            >
              <View
                style={[
                  styles.gfpStat,
                  styles.gfpStatBorderRight,
                  styles.gfpStatBorderBottom,
                ]}
              >
                <Text
                  style={T.label}
                  numberOfLines={1}
                >
                  {isPersonalView
                    ? "My Account"
                    : "Members"}
                </Text>

                <Text
                  style={
                    styles.gfpStatValue
                  }
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.75
                  }
                >
                  {isPersonalView
                    ? "1"
                    : members.filter(
                        (m) =>
                          m.status ===
                          "active"
                      ).length}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  {isPersonalView
                    ? "personal"
                    : "active"}
                </Text>
              </View>

              <View
                style={[
                  styles.gfpStat,
                  styles.gfpStatBorderBottom,
                ]}
              >
                <Text
                  style={T.label}
                  numberOfLines={1}
                >
                  Total Net Assets
                </Text>

                <Text
                  style={[
                    styles.gfpStatValue,
                    {
                      color:
                        C.primary,
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.65
                  }
                >
                  {fmtCurrency(
                    groupTotalNetAssets
                  )}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  {isPersonalView
                    ? "my wallet"
                    : "everything in wallet"}
                </Text>
              </View>
            </View>

            <View
              style={
                styles.gfpRow
              }
            >
              <View
                style={[
                  styles.gfpStat,
                  styles.gfpStatBorderRight,
                  styles.gfpStatBorderBottom,
                ]}
              >
                <Text
                  style={T.label}
                  numberOfLines={1}
                >
                  Contributions
                </Text>

                <Text
                  style={
                    styles.gfpStatValue
                  }
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.7
                  }
                >
                  {fmtCurrency(
                    groupContributionsOnly
                  )}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  {isPersonalView
                    ? "my contributions"
                    : "total collected"}
                </Text>
              </View>

              <View
                style={[
                  styles.gfpStat,
                  styles.gfpStatBorderBottom,
                ]}
              >
                <Text
                  style={[
                    styles.gfpStatLabel,
                  ]}
                  numberOfLines={1}
                >
                  Interest Earned
                </Text>

                <Text
                  style={[
                    styles.gfpStatValue,
                    {
                      color:
                        C.gold,
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.7
                  }
                >
                  {fmtCurrency(
                    groupInterestOnly
                  )}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  from loan repayments
                </Text>
              </View>
            </View>

            <View
              style={
                styles.gfpRow
              }
            >
              <View
                style={[
                  styles.gfpStat,
                  styles.gfpStatBorderRight,
                ]}
              >
                <Text
                  style={T.label}
                  numberOfLines={1}
                >
                  Penalties & Late Fees
                </Text>

                <Text
                  style={[
                    styles.gfpStatValue,
                    {
                      color:
                        C.error,
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.7
                  }
                >
                  {fmtCurrency(
                    groupPenaltiesOnly
                  )}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  collected
                </Text>
              </View>

              <View
                style={
                  styles.gfpStat
                }
              >
                <Text
                  style={T.label}
                  numberOfLines={1}
                >
                  Other
                </Text>

                <Text
                  style={
                    styles.gfpStatValue
                  }
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={
                    0.7
                  }
                >
                  {fmtCurrency(
                    groupOtherOnly
                  )}
                </Text>

                <Text
                  style={T.small}
                  numberOfLines={1}
                >
                  bank fees, misc
                </Text>
              </View>
            </View>
          </View>

          <View
            style={
              styles.chartCard
            }
          >
            <Text
              style={
                styles.chartTitle
              }
            >
              Cash Flow (Last 6 Months)
            </Text>

            <CashflowBarChart
              months={
                cashflow.months
              }
              income={
                cashflow.income
              }
              expenses={
                cashflow.expenses
              }
            />
          </View>

          {memberPie.length >
            0 && (
            <View
              style={
                styles.chartCard
              }
            >
              <Text
                style={
                  styles.chartTitle
                }
              >
                {isPersonalView
                  ? "My Savings"
                  : "Savings by Member (Top 5)"}
              </Text>

              <MemberSharesChart
                data={
                  memberPie
                }
              />
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════
            REPORT CONTROLS
        ═══════════════════════════════════════════════════════════════ */}

        <View
          style={[
            styles.contentContainer,
            isWide &&
              styles.contentContainerWide,
          ]}
        >
          {/* Scope */}

          {canSeeAll && (
            <View
              style={
                styles.scopeSection
              }
            >
              <Text
                style={
                  styles.scopeLabel
                }
              >
                VIEW
              </Text>

              <View
                style={
                  styles.scopeToggle
                }
              >
                <TouchableOpacity
                  style={[
                    styles.scopeOption,
                    reportScope ===
                      "group" &&
                      styles.scopeOptionActive,
                  ]}
                  onPress={() => {
                    setReportScope(
                      "group"
                    );
                    setMemberIdFilter(
                      "all"
                    );
                  }}
                  activeOpacity={
                    0.8
                  }
                >
                  <Text
                    style={[
                      styles.scopeOptionText,
                      reportScope ===
                        "group" &&
                        styles.scopeOptionTextActive,
                    ]}
                  >
                    👥 Group
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.scopeOption,
                    reportScope ===
                      "personal" &&
                      styles.scopeOptionActive,
                  ]}
                  onPress={() => {
                    setReportScope(
                      "personal"
                    );
                    setMemberIdFilter(
                      "all"
                    );
                  }}
                  activeOpacity={
                    0.8
                  }
                >
                  <Text
                    style={[
                      styles.scopeOptionText,
                      reportScope ===
                        "personal" &&
                        styles.scopeOptionTextActive,
                    ]}
                  >
                    👤 Personal
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Categories */}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={
              false
            }
            style={
              styles.categoryScroller
            }
            contentContainerStyle={
              styles.categoryContent
            }
          >
            {CATEGORIES.map(
              (c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[
                    styles.pill,
                    category ===
                      c.key &&
                      styles.pillActive,
                  ]}
                  onPress={() => {
                    setCategory(
                      c.key
                    );
                    setMonthFilter(
                      "all"
                    );
                    setSelectedFromDate(
                      ""
                    );
                    setSelectedToDate(
                      ""
                    );
                  }}
                  activeOpacity={
                    0.8
                  }
                >
                  <Text
                    style={
                      styles.pillIcon
                    }
                  >
                    {c.icon}
                  </Text>

                  <Text
                    style={[
                      styles.pillLabel,
                      category ===
                        c.key &&
                        styles.pillLabelActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </ScrollView>

          {/* Filters */}

          <View
            style={[
              styles.filterArea,
              isMobile &&
                styles.filterAreaMobile,
            ]}
          >
            <View
              style={[
                styles.filterDropdown,
                isMobile &&
                  styles.filterDropdownMobile,
              ]}
            >
              <Dropdown
                label="Month"
                value={
                  monthFilter
                }
                options={
                  monthOptions
                }
                onChange={
                  handleMonthChange
                }
              />
            </View>

            {!isPersonalView && (
              <View
                style={[
                  styles.filterDropdown,
                  isMobile &&
                    styles.filterDropdownMobile,
                ]}
              >
                <Dropdown
                  label="Member"
                  value={
                    memberIdFilter
                  }
                  options={
                    memberOptions
                  }
                  onChange={
                    setMemberIdFilter
                  }
                />
              </View>
            )}

            <TouchableOpacity
              style={
                styles.filterBtn
              }
              onPress={
                openFilterModal
              }
              activeOpacity={
                0.8
              }
            >
              <Text
                style={
                  styles.filterBtnText
                }
              >
                {hasActiveFilters
                  ? "🎯 Advanced"
                  : "🔍 Advanced"}
              </Text>

              {hasActiveFilters && (
                <View
                  style={
                    styles.filterDot
                  }
                />
              )}
            </TouchableOpacity>

            {hasActiveFilters && (
              <TouchableOpacity
                onPress={
                  clearAllFilters
                }
                style={
                  styles.clearBtn
                }
              >
                <Text
                  style={
                    styles.clearBtnText
                  }
                >
                  Clear
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {searchTerm !==
            "" && (
            <Text
              style={
                styles.searchIndicator
              }
            >
              🔍 "{searchTerm}"
            </Text>
          )}

          {/* ═════════════════════════════════════════════════════════════
              MEMBERS
          ═════════════════════════════════════════════════════════════ */}

          {category ===
          "members" ? (
            <MembersTab
              members={
                view.rows
              }
              contributions={
                contributions
              }
              loans={loans}
              wallet={wallet}
              canSeeAll={
                canSeeAll
              }
              currentMember={
                currentMember
              }
              onExport={
                handleExport
              }
              onExportContributions={
                handleExportMemberContributions
              }
              exportRows={
                exportRows
              }
            />
          ) : (
            <View
              style={[
                styles.reportColumns,
                isWide &&
                  styles.reportColumnsWide,
              ]}
            >
              {/* Chart */}

              <View
                style={[
                  styles.card,
                  isWide &&
                    styles.reportColumn,
                ]}
              >
                <Text
                  style={
                    styles.cardTitle
                  }
                >
                  {
                    CATEGORIES.find(
                      (c) =>
                        c.key ===
                        category
                    )?.label
                  }{" "}
                  Overview
                </Text>

                <View
                  style={
                    styles.kpiMiniRow
                  }
                >
                  {view.kpis.map(
                    (k) => (
                      <View
                        key={
                          k.label
                        }
                        style={
                          styles.kpiMini
                        }
                      >
                        <Text
                          style={
                            styles.kpiMiniLabel
                          }
                        >
                          {k.label}
                        </Text>

                        <Text
                          style={
                            styles.kpiMiniValue
                          }
                          numberOfLines={
                            1
                          }
                          adjustsFontSizeToFit
                          minimumFontScale={
                            0.7
                          }
                        >
                          {k.value}
                        </Text>
                      </View>
                    )
                  )}
                </View>

                {view.chart
                  .labels
                  .length >
                0 ? (
                  <CategoryBarChart
                    labels={
                      view.chart
                        .labels
                    }
                    values={
                      view.chart
                        .values
                    }
                    color={
                      view.chartColor
                    }
                  />
                ) : (
                  <Text
                    style={
                      styles.noData
                    }
                  >
                    No data for this
                    selection
                  </Text>
                )}
              </View>

              {/* Data preview */}

              <View
                style={[
                  styles.card,
                  isWide &&
                    styles.reportColumn,
                ]}
              >
                <View
                  style={
                    styles.previewHeader
                  }
                >
                  <Text
                    style={
                      styles.cardTitle
                    }
                  >
                    Data Preview
                  </Text>

                  <View
                    style={
                      styles.exportActions
                    }
                  >
                    <TouchableOpacity
                      style={
                        styles.exportBtn
                      }
                      onPress={() =>
                        handleExport(
                          "excel"
                        )
                      }
                      disabled={
                        !exportRows.length
                      }
                      activeOpacity={
                        0.8
                      }
                    >
                      <Text
                        style={
                          styles.exportBtnText
                        }
                      >
                        📊 Excel
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={
                        styles.exportBtn
                      }
                      onPress={() =>
                        handleExport(
                          "pdf"
                        )
                      }
                      disabled={
                        !exportRows.length
                      }
                      activeOpacity={
                        0.8
                      }
                    >
                      <Text
                        style={
                          styles.exportBtnText
                        }
                      >
                        🖨 PDF
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {exportRows.length ===
                0 ? (
                  <Text
                    style={
                      styles.noData
                    }
                  >
                    No records match your
                    filters
                  </Text>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                  >
                    <View>
                      <View
                        style={
                          styles.previewRow
                        }
                      >
                        {view.headers.map(
                          (h) => (
                            <Text
                              key={h}
                              style={
                                styles.previewHeadCell
                              }
                            >
                              {h}
                            </Text>
                          )
                        )}
                      </View>

                      <ScrollView
                        style={{
                          maxHeight: 420,
                        }}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={
                          true
                        }
                      >
                        {exportRows.map(
                          (
                            row,
                            i
                          ) => (
                            <View
                              key={
                                i
                              }
                              style={[
                                styles.previewRow,
                                i %
                                    2 ===
                                  1 && {
                                  backgroundColor:
                                    C.elevated,
                                },
                              ]}
                            >
                              {row.map(
                                (
                                  cell,
                                  j
                                ) => (
                                  <Text
                                    key={
                                      j
                                    }
                                    style={
                                      styles.previewCell
                                    }
                                    numberOfLines={
                                      2
                                    }
                                  >
                                    {String(
                                      cell
                                    )}
                                  </Text>
                                )
                              )}
                            </View>
                          )
                        )}
                      </ScrollView>
                    </View>
                  </ScrollView>
                )}

                {exportRows.length >
                  0 && (
                  <Text
                    style={
                      styles.previewCount
                    }
                  >
                    {
                      exportRows.length
                    }{" "}
                    record
                    {exportRows.length !==
                    1
                      ? "s"
                      : ""}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <FilterModal
        visible={
          showFilterModal
        }
        onClose={() =>
          setShowFilterModal(
            false
          )
        }
        fromDate={
          tempFromDate
        }
        toDate={
          tempToDate
        }
        onFromDateChange={
          setTempFromDate
        }
        onToDateChange={
          setTempToDate
        }
        loanStatus={
          tempLoanStatus
        }
        contributionStatus={
          tempContributionStatus
        }
        onLoanStatusChange={
          setTempLoanStatus
        }
        onContributionStatusChange={
          setTempContributionStatus
        }
        onApply={
          applyFilters
        }
        searchTerm={
          tempSearch
        }
        onSearchChange={
          setTempSearch
        }
        onClear={
          clearAllFilters
        }
      />

      <Toast
        visible={visible}
        msg={msg}
        type={type}
      />
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
  canSeeAll,
  currentMember,
  onExport,
  onExportContributions,
  exportRows,
}: any) {
  const [
    selectedMember,
    setSelectedMember,
  ] = useState<any>(
    !canSeeAll &&
      members.length === 1
      ? members[0]
      : null
  );

  useEffect(() => {
    if (
      !canSeeAll &&
      members.length === 1
    ) {
      setSelectedMember(
        members[0]
      );
      return;
    }

    if (
      canSeeAll &&
      selectedMember
    ) {
      const exists =
        members.some(
          (m: any) =>
            m.id ===
            selectedMember.id
        );

      if (!exists) {
        setSelectedMember(
          null
        );
      }
    }
  }, [
    canSeeAll,
    members,
  ]);

  if (selectedMember) {
    return (
      <MemberDetail
        member={
          selectedMember
        }
        loans={loans.filter(
          (l: any) =>
            l.memberId ===
            selectedMember.id
        )}
        contributions={contributions.filter(
          (c: any) =>
            c.memberId ===
              selectedMember.id &&
            c.status ===
              "approved"
        )}
        wallet={wallet.filter(
          (w: any) =>
            w.memberId ===
            selectedMember.id
        )}
        canGoBack={
          canSeeAll
        }
        onBack={() =>
          setSelectedMember(
            null
          )
        }
        onExportContributions={(
          format:
            | "excel"
            | "pdf"
        ) =>
          onExportContributions(
            selectedMember.id,
            format
          )
        }
      />
    );
  }

  const approvedContributions =
    contributions.filter(
      (c: any) =>
        c.status ===
        "approved"
    );

  return (
    <View>
      <View
        style={[
          styles.previewHeader,
          {
            flexWrap:
              "wrap",
          },
        ]}
      >
        <View
          style={{
            flex: 1,
            minWidth: 140,
          }}
        >
          <Text
            style={
              styles.resultsCount
            }
          >
            {members.length} member
            {members.length !==
            1
              ? "s"
              : ""}
          </Text>

          <Text
            style={
              styles.resultsSubtext
            }
          >
            {
              approvedContributions.length
            }{" "}
            approved contribution
            {approvedContributions.length !==
            1
              ? "s"
              : ""}
          </Text>
        </View>

        <View
          style={
            styles.exportActions
          }
        >
          <TouchableOpacity
            style={
              styles.exportBtn
            }
            onPress={() =>
              onExportContributions(
                undefined,
                "excel"
              )
            }
            disabled={
              !approvedContributions.length
            }
            activeOpacity={0.8}
          >
            <Text
              style={
                styles.exportBtnText
              }
            >
              📈 Contributions
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.exportBtn
            }
            onPress={() =>
              onExport(
                "excel"
              )
            }
            disabled={
              !exportRows.length
            }
            activeOpacity={0.8}
          >
            <Text
              style={
                styles.exportBtnText
              }
            >
              📊 Members
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Card
        style={
          styles.card
        }
      >
        {members.length ===
        0 ? (
          <Empty
            message="No members found"
            icon="👥"
          />
        ) : (
          members.map(
            (
              m: any,
              i: number
            ) => (
              <TouchableOpacity
                key={m.id}
                onPress={() =>
                  setSelectedMember(
                    m
                  )
                }
                activeOpacity={
                  0.7
              }
              >
                <View
                  style={
                    styles.memberRow
                  }
                >
                  <View
                    style={
                      styles.memberAvatar
                    }
                  >
                    <Text
                      style={
                        styles.memberAvatarText
                      }
                    >
                      {m.fullName
                        .split(
                          " "
                        )
                        .map(
                          (
                            w: string
                          ) =>
                            w[0]
                        )
                        .join(
                          ""
                        )
                        .slice(
                          0,
                          2
                        )
                        .toUpperCase()}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.memberInfo
                    }
                  >
                    <Text
                      style={
                        styles.memberName
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {m.fullName}
                    </Text>

                    <Text
                      style={
                        styles.memberContact
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {m.phone ||
                        m.email ||
                        "No contact"}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.memberStats
                    }
                  >
                    <Text
                      style={
                        styles.memberAmount
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {fmtCurrency(
                        m.totalContributions ||
                          0
                      )}
                    </Text>

                    <Text
                      style={
                        styles.memberRole
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {m.role}
                    </Text>
                  </View>

                  <Text
                    style={
                      styles.chevron
                    }
                  >
                    ›
                  </Text>
                </View>

                {i <
                  members.length -
                    1 && (
                  <Divider />
                )}
              </TouchableOpacity>
            )
          )
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
  const totalContributions =
    contributions.reduce(
      (
        s: number,
        c: any
      ) =>
        s + c.amount,
      0
    );

  const loanBalance =
    loans
      .filter(
        (l: any) =>
          l.status ===
          "disbursed"
      )
      .reduce(
        (
          s: number,
          l: any
        ) =>
          s +
          (l.balance ||
            0),
        0
      );

  const interestFromLedger =
    wallet
      .filter(
        (t: any) =>
          t.type ===
            "loan_interest_income" &&
          t.amount > 0
      )
      .reduce(
        (
          s: number,
          t: any
        ) =>
          s + t.amount,
        0
      );

  const interestLegacy =
    wallet
      .filter(
        (t: any) =>
          t.type ===
            "loan_repayment" &&
          t.amount > 0
      )
      .reduce(
        (
          s: number,
          t: any
        ) => {
          const loan =
            loans.find(
              (l: any) =>
                l.id ===
                t.loanId
            );

          if (
            !loan?.totalRepayable
          ) {
            return s;
          }

          return (
            s +
            round2(
              t.amount *
                (loan.totalInterest /
                  loan.totalRepayable)
            )
          );
        },
        0
      );

  const interestEarned =
    round2(
      interestFromLedger +
        interestLegacy
    );

  const recentWallet =
    [...wallet]
      .sort(
        (
          a: any,
          b: any
        ) =>
          new Date(
            b.date ||
              b.createdAt
          ).getTime() -
          new Date(
            a.date ||
              a.createdAt
          ).getTime()
      )
      .slice(0, 8);

  const sortedContributions =
    [...contributions].sort(
      (
        a: any,
        b: any
      ) =>
        new Date(
          b.date
        ).getTime() -
        new Date(
          a.date
        ).getTime()
    );

  return (
    <View>
      {canGoBack && (
        <TouchableOpacity
          onPress={onBack}
          style={
            styles.backButton
          }
        >
          <Text
            style={
              styles.backButtonText
            }
          >
            ← Back to Directory
          </Text>
        </TouchableOpacity>
      )}

      {/* Member header */}

      <View
        style={
          styles.memberDetailCard
        }
      >
        <View
          style={
            styles.memberDetailHeader
          }
        >
          <View
            style={[
              styles.memberAvatar,
              {
                marginRight: 14,
              },
            ]}
          >
            <Text
              style={
                styles.memberAvatarText
              }
            >
              {member.fullName
                .split(" ")
                .map(
                  (
                    w: string
                  ) => w[0]
                )
                .join("")
                .slice(
                  0,
                  2
                )
                .toUpperCase()}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <Text
              style={
                styles.memberDetailName
              }
              numberOfLines={
                2
              }
            >
              {member.fullName}
            </Text>

            <Text
              style={
                styles.memberDetailRole
              }
              numberOfLines={
                1
              }
            >
              {member.role.replace(
                /_/g,
                " "
              )}{" "}
              · {member.status}
            </Text>
          </View>
        </View>

        <View
          style={
            styles.memberContactBlock
          }
        >
          {member.phone ? (
            <Text
              style={
                styles.memberDetailText
              }
            >
              📞 {member.phone}
            </Text>
          ) : null}

          {member.email ? (
            <Text
              style={
                styles.memberDetailText
              }
            >
              ✉️ {member.email}
            </Text>
          ) : null}

          <Text
            style={
              styles.memberDetailText
            }
          >
            📅 Joined{" "}
            {fmtDate(
              member.dateJoined
            )}
          </Text>
        </View>
      </View>

      {/* Member KPIs */}

      <View
        style={
          styles.memberKpiGrid
        }
      >
        <View
          style={
            styles.memberKpi
          }
        >
          <Text
            style={
              styles.memberKpiLabel
            }
          >
            Contributions
          </Text>

          <Text
            style={[
              styles.memberKpiValue,
              {
                color:
                  C.accent,
              },
            ]}
          >
            {fmtCurrency(
              totalContributions
            )}
          </Text>
        </View>

        <View
          style={
            styles.memberKpi
          }
        >
          <Text
            style={
              styles.memberKpiLabel
            }
          >
            Loan Balance
          </Text>

          <Text
            style={[
              styles.memberKpiValue,
              {
                color:
                  C.error,
              },
            ]}
          >
            {fmtCurrency(
              loanBalance
            )}
          </Text>
        </View>

        <View
          style={
            styles.memberKpi
          }
        >
          <Text
            style={
              styles.memberKpiLabel
            }
          >
            Interest Earned
          </Text>

          <Text
            style={[
              styles.memberKpiValue,
              {
                color:
                  C.gold,
              },
            ]}
          >
            {fmtCurrency(
              interestEarned
            )}
          </Text>
        </View>
      </View>

      {/* Contributions */}

      <View
        style={
          styles.sectionHeader
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
              styles.cardTitle
            }
          >
            Contributions
          </Text>

          <Text
            style={
              styles.sectionSubtext
            }
          >
            {
              contributions.length
            }{" "}
            approved contribution
            {contributions.length !==
            1
              ? "s"
              : ""}
          </Text>
        </View>

        <View
          style={
            styles.exportActions
          }
        >
          <TouchableOpacity
            style={
              styles.exportBtn
            }
            onPress={() =>
              onExportContributions(
                "excel"
              )
            }
            disabled={
              !contributions.length
            }
            activeOpacity={0.8}
          >
            <Text
              style={
                styles.exportBtnText
              }
            >
              📊 Excel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.exportBtn
            }
            onPress={() =>
              onExportContributions(
                "pdf"
              )
            }
            disabled={
              !contributions.length
            }
            activeOpacity={0.8}
          >
            <Text
              style={
                styles.exportBtnText
              }
            >
              🖨 PDF
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Card
        style={[
          styles.card,
          {
            marginBottom: 20,
          },
        ]}
      >
        {sortedContributions.length ===
        0 ? (
          <Text
            style={
              styles.emptyInline
            }
          >
            No contributions yet
          </Text>
        ) : (
          sortedContributions.map(
            (
              c: any,
              i: number
            ) => (
              <React.Fragment
                key={`${c.id}_${i}`}
              >
                <View
                  style={
                    styles.contributionRow
                  }
                >
                  <View
                    style={
                      styles.contributionIcon
                    }
                  >
                    <Text>
                      📈
                    </Text>
                  </View>

                  <View
                    style={
                      styles.contributionInfo
                    }
                  >
                    <Text
                      style={
                        styles.contributionType
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {c.contributionType ||
                        "Contribution"}
                    </Text>

                    <Text
                      style={
                        styles.contributionDate
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {fmtDate(
                        c.date
                      )}
                    </Text>

                    {c.description ? (
                      <Text
                        style={
                          styles.contributionDescription
                        }
                        numberOfLines={
                          1
                        }
                      >
                        {
                          c.description
                        }
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    style={
                      styles.contributionAmount
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {fmtCurrency(
                      c.amount
                    )}
                  </Text>
                </View>

                {i <
                  sortedContributions.length -
                    1 && (
                  <Divider />
                )}
              </React.Fragment>
            )
          )
        )}
      </Card>

      {/* Recent transactions */}

      <Text
        style={
          styles.cardTitle
        }
      >
        Recent Transactions
      </Text>

      <Card
        style={[
          styles.card,
          {
            marginTop: 10,
          },
        ]}
      >
        {recentWallet.length ===
        0 ? (
          <Text
            style={
              styles.emptyInline
            }
          >
            No transactions yet
          </Text>
        ) : (
          recentWallet.map(
            (
              w: any,
              i: number
            ) => (
              <React.Fragment
                key={`${w.id}_${i}`}
              >
                <View
                  style={
                    styles.transactionRow
                  }
                >
                  <View
                    style={[
                      styles.txDot,
                      {
                        backgroundColor:
                          w.amount >
                          0
                            ? C.greenBg
                            : C.redBg,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        color:
                          w.amount >
                          0
                            ? C.success
                            : C.error,
                      }}
                    >
                      {w.amount >
                      0
                        ? "↓"
                        : "↑"}
                    </Text>
                  </View>

                  <View
                    style={
                      styles.transactionInfo
                    }
                  >
                    <Text
                      style={
                        styles.transactionType
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {w.type.replace(
                        /_/g,
                        " "
                      )}
                    </Text>

                    <Text
                      style={
                        styles.transactionDate
                      }
                      numberOfLines={
                        1
                      }
                    >
                      {fmtDate(
                        w.date ||
                          w.createdAt
                      )}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.transactionAmount,
                      {
                        color:
                          w.amount >
                          0
                            ? C.success
                            : C.error,
                      },
                    ]}
                    numberOfLines={
                      1
                    }
                  >
                    {w.amount >
                    0
                      ? "+"
                      : ""}
                    {fmtCurrency(
                      w.amount
                    )}
                  </Text>
                </View>

                {i <
                  recentWallet.length -
                    1 && (
                  <Divider />
                )}
              </React.Fragment>
            )
          )
        )}
      </Card>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────

const Divider = () => (
  <View
    style={{
      height: 1,
      backgroundColor:
        C.borderLight,
      marginHorizontal: 16,
    }}
  />
);

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles =
  StyleSheet.create({
    page: {
      padding: 20,
    },

    contentContainer: {
      width: "100%",
    },

    contentContainerWide: {
      maxWidth: 1100,
      alignSelf: "center",
    },

    // ────────────────────────────────────────────────────────────────
    // KPI
    // ────────────────────────────────────────────────────────────────

    kpiGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 20,
      marginBottom: 16,
    },

    kpiCard: {
      flexBasis: "31%" as any,
      flexGrow: 1,
      minWidth: 0,
      backgroundColor:
        C.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor:
        C.border,
      borderTopWidth: 3,
      padding: 14,
    },

    kpiLabel: {
      fontSize: 10,
      fontWeight: "700",
      color: C.text3,
      letterSpacing: 0.8,
      textTransform:
        "uppercase",
      marginBottom: 6,
    },

    kpiValue: {
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: -0.3,
      marginBottom: 2,
    },

    kpiSubtext: {
      fontSize: 10,
      color: C.text3,
    },

    // ────────────────────────────────────────────────────────────────
    // Cards
    // ────────────────────────────────────────────────────────────────

    chartCard: {
      backgroundColor:
        C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        C.border,
      padding: 16,
      marginBottom: 16,
    },

    chartTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: C.text,
      marginBottom: 12,
    },

    card: {
      backgroundColor:
        C.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor:
        C.border,
      padding: 20,
    },

    cardTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: C.text,
    },

    // ────────────────────────────────────────────────────────────────
    // Financial position
    // ────────────────────────────────────────────────────────────────

    gfpRow: {
      flexDirection: "row",
    },

    gfpStat: {
      flex: 1,
      minWidth: 0,
      padding: 14,
      gap: 3,
    },

    gfpStatBorderRight: {
      borderRightWidth: 1,
      borderRightColor:
        C.border,
    },

    gfpStatBorderBottom: {
      borderBottomWidth: 1,
      borderBottomColor:
        C.border,
    },

    gfpStatValue: {
      fontSize: 16,
      fontWeight: "800",
      color: C.text,
      letterSpacing: -0.3,
    },

    gfpStatLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: C.text3,
    },

    // ────────────────────────────────────────────────────────────────
    // Scope
    // ────────────────────────────────────────────────────────────────

    scopeSection: {
      marginTop: 4,
      marginBottom: 12,
    },

    scopeLabel: {
      fontSize: 10,
      fontWeight: "800",
      color: C.text3,
      letterSpacing: 0.8,
      marginBottom: 6,
    },

    scopeToggle: {
      flexDirection: "row",
      alignSelf:
        "flex-start",
      backgroundColor:
        C.elevated,
      borderWidth: 1,
      borderColor:
        C.border,
      borderRadius: 12,
      padding: 3,
    },

    scopeOption: {
      minWidth: 110,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 9,
      alignItems: "center",
      justifyContent:
        "center",
    },

    scopeOptionActive: {
      backgroundColor:
        C.primary,
    },

    scopeOptionText: {
      fontSize: 13,
      fontWeight: "700",
      color: C.text2,
    },

    scopeOptionTextActive: {
      color: "#fff",
    },

    // ────────────────────────────────────────────────────────────────
    // Categories
    // ────────────────────────────────────────────────────────────────

    categoryScroller: {
      marginTop: 4,
      marginBottom: 14,
    },

    categoryContent: {
      flexDirection: "row",
      gap: 10,
      paddingRight: 10,
    },

    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor:
        C.border,
      backgroundColor:
        C.surface,
    },

    pillActive: {
      backgroundColor:
        "#2E7D6C",
      borderColor:
        "#2E7D6C",
    },

    pillIcon: {
      fontSize: 15,
    },

    pillLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: C.text2,
    },

    pillLabelActive: {
      color: "#fff",
    },

    // ────────────────────────────────────────────────────────────────
    // Filters
    // ────────────────────────────────────────────────────────────────

    filterArea: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 12,
    },

    filterAreaMobile: {
      flexDirection: "column",
      alignItems: "stretch",
    },

    filterDropdown: {
      width: 190,
    },

    filterDropdownMobile: {
      width: "100%",
    },

    filterBtn: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent:
        "center",
      backgroundColor:
        C.elevated,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor:
        C.border,
      gap: 6,
    },

    filterBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: C.text2,
    },

    filterDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor:
        C.accent,
    },

    clearBtn: {
      minHeight: 46,
      justifyContent:
        "center",
      paddingHorizontal: 6,
    },

    clearBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: C.error,
    },

    searchIndicator: {
      fontSize: 12,
      color: C.primary,
      marginBottom: 16,
    },

    // ────────────────────────────────────────────────────────────────
    // Dropdown
    // ────────────────────────────────────────────────────────────────

    dropdownTrigger: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor:
        C.surface,
      borderWidth: 1,
      borderColor:
        C.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },

    dropdownLabel: {
      fontSize: 9,
      fontWeight: "700",
      color: C.text3,
      textTransform:
        "uppercase",
      letterSpacing: 0.5,
      marginBottom: 1,
    },

    dropdownValue: {
      fontSize: 13,
      fontWeight: "600",
      color: C.text,
    },

    dropdownChevron: {
      fontSize: 9,
      color: C.text3,
      marginLeft: 8,
    },

    dropdownOverlay: {
      flex: 1,
      backgroundColor:
        "rgba(0,0,0,0.35)",
      justifyContent:
        "center",
      alignItems: "center",
      padding: 20,
    },

    dropdownModal: {
      width: "100%",
      maxWidth: 440,
      backgroundColor:
        C.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor:
        C.border,
      overflow: "hidden",

      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: 8,
      },
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
      borderBottomColor:
        C.borderLight,
    },

    dropdownModalTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: C.text,
    },

    dropdownModalSubtitle: {
      fontSize: 11,
      color: C.text3,
      marginTop: 2,
    },

    dropdownClose: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent:
        "center",
      backgroundColor:
        C.elevated,
    },

    dropdownCloseText: {
      fontSize: 13,
      color: C.text3,
    },

    dropdownItem: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 52,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor:
        C.borderLight,
    },

    dropdownItemActive: {
      backgroundColor:
        C.pill,
    },

    dropdownRadio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor:
        C.border,
      alignItems: "center",
      justifyContent:
        "center",
      marginRight: 12,
    },

    dropdownRadioActive: {
      borderColor:
        C.primary,
    },

    dropdownRadioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor:
        C.primary,
    },

    dropdownItemText: {
      flex: 1,
      fontSize: 14,
      color: C.text2,
    },

    dropdownItemTextActive: {
      color: C.primary,
      fontWeight: "700",
    },

    // ────────────────────────────────────────────────────────────────
    // Reports
    // ────────────────────────────────────────────────────────────────

    reportColumns: {
      flexDirection: "column",
      gap: 16,
    },

    reportColumnsWide: {
      flexDirection: "row",
    },

    reportColumn: {
      flex: 1,
      minWidth: 0,
    },

    kpiMiniRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 20,
      marginTop: 10,
      marginBottom: 16,
    },

    kpiMini: {
      minWidth: 100,
      maxWidth: 180,
    },

    kpiMiniLabel: {
      fontSize: 10,
      color: C.text3,
      fontWeight: "700",
      textTransform:
        "uppercase",
      marginBottom: 3,
    },

    kpiMiniValue: {
      fontSize: 18,
      fontWeight: "800",
      color: C.text,
    },

    noData: {
      color: C.text3,
      fontSize: 13,
      paddingVertical: 30,
      textAlign: "center",
    },

    // ────────────────────────────────────────────────────────────────
    // Preview
    // ────────────────────────────────────────────────────────────────

    previewHeader: {
      flexDirection: "row",
      justifyContent:
        "space-between",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },

    exportActions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
      justifyContent:
        "flex-end",
    },

    exportBtn: {
      minHeight: 38,
      flexDirection: "row",
      alignItems: "center",
      justifyContent:
        "center",
      borderWidth: 1,
      borderColor:
        C.border,
      backgroundColor:
        C.elevated,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
    },

    exportBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: C.text2,
    },

    previewRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor:
        C.borderLight,
    },

    previewHeadCell: {
      fontSize: 10,
      fontWeight: "800",
      color: C.text3,
      textTransform:
        "uppercase",
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

    previewCount: {
      fontSize: 11,
      color: C.text3,
      marginTop: 10,
    },

    resultsCount: {
      fontSize: 12,
      color: C.text3,
    },

    resultsSubtext: {
      fontSize: 11,
      color: C.text3,
      marginTop: 3,
    },

    // ────────────────────────────────────────────────────────────────
    // Members
    // ────────────────────────────────────────────────────────────────

    memberRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 12,
    },

    memberAvatar: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor:
        C.pill,
      alignItems: "center",
      justifyContent:
        "center",
    },

    memberAvatarText: {
      fontSize: 14,
      fontWeight: "800",
      color: C.primary,
    },

    memberInfo: {
      flex: 1,
      minWidth: 0,
    },

    memberName: {
      fontSize: 14,
      fontWeight: "700",
      color: C.text,
    },

    memberContact: {
      fontSize: 11,
      color: C.text3,
      marginTop: 2,
    },

    memberStats: {
      alignItems:
        "flex-end",
      flexShrink: 0,
      maxWidth: 130,
    },

    memberAmount: {
      fontSize: 13,
      fontWeight: "700",
      color: C.primary,
    },

    memberRole: {
      fontSize: 10,
      color: C.text3,
      textTransform:
        "capitalize",
      marginTop: 2,
    },

    chevron: {
      fontSize: 20,
      color: C.text3,
      flexShrink: 0,
    },

    // ────────────────────────────────────────────────────────────────
    // Member detail
    // ────────────────────────────────────────────────────────────────

    backButton: {
      marginBottom: 16,
      alignSelf:
        "flex-start",
    },

    backButtonText: {
      color: C.primary,
      fontSize: 14,
      fontWeight: "600",
    },

    memberDetailCard: {
      backgroundColor:
        C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        C.border,
      padding: 16,
      marginBottom: 16,
    },

    memberDetailHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },

    memberDetailName: {
      fontSize: 20,
      fontWeight: "800",
      color: C.text,
      marginBottom: 4,
    },

    memberDetailRole: {
      fontSize: 13,
      color: C.text3,
    },

    memberContactBlock: {
      alignItems: "center",
      gap: 4,
    },

    memberDetailText: {
      fontSize: 12,
      color: C.text2,
    },

    memberKpiGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 20,
      marginBottom: 18,
    },

    memberKpi: {
      flex: 1,
      minWidth: 120,
    },

    memberKpiLabel: {
      fontSize: 10,
      color: C.text3,
      fontWeight: "700",
      textTransform:
        "uppercase",
      marginBottom: 3,
    },

    memberKpiValue: {
      fontSize: 18,
      fontWeight: "800",
    },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent:
        "space-between",
      gap: 12,
      marginBottom: 10,
    },

    sectionSubtext: {
      fontSize: 11,
      color: C.text3,
      marginTop: 3,
    },

    emptyInline: {
      textAlign: "center",
      paddingVertical: 20,
      color: C.text3,
      fontSize: 13,
    },

    contributionRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 12,
    },

    contributionIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor:
        C.pill,
      alignItems: "center",
      justifyContent:
        "center",
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
      flexShrink: 0,
    },

    transactionRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
      gap: 12,
    },

    txDot: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent:
        "center",
    },

    transactionInfo: {
      flex: 1,
      minWidth: 0,
    },

    transactionType: {
      fontSize: 13,
      fontWeight: "600",
      color: C.text,
    },

    transactionDate: {
      fontSize: 11,
      color: C.text3,
      marginTop: 2,
    },

    transactionAmount: {
      fontSize: 13,
      fontWeight: "700",
      marginLeft: 8,
      flexShrink: 0,
    },

    // ────────────────────────────────────────────────────────────────
    // Advanced modal
    // ────────────────────────────────────────────────────────────────

    modalSectionLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: C.text,
      marginTop: 12,
      marginBottom: 8,
    },

    modalRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 10,
    },

    modalHalf: {
      flex: 1,
      minWidth: 0,
    },

    modalButtonRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 20,
    },

    modalClearBtn: {
      flex: 1,
      backgroundColor:
        C.surface,
      borderWidth: 1,
      borderColor:
        C.border,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },

    modalClearBtnText: {
      fontSize: 14,
      fontWeight: "600",
      color: C.text2,
    },

    modalApplyBtn: {
      flex: 2,
      backgroundColor:
        C.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },

    modalApplyBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: "#fff",
    },
  });