// app/(tabs)/reports.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Platform, StatusBar,
} from "react-native";
import { BarChart, PieChart } from "react-native-chart-kit";
import { useRouter } from "expo-router";
import {
  useStore,
  useActiveGroup, useGroupMembers, useGroupLoans,
  useGroupContributions, useGroupInvestments, useGroupWallet,
  useCurrentUserRole, useCurrentMember,
} from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";
import { Card, Badge, Empty, useToast, Input, BottomModal } from "../../components/ui";
import { Colors, C, T, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";
import { exportCsv, exportPdf } from "../../utils/export";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CHART_WIDTH = SCREEN_WIDTH - 32;

// ─── Tiny components ──────────────────────────────────────────────
const Chip = ({ label, bg, color }: { label: string; bg: string; color: string }) => (
  <View style={[styles.chip, { backgroundColor: bg }]}>
    <Text style={[styles.chipText, { color }]}>{label}</Text>
  </View>
);

const SectionHeader = ({
  title, action, actionLabel,
}: { title: string; action?: () => void; actionLabel?: string }) => (
  <View style={styles.sectionHeader}>
    <Text style={T.h2}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={action} activeOpacity={0.7}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: C.primary }}>{actionLabel ?? "See all"}</Text>
      </TouchableOpacity>
    )}
  </View>
);

const KpiCard = ({ label, value, color, subtext }: { label: string; value: string; color: string; subtext?: string }) => (
  <View style={[styles.kpiCard, { borderTopColor: color }]}>
    <Text style={styles.kpiLabel}>{label}</Text>
    <Text style={[styles.kpiValue, { color }]}>{value}</Text>
    {subtext && <Text style={styles.kpiSubtext}>{subtext}</Text>}
  </View>
);

// Filter Modal Component
function FilterModal({
  visible,
  onClose,
  year, month, day,
  onYearChange, onMonthChange, onDayChange,
  loanStatus, contributionStatus,
  onLoanStatusChange, onContributionStatusChange,
  onApply,
  searchTerm,
  onSearchChange,
}: any) {
  const yearOptions = [{ label: "All Years", value: 0 }, ...Array.from({ length: 6 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return { label: String(y), value: y };
  })];
  const monthOptions = [{ label: "All Months", value: 0 },
    { label: "Jan", value: 1 }, { label: "Feb", value: 2 }, { label: "Mar", value: 3 },
    { label: "Apr", value: 4 }, { label: "May", value: 5 }, { label: "Jun", value: 6 },
    { label: "Jul", value: 7 }, { label: "Aug", value: 8 }, { label: "Sep", value: 9 },
    { label: "Oct", value: 10 }, { label: "Nov", value: 11 }, { label: "Dec", value: 12 }
  ];
  const dayOptions = [{ label: "All Days", value: 0 }, ...Array.from({ length: 31 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))];

  return (
    <BottomModal visible={visible} onClose={onClose} title="Filter Reports">
      <View style={{ padding: 16 }}>
        <Input
          label="Search"
          value={searchTerm}
          onChangeText={onSearchChange}
          placeholder="Search by member, loan ID..."
          leftIcon="🔍"
        />
        
        <Text style={styles.modalSectionLabel}>Date Range</Text>
        <View style={styles.modalRow}>
          <View style={styles.modalHalf}>
            <Text style={styles.modalSelectLabel}>Year</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {yearOptions.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.modalChip, (year === opt.value || (year === null && opt.value === 0)) && styles.modalChipActive]}
                  onPress={() => onYearChange(opt.value === 0 ? null : opt.value)}
                >
                  <Text style={[styles.modalChipText, (year === opt.value || (year === null && opt.value === 0)) && styles.modalChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={styles.modalRow}>
          <View style={styles.modalHalf}>
            <Text style={styles.modalSelectLabel}>Month</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {monthOptions.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.modalChip, (month === opt.value || (month === null && opt.value === 0)) && styles.modalChipActive]}
                  onPress={() => onMonthChange(opt.value === 0 ? null : opt.value)}
                >
                  <Text style={[styles.modalChipText, (month === opt.value || (month === null && opt.value === 0)) && styles.modalChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalHalf}>
            <Text style={styles.modalSelectLabel}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {dayOptions.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.modalChip, (day === opt.value || (day === null && opt.value === 0)) && styles.modalChipActive]}
                  onPress={() => onDayChange(opt.value === 0 ? null : opt.value)}
                >
                  <Text style={[styles.modalChipText, (day === opt.value || (day === null && opt.value === 0)) && styles.modalChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <Text style={styles.modalSectionLabel}>Status Filters</Text>
        <View style={styles.modalRow}>
          <View style={styles.modalHalf}>
            <Text style={styles.modalSelectLabel}>Loans</Text>
            {["all", "pending", "active", "repaid"].map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.modalChip, loanStatus === status && styles.modalChipActive]}
                onPress={() => onLoanStatusChange(status)}
              >
                <Text style={[styles.modalChipText, loanStatus === status && styles.modalChipTextActive]}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.modalHalf}>
            <Text style={styles.modalSelectLabel}>Contributions</Text>
            {["all", "approved", "pending", "rejected"].map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.modalChip, contributionStatus === status && styles.modalChipActive]}
                onPress={() => onContributionStatusChange(status)}
              >
                <Text style={[styles.modalChipText, contributionStatus === status && styles.modalChipTextActive]}>
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
          <TouchableOpacity style={styles.modalClearBtn} onPress={() => {
            onYearChange(null);
            onMonthChange(null);
            onDayChange(null);
            onLoanStatusChange("all");
            onContributionStatusChange("all");
            onSearchChange("");
          }}>
            <Text style={styles.modalClearBtnText}>Clear All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalApplyBtn} onPress={onApply}>
            <Text style={styles.modalApplyBtnText}>Apply Filters</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomModal>
  );
}

