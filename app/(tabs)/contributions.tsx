// app/(tabs)/contributions.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupContributions, useGroupMembers,
  useCurrentUserRole, useCurrentMember, useCanSeeAllFinancial, useIsAdminView,
  useCurrentMemberPermissions, useActiveGroup, useGroupWallet,
} from "../../stores/useStore";
import { SearchBar, Card, Badge, Empty, BottomModal, useToast, Select, DatePicker, TabRow } from "../../components/ui";
import { Colors, C, T, S, R, fmtCurrency, fmtDate } from "../../utils/theme";
import { exportCsv, exportPdf } from "../../utils/export";
import { findOverdueContributions } from "../../utils/lateFees";
import type { Contribution } from "../../types";

const STATUS_COLOR: Record<string, "teal" | "gold" | "green" | "red" | "muted"> = {
  approved: "green",
  pending:  "gold",
  rejected: "red",
};

const TYPE_LABELS: Record<string, string> = {
  regular:            "Regular",
  loan_repayment:     "Loan Repayment",
  loan_interest:      "Loan Interest",
  late_fee:           "Late Fee",
  investment_funding: "Investment Funding",
  investment_return:  "Investment Return",
  penalty:            "Penalty",
  other:              "Other",
};

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { label: "Newest first",   value: "date_desc" },
  { label: "Oldest first",   value: "date_asc"  },
  { label: "Month",          value: "month"     },
  { label: "Year",           value: "year"      },
];
const TYPE_OPTIONS = [
  { label: "All types", value: "all" },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ label, value })),
];

function generateHtmlTable(headers: string[], rows: any[][]) {
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
);

