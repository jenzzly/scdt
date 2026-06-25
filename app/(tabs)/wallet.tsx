// app/(tabs)/wallet.tsx
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import {
  useActiveGroup, useGroupWallet, useGroupMembers,
  useCurrentUserRole, useCurrentMember,
} from "../../stores/useStore";
import { TabRow, SearchBar, useToast } from "../../components/ui";
import { Colors, S, R, C, fmtCurrency, fmtDate, showConfirm } from "../../utils/theme";
import type { WalletTransaction } from "../../types";
import { useStore } from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";

const TX_LABEL: Record<string, string> = {
  contribution: "Contribution", loan_disbursement: "Loan Disbursement",
  loan_repayment: "Loan Repayment", interest: "Interest Earned",
  late_fee: "Late Fee", investment_disbursement: "Investment",
  investment_return: "Investment Return", bank_fee: "Bank Fee",
  other_credit: "Credit", other_debit: "Debit", withdrawal: "Withdrawal",
};

const TX_ABBR: Record<string, string> = {
  contribution: "CT", loan_disbursement: "LN", loan_repayment: "LR",
  interest: "INT", late_fee: "LF", investment_disbursement: "IV",
  investment_return: "IR", bank_fee: "BF", other_credit: "CR",
  other_debit: "DR", withdrawal: "WD",
};

const Divider = () => <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />;