const chartConfig = {
  backgroundColor: C.surface,
  backgroundGradientFrom: C.surface,
  backgroundGradientTo: C.surface,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(13,148,136,${opacity})`,
  labelColor: () => C.text3,
  style: { borderRadius: 12 },
  propsForBackgroundLines: { stroke: C.border },
};

export default function ReportsScreen() {
  const router = useRouter();
  const group = useActiveGroup();
  const allMembers = useGroupMembers();
  const allLoans = useGroupLoans();
  const allContributions = useGroupContributions();
  const allInvestments = useGroupInvestments();
  const allWallet = useGroupWallet();
  const role = useCurrentUserRole();
  const permissions = useCurrentMemberPermissions();
  const currentMember = useCurrentMember();
  const { show, Toast } = useToast();

  const canSeeAll = ["admin", "loan_officer", "committee", "accountant"].includes(role);
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "loans">("overview");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [loanStatus, setLoanStatus] = useState<"all" | "pending" | "active" | "repaid">("all");
  const [contributionStatus, setContributionStatus] = useState<"all" | "approved" | "pending" | "rejected">("all");
  
  // Temp state for modal
  const [tempSearch, setTempSearch] = useState("");
  const [tempYear, setTempYear] = useState<number | null>(null);
  const [tempMonth, setTempMonth] = useState<number | null>(null);
  const [tempDay, setTempDay] = useState<number | null>(null);
  const [tempLoanStatus, setTempLoanStatus] = useState<"all" | "pending" | "active" | "repaid">("all");
  const [tempContributionStatus, setTempContributionStatus] = useState<"all" | "approved" | "pending" | "rejected">("all");

  // Scope data
  const members = canSeeAll ? allMembers : allMembers.filter(m => m.id === currentMember?.id);
  const loans = canSeeAll ? allLoans : allLoans.filter(l => l.memberId === currentMember?.id);
  const contributions = canSeeAll ? allContributions : allContributions.filter(c => c.memberId === currentMember?.id);
  const investments = allInvestments;
  const wallet = canSeeAll ? allWallet : allWallet.filter(t => t.memberId === currentMember?.id);

  // Filter helpers
  const filterByDate = (items: any[], dateField: string) => {
    return items.filter(item => {
      if (!selectedYear && !selectedMonth && !selectedDay) return true;
      const date = new Date(item[dateField]);
      if (isNaN(date.getTime())) return true;
      if (selectedYear && date.getFullYear() !== selectedYear) return false;
      if (selectedMonth && (date.getMonth() + 1) !== selectedMonth) return false;
      if (selectedDay && date.getDate() !== selectedDay) return false;
      return true;
    });
  };

  const filterBySearch = (items: any[], searchFields: string[]) => {
    if (!searchTerm) return items;
    const term = searchTerm.toLowerCase();
    return items.filter(item => 
      searchFields.some(field => item[field]?.toString().toLowerCase().includes(term))
    );
  };

  const filteredLoans = useMemo(() => {
    let list = filterByDate(loans, "applicationDate");
    if (loanStatus !== "all") {
      if (loanStatus === "active") list = list.filter(l => l.status === "disbursed");
      if (loanStatus === "pending") list = list.filter(l => l.status.startsWith("pending_"));
      if (loanStatus === "repaid") list = list.filter(l => l.status === "repaid");
    }
    return filterBySearch(list, ["memberId", "id", "purpose"]);
  }, [loans, selectedYear, selectedMonth, selectedDay, loanStatus, searchTerm]);

  const filteredContributions = useMemo(() => {
    let list = filterByDate(contributions, "date");
    if (contributionStatus !== "all") {
      list = list.filter(c => c.status === contributionStatus);
    }
    return filterBySearch(list, ["memberId", "description"]);
  }, [contributions, selectedYear, selectedMonth, selectedDay, contributionStatus, searchTerm]);

  const filteredInvestments = useMemo(() => 
    filterByDate(investments, "startDate"),
    [investments, selectedYear, selectedMonth, selectedDay]
  );

  const cashflow = useMemo(() => {
    const months: string[] = [];
    const income: number[] = [];
    const expenses: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthTxs = wallet.filter(t => {
        const txDate = new Date(t.date);
        return txDate >= startOfMonth && txDate <= endOfMonth;
      });
      months.push(d.toLocaleDateString("en", { month: "short" }));
      income.push(monthTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0));
      expenses.push(Math.abs(monthTxs.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)));
    }
    return { months, income, expenses };
  }, [wallet]);

  const memberPie = useMemo(() => {
    const top = allMembers.filter(m => m.status === "active" && m.totalContributions > 0).slice(0, 5);
    const palette = [C.accent, C.gold, C.info, C.success, "#7C3AED"];
    return top.map((m, i) => ({
      name: m.fullName.split(" ")[0],
      population: m.totalContributions,
      color: palette[i % palette.length],
      legendFontColor: C.text2,
      legendFontSize: 11,
    }));
  }, [allMembers]);

  const totalInterest = useMemo(() =>
    loans.reduce((s, l) => s + Math.max(0, l.amountRepaid - l.amount), 0), [loans]
  );
  const totalExpenses = useMemo(() =>
    wallet.filter(t => ["bank_fee", "other_debit"].includes(t.type)).reduce((s, t) => s + Math.abs(t.amount), 0), [wallet]
  );

  const loansTotal = useMemo(() => filteredLoans.reduce((s, l) => s + l.amount, 0), [filteredLoans]);
  const contributionsTotal = useMemo(() => filteredContributions.reduce((s, c) => s + c.amount, 0), [filteredContributions]);
  const investmentsTotal = useMemo(() => filteredInvestments.reduce((s, i) => s + i.investmentAmount, 0), [filteredInvestments]);

  const hasActiveFilters = selectedYear || selectedMonth || selectedDay || loanStatus !== "all" || contributionStatus !== "all" || searchTerm;

  const openFilterModal = () => {
    setTempSearch(searchTerm);
    setTempYear(selectedYear);
    setTempMonth(selectedMonth);
    setTempDay(selectedDay);
    setTempLoanStatus(loanStatus);
    setTempContributionStatus(contributionStatus);
    setShowFilterModal(true);
  };

  const applyFilters = () => {
    setSearchTerm(tempSearch);
    setSelectedYear(tempYear);
    setSelectedMonth(tempMonth);
    setSelectedDay(tempDay);
    setLoanStatus(tempLoanStatus);
    setContributionStatus(tempContributionStatus);
    setShowFilterModal(false);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedDay(null);
    setLoanStatus("all");
    setContributionStatus("all");
    setTempSearch("");
    setTempYear(null);
    setTempMonth(null);
    setTempDay(null);
    setTempLoanStatus("all");
    setTempContributionStatus("all");
  };

  const exportData = async (type: "loans" | "contributions" | "investments", format: "csv" | "pdf") => {
    if (type === "loans") {
      const headers = ["Loan ID", "Member", "Status", "Principal", "Repaid", "Balance", "Application Date", "Disbursement Date"];
      const rows = filteredLoans.map(loan => [
        loan.id,
        allMembers.find(m => m.id === loan.memberId)?.fullName ?? "Unknown",
        loan.status, fmtCurrency(loan.amount), fmtCurrency(loan.amountRepaid), fmtCurrency(loan.balance),
        fmtDate(loan.applicationDate), loan.disbursementDate ? fmtDate(loan.disbursementDate) : "",
      ]);
      if (format === "csv") await exportCsv(`Loans_Report`, headers, rows);
      else await exportPdf(`Loans_Report`, "Loans Report", generateHtmlTable(headers, rows));
    } else if (type === "contributions") {
      const headers = ["Contribution ID", "Member", "Amount", "Type", "Status", "Date", "Description"];
      const rows = filteredContributions.map(contribution => [
        contribution.id,
        allMembers.find(m => m.id === contribution.memberId)?.fullName ?? "Unknown",
        fmtCurrency(contribution.amount), contribution.contributionType, contribution.status,
        fmtDate(contribution.date), contribution.description ?? "",
      ]);
      if (format === "csv") await exportCsv(`Contributions_Report`, headers, rows);
      else await exportPdf(`Contributions_Report`, "Contributions Report", generateHtmlTable(headers, rows));
    } else {
      const headers = ["Investment ID", "Name", "Amount", "Expected Return", "Status", "Start Date", "Maturity Date"];
      const rows = filteredInvestments.map(investment => [
        investment.id, investment.investmentName, fmtCurrency(investment.investmentAmount),
        fmtCurrency(investment.expectedReturn), investment.status, fmtDate(investment.startDate), investment.maturityDate ? fmtDate(investment.maturityDate) : "",
      ]);
      if (format === "csv") await exportCsv(`Investments_Report`, headers, rows);
      else await exportPdf(`Investments_Report`, "Investments Report", generateHtmlTable(headers, rows));
    }
    show(`Exported ${type} report as ${format.toUpperCase()}`);
  };

  const generateHtmlTable = (headers: string[], rows: any[][]) => {
    return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };

  const TABS = canSeeAll ? ["overview", "members", "loans"] as const : ["overview", "loans"] as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>Analytics & Insights</Text>
          <Text style={styles.headerTitle}>Reports</Text>
        </View>
        <TouchableOpacity style={styles.filterBtn} onPress={openFilterModal} activeOpacity={0.8}>
          <Text style={styles.filterBtnText}>{hasActiveFilters ? "🎯 Filter" : "🔍 Filter"}</Text>
          {hasActiveFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {/* Active Filters Bar */}
      {hasActiveFilters && (
        <TouchableOpacity style={styles.activeFiltersBar} onPress={openFilterModal}>
          <Text style={styles.activeFiltersText}>
            {searchTerm && `🔍 "${searchTerm}" `}
            {selectedYear && `📅 ${selectedYear} `}
            {selectedMonth && `📆 ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][selectedMonth-1]} `}
            {selectedDay && `📌 ${selectedDay} `}
            {loanStatus !== "all" && `🏦 ${loanStatus} loans `}
            {contributionStatus !== "all" && `💰 ${contributionStatus} contributions`}
          </Text>
          <TouchableOpacity onPress={clearFilters}>
            <Text style={styles.clearFiltersText}>Clear</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <View style={styles.content}>
            {/* KPI Row */}
            <View style={styles.kpiGrid}>
              <KpiCard 
                label={canSeeAll ? "TOTAL CONTRIBUTIONS" : "MY CONTRIBUTIONS"} 
                value={fmtCurrency(canSeeAll ? (group?.totalSavings ?? 0) : (currentMember?.totalContributions ?? 0))} 
                color={C.accent}
                subtext={canSeeAll ? "group savings" : "personal savings"}
              />
              <KpiCard label="INTEREST EARNED" value={fmtCurrency(totalInterest)} color={C.gold} subtext="from loans" />
              {canSeeAll && (
                <>
                  <KpiCard label="INVESTMENTS" value={fmtCurrency(group?.totalInvestments ?? 0)} color={C.success} subtext="active" />
                  <KpiCard label="EXPENSES" value={fmtCurrency(totalExpenses)} color={C.error} subtext="operational" />
                </>
              )}
            </View>

            {/* Cash Flow Chart */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Cash Flow (Last 6 Months)</Text>
              {cashflow.months.length > 0 && (
                <BarChart
                  data={{
                    labels: cashflow.months,
                    datasets: [
                      { data: cashflow.income, color: () => C.success, label: "Income" },
                      { data: cashflow.expenses, color: () => C.error, label: "Expenses" },
                    ],
                  }}
                  width={CHART_WIDTH}
                  height={200}
                  chartConfig={chartConfig}
                  yAxisLabel=""
                  yAxisSuffix=""
                  style={{ borderRadius: 12, marginTop: 8 }}
                  showValuesOnTopOfBars={false}
                  fromZero
                />
              )}
              <View style={styles.chartLegend}>
                <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.success }]} /><Text style={styles.legendText}>Income</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: C.error }]} /><Text style={styles.legendText}>Expenses</Text></View>
              </View>
            </View>

            {/* Savings by Member - Admin only */}
            {canSeeAll && memberPie.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Savings by Member (Top 5)</Text>
                <PieChart
                  data={memberPie}
                  width={CHART_WIDTH}
                  height={180}
                  chartConfig={chartConfig}
                  accessor="population"
                  backgroundColor="transparent"
                  paddingLeft="15"
                  absolute
                />
              </View>
            )}

            {/* Export Section - gated by downloadReports permission */}
            {canSeeAll && permissions.downloadReports && (
              <View style={styles.exportSection}>
                <Text style={styles.exportTitle}>Export Data</Text>
                <Text style={styles.exportSubtitle}>Filtered data based on your current filters</Text>
                <View style={styles.exportGrid}>
                  <View style={styles.exportCard}>
                    <Text style={styles.exportCardTitle}>Loans</Text>
                    <Text style={styles.exportCardValue}>{fmtCurrency(loansTotal)}</Text>
                    <Text style={styles.exportCardMeta}>{filteredLoans.length} records</Text>
                    <View style={styles.exportButtons}>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.primary }]} onPress={() => exportData("loans", "csv")}>
                        <Text style={styles.exportBtnText}>CSV</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.redText }]} onPress={() => exportData("loans", "pdf")}>
                        <Text style={styles.exportBtnText}>PDF</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.exportCard}>
                    <Text style={styles.exportCardTitle}>Contributions</Text>
                    <Text style={styles.exportCardValue}>{fmtCurrency(contributionsTotal)}</Text>
                    <Text style={styles.exportCardMeta}>{filteredContributions.length} records</Text>
                    <View style={styles.exportButtons}>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.primary }]} onPress={() => exportData("contributions", "csv")}>
                        <Text style={styles.exportBtnText}>CSV</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.redText }]} onPress={() => exportData("contributions", "pdf")}>
                        <Text style={styles.exportBtnText}>PDF</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.exportCard}>
                    <Text style={styles.exportCardTitle}>Investments</Text>
                    <Text style={styles.exportCardValue}>{fmtCurrency(investmentsTotal)}</Text>
                    <Text style={styles.exportCardMeta}>{filteredInvestments.length} records</Text>
                    <View style={styles.exportButtons}>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.primary }]} onPress={() => exportData("investments", "csv")}>
                        <Text style={styles.exportBtnText}>CSV</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.exportBtn, { backgroundColor: C.redText }]} onPress={() => exportData("investments", "pdf")}>
                        <Text style={styles.exportBtnText}>PDF</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Members Tab */}
        {activeTab === "members" && canSeeAll && (
          <MembersTab 
            members={allMembers} 
            contributions={allContributions} 
            loans={allLoans} 
            investments={allInvestments} 
            wallet={allWallet} 
          />
        )}

        {/* Loans Tab */}
        {activeTab === "loans" && (
          <LoansTab 
            loans={loans} 
            members={allMembers} 
            canSeeAll={canSeeAll} 
            onViewLoan={(loanId) => router.push(`/(tabs)/loans`)}
          />
        )}
      </ScrollView>

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        year={tempYear}
        month={tempMonth}
        day={tempDay}
        onYearChange={setTempYear}
        onMonthChange={setTempMonth}
        onDayChange={setTempDay}
        loanStatus={tempLoanStatus}
        contributionStatus={tempContributionStatus}
        onLoanStatusChange={setTempLoanStatus}
        onContributionStatusChange={setTempContributionStatus}
        onApply={applyFilters}
        searchTerm={tempSearch}
        onSearchChange={setTempSearch}
      />

      <Toast />
    </View>
  );
}

// Members Tab Component
function MembersTab({ members, contributions, loans, wallet }: any) {
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const filteredMembers = members.filter((m: any) =>
    m.fullName.toLowerCase().includes(search.toLowerCase()) ||
    m.phone?.includes(search) ||
    m.email?.toLowerCase().includes(search.toLowerCase())
  ).sort((a: any, b: any) => b.totalContributions - a.totalContributions);

  const memberLoans = loans.filter((l: any) => l.memberId === selectedMember?.id);
  const memberContributions = contributions.filter((c: any) => c.memberId === selectedMember?.id && c.status === "approved");
  const memberWallet = wallet.filter((w: any) => w.memberId === selectedMember?.id);
  
  const totalPaid = memberContributions.reduce((s: number, c: any) => s + c.amount, 0);
  const loanBalance = memberLoans.filter((l: any) => l.status === "disbursed").reduce((s: number, l: any) => s + l.balance, 0);

  if (selectedMember) {
    return (
      <View style={styles.content}>
        <TouchableOpacity onPress={() => setSelectedMember(null)} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back to Directory</Text>
        </TouchableOpacity>
        
        <View style={styles.memberDetailCard}>
          <Text style={styles.memberDetailName}>{selectedMember.fullName}</Text>
          <Text style={styles.memberDetailRole}>{selectedMember.role} • {selectedMember.status}</Text>
          <View style={styles.memberDetailInfo}>
            <Text style={styles.memberDetailText}>📞 {selectedMember.phone || "N/A"}</Text>
            <Text style={styles.memberDetailText}>✉️ {selectedMember.email || "N/A"}</Text>
            <Text style={styles.memberDetailText}>📅 Joined {fmtDate(selectedMember.dateJoined)}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <KpiCard label="Total Contributions" value={fmtCurrency(totalPaid)} color={C.accent} />
          <KpiCard label="Loan Balance" value={fmtCurrency(loanBalance)} color={C.error} />
        </View>

        <SectionHeader title="Recent Activity" />
        <Card style={styles.card}>
          {memberWallet.slice(0, 5).map((w: any, i: number) => (
            <React.Fragment key={w.id}>
              <View style={styles.txRow}>
                <View style={[styles.txDot, { backgroundColor: w.amount > 0 ? C.greenBg : C.redBg }]}>
                  <Text style={{ fontSize: 13, color: w.amount > 0 ? C.success : C.error }}>{w.amount > 0 ? "↓" : "↑"}</Text>
                </View>
                <View style={styles.txMid}>
                  <Text style={styles.txDesc}>{w.type.replace(/_/g, " ").toUpperCase()}</Text>
                  <Text style={T.small}>{fmtDate(w.date || w.createdAt)}</Text>
                </View>
                <Text style={[styles.txAmount, { color: w.amount > 0 ? C.success : C.error }]}>
                  {w.amount > 0 ? "+" : "-"}{fmtCurrency(Math.abs(w.amount))}
                </Text>
              </View>
              {i < Math.min(memberWallet.length, 5) - 1 && <Divider />}
            </React.Fragment>
          ))}
          {memberWallet.length === 0 && <Text style={styles.emptyText}>No transactions yet</Text>}
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Input
        placeholder="Search members by name, phone, email..."
        value={search}
        onChangeText={setSearch}
        leftIcon="🔍"
      />
      <Text style={styles.resultsCount}>{filteredMembers.length} members found</Text>
      <Card>
        {filteredMembers.length === 0 ? (
          <Empty message="No members found" icon="👥" />
        ) : (
          filteredMembers.map((m: any, i: number) => (
            <TouchableOpacity key={m.id} onPress={() => setSelectedMember(m)}>
              <View style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {m.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{m.fullName}</Text>
                  <Text style={styles.memberContact}>{m.phone || m.email || "No contact"}</Text>
                </View>
                <View style={styles.memberStats}>
                  <Text style={styles.memberAmount}>{fmtCurrency(m.totalContributions)}</Text>
                  <Text style={styles.memberRole}>{m.role}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
              {i < filteredMembers.length - 1 && <Divider />}
            </TouchableOpacity>
          ))
        )}
      </Card>
    </View>
  );
}

// Loans Tab Component
function LoansTab({ loans, members, canSeeAll, onViewLoan }: any) {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "repaid" | "pending">("all");
  
  const filtered = loans.filter((l: any) => {
    if (statusFilter === "active") return l.status === "disbursed";
    if (statusFilter === "repaid") return l.status === "repaid";
    if (statusFilter === "pending") return l.status.startsWith("pending_");
    return true;
  });

  const getMember = (id: string) => members.find((m: any) => m.id === id);
  const totalOutstanding = loans.filter((l: any) => l.status === "disbursed").reduce((s: number, l: any) => s + l.balance, 0);
  const totalInterest = loans.reduce((s: number, l: any) => s + Math.max(0, l.amountRepaid - l.amount), 0);

  return (
    <View style={styles.content}>
      <View style={styles.statsGrid}>
        <KpiCard label="Outstanding" value={fmtCurrency(totalOutstanding)} color={C.error} />
        <KpiCard label="Interest Earned" value={fmtCurrency(totalInterest)} color={C.gold} />
      </View>

      <View style={styles.filterChips}>
        {["all", "pending", "active", "repaid"].map(status => (
          <TouchableOpacity
            key={status}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status as any)}
          >
            <Text style={[styles.filterChipText, statusFilter === status && styles.filterChipTextActive]}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.resultsCount}>{filtered.length} loans found</Text>

      {filtered.length === 0 ? (
        <Empty message="No loans found" icon="📋" />
      ) : (
        filtered.map((loan: any) => {
          const member = getMember(loan.memberId);
          const pct = loan.totalRepayable > 0 ? round2((loan.amountRepaid / loan.totalRepayable) * 100) : 0;
          const isPending = loan.status.startsWith("pending_");
          
          return (
            <TouchableOpacity key={loan.id} onPress={() => onViewLoan?.(loan.id)}>
              <Card style={styles.loanItem}>
                <View style={styles.loanItemHeader}>
                  <View style={styles.loanItemAvatar}>
                    <Text style={styles.loanItemAvatarText}>
                      {member?.fullName?.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "??"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.loanItemMember}>{member?.fullName || "Unknown"}</Text>
                    <Text style={styles.loanItemDate}>{fmtDate(loan.applicationDate)}</Text>
                  </View>
                  <Chip 
                    label={isPending ? "Pending" : (loan.status === "disbursed" ? "Active" : loan.status)} 
                    bg={isPending ? C.goldBg : (loan.status === "disbursed" ? C.tealBg : C.greenBg)}
                    color={isPending ? C.gold : (loan.status === "disbursed" ? C.teal : C.success)}
                  />
                </View>
                
                <View style={styles.loanItemAmounts}>
                  <View><Text style={styles.loanItemLabel}>Principal</Text><Text style={styles.loanItemValue}>{fmtCurrency(loan.amount)}</Text></View>
                  <View><Text style={styles.loanItemLabel}>Interest</Text><Text style={styles.loanItemValue}>{fmtCurrency(loan.totalInterest)}</Text></View>
                  <View><Text style={styles.loanItemLabel}>Balance</Text><Text style={[styles.loanItemValue, { color: C.error }]}>{fmtCurrency(loan.balance)}</Text></View>
                </View>
                
                {loan.status === "disbursed" && (
                  <View style={styles.loanProgress}>
                    <View style={styles.loanProgressBar}><View style={[styles.loanProgressFill, { width: `${pct}%` }]} /></View>
                    <Text style={styles.loanProgressText}>{pct.toFixed(0)}% repaid</Text>
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

// Helper Components
const Divider = () => <View style={{ height: 1, backgroundColor: C.borderLight, marginHorizontal: 16 }} />;

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14,
    backgroundColor: C.bg,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.5,
    marginTop: 1,
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
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
    backgroundColor: C.accent,
  },
  activeFiltersBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.primaryFaint,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
  },
  activeFiltersText: {
    fontSize: 12,
    color: C.primary,
    fontWeight: "500",
    flex: 1,
  },
  clearFiltersText: {
    fontSize: 12,
    color: C.error,
    fontWeight: "700",
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text2,
  },
  tabTextActive: {
    color: "#fff",
  },
  content: {
    paddingHorizontal: 16,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: "45%",
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
  chartCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    marginBottom: 12,
  },
  chartLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: C.text3,
  },
  exportSection: {
    marginTop: 8,
    marginBottom: 20,
  },
  exportTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    marginBottom: 4,
  },
  exportSubtitle: {
    fontSize: 11,
    color: C.text3,
    marginBottom: 12,
  },
  exportGrid: {
    gap: 10,
  },
  exportCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  exportCardTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  exportCardValue: {
    fontSize: 18,
    fontWeight: "800",
    color: C.text,
    marginBottom: 2,
  },
  exportCardMeta: {
    fontSize: 11,
    color: C.text3,
    marginBottom: 10,
  },
  exportButtons: {
    flexDirection: "row",
    gap: 8,
  },
  exportBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  exportBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  txRow: {
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
    justifyContent: "center",
  },
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txAmount: { fontSize: 13, fontWeight: "700" },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "700",
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    color: C.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  memberDetailCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
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
    marginBottom: 12,
  },
  memberDetailInfo: {
    alignItems: "center",
    gap: 4,
  },
  memberDetailText: {
    fontSize: 12,
    color: C.text2,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  resultsCount: {
    fontSize: 12,
    color: C.text3,
    marginBottom: 10,
  },
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
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: C.primary,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: "700", color: C.text },
  memberContact: { fontSize: 11, color: C.text3, marginTop: 2 },
  memberStats: { alignItems: "flex-end" },
  memberAmount: { fontSize: 13, fontWeight: "700", color: C.primary },
  memberRole: { fontSize: 10, color: C.text3, textTransform: "capitalize", marginTop: 2 },
  chevron: { fontSize: 16, color: C.text3 },
  filterChips: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text2,
  },
  filterChipTextActive: {
    color: "#fff",
  },
  loanItem: {
    padding: 16,
    marginBottom: 12,
  },
  loanItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  loanItemAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  loanItemAvatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: C.primary,
  },
  loanItemMember: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
  },
  loanItemDate: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  loanItemAmounts: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 12,
  },
  loanItemLabel: {
    fontSize: 10,
    color: C.text3,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  loanItemValue: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
  },
  loanProgress: {
    marginTop: 4,
  },
  loanProgressBar: {
    height: 4,
    backgroundColor: C.elevated,
    borderRadius: 2,
    overflow: "hidden",
  },
  loanProgressFill: {
    height: "100%",
    backgroundColor: C.accent,
    borderRadius: 2,
  },
  loanProgressText: {
    fontSize: 10,
    color: C.text3,
    marginTop: 4,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: 20,
    color: C.text3,
  },
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
  },
  modalSelectLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text2,
    marginBottom: 6,
  },
  modalChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginRight: 6,
  },
  modalChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  modalChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text2,
  },
  modalChipTextActive: {
    color: "#fff",
  },
  modalClearBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
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
    backgroundColor: C.primary,
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