export default function ContributionsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { approveContribution, rejectContribution, activeGroupId, applyContributionLateFee, recalcTotals } = useStore();
  const allContributions = useGroupContributions();
  const allMembers = useGroupMembers();
  const group = useActiveGroup();
  const allWallet = useGroupWallet();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const canSeeAll = useCanSeeAllFinancial();
  const permissions = useCurrentMemberPermissions();
  const { show, Toast } = useToast();

  const isAdmin = role === "admin";
  const canApprove = ["admin", "loan_officer", "accountant"].includes(role) ||
    (role === "committee" && permissions.approveContributions);
  const canAdd = permissions.addContribution || isAdmin;
  const canExport = permissions.downloadReports || isAdmin;
  const canManageFees = ["admin", "accountant", "loan_officer"].includes(role);
  const isAdminView = useIsAdminView();

  // Scope: use toggle for admins, members always see only their own
  const contributions = isAdminView
    ? allContributions
    : allContributions.filter(c => c.memberId === currentMember?.id);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [selectedContrib, setSelectedContrib] = useState<Contribution | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [applyingFeeId, setApplyingFeeId] = useState<string | null>(null);

  // Late fee calculation
  const overdueContributions = useMemo(() => {
    if (!group) return [];
    return findOverdueContributions(group, allMembers, allContributions, allWallet);
  }, [canManageFees, group, allMembers, allContributions, allWallet]);

  const visibleLateFees = useMemo(
    () => {
      const calculated = overdueContributions.map(item => ({ ...item, applied: false }));
      const unpaidApplied = allWallet
        .filter(tx => tx.type === "late_fee" && !tx.loanId && !tx.feePaid && tx.description?.startsWith("Late contribution fee"))
        .map(tx => ({
          memberId: tx.memberId ?? "",
          memberName: allMembers.find(member => member.id === tx.memberId)?.fullName ?? "Unknown",
          periodLabel: tx.description?.replace("Late contribution fee — ", "").replace(/ \(.*\)$/, "") ?? "Late contribution",
          amountDue: 0,
          daysLate: 0,
          feeAmount: tx.amount,
          feeTxId: tx.id,
          applied: true,
        }));
      const fees = [...calculated, ...unpaidApplied];
      return isAdminView ? fees : fees.filter(item => item.memberId === currentMember?.id);
    },
    [overdueContributions, allWallet, allMembers, isAdminView, currentMember],
  );

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

  const handleClearContributionFee = async (item: any) => {
    setApplyingFeeId(item.feeTxId);
    try {
      await useStore.getState().clearStandaloneLateFee(item.feeTxId);
      show(`Late fee of ${fmtCurrency(item.feeAmount)} cleared`);
    } catch (e: any) {
      show(e?.message || "Failed to clear late fee", "error");
    } finally {
      setApplyingFeeId(null);
    }
  };

  const getMemberName = (id: string) =>
    allMembers.find(m => m.id === id)?.fullName ?? "Unknown";

  // Filter + sort + pagination (similar to wallet)
  const filtered = useMemo(() => {
    let list = [...contributions];
    
    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "approved") list = list.filter(c => c.status === "approved");
      else if (statusFilter === "pending") list = list.filter(c => c.status === "pending");
      else if (statusFilter === "rejected") list = list.filter(c => c.status === "rejected");
    }
    
    // Type filter
    if (typeFilter !== "all") list = list.filter(c => c.contributionType === typeFilter);
    
    // Search
    if (search) {
      const term = search.toLowerCase();
      list = list.filter(c =>
        getMemberName(c.memberId).toLowerCase().includes(term) ||
        c.description?.toLowerCase().includes(term) ||
        c.contributionType?.toLowerCase().includes(term)
      );
    }

    // Sort
    if (sort === "date_asc") {
      list.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else if (sort === "date_desc") {
      list.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else if (sort === "month") {
      list.sort((a,b) => {
        const da = new Date(a.date), db = new Date(b.date);
        const ma = da.getFullYear() * 12 + da.getMonth();
        const mb = db.getFullYear() * 12 + db.getMonth();
        return mb - ma;
      });
    } else if (sort === "year") {
      list.sort((a,b) => new Date(b.date).getFullYear() - new Date(a.date).getFullYear());
    }
    
    return list;
  }, [contributions, statusFilter, typeFilter, search, sort, allMembers]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalAmount = useMemo(
    () => statusFilter === "late_fee"
      ? visibleLateFees.reduce((sum, item) => sum + item.feeAmount, 0)
      : filtered.reduce((sum, c) => sum + c.amount, 0),
    [statusFilter, visibleLateFees, filtered],
  );
  const pendingCount = useMemo(() => filtered.filter(c => c.status === "pending").length, [filtered]);
  const approvedCount = useMemo(() => filtered.filter(c => c.status === "approved").length, [filtered]);

  const handleTabChange = (t: string) => { setStatusFilter(t === "Late Fee" ? "late_fee" : t.toLowerCase()); setPage(1); };
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleSort = (v: string) => { setSort(v); setPage(1); };

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

  const handleExport = async (format: "csv" | "pdf") => {
    const headers = ["Date", "Member", "Type", "Amount", "Status", "Description"];
    const rows = filtered.map(c => [
      fmtDate(c.date),
      getMemberName(c.memberId),
      TYPE_LABELS[c.contributionType] ?? c.contributionType,
      fmtCurrency(c.amount),
      c.status,
      c.description ?? "",
    ]);
    if (format === "csv") {
      await exportCsv("Contributions_Report", headers, rows);
    } else {
      await exportPdf("Contributions_Report", "Contributions Report", generateHtmlTable(headers, rows));
    }
    show(`Exported as ${format.toUpperCase()}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={[st.header, isWide && st.headerWide]}>
        <View>
          <Text style={st.headerSub}>{isAdminView ? "Admin" : "My"}</Text>
          <Text style={st.title}>Contributions</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {canExport && (
            <>
              <TouchableOpacity style={st.iconBtn} onPress={() => handleExport("csv")} activeOpacity={0.8}>
                <Text style={st.iconBtnText}>CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.iconBtn, { backgroundColor: C.redBg }]} onPress={() => handleExport("pdf")} activeOpacity={0.8}>
                <Text style={[st.iconBtnText, { color: C.redText }]}>PDF</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, isWide && { paddingHorizontal: 24 }]}
        showsVerticalScrollIndicator={false}>

        {/* ── Balance card ── */}
        <View style={[st.balanceCard, isWide && { marginHorizontal: 0, maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={st.cardAccentDot} />
          <Text style={st.balanceLabel}>{statusFilter === "late_fee" ? "LATE FEES OWED" : isAdminView ? "TOTAL CONTRIBUTIONS" : "MY CONTRIBUTIONS"}</Text>
          <Text style={st.balanceAmount}>
            <Text style={st.balanceCurrency}>{group?.currency ?? "RWF"} </Text>
            {fmtCurrency(totalAmount, group?.currency ?? "RWF").replace(`${group?.currency ?? "RWF"} `, "")}
          </Text>
          <View style={st.balancePills}>
            <View style={st.balancePill}>
              <Text style={st.balancePillLabel}>APPROVED</Text>
              <Text style={[st.balancePillValue, { color: "#34D399" }]}>{approvedCount}</Text>
            </View>
            <View style={st.balancePillDivider} />
            <View style={st.balancePill}>
              <Text style={st.balancePillLabel}>PENDING</Text>
              <Text style={[st.balancePillValue, { color: "#F87171" }]}>{pendingCount}</Text>
            </View>
            <View style={st.balancePillDivider} />
            <View style={st.balancePill}>
              <Text style={st.balancePillLabel}>RECORDS</Text>
              <Text style={[st.balancePillValue, { color: "#fff" }]}>{statusFilter === "late_fee" ? visibleLateFees.length : filtered.length}</Text>
            </View>
          </View>
        </View>

        {/* ── Controls: search + tabs + sort ── */}
        <View style={[st.controls, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={st.controlsTop}>
            <View style={{ flex: 1 }}>
              <SearchBar value={search} onChange={handleSearch} placeholder="Search contributions…" />
            </View>
            <View style={st.filterSelect}>
              <Select label="Type" value={typeFilter} options={TYPE_OPTIONS} onChange={(value) => { setTypeFilter(value); setPage(1); }} />
            </View>
            <View style={st.filterSelect}>
              <Select label="Sort" value={sort} options={SORT_OPTIONS} onChange={handleSort} />
            </View>
          </View>
          <View style={st.statusRow}>
            <TabRow tabs={["All","Approved","Pending","Late Fee"]} active={statusFilter === "all" ? "All" : statusFilter === "late_fee" ? "Late Fee" : statusFilter} onChange={handleTabChange} />
            {canAdd && (
              <TouchableOpacity style={st.addTabBtn} onPress={() => router.push("/modals/add-contribution")} activeOpacity={0.8}>
                <Text style={st.primaryBtnText}>+ Contribution</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Contribution list / table ── */}
        <View style={[{ marginTop: 8 }, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          {statusFilter === "late_fee" ? (
            visibleLateFees.length === 0 ? (
              <View style={st.empty}>
                <Text style={st.emptyIcon}>✓</Text>
                <Text style={st.emptyText}>No late fees owed</Text>
              </View>
            ) : (
              <View style={st.card}>
                {visibleLateFees.map((item, index) => (
                  <React.Fragment key={item.feeTxId}>
                    <View style={st.lateFeeRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.lateFeeMemberName}>{isAdminView ? item.memberName : item.periodLabel}</Text>
                        <Text style={st.lateFeeDetail}>
                          {item.applied ? "Unpaid late fee" : `${isAdminView ? `${item.periodLabel} · ` : ""}${item.daysLate}d late · due ${fmtCurrency(item.amountDue)}`}
                        </Text>
                      </View>
                      <View style={st.lateFeeAmountWrap}>
                        <Text style={st.lateFeeAmount}>{fmtCurrency(item.feeAmount)}</Text>
                        {canManageFees && (
                          <TouchableOpacity
                            style={st.lateFeeApplyBtn}
                            onPress={() => item.applied ? handleClearContributionFee(item) : handleApplyContributionFee(item)}
                            disabled={applyingFeeId === item.feeTxId}
                            activeOpacity={0.8}
                          >
                            <Text style={st.lateFeeApplyBtnText}>
                              {applyingFeeId === item.feeTxId ? "Saving…" : item.applied ? "Clear" : "Apply"}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    {index < visibleLateFees.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </View>
            )
          ) : paginated.length === 0 ? (
            <View style={st.empty}>
              <Text style={st.emptyIcon}>💰</Text>
              <Text style={st.emptyText}>No contributions found</Text>
            </View>
          ) : isWide ? (
            // Desktop table
            <View style={st.table}>
              {/* Table header */}
              <View style={[st.tableRow, st.tableHeadRow]}>
                <View style={{ width: 40 }} />
                <Text style={[st.tableHeadCell, { flex: 2 }]}>DESCRIPTION</Text>
                <Text style={[st.tableHeadCell, { width: 160 }]}>TYPE</Text>
                {isAdminView && <Text style={[st.tableHeadCell, { width: 150 }]}>MEMBER</Text>}
                <Text style={[st.tableHeadCell, { width: 120 }]}>DATE</Text>
                <Text style={[st.tableHeadCell, { width: 120, textAlign: "right" }]}>AMOUNT</Text>
                {canApprove && <View style={{ width: 60 }} />}
              </View>
              {paginated.map(c => <React.Fragment key={c.id}><TableRow contribution={c} showMember={isAdminView} /></React.Fragment>)}
            </View>
          ) : (
            // Mobile cards
            <View style={st.card}>
              {paginated.map((c, i) => (
                <React.Fragment key={c.id}>
                  <ContributionRow
                    contribution={c}
                    memberName={isAdminView ? getMemberName(c.memberId) : ""}
                    canApprove={canApprove}
                    onApprove={() => handleApprove(c.id)}
                    onReject={() => handleReject(c.id)}
                    onView={() => setSelectedContrib(c)}
                  />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          <Pagination page={page} totalPages={totalPages} setPage={setPage} filtered={filtered} />
        </View>
      </ScrollView>
      <Toast />
    </View>
  );
}

// ── Table row (desktop) ──────────────────────────────────────────────────
const TableRow = ({ contribution, showMember }: { contribution: Contribution; showMember: boolean }) => {
  const role = useCurrentUserRole();
  const canApprove = ["admin", "loan_officer", "accountant"].includes(role);
  const getMemberName = (id: string) => {
    const allMembers = useGroupMembers();
    return allMembers.find(m => m.id === id)?.fullName ?? "Unknown";
  };
  
  const memberName = getMemberName(contribution.memberId);
  
  return (
    <View style={[st.tableRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
      <View style={[st.tableCell, { width: 40 }]}>
        <View style={[st.txIconSm, { backgroundColor: contribution.status === "approved" ? C.greenBg : contribution.status === "pending" ? C.goldBg : C.redBg }]}>
          <Text style={{ fontSize: 9, fontWeight: "800", color: contribution.status === "approved" ? C.greenText : contribution.status === "pending" ? C.goldText : C.redText }}>
            {contribution.status === "approved" ? "✓" : contribution.status === "pending" ? "⏳" : "✗"}
          </Text>
        </View>
      </View>
      <Text style={[st.tableCell, { flex: 2 }]} numberOfLines={1}>{contribution.description || TYPE_LABELS[contribution.contributionType]}</Text>
      <Text style={[st.tableCell, { width: 160 }]}>{TYPE_LABELS[contribution.contributionType] ?? contribution.contributionType}</Text>
      {showMember && <Text style={[st.tableCell, { width: 150 }]}>{memberName}</Text>}
      <Text style={[st.tableCell, { width: 120 }]}>{fmtDate(contribution.date)}</Text>
      <Text style={[st.tableCell, { width: 120, textAlign: "right",
        fontWeight: "700", color: C.accent }]}>
        {fmtCurrency(contribution.amount)}
      </Text>
      {canApprove && contribution.status === "pending" && (
        <View style={[st.tableCell, { width: 60, alignItems: "center" }]}>
          <TouchableOpacity onPress={() => {/* Handle approve would go here */}}>
            <Text style={{ fontSize: 11, color: C.success, fontWeight: "600" }}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ── Mobile card row ────────────────────────────────────────────────────────
function ContributionRow({ contribution, memberName, canApprove, onApprove, onReject, onView }: any) {
  const isApproved = contribution.status === "approved";
  const abbr = isApproved ? "✓" : contribution.status === "pending" ? "⏳" : "✗";
  return (
    <View style={st.txRow}>
      <View style={[st.txIcon, { backgroundColor: isApproved ? C.greenBg : contribution.status === "pending" ? C.goldBg : C.redBg }]}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: isApproved ? C.greenText : contribution.status === "pending" ? C.goldText : C.redText, letterSpacing: 0.3 }}>
          {abbr}
        </Text>
      </View>
      <View style={st.txMid}>
        <Text style={st.txDesc} numberOfLines={1}>{contribution.description || TYPE_LABELS[contribution.contributionType]}</Text>
        <Text style={st.txMeta}>
          {fmtDate(contribution.date)}{memberName ? ` · ${memberName}` : ""} · {TYPE_LABELS[contribution.contributionType] ?? contribution.contributionType}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[st.txAmount, { color: C.accent }]}>
          {fmtCurrency(contribution.amount)}
        </Text>
        {canApprove && contribution.status === "pending" && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 3 }}>
            <TouchableOpacity onPress={onApprove} style={{ backgroundColor: C.greenBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, color: C.success, fontWeight: "600" }}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onReject} style={{ backgroundColor: C.redBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, color: C.error, fontWeight: "600" }}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Pagination controls ────────────────────────────────────────────────
const Pagination = ({ page, totalPages, setPage, filtered }: { page: number; totalPages: number; setPage: (p: number) => void; filtered: any[] }) => {
  if (totalPages <= 1) return null;
  return (
    <View style={st.pagination}>
      <TouchableOpacity
        style={[st.pageBtn, page === 1 && st.pageBtnDisabled]}
        onPress={() => page > 1 && setPage(page - 1)}
        disabled={page === 1}
      >
        <Text style={[st.pageBtnText, page === 1 && { color: C.text3 }]}>← Prev</Text>
      </TouchableOpacity>
      <Text style={st.pageInfo}>
        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
      </Text>
      <TouchableOpacity
        style={[st.pageBtn, page >= totalPages && st.pageBtnDisabled]}
        onPress={() => page < totalPages && setPage(page + 1)}
        disabled={page >= totalPages}
      >
        <Text style={[st.pageBtnText, page >= totalPages && { color: C.text3 }]}>Next →</Text>
      </TouchableOpacity>
    </View>
  );
};

const st = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14, backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerWide: { paddingHorizontal: 32 },
  headerSub: { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.5, marginTop: 1 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  iconBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: Colors.surface,
  },
  iconBtnText: { fontSize: 12, fontWeight: "700", color: C.text2 },
  toggleBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
    backgroundColor: Colors.surface,
  },
  toggleBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  toggleBtnText: { fontSize: 12, fontWeight: "700", color: C.text2 },
  toggleBtnTextActive: { color: "#fff" },

  // Balance card
  balanceCard: {
    margin: 16, borderRadius: 20, backgroundColor: C.card, padding: 24, overflow: "hidden",
  },
  cardAccentDot: {
    position: "absolute", top: -50, right: -30, width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(26,86,219,0.15)",
  },
  balanceLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.45)", letterSpacing: 1.2, textTransform: "uppercase" },
  balanceAmount: { fontSize: 34, fontWeight: "800", color: "#fff", letterSpacing: -1.2, marginTop: 6 },
  balanceCurrency: { fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
  balancePills: {
    flexDirection: "row", marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  balancePill: { flex: 1, alignItems: "center" },
  balancePillLabel: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.4)", letterSpacing: 0.8, textTransform: "uppercase" },
  balancePillValue: { fontSize: 12, fontWeight: "700", marginTop: 3 },
  balancePillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },

  // Controls
  controls: { paddingHorizontal: 16, marginTop: 8 },
  controlsTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8, flexWrap: "wrap" },
  filterSelect: { width: 150, marginBottom: -16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addTabBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sortChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated,
  },
  sortChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  sortChipText: { fontSize: 11, fontWeight: "600", color: C.text3 },
  sortChipTextActive: { color: "#fff" },

  // Mobile card list
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginHorizontal: 16, overflow: "hidden" },
  txRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  txIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txMeta: { fontSize: 11, color: C.text3 },
  txAmount: { fontSize: 14, fontWeight: "700" },

  // Desktop table
  table: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12 },
  tableHeadRow: { backgroundColor: C.elevated, borderBottomWidth: 1, borderBottomColor: C.border },
  tableCell: { fontSize: 12, color: C.text2, paddingHorizontal: 6 },
  tableHeadCell: { fontSize: 10, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 6 },
  txIconSm: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },

  // Empty
  empty: { alignItems: "center", paddingVertical: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyText: { fontSize: 14, color: C.text3 },

  // Pagination
  pagination: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 16, gap: 16,
  },
  pageBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: "600", color: C.text },
  pageInfo: { fontSize: 12, color: C.text3 },

  // Late fee card
  lateFeeCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fca5a5",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#fee2e2",
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
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
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
  lateFeeAmountWrap: { alignItems: "flex-end", marginLeft: 10 },
  lateFeeAmount: { fontSize: 13, fontWeight: "800", color: "#b91c1c", marginBottom: 5 },
});