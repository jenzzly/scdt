// app/(tabs)/wallet.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useActiveGroup, useGroupWallet, useGroupMembers,
  useCurrentUserRole, useCurrentMember,
  useIsAdminView,
} from "../../stores/useStore";
import { TabRow, SearchBar, useToast } from "../../components/ui";
import { Colors, S, R, C, fmtCurrency, fmtDate, showConfirm } from "../../utils/theme";
import type { WalletTransaction } from "../../types";
import { useStore } from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";

const PAGE_SIZE = 20;

const TX_LABEL: Record<string, string> = {
  contribution:             "Contribution",
  loan_disbursement:        "Loan Disbursement",
  loan_repayment:           "Loan Repayment",
  loan_interest_income:     "Interest Income",
  loan_principal_recovery:  "Principal Recovery",
  interest:                 "Interest Earned",
  late_fee:                 "Late Fee",
  investment_disbursement:  "Investment",
  investment_return:        "Investment Return",
  bank_fee:                 "Bank Fee",
  other_credit:             "Credit",
  other_debit:              "Debit",
  withdrawal:               "Withdrawal",
};

const TX_ABBR: Record<string, string> = {
  contribution: "CT", loan_disbursement: "LN", loan_repayment: "LR",
  loan_interest_income: "INT", loan_principal_recovery: "PRI",
  interest: "INT", late_fee: "LF", investment_disbursement: "IV",
  investment_return: "IR", bank_fee: "BF", other_credit: "CR",
  other_debit: "DR", withdrawal: "WD",
};

const SORT_OPTIONS = [
  { label: "Newest first",   value: "date_desc" },
  { label: "Oldest first",   value: "date_asc"  },
  { label: "Month",          value: "month"     },
  { label: "Year",           value: "year"      },
];

const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
);

