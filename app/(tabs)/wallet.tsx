// app/(tabs)/wallet.tsx
import React, { useMemo, useState, useEffect } from "react";
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
  useActiveGroup, useGroupWallet, useGroupMembers,
  useCurrentUserRole, useCurrentMember,
  useIsGroupView, useStore,
} from "../../stores/useStore";
import { TabRow, SearchBar, useToast, Toast } from "../../components/ui";
import {
  C as LightPalette,
  D as DarkPalette,
  type Palette,
  fmtCurrency,
  fmtDate,
  showConfirm,
} from "../../utils/theme";
import { Layout } from "../../utils/theme";
import { useTheme } from "../../hooks/useTheme";
import type { WalletTransaction } from "../../types";
import {
  useCurrentMemberPermissions,
  useMyMemberIds,
  findMemberByAnyId,
} from "../../stores/selectors";
import { KpiCard } from "../../components/ui/KpiCard";
import {
  FINANCIAL_EDIT_ROLES,
  canViewWallet,
} from "../../lib/auth/permissions";
import { BalanceSheetTab } from "../../components/wallet/BalanceSheetTab";

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
  bank_reconciliation:      "Bank Reconciliation",
};

const TX_ABBR: Record<string, string> = {
  contribution: "CT", loan_disbursement: "LN", loan_repayment: "LR",
  loan_interest_income: "INT", loan_principal_recovery: "PRI",
  interest: "INT", late_fee: "LF", investment_disbursement: "IV",
  investment_return: "IR", bank_fee: "BF", other_credit: "CR",
  other_debit: "DR", withdrawal: "WD", bank_reconciliation: "REC",
};

const SORT_OPTIONS = [
  { label: "Newest first",   value: "date_desc" },
  { label: "Oldest first",   value: "date_asc"  },
  { label: "Month",          value: "month"     },
  { label: "Year",           value: "year"      },
];

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  bank_charges: "Bank Charges",
  communication: "Communication",
  meeting: "Meeting Expenses",
  system_maintenance: "System Maintenance",
  administrative: "Administrative Costs",
  transport: "Transport",
  other: "Other",
};

const PERSONAL_TABS = ["Savings", "Loans", "Fees", "Activity"];

const GROUP_TABS = [
  "Balances",
  "Income",
  "Expenses",
  "Reconciliations",
  "Balance Sheet",
];

const SAVING_TYPES = new Set(["contribution"]);
const LOAN_TYPES = new Set([
  "loan_disbursement",
  "loan_repayment",
  "loan_interest_income",
  "loan_principal_recovery",
  "interest",
]);
const FEE_TYPES = new Set(["late_fee"]);

const Divider = () => {
  const C = useTheme();
  return (
    <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
  );
};

