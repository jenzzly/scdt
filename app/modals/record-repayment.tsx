// app/modals/record-repayment.tsx
import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity, ScrollView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStore, useGroupLoans, useGroupMembers, useActiveGroup, useGroupWallet } from "../../stores/useStore";
import { Input, Button, LoanProgress, useToast } from "../../components/ui";
import { Colors, S, R, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";

// ─── Shared math — mirrors splitRepayment in lib/firestore/loans.ts exactly ──
function computeSplit(loan: {
  amount: number; interestRate: number; interestMethod?: string;
  totalInterest: number; totalRepayable: number; amountRepaid: number; balance: number;
}, payment: number) {
  const method = loan.interestMethod || "flat";
  const p = round2(payment);

  if (method === "reducing_balance") {
    const periodicRate = loan.interestRate / 100;
    const interestDue = round2(loan.balance * periodicRate);
    const remainingTotal = round2(loan.balance + interestDue);
    const isOverpaid = p > remainingTotal;
    const overpaidAmount = isOverpaid ? round2(p - remainingTotal) : 0;
    let interestPortion: number, principalPortion: number;
    if (p >= remainingTotal)       { interestPortion = interestDue;  principalPortion = loan.balance; }
    else if (p <= interestDue)     { interestPortion = p;            principalPortion = 0; }
    else                           { interestPortion = interestDue;  principalPortion = round2(p - interestDue); }
    const newBalance = Math.max(0, round2(loan.balance - principalPortion));
    return {
      interestPortion, principalPortion, overpaidAmount, isOverpaid,
      newBalance,
      // For reducing balance, track by balance only
      remainingPrincipal: loan.balance,
      remainingInterest:  interestDue,
      remainingTotal,
      newRemainingPrincipal: newBalance,
      newRemainingInterest:  isOverpaid ? 0 : round2(interestDue - interestPortion),
      newRemainingTotal:     round2(newBalance + Math.max(0, round2(interestDue - interestPortion))),
      isRepaid: newBalance === 0,
    };
  }

  // ── Flat interest ────────────────────────────────────────────────────────
  // "remaining" is what the server tracks: totalRepayable - amountRepaid
  // amountRepaid covers BOTH principal and interest already paid.
  // We split remaining proportionally between principal and interest.
  const ratio = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
  const remaining = round2(loan.totalRepayable - loan.amountRepaid);
  const isOverpaid = p > remaining;
  const overpaidAmount = isOverpaid ? round2(p - remaining) : 0;
  const effectiveAmt = isOverpaid ? remaining : p;

  const interestPortion  = round2(effectiveAmt * ratio);
  const principalPortion = round2(effectiveAmt - interestPortion);

  // What's left of principal and interest in total-repayable terms
  const paidInterestSoFar    = round2(loan.amountRepaid * ratio);
  const remainingInterest    = Math.max(0, round2(loan.totalInterest - paidInterestSoFar));
  const remainingPrincipal   = loan.balance; // authoritative from server

  const newRemainingInterest  = Math.max(0, round2(remainingInterest - interestPortion));
  const newRemainingPrincipal = Math.max(0, round2(remainingPrincipal - principalPortion));
  const newRemainingTotal     = round2(newRemainingInterest + newRemainingPrincipal);

  return {
    interestPortion,
    principalPortion,
    overpaidAmount,
    isOverpaid,
    newBalance: newRemainingPrincipal,
    remainingPrincipal,
    remainingInterest,
    remainingTotal: remaining,
    newRemainingPrincipal,
    newRemainingInterest,
    newRemainingTotal,
    isRepaid: newRemainingTotal === 0,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function RecordRepaymentModal() {
  const router = useRouter();
  const { loanId } = useLocalSearchParams<{ loanId: string }>();
  const { recordRepayment } = useStore();
  const loans = useGroupLoans();
  const members = useGroupMembers();
  const group = useActiveGroup();
  const walletTxs = useGroupWallet();
  const { show, Toast } = useToast();

  const loan = loans.find((l) => l.id === loanId);
  const member = loan ? members.find((m) => m.id === loan.memberId) : null;
  const currency = group?.currency ?? "RWF";

  const [showHistory, setShowHistory] = useState(false);
  const [amount, setAmount] = useState(String(loan?.monthlyPayment ?? ""));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  // Guard against double-submit
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);

  const pastRepayments = walletTxs
    .filter((tx) => tx.loanId === loanId && tx.type === "loan_repayment")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalRepaid = pastRepayments.reduce((sum, tx) => sum + tx.amount, 0);

  if (!loan) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: Colors.text3 }}>Loan not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: Colors.accent }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pct = loan.totalRepayable > 0 ? round2((loan.amountRepaid / loan.totalRepayable) * 100) : 0;
  const amtNum = parseFloat(amount) || 0;
  const split = amtNum > 0 ? computeSplit(loan, amtNum) : null;

  const doRecord = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await recordRepayment(loan.id, amtNum, new Date(date).toISOString());
      show(split?.isRepaid ? "Loan fully repaid! 🎉" : "Repayment recorded ✅");
      setTimeout(() => router.back(), 600);
    } catch (e: any) {
      show(e?.message || "Failed to record repayment", "error");
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  const handleSave = () => {
    if (!amtNum || amtNum <= 0) { show("Enter a valid amount", "error"); return; }
    if (submitting.current || loading) return;

    if (split?.isOverpaid) {
      showConfirm(
        "Overpayment",
        `This payment (${fmtCurrency(amtNum)}) exceeds the outstanding balance of ${fmtCurrency(split.remainingTotal)}.\n\nThe extra ${fmtCurrency(split.overpaidAmount)} will be credited to the group wallet.\n\nContinue?`,
        doRecord,
      );
      return;
    }
    doRecord();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: Colors.bg }}
    >
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={st.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={st.title}>Record Repayment</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">

        {/* ── Loan Info Card ── */}
        <View style={st.infoCard}>
          <Text style={st.memberName}>{member?.fullName ?? "Unknown"}</Text>
          {loan.purpose ? <Text style={st.purpose}>{loan.purpose}</Text> : null}

          {/* Original loan terms */}
          <View style={st.section}>
            <Text style={st.sectionLabel}>ORIGINAL LOAN</Text>
            <View style={st.row3}>
              <View style={st.col}>
                <Text style={st.colLabel}>Principal</Text>
                <Text style={st.colValue}>{fmtCurrency(loan.amount)}</Text>
              </View>
              <View style={st.colDivider} />
              <View style={st.col}>
                <Text style={st.colLabel}>Interest ({loan.interestRate}%{loan.interestMethod === "reducing_balance" ? " RB" : " flat"})</Text>
                <Text style={st.colValue}>{fmtCurrency(loan.totalInterest)}</Text>
              </View>
              <View style={st.colDivider} />
              <View style={st.col}>
                <Text style={st.colLabel}>Total Due</Text>
                <Text style={[st.colValue, { color: Colors.primary }]}>{fmtCurrency(loan.totalRepayable)}</Text>
              </View>
            </View>
          </View>

          {/* What's left */}
          <View style={[st.section, { borderTopWidth: 1, borderTopColor: Colors.borderLight, marginTop: 0 }]}>
            <Text style={st.sectionLabel}>OUTSTANDING BALANCE</Text>
            <View style={st.row3}>
              <View style={st.col}>
                <Text style={st.colLabel}>Principal Left</Text>
                <Text style={[st.colValue, { color: Colors.error }]}>{fmtCurrency(loan.balance)}</Text>
              </View>
              <View style={st.colDivider} />
              <View style={st.col}>
                <Text style={st.colLabel}>Interest Left</Text>
                <Text style={[st.colValue, { color: Colors.gold }]}>
                  {fmtCurrency(split ? split.remainingInterest : (() => {
                    const ratio = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
                    return Math.max(0, round2(loan.totalInterest - loan.amountRepaid * ratio));
                  })())}
                </Text>
              </View>
              <View style={st.colDivider} />
              <View style={st.col}>
                <Text style={st.colLabel}>Total Left</Text>
                <Text style={[st.colValue, { color: Colors.error, fontWeight: "800" }]}>
                  {fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid))}
                </Text>
              </View>
            </View>
          </View>

          <LoanProgress pct={pct} />
          <Text style={st.progressText}>
            {pct.toFixed(0)}% repaid · {fmtCurrency(loan.amountRepaid)} paid of {fmtCurrency(loan.totalRepayable)}
          </Text>
        </View>

        {/* ── Payment Input ── */}
        <Input
          label={`Payment Amount (${currency}) *`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix={currency}
          hint={`Monthly instalment: ${fmtCurrency(loan.monthlyPayment)}`}
        />
        <Input
          label="Payment Date"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />

        {/* ── Payment Breakdown Preview ── */}
        {split && amtNum > 0 && (
          <View style={[
            st.breakdown,
            split.isRepaid && st.breakdownFull,
            split.isOverpaid && st.breakdownWarning,
          ]}>
            <Text style={st.breakdownTitle}>
              {split.isRepaid ? "✅ Full Repayment" : split.isOverpaid ? "⚠️ Overpayment" : "Payment Breakdown"}
            </Text>

            {/* How this payment is split */}
            <View style={st.bSection}>
              <Text style={st.bSectionLabel}>THIS PAYMENT</Text>
              <View style={st.bRow}>
                <Text style={st.bLabel}>Amount Paid</Text>
                <Text style={[st.bValue, { color: Colors.text, fontWeight: "800" }]}>{fmtCurrency(amtNum)}</Text>
              </View>
              <View style={st.bIndentRow}>
                <Text style={st.bIndentLabel}>↳ Goes to principal</Text>
                <Text style={[st.bValue, { color: Colors.accent }]}>{fmtCurrency(split.principalPortion)}</Text>
              </View>
              <View style={st.bIndentRow}>
                <Text style={st.bIndentLabel}>↳ Goes to interest</Text>
                <Text style={[st.bValue, { color: Colors.gold }]}>{fmtCurrency(split.interestPortion)}</Text>
              </View>
              {split.isOverpaid && (
                <View style={st.bIndentRow}>
                  <Text style={st.bIndentLabel}>↳ Overpayment (credited)</Text>
                  <Text style={[st.bValue, { color: Colors.success }]}>{fmtCurrency(split.overpaidAmount)}</Text>
                </View>
              )}
            </View>

            {/* What remains after */}
            {!split.isOverpaid && (
              <>
                <View style={[st.bDivider]} />
                <View style={st.bSection}>
                  <Text style={st.bSectionLabel}>AFTER THIS PAYMENT</Text>
                  <View style={st.bRow}>
                    <Text style={st.bLabel}>Principal remaining</Text>
                    <Text style={[st.bValue, {
                      color: split.newRemainingPrincipal === 0 ? Colors.success : Colors.error,
                    }]}>
                      {split.newRemainingPrincipal === 0 ? "✓ Cleared" : fmtCurrency(split.newRemainingPrincipal)}
                    </Text>
                  </View>
                  <View style={st.bRow}>
                    <Text style={st.bLabel}>Interest remaining</Text>
                    <Text style={[st.bValue, {
                      color: split.newRemainingInterest === 0 ? Colors.success : Colors.gold,
                    }]}>
                      {split.newRemainingInterest === 0 ? "✓ Cleared" : fmtCurrency(split.newRemainingInterest)}
                    </Text>
                  </View>
                  <View style={[st.bRow, st.bRowTotal]}>
                    <Text style={st.bLabelTotal}>Total still owed</Text>
                    <Text style={[st.bValueTotal, {
                      color: split.isRepaid ? Colors.success : Colors.error,
                    }]}>
                      {split.isRepaid ? "✓ FULLY PAID" : fmtCurrency(split.newRemainingTotal)}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* Progress bar after payment */}
            <View style={st.progressAfter}>
              <View style={st.progressBar}>
                <View style={[st.progressFill, {
                  width: `${Math.min(100, round2(((loan.amountRepaid + (split.isOverpaid ? split.remainingTotal : amtNum)) / loan.totalRepayable) * 100))}%` as any,
                }]} />
              </View>
              <Text style={st.progressAfterText}>
                {Math.min(100, round2(((loan.amountRepaid + (split.isOverpaid ? split.remainingTotal : amtNum)) / loan.totalRepayable) * 100)).toFixed(0)}% complete after this payment
              </Text>
            </View>
          </View>
        )}

        {/* ── Past Payments ── */}
        {pastRepayments.length > 0 && (
          <View style={st.historyCard}>
            <TouchableOpacity style={st.historyHeader} onPress={() => setShowHistory(!showHistory)} activeOpacity={0.7}>
              <Text style={st.historyTitle}>📜 Payment History ({pastRepayments.length})</Text>
              <Text style={st.historyChevron}>{showHistory ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {showHistory && (
              <View style={st.historyBody}>
                {pastRepayments.map((tx, i) => (
                  <View key={tx.id} style={[st.historyRow, i < pastRepayments.length - 1 && st.historyRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.historyDate}>{fmtDate(tx.date)}</Text>
                      <Text style={st.historyDesc} numberOfLines={1}>{tx.description || `Repayment #${pastRepayments.length - i}`}</Text>
                    </View>
                    <Text style={st.historyAmt}>{fmtCurrency(tx.amount)}</Text>
                  </View>
                ))}
                <View style={st.historyTotalRow}>
                  <Text style={st.historyTotalLabel}>Total Paid</Text>
                  <Text style={st.historyTotalValue}>{fmtCurrency(totalRepaid)}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        <Button
          label={split?.isRepaid ? "Complete — Pay Off Loan" : "Record Payment"}
          onPress={handleSave}
          fullWidth
          loading={loading}
          size="lg"
        />

        <View style={st.note}>
          <Text style={st.noteTitle}>How payments work</Text>
          <Text style={st.noteLine}>Each payment is split proportionally between principal and interest based on how much of each remains.</Text>
          <Text style={st.noteLine}>Paying more than the outstanding balance generates a wallet credit for the difference.</Text>
        </View>

      </ScrollView>
      <Toast />
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.lg, paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title:  { fontSize: 17, fontWeight: "700", color: Colors.text },
  cancel: { color: Colors.accent, fontSize: 15, fontWeight: "600" },
  body:   { padding: S.lg, paddingBottom: 60 },

  // Loan info card
  infoCard: {
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg, marginBottom: S.xl,
  },
  memberName: { fontSize: 17, fontWeight: "700", color: Colors.text },
  purpose:    { fontSize: 12, color: Colors.text3, marginTop: 2, marginBottom: 12 },
  section:    { paddingVertical: 12 },
  sectionLabel: {
    fontSize: 9, fontWeight: "700", color: Colors.text3, letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 10,
  },
  row3: { flexDirection: "row", alignItems: "flex-start" },
  col:  { flex: 1, alignItems: "center" },
  colDivider: { width: 1, backgroundColor: Colors.borderLight, marginHorizontal: 4, alignSelf: "stretch" },
  colLabel: { fontSize: 10, color: Colors.text3, marginBottom: 4, textAlign: "center" },
  colValue: { fontSize: 13, fontWeight: "700", color: Colors.text, textAlign: "center" },
  progressText: { fontSize: 11, color: Colors.text3, marginTop: 4, textAlign: "center" },

  // Breakdown card
  breakdown: {
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg, marginBottom: S.xl,
  },
  breakdownFull:    { borderColor: "rgba(34,197,94,0.4)", backgroundColor: "rgba(34,197,94,0.05)" },
  breakdownWarning: { borderColor: "rgba(245,158,11,0.4)", backgroundColor: "rgba(245,158,11,0.05)" },
  breakdownTitle: {
    fontSize: 13, fontWeight: "700", color: Colors.text,
    textAlign: "center", marginBottom: 14,
  },

  bSection:      { marginBottom: 4 },
  bSectionLabel: {
    fontSize: 9, fontWeight: "700", color: Colors.text3, letterSpacing: 1,
    textTransform: "uppercase", marginBottom: 8,
  },
  bRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  bRowTotal: {
    marginTop: 6, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  bIndentRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 4, paddingLeft: 16,
  },
  bLabel:       { fontSize: 13, color: Colors.text2 },
  bIndentLabel: { fontSize: 12, color: Colors.text3, fontStyle: "italic" },
  bValue:       { fontSize: 13, fontWeight: "700", color: Colors.text },
  bLabelTotal:  { fontSize: 13, fontWeight: "700", color: Colors.text },
  bValueTotal:  { fontSize: 14, fontWeight: "800", color: Colors.text },
  bDivider:     { height: 1, backgroundColor: Colors.borderLight, marginVertical: 10 },

  // Progress after
  progressAfter:    { marginTop: 12 },
  progressBar:      { height: 6, backgroundColor: Colors.elevated, borderRadius: 3, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  progressFill:     { height: "100%" as any, backgroundColor: Colors.accent, borderRadius: 3 },
  progressAfterText:{ fontSize: 10, color: Colors.text3, marginTop: 4, textAlign: "center" },

  // History
  historyCard: {
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, marginBottom: S.xl, overflow: "hidden",
  },
  historyHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: S.md, backgroundColor: Colors.surface,
  },
  historyTitle:   { fontSize: 13, fontWeight: "600", color: Colors.text },
  historyChevron: { fontSize: 12, color: Colors.text3 },
  historyBody:    { paddingHorizontal: S.md, paddingBottom: S.md, paddingTop: 4 },
  historyRow:     { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  historyRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  historyDate:    { fontSize: 11, color: Colors.text3 },
  historyDesc:    { fontSize: 12, color: Colors.text2, marginTop: 1 },
  historyAmt:     { fontSize: 13, fontWeight: "700", color: Colors.text },
  historyTotalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  historyTotalLabel: { fontSize: 12, fontWeight: "600", color: Colors.text3 },
  historyTotalValue: { fontSize: 14, fontWeight: "800", color: Colors.primary },

  // Note
  note:      { backgroundColor: Colors.primaryFaint, borderRadius: R.md, padding: S.md, marginTop: S.md },
  noteTitle: { fontSize: 12, fontWeight: "700", color: Colors.primary, marginBottom: 6 },
  noteLine:  { fontSize: 11, color: Colors.text3, marginBottom: 4, lineHeight: 16 },
});
