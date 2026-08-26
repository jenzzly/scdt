// app/(tabs)/reports.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, StatusBar, useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore,
  useActiveGroup, useGroupMembers, useGroupLoans,
  useGroupContributions, useGroupInvestments, useGroupWallet,
  useCurrentMember, useCurrentMemberPermissions, useIsAdminView,
} from "../../stores/useStore";
import { Card, Badge, Empty, useToast, Input, BottomModal, Select, DatePicker } from "../../components/ui";
import { Colors, C, T, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";
import { exportCsv, exportPdf } from "../../utils/export";

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

// ─── Safe hand-built charts ──────────────────────────────────────────────────
// react-native-chart-kit renders raw SVG <text>/<tspan> nodes that are not
// valid React Native Web children — this is the root cause of the
// "Unexpected text node" crash on this screen. It also computed its width
// once from Dimensions.get("window") at module load time, which never
// updates on rotation/resize (the "chart is off on mobile" report). These
// replacements use only View/Text and size themselves from the parent's
// actual rendered width.
function CashflowBarChart({
  months, income, expenses,
}: { months: string[]; income: number[]; expenses: number[] }) {
  const max = Math.max(1, ...income, ...expenses);
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: C.success }} />
          <Text style={{ fontSize: 11, color: C.text3 }}>Income</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: C.error }} />
          <Text style={{ fontSize: 11, color: C.text3 }}>Expenses</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 150 }}>
        {months.map((m, i) => {
          const incH = Math.max(2, (income[i] / max) * 120);
          const expH = Math.max(2, (expenses[i] / max) * 120);
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 120 }}>
                <View style={{ width: 12, height: incH, borderRadius: 3, backgroundColor: C.success }} />
                <View style={{ width: 12, height: expH, borderRadius: 3, backgroundColor: C.error, marginLeft: 3 }} />
              </View>
              <Text style={{ fontSize: 9, color: C.text3, marginTop: 6 }} numberOfLines={1}>{m}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MemberSharesChart({
  data,
}: { data: { name: string; population: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.population, 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => {
        const pct = (d.population / total) * 100;
        return (
          <View key={i}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: C.text2 }}>{d.name}</Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color: d.color }}>{pct.toFixed(0)}%</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.border, overflow: "hidden" }}>
              <View style={{ height: "100%" as any, width: `${pct}%` as any, backgroundColor: d.color, borderRadius: 4 }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Filter Modal Component
function FilterModal({
  visible,
  onClose,
  fromDate, toDate,
  onFromDateChange, onToDateChange,
  loanStatus, contributionStatus,
  onLoanStatusChange, onContributionStatusChange,
  onApply,
  searchTerm,
  onSearchChange,
}: any) {
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
        <DatePicker
          label="From Date"
          value={fromDate}
          onChange={onFromDateChange}
          placeholder="Start date"
        />
        <DatePicker
          label="To Date"
          value={toDate}
          onChange={onToDateChange}
          placeholder="End date"
        />

        <Text style={styles.modalSectionLabel}>Status Filters</Text>
        <View style={styles.modalRow}>
          <View style={styles.modalHalf}>
            <Select
              label="Loans"
              value={loanStatus}
              options={["all", "pending", "active", "repaid"].map(status => ({
                label: status.charAt(0).toUpperCase() + status.slice(1), value: status,
              }))}
              onChange={onLoanStatusChange}
            />
          </View>
          <View style={styles.modalHalf}>
            <Select
              label="Contributions"
              value={contributionStatus}
              options={["all", "approved", "pending", "rejected"].map(status => ({
                label: status.charAt(0).toUpperCase() + status.slice(1), value: status,
              }))}
              onChange={onContributionStatusChange}
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
          <TouchableOpacity style={styles.modalClearBtn} onPress={() => {
            onFromDateChange("");
            onToDateChange("");
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

export default function ReportsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const group = useActiveGroup();
  const allMembers = useGroupMembers();
  const allLoans = useGroupLoans();
  const allContributions = useGroupContributions();
  const allInvestments = useGroupInvestments();
  const allWallet = useGroupWallet();
  const permissions = useCurrentMemberPermissions();
  const currentMember = useCurrentMember();
  const { show, Toast } = useToast();

  // Officers/admins always see all reports. A regular "member" role only
  // sees group-wide data when explicitly granted the viewAllReports
  // permission from Group Settings → Permissions — otherwise they only ever
  // see their own report (enforced below on every data slice).
  const canSeeAll = useIsAdminView();
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "earnings">("overview");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFromDate, setSelectedFromDate] = useState("");
  const [selectedToDate, setSelectedToDate] = useState("");
  const [loanStatus, setLoanStatus] = useState<"all" | "pending" | "active" | "repaid">("all");
  const [contributionStatus, setContributionStatus] = useState<"all" | "approved" | "pending" | "rejected">("all");
  
  // Temp state for modal
  const [tempSearch, setTempSearch] = useState("");
  const [tempFromDate, setTempFromDate] = useState("");
  const [tempToDate, setTempToDate] = useState("");
  const [tempLoanStatus, setTempLoanStatus] = useState<"all" | "pending" | "active" | "repaid">("all");
  const [tempContributionStatus, setTempContributionStatus] = useState<"all" | "approved" | "pending" | "rejected">("all");

  // Scope data
  const members = canSeeAll ? allMembers : allMembers.filter(m => m.id === currentMember?.id);
  const loans = canSeeAll ? allLoans : allLoans.filter(l => l.memberId === currentMember?.id);
  const contributions = canSeeAll ? allContributions : allContributions.filter(c => c.memberId === currentMember?.id);
  const investments = canSeeAll ? allInvestments : allInvestments.filter(i => i.createdBy === currentMember?.id);
  const wallet = canSeeAll ? allWallet : allWallet.filter(t => t.memberId === currentMember?.id);

  const groupWalletEarnings = useMemo(
    () => allWallet
      .filter(t => t.type !== "contribution")
      .reduce((sum, t) => sum + t.amount, 0),
    [allWallet],
  );
  const groupInterest = useMemo(() => {
    const fromLedger = allWallet
      .filter(t => t.type === "loan_interest_income" && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const legacy = allWallet
      .filter(t => t.type === "loan_repayment" && t.amount > 0)
      .reduce((sum, t) => {
        const loan = allLoans.find(item => item.id === t.loanId);
        return loan?.totalRepayable
          ? sum + round2(t.amount * (loan.totalInterest / loan.totalRepayable))
          : sum;
      }, 0);
    return round2(fromLedger + legacy);
  }, [allWallet, allLoans]);
  const groupExpenses = useMemo(
    () => allWallet.filter(t => ["bank_fee", "other_debit"].includes(t.type)).reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [allWallet],
  );

  // Filter helpers
  const filterByDateRange = (items: any[], dateField: string) => {
    return items.filter(item => {
      const dStr = (item[dateField] || "").slice(0, 10);
      if (!dStr) return true;
      if (selectedFromDate && dStr < selectedFromDate) return false;
      if (selectedToDate && dStr > selectedToDate) return false;
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
    let list = filterByDateRange(loans, "applicationDate");
    if (loanStatus !== "all") {
      if (loanStatus === "active") list = list.filter(l => l.status === "disbursed");
      if (loanStatus === "pending") list = list.filter(l => l.status.startsWith("pending_"));
      if (loanStatus === "repaid") list = list.filter(l => l.status === "repaid");
    }
    return filterBySearch(list, ["memberId", "id", "purpose"]);
  }, [loans, selectedFromDate, selectedToDate, loanStatus, searchTerm]);

  const filteredContributions = useMemo(() => {
    let list = filterByDateRange(contributions, "date");
    if (contributionStatus !== "all") {
      list = list.filter(c => c.status === contributionStatus);
    }
    return filterBySearch(list, ["memberId", "description"]);
  }, [contributions, selectedFromDate, selectedToDate, contributionStatus, searchTerm]);

  const filteredInvestments = useMemo(() => 
    filterByDateRange(investments, "startDate"),
    [investments, selectedFromDate, selectedToDate]
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
      const monthTxs = allWallet.filter(t => {
        const txDate = new Date(t.date);
        return txDate >= startOfMonth && txDate <= endOfMonth;
      });
      months.push(d.toLocaleDateString("en", { month: "short" }));
      income.push(monthTxs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0));
      expenses.push(Math.abs(monthTxs.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0)));
    }
    return { months, income, expenses };
  }, [allWallet]);

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

  // Interest earned: read from wallet ledger (loan_interest_income txs) + legacy loan_repayment
  const totalInterest = useMemo(() => {
    const fromLedger = wallet
      .filter(t => t.type === "loan_interest_income" && t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const legacy = wallet
      .filter(t => t.type === "loan_repayment" && t.amount > 0)
      .reduce((s, t) => {
        const loan = loans.find(l => l.id === t.loanId);
        if (!loan || !loan.totalRepayable) return s;
        return s + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
      }, 0);
    return round2(fromLedger + legacy);
  }, [wallet, loans]);
  const totalExpenses = useMemo(() =>
    wallet.filter(t => ["bank_fee", "other_debit"].includes(t.type)).reduce((s, t) => s + Math.abs(t.amount), 0), [wallet]
  );

  const loansTotal = useMemo(() => filteredLoans.reduce((s, l) => s + l.amount, 0), [filteredLoans]);
  const contributionsTotal = useMemo(() => filteredContributions.reduce((s, c) => s + c.amount, 0), [filteredContributions]);
  const investmentsTotal = useMemo(() => filteredInvestments.reduce((s, i) => s + i.investmentAmount, 0), [filteredInvestments]);

  const hasActiveFilters = selectedFromDate !== "" || selectedToDate !== "" || loanStatus !== "all" || contributionStatus !== "all" || searchTerm !== "";

  const openFilterModal = () => {
    setTempSearch(searchTerm);
    setTempFromDate(selectedFromDate);
    setTempToDate(selectedToDate);
    setTempLoanStatus(loanStatus);
    setTempContributionStatus(contributionStatus);
    setShowFilterModal(true);
  };

  const applyFilters = () => {
    setSearchTerm(tempSearch);
    setSelectedFromDate(tempFromDate);
    setSelectedToDate(tempToDate);
    setLoanStatus(tempLoanStatus);
    setContributionStatus(tempContributionStatus);
    setShowFilterModal(false);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedFromDate("");
    setSelectedToDate("");
    setLoanStatus("all");
    setContributionStatus("all");
    setTempSearch("");
    setTempFromDate("");
    setTempToDate("");
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

  // All roles can see Members tab — non-admins see only their own data within it
  const TABS = ["overview", "members", "earnings"] as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={[styles.header, isWide && { paddingHorizontal: 32 }]}>
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
          <Text style={styles.activeFiltersText} numberOfLines={1}>
            {searchTerm && `🔍 "${searchTerm}" `}
            {selectedFromDate && `📅 From ${fmtDate(selectedFromDate)} `}
            {selectedToDate && `📌 To ${fmtDate(selectedToDate)} `}
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

      <ScrollView
        contentContainerStyle={[
          { paddingBottom: 100 },
          isWide && { maxWidth: 960, alignSelf: "center" as any, width: "100%" as any },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <View style={styles.content}>
            {/* KPI Row */}
            <View style={styles.kpiGrid}>
              <KpiCard 
                label="TOTAL CONTRIBUTIONS"
                value={fmtCurrency(group?.totalSavings ?? 0)}
                color={C.accent}
                subtext="group savings"
              />
              <KpiCard label="INTEREST EARNED" value={fmtCurrency(groupInterest)} color={C.gold} subtext="from loans" />
              <KpiCard label="TOTAL EARNINGS" value={fmtCurrency(groupWalletEarnings)} color={C.info} subtext="credits minus debits" />
              <KpiCard label="INVESTMENTS" value={fmtCurrency(allInvestments.reduce((sum, item) => sum + item.investmentAmount, 0))} color={C.success} subtext="group total" />
              <KpiCard label="EXPENSES" value={fmtCurrency(groupExpenses)} color={C.error} subtext="operational" />
            </View>

            {/* Cash Flow Chart */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Cash Flow (Last 6 Months)</Text>
              {cashflow.months.length > 0 && (
                <CashflowBarChart
                  months={cashflow.months}
                  income={cashflow.income}
                  expenses={cashflow.expenses}
                />
              )}
            </View>

            {/* Savings by Member - Admin only */}
            {memberPie.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>{canSeeAll ? "Savings by Member (Top 5)" : "My Savings"}</Text>
                <MemberSharesChart data={memberPie} />
              </View>
            )}

            {/* Export Section - gated by downloadReports permission */}
            {permissions.downloadReports && (
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

        {/* Members Tab — scoped by role */}
        {activeTab === "members" && (
          <MembersTab
            members={canSeeAll ? allMembers : allMembers.filter(m => m.id === currentMember?.id)}
            contributions={canSeeAll ? allContributions : allContributions.filter(c => c.memberId === currentMember?.id)}
            loans={canSeeAll ? allLoans : allLoans.filter(l => l.memberId === currentMember?.id)}
            wallet={canSeeAll ? allWallet : allWallet.filter(t => t.memberId === currentMember?.id)}
            canSeeAll={canSeeAll}
            currentMember={currentMember}
          />
        )}

        {/* Earnings Tab — replaces the old Loans tab */}
        {activeTab === "earnings" && (
          <EarningsTab
            wallet={canSeeAll ? allWallet : allWallet.filter(t => t.memberId === currentMember?.id)}
            members={canSeeAll ? allMembers : allMembers.filter(m => m.id === currentMember?.id)}
            canSeeAll={canSeeAll}
            currency={group?.currency ?? "RWF"}
            group={group}
            allMembers={allMembers}
            allContributions={allContributions}
            allLoans={allLoans}
            allWallet={allWallet}
            permissions={permissions}
          />
        )}
      </ScrollView>

      {/* Filter Modal */}
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
        onApply={applyFilters}
        searchTerm={tempSearch}
        onSearchChange={setTempSearch}
      />

      <Toast />
    </View>
  );
}

// ─── MembersTab ──────────────────────────────────────────────────────────────
// Shows member directory for admins/officers; shows own report for regular members.
// ─────────────────────────────────────────────────────────────────────────────
function MembersTab({ members, contributions, loans, wallet, canSeeAll, currentMember }: any) {
  const [search, setSearch] = useState<string>("");
  const [selectedMember, setSelectedMember] = useState<any>(
    // Non-admins land directly on their own detail
    !canSeeAll && members.length === 1 ? members[0] : null
  );

  const filteredMembers = members
    .filter((m: any) =>
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      m.phone?.includes(search) ||
      m.email?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a: any, b: any) => b.totalContributions - a.totalContributions);

  if (selectedMember) {
    return <MemberDetail
      member={selectedMember}
      loans={loans.filter((l: any) => l.memberId === selectedMember.id)}
      contributions={contributions.filter((c: any) => c.memberId === selectedMember.id && c.status === "approved")}
      wallet={wallet.filter((w: any) => w.memberId === selectedMember.id)}
      canGoBack={canSeeAll}
      onBack={() => setSelectedMember(null)}
    />;
  }

  return (
    <View style={styles.content}>
      <Input
        placeholder="Search members by name, phone, email..."
        value={search}
        onChangeText={setSearch}
        leftIcon="🔍"
      />
      <Text style={styles.resultsCount}>{filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}</Text>
      <Card>
        {filteredMembers.length === 0 ? (
          <Empty message="No members found" icon="👥" />
        ) : (
          filteredMembers.map((m: any, i: number) => (
            <TouchableOpacity key={m.id} onPress={() => setSelectedMember(m)} activeOpacity={0.7}>
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

// ─── MemberDetail ─────────────────────────────────────────────────────────────
// Full per-member report: contributions, loans, interest earned projection
// ─────────────────────────────────────────────────────────────────────────────
function MemberDetail({ member, loans, contributions, wallet, canGoBack, onBack }: any) {
  const totalContributions = contributions.reduce((s: number, c: any) => s + c.amount, 0);
  const loanBalance = loans.filter((l: any) => l.status === "disbursed").reduce((s: number, l: any) => s + l.balance, 0);
  const totalLoansAmount = loans.reduce((s: number, l: any) => s + l.amount, 0);
  const totalRepaid = loans.reduce((s: number, l: any) => s + (l.amountRepaid || 0), 0);

  // Interest earned: from ledger loan_interest_income txs
  const interestFromLedger = wallet
    .filter((t: any) => t.type === "loan_interest_income" && t.amount > 0)
    .reduce((s: number, t: any) => s + t.amount, 0);
  // Legacy loan_repayment combined tx fallback
  const interestLegacy = wallet
    .filter((t: any) => t.type === "loan_repayment" && t.amount > 0)
    .reduce((s: number, t: any) => {
      const loan = loans.find((l: any) => l.id === t.loanId);
      if (!loan || !loan.totalRepayable) return s;
      return s + round2(t.amount * (loan.totalInterest / loan.totalRepayable));
    }, 0);
  const interestEarned = round2(interestFromLedger + interestLegacy);

  // ── Interest projection ─────────────────────────────────────────────────
  // Project how much interest this member will earn over remaining loan terms
  const projectedInterest = loans
    .filter((l: any) => l.status === "disbursed")
    .reduce((s: number, l: any) => {
      const remaining = round2(l.totalRepayable - (l.amountRepaid || 0));
      const ratio = l.totalRepayable > 0 ? l.totalInterest / l.totalRepayable : 0;
      return s + round2(remaining * ratio);
    }, 0);

  // ── Monthly contribution trend (last 6 months) ──────────────────────────
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const month = d.toLocaleDateString("en", { month: "short" });
    const total = contributions
      .filter((c: any) => {
        const cd = new Date(c.date);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      })
      .reduce((s: number, c: any) => s + c.amount, 0);
    return { month, total };
  });

  const recentWallet = [...wallet]
    .sort((a: any, b: any) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())
    .slice(0, 8);

  return (
    <View style={styles.content}>
      {canGoBack && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back to Directory</Text>
        </TouchableOpacity>
      )}

      {/* Member identity card */}
      <View style={styles.memberDetailCard}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <View style={[styles.memberAvatar, { marginRight: 14 }]}>
            <Text style={styles.memberAvatarText}>
              {member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.memberDetailName}>{member.fullName}</Text>
            <Text style={styles.memberDetailRole}>{member.role.replace(/_/g," ")} · {member.status}</Text>
          </View>
        </View>
        <View style={styles.memberDetailInfo}>
          {member.phone ? <Text style={styles.memberDetailText}>📞 {member.phone}</Text> : null}
          {member.email ? <Text style={styles.memberDetailText}>✉️ {member.email}</Text> : null}
          <Text style={styles.memberDetailText}>📅 Joined {fmtDate(member.dateJoined)}</Text>
        </View>
      </View>

      {/* KPI grid */}
      <View style={styles.kpiGrid}>
        <KpiCard label="CONTRIBUTIONS" value={fmtCurrency(totalContributions)} color={C.accent} subtext="total saved" />
        <KpiCard label="LOAN BALANCE" value={fmtCurrency(loanBalance)} color={C.error} subtext="outstanding" />
        <KpiCard label="INTEREST EARNED" value={fmtCurrency(interestEarned)} color={C.gold} subtext="from repayments" />
        <KpiCard label="PROJECTED INTEREST" value={fmtCurrency(projectedInterest)} color={"#7C3AED"} subtext="remaining loans" />
      </View>

      {/* Interest breakdown card */}
      <View style={[styles.chartCard, { marginBottom: 16 }]}>
        <Text style={styles.chartTitle}>Interest Earned Overview</Text>
        <Text style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>
          Based on all repayments recorded against your loans
        </Text>
        <View style={{ gap: 10 }}>
          {/* Interest already earned */}
          <View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: C.text2, fontWeight: "600" }}>Already earned</Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: C.gold }}>{fmtCurrency(interestEarned)}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.border, overflow: "hidden" }}>
              <View style={{
                height: "100%" as any, borderRadius: 3, backgroundColor: C.gold,
                width: `${Math.min(100, (interestEarned / Math.max(1, interestEarned + projectedInterest)) * 100)}%` as any,
              }} />
            </View>
          </View>
          {/* Still projected */}
          {projectedInterest > 0 && (
            <View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ fontSize: 12, color: C.text2, fontWeight: "600" }}>Projected (remaining)</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#7C3AED" }}>{fmtCurrency(projectedInterest)}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.border, overflow: "hidden" }}>
                <View style={{
                  height: "100%" as any, borderRadius: 3, backgroundColor: "#7C3AED",
                  width: `${Math.min(100, (projectedInterest / Math.max(1, interestEarned + projectedInterest)) * 100)}%` as any,
                }} />
              </View>
              <Text style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>
                Total interest pool: {fmtCurrency(interestEarned + projectedInterest)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* 6-month contribution trend */}
      {trend.some(t => t.total > 0) && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Contributions (Last 6 Months)</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", height: 80, gap: 6, marginTop: 8 }}>
            {trend.map((t, i) => {
              const max = Math.max(...trend.map(x => x.total), 1);
              const h = Math.max(4, (t.total / max) * 72);
              return (
                <View key={i} style={{ flex: 1, alignItems: "center" }}>
                  <View style={{ width: "100%" as any, height: h, backgroundColor: C.primary, borderRadius: 3, marginBottom: 4 }} />
                  <Text style={{ fontSize: 9, color: C.text3 }}>{t.month}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Loan summary */}
      {(loans.length > 0) && (
        <>
          <SectionHeader title={`Loans (${loans.length})`} />
          <Card style={styles.card}>
            {loans.slice(0, 5).map((l: any, i: number) => {
              const pct = l.totalRepayable > 0 ? Math.min(100, (l.amountRepaid / l.totalRepayable) * 100) : 0;
              return (
                <React.Fragment key={l.id}>
                  <View style={{ paddingVertical: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }}>{fmtCurrency(l.amount)}</Text>
                      <View style={[styles.chip, {
                        backgroundColor: l.status === "repaid" ? C.greenBg : l.status === "disbursed" ? C.infoBg : C.elevated,
                      }]}>
                        <Text style={[styles.chipText, {
                          color: l.status === "repaid" ? C.success : l.status === "disbursed" ? C.info : C.text3,
                        }]}>{l.status}</Text>
                      </View>
                    </View>
                    {l.purpose ? <Text style={{ fontSize: 11, color: C.text3, marginBottom: 6 }}>{l.purpose}</Text> : null}
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: C.border, overflow: "hidden" }}>
                      <View style={{ height: "100%" as any, width: `${pct}%` as any, backgroundColor: C.accent, borderRadius: 2 }} />
                    </View>
                    <Text style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>
                      {pct.toFixed(0)}% repaid · {fmtCurrency(l.amountRepaid || 0)} of {fmtCurrency(l.totalRepayable)}
                    </Text>
                  </View>
                  {i < Math.min(loans.length, 5) - 1 && <Divider />}
                </React.Fragment>
              );
            })}
          </Card>
        </>
      )}

      {/* Recent wallet activity */}
      <SectionHeader title="Recent Transactions" />
      <Card style={styles.card}>
        {recentWallet.length === 0 ? (
          <Text style={styles.emptyText}>No transactions yet</Text>
        ) : recentWallet.map((w: any, i: number) => (
          <React.Fragment key={`${w.id}_${i}`}>
            <View style={styles.txRow}>
              <View style={[styles.txDot, { backgroundColor: w.amount > 0 ? C.greenBg : C.redBg }]}>
                <Text style={{ fontSize: 13, color: w.amount > 0 ? C.success : C.error }}>{w.amount > 0 ? "↓" : "↑"}</Text>
              </View>
              <View style={styles.txMid}>
                <Text style={styles.txDesc}>{w.type.replace(/_/g, " ")}</Text>
                <Text style={T.small}>{fmtDate(w.date || w.createdAt)}</Text>
              </View>
              <Text style={[styles.txAmount, { color: w.amount > 0 ? C.success : C.error }]}>
                {w.amount > 0 ? "+" : ""}{fmtCurrency(w.amount)}
              </Text>
            </View>
            {i < recentWallet.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </Card>
    </View>
  );
}

// Loans Tab Component
// ─── EarningsTab ──────────────────────────────────────────────────────────────
// "Earnings" = every wallet credit that is NOT a regular member contribution:
// loan interest income, investment returns, late fees, and any other manual
// credit. Every figure here is derived directly from the wallet ledger
// (never estimated from loan objects), so it always matches the money that
// actually moved. Downloadable as CSV/PDF and shows a per-member breakdown.
function earningsHtmlTable(headers: string[], rows: any[][]) {
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const EARNING_TYPES = [
  "loan_disbursement", "loan_repayment", "loan_interest_income",
  "loan_principal_recovery", "interest", "late_fee",
  "investment_disbursement", "investment_return", "bank_fee",
  "other_credit", "other_debit", "withdrawal",
];
const EARNING_TYPE_LABEL: Record<string, string> = {
  loan_interest_income: "Loan Interest",
  interest:             "Interest",
  investment_return:    "Investment Return",
  other_credit:         "Other Credit",
  bank_fee:             "Bank Fee",
};

function EarningsTab({
  wallet, members, canSeeAll, currency,
  group, allMembers, allContributions, allLoans, allWallet, permissions,
}: any) {
  const { show } = useToast();
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const earningsTxs = useMemo(
    () => wallet.filter((t: any) => t.type !== "contribution" && t.amount !== 0),
    [wallet]
  );

  const groupEarningsTxs = useMemo(
    () => allWallet.filter((t: any) => t.type !== "contribution" && t.amount !== 0),
    [allWallet],
  );

  const filtered = useMemo(() => {
    if (typeFilter === "all") return earningsTxs;
    return earningsTxs.filter((t: any) => t.type === typeFilter);
  }, [earningsTxs, typeFilter]);

  const totalCredited = useMemo(
    () => groupEarningsTxs.filter((t: any) => t.amount > 0).reduce((sum: number, t: any) => sum + t.amount, 0),
    [groupEarningsTxs],
  );
  const totalDebited = useMemo(
    () => groupEarningsTxs.filter((t: any) => t.amount < 0).reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0),
    [groupEarningsTxs],
  );
  const activeMemberCount = Math.max(1, allMembers.filter((member: any) => member.status === "active").length);
  const totalEarnings = totalCredited - totalDebited;
  const earningsPerMember = totalEarnings / activeMemberCount;

  // Distribute net wallet earnings equally across active members. Contribution
  // credits are excluded from the wallet total above.
  const byMember = useMemo(() => {
    return (canSeeAll ? allMembers : members)
      .filter((member: any) => member.status === "active")
      .map((member: any) => ({ member, total: earningsPerMember }));
  }, [allMembers, members, canSeeAll, earningsPerMember]);

  const getMember = (id?: string) => members.find((m: any) => m.id === id);

  const handleDownload = async (format: "csv" | "pdf") => {
    const headers = ["Date", "Member", "Type", "Description", "Amount"];
    const rows = filtered.map((t: any) => [
      fmtDate(t.date),
      getMember(t.memberId)?.fullName ?? "—",
      EARNING_TYPE_LABEL[t.type] ?? t.type,
      t.description ?? "",
      fmtCurrency(t.amount),
    ]);
    if (format === "csv") await exportCsv(`Earnings_Report`, headers, rows);
    else await exportPdf(`Earnings_Report`, "Earnings Report", earningsHtmlTable(headers, rows));
  };

  return (
    <View style={styles.content}>
      <View style={styles.statsGrid}>
        <KpiCard label={canSeeAll ? "Net Group Earnings" : "My Earnings Share"} value={fmtCurrency(canSeeAll ? totalEarnings : earningsPerMember)} color={C.gold} />
        <KpiCard label="Per Member" value={fmtCurrency(earningsPerMember)} color={C.accent} />
        <KpiCard label="Transactions" value={String(earningsTxs.length)} color={C.teal} />
      </View>

      {byMember.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>{canSeeAll ? "Earnings by Member" : "My Earnings"}</Text>
          <View style={{ marginTop: 8 }}>
            {byMember.map((row: any, i: number) => (
              <View key={row.member.id} style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingVertical: 9, borderBottomWidth: i < byMember.length - 1 ? 1 : 0, borderBottomColor: C.borderLight,
              }}>
                <Text style={{ fontSize: 13, color: C.text, fontWeight: "500" }}>{row.member.fullName}</Text>
                <Text style={{ fontSize: 13, color: C.gold, fontWeight: "700" }}>{fmtCurrency(row.total)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Download buttons */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 16 }}>
        <TouchableOpacity style={[styles.exportBtn, { flex: 1 }]} onPress={() => handleDownload("csv")}>
          <Text style={styles.exportBtnText}>⬇ Download CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.exportBtn, { flex: 1 }]} onPress={() => handleDownload("pdf")}>
          <Text style={styles.exportBtnText}>⬇ Download PDF</Text>
        </TouchableOpacity>
      </View>

      {/* Type filter chips */}
      <View style={styles.filterChips}>
        {["all", ...EARNING_TYPES].map(type => (
          <TouchableOpacity
            key={type}
            style={[styles.filterChip, typeFilter === type && styles.filterChipActive]}
            onPress={() => setTypeFilter(type)}
          >
            <Text style={[styles.filterChipText, typeFilter === type && styles.filterChipTextActive]}>
              {type === "all" ? "All" : (EARNING_TYPE_LABEL[type] ?? type)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.resultsCount}>{filtered.length} earning{filtered.length !== 1 ? "s" : ""} found</Text>

      {filtered.length === 0 ? (
        <Empty message="No earnings recorded yet" icon="💰" />
      ) : (
        filtered
          .slice()
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .map((tx: any) => {
            const member = getMember(tx.memberId);
            return (
              <React.Fragment key={tx.id}>
                <Card style={styles.loanItem}>
                  <View style={styles.loanItemHeader}>
                    <View style={styles.loanItemAvatar}>
                      <Text style={styles.loanItemAvatarText}>
                        {member ? member.fullName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() : "€"}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.loanItemMember}>{member?.fullName ?? "Group Earning"}</Text>
                      <Text style={styles.loanItemDate}>{fmtDate(tx.date)} · {tx.description}</Text>
                    </View>
                    <Chip label={EARNING_TYPE_LABEL[tx.type] ?? tx.type} bg={C.goldBg} color={C.gold} />
                  </View>
                  <View style={{ marginTop: 8, alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: C.gold }}>+{fmtCurrency(tx.amount)}</Text>
                  </View>
                </Card>
              </React.Fragment>
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
    backgroundColor: C.primary + '18',
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
    height: "100%" as any,
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