export default function WalletScreen() {
  const router   = useRouter();
  const { width } = useWindowDimensions();
  const isWide   = width >= 768;
  const isXWide  = width >= 1100;

  const group         = useActiveGroup();
  const allTxs        = useGroupWallet();
  const members       = useGroupMembers();
  const role          = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const { deleteWalletTransaction, recalcTotals } = useStore();
  const permissions   = useCurrentMemberPermissions();
  const { show, Toast } = useToast();

  const isAdmin   = role === "admin";
  const canSeeAll = useIsAdminView();

  const txs = useMemo(() =>
    canSeeAll ? allTxs : allTxs.filter(t => t.memberId === currentMember?.id),
    [allTxs, canSeeAll, currentMember]
  );

  const [tab,    setTab]    = useState("All");
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState("date_desc");
  const [page,   setPage]   = useState(1);

  const getMemberName = (id?: string) =>
    id ? (members.find(m => m.id === id)?.fullName ?? "") : "";

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...txs];
    if (tab === "Income")   list = list.filter(t => t.amount > 0);
    if (tab === "Expenses") list = list.filter(t => t.amount < 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.description ?? "").toLowerCase().includes(q) ||
        getMemberName(t.memberId).toLowerCase().includes(q) ||
        (TX_LABEL[t.type] ?? "").toLowerCase().includes(q)
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
  }, [txs, tab, search, sort]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalIn    = useMemo(() => txs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0), [txs]);
  const totalOut   = useMemo(() => Math.abs(txs.filter(t => t.amount < 0).reduce((s,t) => s + t.amount, 0)), [txs]);
  const displayBalance = canSeeAll ? totalIn - totalOut : (currentMember?.totalContributions ?? 0);

  const handleDelete = (tx: WalletTransaction) => {
    let msg = `Delete "${tx.description}"? This cannot be undone.`;
    if (tx.contributionId) msg = `⚠️ This also deletes the linked contribution.\n\n${msg}`;
    if (tx.loanId && ["loan_repayment","loan_interest_income","interest"].includes(tx.type))
      msg = `⚠️ This is part of a loan repayment and will update the loan balance.\n\n${msg}`;
    showConfirm("Delete Transaction", msg, async () => {
      try {
        await deleteWalletTransaction(tx.id, "Deleted by admin");
        show("Transaction deleted");
        recalcTotals();
      } catch { show("Failed to delete", "error"); }
    }, undefined, true);
  };

  const handleTabChange = (t: string) => { setTab(t); setPage(1); };
  const handleSearch    = (v: string) => { setSearch(v); setPage(1); };
  const handleSort      = (v: string) => { setSort(v);  setPage(1); };

  // ── Table row (desktop) ──────────────────────────────────────────────────
  const TableRow = ({ tx }: { tx: WalletTransaction }) => {
    const isCredit = tx.amount > 0;
    return (
      <View style={[wt.tableRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
        <View style={[wt.tableCell, { width: 40 }]}>
          <View style={[wt.txIconSm, { backgroundColor: isCredit ? C.greenBg : C.redBg }]}>
            <Text style={{ fontSize: 9, fontWeight: "800", color: isCredit ? C.greenText : C.redText }}>
              {TX_ABBR[tx.type] ?? "TX"}
            </Text>
          </View>
        </View>
        <Text style={[wt.tableCell, { flex: 2 }]} numberOfLines={1}>{tx.description}</Text>
        <Text style={[wt.tableCell, { width: 160 }]}>{TX_LABEL[tx.type] ?? tx.type}</Text>
        {canSeeAll && <Text style={[wt.tableCell, { width: 150 }]}>{getMemberName(tx.memberId)}</Text>}
        <Text style={[wt.tableCell, { width: 120 }]}>{fmtDate(tx.date)}</Text>
        <Text style={[wt.tableCell, { width: 120, textAlign: "right",
          fontWeight: "700", color: isCredit ? C.accent : C.debit }]}>
          {isCredit ? "+" : "−"}{fmtCurrency(Math.abs(tx.amount))}
        </Text>
        {isAdmin && (
          <View style={[wt.tableCell, { width: 60, alignItems: "center" }]}>
            <TouchableOpacity onPress={() => handleDelete(tx)}>
              <Text style={{ fontSize: 11, color: C.debit, fontWeight: "600" }}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ── Pagination controls ────────────────────────────────────────────────
  const Pagination = () => {
    if (totalPages <= 1) return null;
    return (
      <View style={wt.pagination}>
        <TouchableOpacity
          style={[wt.pageBtn, page === 1 && wt.pageBtnDisabled]}
          onPress={() => page > 1 && setPage(page - 1)}
          disabled={page === 1}
        >
          <Text style={[wt.pageBtnText, page === 1 && { color: C.text3 }]}>← Prev</Text>
        </TouchableOpacity>
        <Text style={wt.pageInfo}>
          {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
        </Text>
        <TouchableOpacity
          style={[wt.pageBtn, page >= totalPages && wt.pageBtnDisabled]}
          onPress={() => page < totalPages && setPage(page + 1)}
          disabled={page >= totalPages}
        >
          <Text style={[wt.pageBtnText, page >= totalPages && { color: C.text3 }]}>Next →</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={[wt.header, isWide && wt.headerWide]}>
        <View>
          <Text style={wt.headerSub}>{canSeeAll ? "Group" : "My"}</Text>
          <Text style={wt.title}>Wallet</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {permissions.addContribution && (
            <TouchableOpacity style={wt.primaryBtn} onPress={() => router.push("/modals/add-contribution")} activeOpacity={0.8}>
              <Text style={wt.primaryBtnText}>+ Contribution</Text>
            </TouchableOpacity>
          )}
          {isAdmin && (
            <TouchableOpacity style={[wt.primaryBtn, { backgroundColor: C.error }]} onPress={() => router.push("/modals/add-expense")} activeOpacity={0.8}>
              <Text style={wt.primaryBtnText}>+ Expense</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, isWide && { paddingHorizontal: 24 }]}
        showsVerticalScrollIndicator={false}>

        {/* ── Balance card ── */}
        <View style={[wt.balanceCard, isWide && { marginHorizontal: 0, maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={wt.cardAccentDot} />
          <Text style={wt.balanceLabel}>{canSeeAll ? "AVAILABLE BALANCE" : "MY SAVINGS"}</Text>
          <Text style={wt.balanceAmount}>
            <Text style={wt.balanceCurrency}>{group?.currency ?? "RWF"} </Text>
            {fmtCurrency(displayBalance, group?.currency ?? "RWF").replace(`${group?.currency ?? "RWF"} `, "")}
          </Text>
          <View style={wt.balancePills}>
            <View style={wt.balancePill}>
              <Text style={wt.balancePillLabel}>TOTAL IN</Text>
              <Text style={[wt.balancePillValue, { color: "#34D399" }]}>+{fmtCurrency(totalIn)}</Text>
            </View>
            <View style={wt.balancePillDivider} />
            <View style={wt.balancePill}>
              <Text style={wt.balancePillLabel}>TOTAL OUT</Text>
              <Text style={[wt.balancePillValue, { color: "#F87171" }]}>−{fmtCurrency(totalOut)}</Text>
            </View>
            <View style={wt.balancePillDivider} />
            <View style={wt.balancePill}>
              <Text style={wt.balancePillLabel}>TRANSACTIONS</Text>
              <Text style={[wt.balancePillValue, { color: "#fff" }]}>{filtered.length}</Text>
            </View>
          </View>
        </View>

        {/* ── Controls: search + tabs + sort ── */}
        <View style={[wt.controls, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          <View style={wt.controlsTop}>
            <View style={{ flex: 1 }}>
              <SearchBar value={search} onChange={handleSearch} placeholder="Search transactions…" />
            </View>
            <View style={wt.sortRow}>
              {SORT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[wt.sortChip, sort === opt.value && wt.sortChipActive]}
                  onPress={() => handleSort(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[wt.sortChipText, sort === opt.value && wt.sortChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TabRow tabs={["All","Income","Expenses"]} active={tab} onChange={handleTabChange} />
        </View>

        {/* ── Transaction list / table ── */}
        <View style={[{ marginTop: 8 }, isWide && { maxWidth: 900, alignSelf: "center" as any, width: "100%" as any }]}>
          {paginated.length === 0 ? (
            <View style={wt.empty}>
              <Text style={wt.emptyIcon}>💱</Text>
              <Text style={wt.emptyText}>No transactions found</Text>
            </View>
          ) : isWide ? (
            // Desktop table
            <View style={wt.table}>
              {/* Table header */}
              <View style={[wt.tableRow, wt.tableHeadRow]}>
                <View style={{ width: 40 }} />
                <Text style={[wt.tableHeadCell, { flex: 2 }]}>DESCRIPTION</Text>
                <Text style={[wt.tableHeadCell, { width: 160 }]}>TYPE</Text>
                {canSeeAll && <Text style={[wt.tableHeadCell, { width: 150 }]}>MEMBER</Text>}
                <Text style={[wt.tableHeadCell, { width: 120 }]}>DATE</Text>
                <Text style={[wt.tableHeadCell, { width: 120, textAlign: "right" }]}>AMOUNT</Text>
                {isAdmin && <View style={{ width: 60 }} />}
              </View>
              {paginated.map(tx => <React.Fragment key={tx.id}><TableRow tx={tx} /></React.Fragment>)}
            </View>
          ) : (
            // Mobile cards
            <View style={wt.card}>
              {paginated.map((tx, i) => (
                <React.Fragment key={tx.id}>
                  <TxRow
                    tx={tx}
                    memberName={canSeeAll ? getMemberName(tx.memberId) : ""}
                    isAdmin={isAdmin}
                    onDelete={() => handleDelete(tx)}
                  />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          <Pagination />
        </View>
      </ScrollView>
      <Toast />
    </View>
  );
}

// ── Mobile card row ────────────────────────────────────────────────────────
function TxRow({ tx, memberName, isAdmin, onDelete }: {
  tx: WalletTransaction; memberName: string; isAdmin: boolean; onDelete: () => void;
}) {
  const isCredit = tx.amount > 0;
  const abbr = TX_ABBR[tx.type] ?? "TX";
  return (
    <View style={wt.txRow}>
      <View style={[wt.txIcon, { backgroundColor: isCredit ? C.greenBg : C.redBg }]}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: isCredit ? C.greenText : C.redText, letterSpacing: 0.3 }}>
          {abbr}
        </Text>
      </View>
      <View style={wt.txMid}>
        <Text style={wt.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={wt.txMeta}>
          {fmtDate(tx.date)}{memberName ? ` · ${memberName}` : ""} · {TX_LABEL[tx.type] ?? tx.type}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[wt.txAmount, { color: isCredit ? C.accent : C.debit }]}>
          {isCredit ? "+" : "−"}{fmtCurrency(Math.abs(tx.amount))}
        </Text>
        {isAdmin && (
          <TouchableOpacity onPress={onDelete} style={{ marginTop: 3 }}>
            <Text style={{ fontSize: 10, color: C.debit, fontWeight: "600" }}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const wt = StyleSheet.create({
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
});