export default function WalletScreen() {
  const router = useRouter();
  const group = useActiveGroup();
  const allTxs = useGroupWallet();
  const members = useGroupMembers();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const { deleteWalletTransaction, recalcTotals } = useStore();
  const permissions = useCurrentMemberPermissions();
  const { show, Toast } = useToast();

  const isAdmin = role === "admin";
  const canSeeAll = ["admin","loan_officer","committee","accountant"].includes(role);
  const txs = useMemo(() => canSeeAll ? allTxs : allTxs.filter(t => t.memberId === currentMember?.id), [allTxs, canSeeAll, currentMember]);

  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");

  const getMemberName = (id?: string) => id ? (members.find(m => m.id === id)?.fullName ?? "") : "";

  const filtered = useMemo(() => {
    let list = [...txs];
    if (tab === "Income")   list = list.filter(t => t.amount > 0);
    if (tab === "Expenses") list = list.filter(t => t.amount < 0);
    if (search) list = list.filter(t =>
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      (t.memberId && getMemberName(t.memberId).toLowerCase().includes(search.toLowerCase()))
    );
    return list;
  }, [txs, tab, search]);

  const totalIn  = useMemo(() => txs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0), [txs]);
  const totalOut = useMemo(() => Math.abs(txs.filter(t => t.amount < 0).reduce((s,t) => s + t.amount, 0)), [txs]);
  const displayBalance = canSeeAll ? totalIn - totalOut : (currentMember?.totalContributions ?? 0);

  const handleDelete = (tx: WalletTransaction) => {
    let msg = `Delete "${tx.description}"? This cannot be undone.`;
    if (tx.contributionId) msg = `⚠️ This is linked to a contribution. Deleting it also deletes the contribution.\n\n${msg}`;
    if (tx.loanId && (tx.type === "loan_repayment" || tx.type === "interest")) msg = `⚠️ This is part of a loan repayment. Deleting it will update the loan balance.\n\n${msg}`;
    showConfirm("Delete Transaction", msg, async () => {
      try { await deleteWalletTransaction(tx.id, "Deleted by admin"); show("Transaction deleted"); recalcTotals(); }
      catch { show("Failed to delete transaction", "error"); }
    }, undefined, true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.header}>
        <View>
          <Text style={st.headerSub}>{canSeeAll ? "Group" : "My"}</Text>
          <Text style={st.title}>Wallet</Text>
        </View>
        {permissions.addContribution && (
          <TouchableOpacity style={st.primaryBtn} onPress={() => router.push("/modals/add-expense")} activeOpacity={0.8}>
            <Text style={st.primaryBtnText}>+ Expense</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Balance card — dark navy, same as dashboard */}
        <View style={st.balanceCard}>
          <View style={st.cardAccentDot} />
          <Text style={st.balanceLabel}>{canSeeAll ? "AVAILABLE BALANCE" : "MY SAVINGS"}</Text>
          <Text style={st.balanceAmount}>
            <Text style={st.balanceCurrency}>{group?.currency ?? "RWF"} </Text>
            {Math.round(displayBalance).toLocaleString()}
          </Text>

          <View style={st.balancePills}>
            <View style={st.balancePill}>
              <Text style={st.balancePillLabel}>TOTAL IN</Text>
              <Text style={[st.balancePillValue, { color: "#34D399" }]}>+{fmtCurrency(totalIn)}</Text>
            </View>
            <View style={st.balancePillDivider} />
            <View style={st.balancePill}>
              <Text style={st.balancePillLabel}>TOTAL OUT</Text>
              <Text style={[st.balancePillValue, { color: "#F87171" }]}>−{fmtCurrency(totalOut)}</Text>
            </View>
          </View>

          {permissions.addContribution && (
            <TouchableOpacity style={st.addContribBtn} onPress={() => router.push("/modals/add-contribution")} activeOpacity={0.85}>
              <Text style={st.addContribBtnText}>+ Add Contribution</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search transactions…" />
          <TabRow tabs={["All","Income","Expenses"]} active={tab} onChange={setTab} />

          {filtered.length === 0 ? (
            <View style={st.empty}>
              <Text style={st.emptyIcon}>💱</Text>
              <Text style={st.emptyText}>No transactions found</Text>
            </View>
          ) : (
            <View style={st.card}>
              {filtered.map((tx, i) => (
                <React.Fragment key={tx.id}>
                  <TxRow tx={tx} memberName={canSeeAll ? getMemberName(tx.memberId) : ""} isAdmin={isAdmin} onDelete={() => handleDelete(tx)} />
                  {i < filtered.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <Toast />
    </View>
  );
}

function TxRow({ tx, memberName, isAdmin, onDelete }: {
  tx: WalletTransaction; memberName: string; isAdmin: boolean; onDelete: () => void;
}) {
  const isCredit = tx.amount > 0;
  const abbr = TX_ABBR[tx.type] ?? "TX";
  return (
    <View style={st.txRow}>
      <View style={[st.txIcon, { backgroundColor: isCredit ? C.greenBg : C.redBg }]}>
        <Text style={{ fontSize: 11, fontWeight: "800", color: isCredit ? C.greenText : C.redText, letterSpacing: 0.3 }}>{abbr}</Text>
      </View>
      <View style={st.txMid}>
        <Text style={st.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={st.txMeta}>{fmtDate(tx.date)}{memberName ? ` · ${memberName}` : ""} · {TX_LABEL[tx.type] ?? tx.type}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[st.txAmount, { color: isCredit ? C.accent : C.debit }]}>
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

const st = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14, backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerSub: { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.5, marginTop: 1 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  balanceCard: {
    margin: 16, borderRadius: 20, backgroundColor: C.card,
    padding: 24, overflow: "hidden",
  },
  cardAccentDot: {
    position: "absolute", top: -50, right: -30,
    width: 140, height: 140, borderRadius: 70,
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
  balancePillValue: { fontSize: 13, fontWeight: "700", marginTop: 3 },
  balancePillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  addContribBtn: {
    backgroundColor: C.accent, borderRadius: 10,
    paddingVertical: 11, alignItems: "center", marginTop: 16,
  },
  addContribBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  txRow: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  txMid: { flex: 1 },
  txDesc: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 2 },
  txMeta: { fontSize: 11, color: C.text3 },
  txAmount: { fontSize: 13, fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyIcon: { fontSize: 32 },
  emptyText: { fontSize: 14, color: C.text2, fontWeight: "500" },
});