export default function WalletScreen() {
  const C = useTheme();
  const wt = useMemo(() => makeWt(C), [C]);

  const router   = useRouter();
  const { width } = useWindowDimensions();
  const isWide   = width >= 768;

  const group         = useActiveGroup();
  const allTxs        = useGroupWallet();
  const members       = useGroupMembers();
  const role          = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const { deleteWalletTransaction, recalcTotals } = useStore();
  const permissions   = useCurrentMemberPermissions();
  const { show, visible, msg, type } = useToast();

  const isAdmin   = role === "admin";
  const canEdit   = FINANCIAL_EDIT_ROLES.includes(role);
  const isGroupView = useIsGroupView();
  const canSeeAll = isGroupView;
  const canView   = canViewWallet(role, permissions);

  const myIds = useMyMemberIds();

  const txs = useMemo(() =>
    canSeeAll
      ? allTxs
      : allTxs.filter(
          (t) =>
            myIds.has(t.memberId ?? "") ||
            myIds.has((t as any).userId ?? ""),
        ),
    [allTxs, canSeeAll, myIds]
  );

  const isPersonal = !canSeeAll;
  const tabs = isPersonal ? PERSONAL_TABS : GROUP_TABS;

  const [tab, setTab] = useState<string>(tabs[0]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setTab(isPersonal ? PERSONAL_TABS[0] : GROUP_TABS[0]);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersonal]);

  const getMemberName = (id?: string) =>
    id ? (findMemberByAnyId(members, id)?.fullName ?? "") : "";

  const filtered = useMemo(() => {
    let list = [...txs];

    if (tab === "Savings") list = list.filter(t => SAVING_TYPES.has(t.type));
    if (tab === "Loans")   list = list.filter(t => LOAN_TYPES.has(t.type));
    if (tab === "Fees")    list = list.filter(t => FEE_TYPES.has(t.type));

    if (tab === "Income")         list = list.filter(t => t.amount > 0);
    if (tab === "Expenses")       list = list.filter(t => t.amount < 0);
    if (tab === "Reconciliations") list = list.filter(t => t.type === "bank_reconciliation");

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.description ?? "").toLowerCase().includes(q) ||
        getMemberName(t.memberId).toLowerCase().includes(q) ||
        (TX_LABEL[t.type] ?? "").toLowerCase().includes(q)
      );
    }

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

  const expenseGroups = useMemo(() => {
    if (tab !== "Expenses") return null;
    const groups: Record<string, { total: number; count: number }> = {};
    for (const t of filtered) {
      const key = (t as any).expenseCategory || "other";
      if (!groups[key]) groups[key] = { total: 0, count: 0 };
      groups[key].total += Math.abs(t.amount);
      groups[key].count += 1;
    }
    return groups;
  }, [filtered, tab]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalIn    = useMemo(() => txs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0), [txs]);
  const totalOut   = useMemo(() => Math.abs(txs.filter(t => t.amount < 0).reduce((s,t) => s + t.amount, 0)), [txs]);
  const displayBalance = canSeeAll
    ? totalIn - totalOut
    : (currentMember?.totalContributions ?? 0);

  const handleDelete = (tx: WalletTransaction) => {
    let delMsg = `Delete "${tx.description}"? This cannot be undone.`;
    if (tx.loanId || tx.sourceType === "loan" || ["loan_disbursement", "loan_repayment", "loan_interest_income", "loan_principal_recovery", "interest"].includes(tx.type)) {
      delMsg = `⚠️ This will cascade delete the linked loan and ALL associated loan transactions.\n\n${delMsg}`;
    } else if (tx.contributionId || tx.sourceType === "contribution") {
      delMsg = `⚠️ This will cascade delete the linked contribution and update member savings.\n\n${delMsg}`;
    } else if (tx.investmentId || tx.sourceType === "investment" || ["investment_disbursement", "investment_return"].includes(tx.type)) {
      delMsg = `⚠️ This will cascade delete the linked investment and its associated transactions.\n\n${delMsg}`;
    } else if (tx.id.startsWith("meeting-penalty-") || (tx.type === "late_fee" && tx.description.toLowerCase().includes("meeting"))) {
      delMsg = `⚠️ This will delete this meeting fee and clear the penalty from the meeting attendance.\n\n${delMsg}`;
    } else if (tx.sourceType === "manual" && tx.sourceId) {
      delMsg = `⚠️ This will delete this transaction and any linked record.\n\n${delMsg}`;
    }

    showConfirm("Delete Transaction", delMsg, async () => {
      try {
        await deleteWalletTransaction(tx.id, "Deleted by admin");
        show("Transaction deleted");
        recalcTotals();
      } catch { show("Failed to delete", "error"); }
    }, undefined, true);
  };

  const handleEdit = (tx: WalletTransaction) => {
    router.push({
      pathname: "/modals/edit-transaction",
      params: { id: tx.id },
    });
  };

  const handleTabChange = (t: string) => { setTab(t); setPage(1); };
  const handleSearch    = (v: string) => { setSearch(v); setPage(1); };
  const handleSort      = (v: string) => { setSort(v);  setPage(1); };

  if (!canView) {
    return (
      <View style={wt.noAccess}>
        <View style={wt.noAccessCard}>
          <Text style={wt.noAccessIcon}>🔒</Text>
          <Text style={wt.noAccessTitle}>Wallet access required</Text>
          <Text style={wt.noAccessBody}>
            This page shows the group's transaction ledger and bank
            balance. Ask your group admin to grant wallet access from
            Group Settings → Permissions.
          </Text>
        </View>
      </View>
    );
  }

  if (tab === "Balance Sheet") {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={[wt.topBar, isWide && Layout.insetColumn]}>
          <View>
            <Text style={wt.pageSummaryLabel}>Group Vault</Text>
            <Text style={wt.pageSummaryTitle}>Balance Sheet</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
          <TabRow tabs={tabs} active={tab} onChange={handleTabChange} />
        </View>

        <ScrollView
          contentContainerStyle={[{ paddingBottom: 100 }, isWide && Layout.insetColumn]}
          showsVerticalScrollIndicator={false}
        >
          <BalanceSheetTab />
        </ScrollView>

        <Toast visible={visible} msg={msg} type={type} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[wt.topBar, isWide && Layout.insetColumn]}>
        <View>
          <Text style={wt.pageSummaryLabel}>
            {canSeeAll ? "Group Vault & Ledger" : "My Wallet"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {canSeeAll && permissions.addContribution && (
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

      <ScrollView contentContainerStyle={[{ paddingBottom: 100 }, isWide && Layout.insetColumn]}
        showsVerticalScrollIndicator={false}>

        <View style={[wt.block]}>
          <View style={wt.kpiGrid}>
            <KpiCard
              label={canSeeAll ? "Balance" : "My Contributions"}
              value={fmtCurrency(displayBalance)}
              icon="💰"
              subtext={canSeeAll ? "Group vault balance" : "Approved regular savings"}
              accentColor={C.primary}
              onPress={() => {}}
            />
            <KpiCard
              label="Total In"
              value={fmtCurrency(totalIn)}
              icon="📈"
              subtext="All credits"
              accentColor={C.success}
              onPress={() => { handleTabChange(canSeeAll ? "Income" : tabs[0]); }}
            />
            <KpiCard
              label="Total Out"
              value={fmtCurrency(totalOut)}
              icon="📉"
              subtext="All debits"
              accentColor={C.error}
              onPress={() => { handleTabChange(canSeeAll ? "Expenses" : tabs[0]); }}
            />
            <KpiCard
              label="Transactions"
              value={String(filtered.length)}
              icon="📊"
              subtext="Total records"
              accentColor={C.accent}
              onPress={() => {}}
            />
          </View>
        </View>

        <View style={[wt.controls]}>
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
          <TabRow tabs={tabs} active={tab} onChange={handleTabChange} />
        </View>

        {tab === "Expenses" && expenseGroups && (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            {Object.entries(expenseGroups).length === 0 ? (
              <Text style={{ fontSize: 12, color: C.text3, textAlign: "center", paddingVertical: 16 }}>
                No expenses recorded yet.
              </Text>
            ) : (
              <View style={{
                backgroundColor: C.surface,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: C.border,
                overflow: "hidden",
              }}>
                <View style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: C.border,
                  backgroundColor: C.elevated,
                }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: C.text3, letterSpacing: 0.6 }}>
                    CATEGORY SUBTOTALS
                  </Text>
                </View>
                {Object.entries(expenseGroups)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([cat, agg]) => (
                    <View key={cat} style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: C.borderLight,
                    }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: C.text }} numberOfLines={1}>
                          {EXPENSE_CATEGORY_LABELS[cat] || cat}
                        </Text>
                        <Text style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
                          {agg.count} entr{agg.count !== 1 ? "ies" : "y"}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 14, fontWeight: "800", color: C.error }} numberOfLines={1}>
                        {fmtCurrency(agg.total)}
                      </Text>
                    </View>
                  ))}
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: C.elevated,
                }}>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: "800", color: C.text }}>
                    Total expenses
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: C.error }}>
                    {fmtCurrency(
                      Object.values(expenseGroups).reduce((s, g) => s + g.total, 0),
                    )}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        <View style={[{ marginTop: 8 }]}>
          {paginated.length === 0 ? (
            <View style={wt.empty}>
              <Text style={wt.emptyIcon}>💱</Text>
              <Text style={wt.emptyText}>No transactions found</Text>
            </View>
          ) : isWide ? (
            <View style={wt.table}>
              <View style={[wt.tableRow, wt.tableHeadRow]}>
                <View style={{ width: 40 }} />
                <Text style={[wt.tableHeadCell, { flex: 2 }]}>DESCRIPTION</Text>
                <Text style={[wt.tableHeadCell, { width: 160 }]}>TYPE</Text>
                {canSeeAll && <Text style={[wt.tableHeadCell, { width: 150 }]}>MEMBER</Text>}
                <Text style={[wt.tableHeadCell, { width: 120 }]}>DATE</Text>
                <Text style={[wt.tableHeadCell, { width: 120, textAlign: "right" }]}>AMOUNT</Text>
                {(canEdit || isAdmin) && (
                  <View style={{ width: isAdmin && canEdit ? 110 : 60 }} />
                )}
              </View>
              {paginated.map(tx => <TableRow key={tx.id} tx={tx} />)}
            </View>
          ) : (
            <View style={wt.card}>
              {paginated.map((tx, i) => (
                <React.Fragment key={tx.id}>
                  <TxRow
                    tx={tx}
                    memberName={canSeeAll ? getMemberName(tx.memberId) : ""}
                    isAdmin={isAdmin}
                    canEdit={canEdit}
                    onDelete={() => handleDelete(tx)}
                    onEdit={() => handleEdit(tx)}
                  />
                  {i < paginated.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          {totalPages > 1 && (
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
          )}
        </View>
      </ScrollView>
      <Toast visible={visible} msg={msg} type={type}/>
    </View>
  );
}

function TableRow({ tx }: { tx: WalletTransaction }) {
  const C = useTheme();
  const wt = useMemo(() => makeWt(C), [C]);
  const members = useGroupMembers();

  const isCredit = tx.amount > 0;
  const memberName = tx.memberId
    ? members.find((m) => m.id === tx.memberId)?.fullName ?? ""
    : "";

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
      {memberName ? <Text style={[wt.tableCell, { width: 150 }]}>{memberName}</Text> : <View style={{ width: 150 }} />}
      <Text style={[wt.tableCell, { width: 120 }]}>{fmtDate(tx.date)}</Text>
      <Text style={[wt.tableCell, { width: 120, textAlign: "right", fontWeight: "700", color: isCredit ? C.accent : C.debit }]}>
        {isCredit ? "+" : "−"}{fmtCurrency(Math.abs(tx.amount))}
      </Text>
    </View>
  );
}

function TxRow({ tx, memberName, isAdmin, canEdit, onDelete, onEdit }: {
  tx: WalletTransaction; memberName: string; isAdmin: boolean; canEdit: boolean;
  onDelete: () => void; onEdit: () => void;
}) {
  const C = useTheme();
  const wt = useMemo(() => makeWt(C), [C]);

  const isCredit = tx.amount > 0;
  const abbr = TX_ABBR[tx.type] ?? "TX";

  return (
    <View style={[wt.txRow, { borderLeftColor: isCredit ? C.success : C.error }]}>
      <View style={[wt.txIcon, { backgroundColor: isCredit ? C.greenBg : C.redBg }]}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: isCredit ? C.greenText : C.redText, letterSpacing: 0.3 }}>
          {abbr}
        </Text>
      </View>

      <View style={wt.txMid}>
        <Text style={wt.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={wt.txMeta} numberOfLines={1}>
          {fmtDate(tx.date)}
          {memberName ? ` · ${memberName}` : ""}
          {" · "}
          {TX_LABEL[tx.type] ?? tx.type}
        </Text>
      </View>

      <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
        <Text style={[wt.txAmount, { color: isCredit ? C.success : C.error }]} numberOfLines={1}>
          {isCredit ? "+" : "−"}{fmtCurrency(Math.abs(tx.amount))}
        </Text>

        {(canEdit || isAdmin) && (
          <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
            {canEdit && (
              <TouchableOpacity onPress={onEdit} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={wt.rowAction}>Edit</Text>
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={[wt.rowAction, { color: C.debit }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const makeWt = (C: Palette) => StyleSheet.create({
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  pageSummaryLabel: { fontSize: 10, fontWeight: "700", color: C.primary, textTransform: "uppercase", letterSpacing: 0.6 },
  pageSummaryTitle: { fontSize: 15, fontWeight: "800", color: C.text, letterSpacing: -0.2, marginTop: 1 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  block: { marginHorizontal: 16, marginBottom: 14 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginHorizontal: 16, overflow: "hidden" },
  txRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, paddingRight: 14, paddingLeft: 12,
    gap: 12, borderLeftWidth: 3, borderLeftColor: C.border,
  },
  txIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txMeta: { fontSize: 11, color: C.text3 },
  txAmount: { fontSize: 14, fontWeight: "700" },
  rowAction: { fontSize: 10, color: C.primary, fontWeight: "700" },
  table: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginHorizontal: Layout.gutter, overflow: "hidden" },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12 },
  tableHeadRow: { backgroundColor: C.elevated, borderBottomWidth: 1, borderBottomColor: C.border },
  tableCell: { fontSize: 12, color: C.text2, paddingHorizontal: 6 },
  tableHeadCell: { fontSize: 10, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 6 },
  txIconSm: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyText: { fontSize: 14, color: C.text3 },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 16 },
  pageBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: "600", color: C.text },
  pageInfo: { fontSize: 12, color: C.text3 },
  noAccess: {
    flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 24,
  },
  noAccessCard: {
    maxWidth: 460, width: "100%", padding: 28, borderRadius: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", gap: 12,
  },
  noAccessIcon: { fontSize: 40 },
  noAccessTitle: {
    fontSize: 16, fontWeight: "800", color: C.text, textAlign: "center",
  },
  noAccessBody: {
    fontSize: 13, color: C.text3, textAlign: "center", lineHeight: 19,
  },
});

const lightWt = makeWt(LightPalette);
const darkWt = makeWt(DarkPalette);
