// app/modals/record-repayment.tsx
//
// Mirror of splitRepayment() in lib/firestore/loans.ts — MUST stay in sync.
// For reducing-balance loans: daily accrual on exact calendar days.
// For flat loans: proportional split on totalRepayable.
//
import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TouchableOpacity, ScrollView, TextInput} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStore, useGroupLoans, useGroupMembers, useActiveGroup, useGroupWallet } from "../../stores/useStore";
import { Button, useToast, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, R, fmtCurrency, round2, showConfirm, fmtFull } from "../../utils/theme";

// ─────────────────────────────────────────────────────────────────────────────
// Math — exact mirror of lib/firestore/loans.ts splitRepayment
// ─────────────────────────────────────────────────────────────────────────────
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10)).getTime();
  const b = new Date(toIso.slice(0, 10)).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

interface Split {
  interestPortion:       number;
  principalPortion:      number;
  overpaidAmount:        number;
  isOverpaid:            boolean;
  daysAccrued:           number;
  dailyRatePct:          number;
  annualRatePct:         number;
  newInterestAccrued:    number;
  priorAccruedInterest:  number;
  totalAccruedBefore:    number;
  accruedAfter:          number;
  newBalance:            number;
  newAmountRepaid:       number;
  newTotalInterestPaid:  number;
  isRepaid:              boolean;
}

function toAnnualRate(ratePercent: number, period?: "monthly" | "annual"): number {
  return period === "monthly" ? ratePercent * 12 : ratePercent;
}

function computeSplit(loan: any, payment: number, paymentDate: string): Split {
  const p      = round2(payment);
  const method = loan.interestMethod || "flat";

  if (method === "reducing_balance") {
    const annualRate = toAnnualRate(loan.interestRate, loan.interestRatePeriod ?? "monthly");
    const dailyRate  = annualRate / 100 / 365;
    const fromDate  = loan.lastAccrualDate ?? paymentDate;
    const days      = daysBetween(fromDate, paymentDate);
    const newInterestAccrued  = round2(loan.balance * dailyRate * days);
    const priorAccrued        = round2(loan.accruedInterest ?? 0);
    const totalAccrued        = round2(priorAccrued + newInterestAccrued);
    const totalDue            = round2(loan.balance + totalAccrued);
    const isOverpaid          = p > totalDue;
    const overpaidAmount      = isOverpaid ? round2(p - totalDue) : 0;
    const effectiveAmt        = isOverpaid ? totalDue : p;
    const interestPortion     = round2(Math.min(effectiveAmt, totalAccrued));
    const principalPortion    = round2(effectiveAmt - interestPortion);
    const accruedAfter        = round2(totalAccrued - interestPortion);
    const newBalance          = Math.max(0, round2(loan.balance - principalPortion));
    const newAmountRepaid     = round2((loan.amountRepaid || 0) + effectiveAmt);
    const newTotalInterestPaid= round2((loan.totalInterestPaid || 0) + interestPortion);
    return {
      interestPortion, principalPortion, overpaidAmount, isOverpaid,
      daysAccrued: days, dailyRatePct: round2(dailyRate * 100),
      annualRatePct: annualRate,
      newInterestAccrued, priorAccruedInterest: priorAccrued,
      totalAccruedBefore: totalAccrued, accruedAfter,
      newBalance, newAmountRepaid, newTotalInterestPaid,
      isRepaid: newBalance === 0 && accruedAfter === 0,
    };
  }

  // Flat
  const amountRepaid   = loan.amountRepaid || 0;
  const remaining      = round2(loan.totalRepayable - amountRepaid);
  const isOverpaid     = p > remaining;
  const overpaidAmount = isOverpaid ? round2(p - remaining) : 0;
  const effectiveAmt   = isOverpaid ? remaining : p;
  const ratio          = loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
  const interestPortion  = round2(effectiveAmt * ratio);
  const principalPortion = round2(effectiveAmt - interestPortion);
  const newAmountRepaid  = round2(amountRepaid + effectiveAmt);
  const isRepaid         = round2(newAmountRepaid) >= round2(loan.totalRepayable);
  // Matches splitRepayment() server-side exactly: zero the balance on
  // overpayment too, not just when the rounded totals cross the repayable
  // threshold — otherwise the preview can show a nonzero remaining balance
  // for a payment the server would treat as fully clearing the loan.
  const newBalance       = isOverpaid || isRepaid
    ? 0
    : Math.max(0, round2(loan.balance - principalPortion));
  return {
    interestPortion, principalPortion, overpaidAmount, isOverpaid,
    daysAccrued: 0, dailyRatePct: 0, annualRatePct: 0,
    newInterestAccrued: 0, priorAccruedInterest: 0,
    totalAccruedBefore: 0, accruedAfter: 0,
    newBalance, newAmountRepaid,
    newTotalInterestPaid: round2((loan.totalInterestPaid || 0) + interestPortion),
    isRepaid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function RecordRepaymentModal() {
  const router   = useRouter();
  const { loanId } = useLocalSearchParams<{ loanId: string }>();
  const { recordRepayment } = useStore();
  const loans    = useGroupLoans();
  const members  = useGroupMembers();
  const group    = useActiveGroup();
  const allWallet= useGroupWallet();
  const { show, Toast } = useToast();

  const loan   = loans.find((l) => l.id === loanId);
  const member = loan ? members.find((m) => m.id === loan.memberId) : null;
  const currency = group?.currency ?? "RWF";
  const isRB = loan?.interestMethod === "reducing_balance";

  // Payment txs for this loan — sorted newest first
  const paymentTxs = allWallet
    .filter((t) => t.loanId === loanId && ["loan_interest_income", "loan_principal_recovery", "loan_repayment"].includes(t.type))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group into payment events by exact timestamp — recordRepaymentServer
  // writes the interest + principal transactions for one payment in the
  // SAME writeBatch with the SAME `date` value, so an exact date match is
  // the real shared key (NOT array index, which silently misaligns rows
  // the moment any one repayment produces an uneven count of interest vs.
  // principal transactions — e.g. a payment that was 100% interest with a
  // principal portion of exactly 0). Legacy "loan_repayment" transactions
  // predate the interest/principal split and represent a payment's FULL
  // amount in one transaction — they are never interest-only and must not
  // be paired with an unrelated principal transaction from a different
  // payment event.
  const pairedPayments = (() => {
    const byDate = new Map<string, { interest: number; principal: number; legacyTotal: number }>();
    for (const t of paymentTxs) {
      const key = t.date;
      const entry = byDate.get(key) ?? { interest: 0, principal: 0, legacyTotal: 0 };
      if (t.type === "loan_interest_income") entry.interest += t.amount;
      else if (t.type === "loan_principal_recovery") entry.principal += t.amount;
      else if (t.type === "loan_repayment") entry.legacyTotal += t.amount; // combined, pre-split
      byDate.set(key, entry);
    }
    // For legacy combined transactions, back out an approximate interest/
    // principal split using the loan's overall interest ratio (same ratio
    // splitRepayment uses for flat loans) — better than showing the whole
    // amount as principal with zero interest, which would be misleading.
    const legacyRatio = loan && loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
    return Array.from(byDate.entries())
      .map(([date, e]) => {
        if (e.legacyTotal > 0) {
          const legacyInterest  = round2(e.legacyTotal * legacyRatio);
          const legacyPrincipal = round2(e.legacyTotal - legacyInterest);
          return { date, interest: legacyInterest, principal: legacyPrincipal, total: e.legacyTotal, isLegacyCombined: true };
        }
        return { date, interest: e.interest, principal: e.principal, total: round2(e.interest + e.principal), isLegacyCombined: false };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  })();

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(loan?.monthlyPayment ? loan.monthlyPayment.toFixed(2) : "");
  const [date,   setDate]   = useState(today);
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  const amtNum = parseFloat(amount) || 0;
  const split  = amtNum > 0 && date ? computeSplit(loan, amtNum, date) : null;

  // Progress — for repaid loans always 100
  const pct = loan.status === "repaid"
    ? 100
    : loan.totalRepayable > 0
      ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
      : 0;

  // Today's accrued interest (for display).
  // BUG FIX: this previously did `loan.interestRate / 100 / 365` directly,
  // which silently treats a MONTHLY rate as if it were already annual —
  // understating accrued interest by 12x for the common case (group default
  // is monthly). Must go through toAnnualRate() first, exactly like
  // computeSplit() does, so the daily rate here always matches what the
  // server will actually charge.
  const todayAccrued = (() => {
    if (!isRB) return null;
    const days       = daysBetween((loan as any).lastAccrualDate ?? today, today);
    const annualRate = toAnnualRate(loan.interestRate, (loan as any).interestRatePeriod ?? "monthly");
    const daily      = annualRate / 100 / 365;
    const acc        = round2(loan.balance * daily * days);
    const prior      = round2((loan as any).accruedInterest ?? 0);
    return { days, accrued: acc, total: round2(prior + acc), dailyRatePct: round2(daily * 100) };
  })();

  const doRecord = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await recordRepayment(loan.id, amtNum, new Date(date + "T12:00:00").toISOString());
      show(split?.isRepaid ? "Loan fully repaid! 🎉" : "Repayment recorded ✅");
      setTimeout(() => router.back(), 700);
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
    if (!date) { show("Enter a payment date", "error"); return; }
    if (split?.isOverpaid) {
      showConfirm(
        "Overpayment",
        `Payment (${fmtCurrency(amtNum)}) exceeds the total outstanding.\n\nExtra ${fmtCurrency(split.overpaidAmount)} will be credited to the group wallet.\n\nContinue?`,
        doRecord,
      );
    } else {
      doRecord();
    }
  };

  return (
    <ModalShell title="Record Payment" onClose={() => router.back()}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={st.cancel}>Cancel</Text></TouchableOpacity>
        <Text style={st.title}>Record Payment</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">

        {/* ── Loan summary ── */}
        <View style={st.infoCard}>
          <Text style={st.memberName}>{member?.fullName ?? "Unknown"}</Text>
          {loan.purpose ? <Text style={st.purpose}>{loan.purpose}</Text> : null}

          {/* Three-column terms */}
          <View style={st.section}>
            <Text style={st.sectionLabel}>LOAN TERMS</Text>
            <View style={st.cols3}>
              <View style={st.col}>
                <Text style={st.colLbl}>Principal</Text>
                <Text style={st.colVal}>{fmtCurrency(loan.amount)}</Text>
              </View>
              <View style={st.colDiv} />
              <View style={st.col}>
                <Text style={st.colLbl}>Rate</Text>
                <Text style={st.colVal}>{loan.interestRate}% {isRB ? "p.a." : "flat"}</Text>
              </View>
              <View style={st.colDiv} />
              <View style={st.col}>
                <Text style={st.colLbl}>Term</Text>
                <Text style={st.colVal}>{loan.repaymentMonths}mo</Text>
              </View>
            </View>
          </View>

          {/* Outstanding */}
          <View style={[st.section, { borderTopWidth: 1, borderTopColor: Colors.borderLight }]}>
            <Text style={st.sectionLabel}>OUTSTANDING</Text>
            <View style={st.cols3}>
              <View style={st.col}>
                <Text style={st.colLbl}>Principal</Text>
                <Text style={[st.colVal, { color: Colors.error }]}>{fmtCurrency(loan.balance)}</Text>
              </View>
              <View style={st.colDiv} />
              <View style={st.col}>
                <Text style={st.colLbl}>Accrued int.</Text>
                <Text style={[st.colVal, { color: Colors.gold }]}>
                  {isRB
                    ? fmtCurrency(todayAccrued?.total ?? (loan as any).accruedInterest ?? 0)
                    : fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid - loan.balance))}
                </Text>
              </View>
              <View style={st.colDiv} />
              <View style={st.col}>
                <Text style={st.colLbl}>Total due</Text>
                <Text style={[st.colVal, { color: Colors.error, fontWeight: "800" }]}>
                  {isRB
                    ? fmtCurrency(round2(loan.balance + (todayAccrued?.total ?? 0)))
                    : fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid))}
                </Text>
              </View>
            </View>
          </View>

          {/* Accrual detail for RB */}
          {isRB && todayAccrued && (
            <View style={st.accrualBox}>
              <Text style={st.accrualText}>
                📅 {todayAccrued.days}d since last payment · Daily rate: {round2(todayAccrued.dailyRatePct * 1000) / 1000}% · Today's accrued: {fmtCurrency(todayAccrued.accrued)}
              </Text>
            </View>
          )}

          {/* Progress bar */}
          <View style={st.progressWrap}>
            <View style={st.progressTrack}>
              <View style={[st.progressFill, { width: `${pct}%` as any }]} />
            </View>
            <Text style={st.progressText}>
              {loan.status === "repaid" ? "100.0%" : `${pct.toFixed(1)}%`} repaid
              {" · "}{fmtCurrency(loan.amountRepaid)} of {fmtCurrency(loan.totalRepayable)}
            </Text>
            {loan.status !== "repaid" && (
              <Text style={[st.progressText, { marginTop: 2 }]}>
                {fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid))} remaining
              </Text>
            )}
          </View>
        </View>

        {/* ── Input ── */}
        <View style={st.inputGroup}>
          <Text style={st.inputLabel}>Payment Amount ({currency}) *</Text>
          <View style={st.inputRow}>
            <Text style={st.inputPrefix}>{currency}</Text>
            <TextInput
              style={st.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={Colors.text3}
              returnKeyType="next"
            />
          </View>
        </View>

        <DatePicker
          label="Payment Date *"
          value={date}
          onChange={setDate}
          placeholder="Select payment date"
        />

        {/* ── Breakdown ── */}
        {split && amtNum > 0 && (
          <View style={[
            st.breakdown,
            split.isRepaid  && { borderColor: Colors.success + "55", backgroundColor: Colors.success + "08" },
            split.isOverpaid && { borderColor: Colors.gold + "55", backgroundColor: Colors.gold + "08" },
          ]}>
            <Text style={st.breakdownTitle}>
              {split.isRepaid ? "✅ This payment closes the loan" : split.isOverpaid ? "⚠️ Overpayment" : "Payment Breakdown"}
            </Text>

            {/* RB: show accrual detail */}
            {isRB && (
              <View style={st.bSection}>
                <Text style={st.bSectionLabel}>INTEREST ACCRUAL</Text>
                <View style={st.bRow}>
                  <Text style={st.bLbl}>Days since last payment</Text>
                  <Text style={st.bVal}>{split.daysAccrued} days</Text>
                </View>
                <View style={st.bRow}>
                  <Text style={st.bLbl}>
                    Daily rate ({loan.interestRate}% {loan.interestRatePeriod === "monthly" ? "monthly" : "p.a."} → {round2(split.annualRatePct * 100) / 100}% p.a. ÷ 365)
                  </Text>
                  <Text style={st.bVal}>{round2(split.dailyRatePct * 1000) / 1000}% / day</Text>
                </View>
                <View style={st.bRow}>
                  <Text style={st.bLbl}>Interest this period</Text>
                  <Text style={[st.bVal, { color: Colors.gold }]}>{fmtCurrency(split.newInterestAccrued)}</Text>
                </View>
                {split.priorAccruedInterest > 0 && (
                  <View style={st.bRow}>
                    <Text style={st.bLbl}>Prior unpaid interest</Text>
                    <Text style={[st.bVal, { color: Colors.gold }]}>{fmtCurrency(split.priorAccruedInterest)}</Text>
                  </View>
                )}
                <View style={[st.bRow, { borderTopWidth: 1, borderTopColor: Colors.borderLight, marginTop: 4, paddingTop: 6 }]}>
                  <Text style={st.bLblBold}>Total accrued interest</Text>
                  <Text style={[st.bValBold, { color: Colors.gold }]}>{fmtCurrency(split.totalAccruedBefore)}</Text>
                </View>
              </View>
            )}

            <View style={st.bSection}>
              <Text style={st.bSectionLabel}>PAYMENT APPLICATION</Text>
              <View style={st.bRow}>
                <Text style={st.bLbl}>Total payment</Text>
                <Text style={[st.bValBold]}>{fmtCurrency(amtNum)}</Text>
              </View>
              <View style={st.bIndentRow}>
                <Text style={st.bIndentLbl}>↳ Applied to interest</Text>
                <Text style={[st.bVal, { color: Colors.gold }]}>{fmtCurrency(split.interestPortion)}</Text>
              </View>
              <View style={st.bIndentRow}>
                <Text style={st.bIndentLbl}>↳ Applied to principal</Text>
                <Text style={[st.bVal, { color: Colors.accent }]}>{fmtCurrency(split.principalPortion)}</Text>
              </View>
              {split.isOverpaid && (
                <View style={st.bIndentRow}>
                  <Text style={st.bIndentLbl}>↳ Overpayment (credited)</Text>
                  <Text style={[st.bVal, { color: Colors.success }]}>{fmtCurrency(split.overpaidAmount)}</Text>
                </View>
              )}
            </View>

            <View style={[st.bSection, { borderTopWidth: 1, borderTopColor: Colors.borderLight }]}>
              <Text style={st.bSectionLabel}>AFTER THIS PAYMENT</Text>
              <View style={st.bRow}>
                <Text style={st.bLbl}>Principal remaining</Text>
                <Text style={[st.bVal, { color: split.newBalance === 0 ? Colors.success : Colors.error }]}>
                  {split.newBalance === 0 ? "✓ Cleared" : fmtCurrency(split.newBalance)}
                </Text>
              </View>
              {isRB && (
                <View style={st.bRow}>
                  <Text style={st.bLbl}>Unpaid interest remaining</Text>
                  <Text style={[st.bVal, { color: split.accruedAfter === 0 ? Colors.success : Colors.gold }]}>
                    {split.accruedAfter === 0 ? "✓ Cleared" : fmtCurrency(split.accruedAfter)}
                  </Text>
                </View>
              )}
              <View style={[st.bRow, { borderTopWidth: 1, borderTopColor: Colors.borderLight, marginTop: 4, paddingTop: 6 }]}>
                <Text style={st.bLblBold}>Loan status after</Text>
                <Text style={[st.bValBold, { color: split.isRepaid ? Colors.success : Colors.error }]}>
                  {split.isRepaid ? "✓ FULLY REPAID" : "Active"}
                </Text>
              </View>
            </View>

            {/* Progress bar after payment */}
            <View style={{ marginTop: 12 }}>
              <View style={st.progressTrack}>
                <View style={[st.progressFill, {
                  width: `${split.isRepaid ? 100 : Math.min(100, (split.newAmountRepaid / loan.totalRepayable) * 100)}%` as any,
                  backgroundColor: split.isRepaid ? Colors.success : Colors.primary,
                }]} />
              </View>
              <Text style={st.progressText}>
                {split.isRepaid ? "100.0" : Math.min(100, (split.newAmountRepaid / loan.totalRepayable) * 100).toFixed(1)}% complete after this payment
              </Text>
            </View>
          </View>
        )}

        {/* ── Payment History ── */}
        {(pairedPayments.length > 0) && (
          <View style={st.histCard}>
            <TouchableOpacity style={st.histHeader} onPress={() => setShowHistory(!showHistory)} activeOpacity={0.7}>
              <Text style={st.histTitle}>📜 Payment History ({pairedPayments.length})</Text>
              <Text style={st.histChevron}>{showHistory ? "▲" : "▼"}</Text>
            </TouchableOpacity>

            {showHistory && (
              <View>
                {/* Column headers */}
                <View style={st.histHeadRow}>
                  <Text style={[st.histHead, { flex: 1.2 }]}>DATE</Text>
                  <Text style={[st.histHead, { flex: 1, textAlign: "right" }]}>INTEREST</Text>
                  <Text style={[st.histHead, { flex: 1, textAlign: "right" }]}>PRINCIPAL</Text>
                  <Text style={[st.histHead, { flex: 1, textAlign: "right" }]}>TOTAL</Text>
                </View>
                {pairedPayments.map((p, i) => (
                  <View key={i} style={[st.histRow, i % 2 === 1 && { backgroundColor: Colors.elevated }]}>
                    <Text style={[st.histCell, { flex: 1.2 }]} numberOfLines={1}>
                      {new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "2-digit" })}
                    </Text>
                    <Text style={[st.histCell, { flex: 1, textAlign: "right", color: Colors.gold }]}>
                      {fmtCurrency(p.interest)}
                    </Text>
                    <Text style={[st.histCell, { flex: 1, textAlign: "right", color: Colors.accent }]}>
                      {fmtCurrency(p.principal)}
                    </Text>
                    <Text style={[st.histCell, { flex: 1, textAlign: "right", fontWeight: "700" }]}>
                      {fmtCurrency(p.total)}
                    </Text>
                  </View>
                ))}
                {/* Totals row */}
                <View style={[st.histRow, st.histTotalRow]}>
                  <Text style={[st.histCell, { flex: 1.2, fontWeight: "700", color: Colors.text }]}>Total</Text>
                  <Text style={[st.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: Colors.gold }]}>
                    {fmtCurrency(pairedPayments.reduce((s, p) => s + p.interest, 0))}
                  </Text>
                  <Text style={[st.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: Colors.accent }]}>
                    {fmtCurrency(pairedPayments.reduce((s, p) => s + p.principal, 0))}
                  </Text>
                  <Text style={[st.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: Colors.text }]}>
                    {fmtCurrency(pairedPayments.reduce((s, p) => s + p.total, 0))}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        <Button
          label={split?.isRepaid ? "Close Loan — Final Payment" : "Record Payment"}
          onPress={handleSave}
          fullWidth
          loading={loading}
          size="lg"
        />

        {isRB && (
          <View style={st.note}>
            <Text style={st.noteTitle}>How daily accrual works</Text>
            <Text style={st.noteLine}>
              Interest accrues daily: balance × ({loan.interestRate}% ÷ 365) × exact days since last payment.
              Each payment covers all accrued interest first; the remainder reduces principal.
              The next period's interest is then calculated on the lower principal.
            </Text>
          </View>
        )}
      </ScrollView>
      <Toast />
    </ModalShell>
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
  purpose:    { fontSize: 12, color: Colors.text3, marginTop: 2, marginBottom: 10 },
  section:    { paddingVertical: 12 },
  sectionLabel: {
    fontSize: 9, fontWeight: "700", color: Colors.text3,
    letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 10,
  },
  cols3:  { flexDirection: "row" },
  col:    { flex: 1, alignItems: "center" },
  colDiv: { width: 1, backgroundColor: Colors.borderLight, marginHorizontal: 4, alignSelf: "stretch" },
  colLbl: { fontSize: 10, color: Colors.text3, marginBottom: 4, textAlign: "center" },
  colVal: { fontSize: 13, fontWeight: "700", color: Colors.text, textAlign: "center" },

  accrualBox: {
    backgroundColor: Colors.elevated, borderRadius: 8,
    padding: 10, marginTop: 4,
  },
  accrualText: { fontSize: 11, color: Colors.gold, lineHeight: 16 },

  progressWrap: { marginTop: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill:  { height: "100%" as any, backgroundColor: Colors.primary, borderRadius: 3 },
  progressText:  { fontSize: 11, color: Colors.text3, marginTop: 4, textAlign: "center" },

  // Inputs
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 12, fontWeight: "600", color: Colors.text2, marginBottom: 6 },
  inputRow:   {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surface, overflow: "hidden",
  },
  inputPrefix: {
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 14, color: Colors.text3, fontWeight: "600",
    borderRightWidth: 1, borderRightColor: Colors.border,
    backgroundColor: Colors.elevated,
  },
  input: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, fontWeight: "600", color: Colors.text,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    backgroundColor: Colors.surface,
  },

  // Breakdown card
  breakdown: {
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg, marginBottom: S.xl,
  },
  breakdownTitle: { fontSize: 13, fontWeight: "700", color: Colors.text, textAlign: "center", marginBottom: 14 },
  bSection:       { marginBottom: 10 },
  bSectionLabel:  {
    fontSize: 9, fontWeight: "700", color: Colors.text3,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
  },
  bRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  bIndentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3, paddingLeft: 16 },
  bLbl:       { fontSize: 12, color: Colors.text2 },
  bLblBold:   { fontSize: 13, fontWeight: "700", color: Colors.text },
  bIndentLbl: { fontSize: 11, color: Colors.text3, fontStyle: "italic" },
  bVal:       { fontSize: 12, fontWeight: "600", color: Colors.text },
  bValBold:   { fontSize: 13, fontWeight: "800", color: Colors.text },

  // Payment history
  histCard: {
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, marginBottom: S.xl, overflow: "hidden",
  },
  histHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: S.md, backgroundColor: Colors.surface },
  histTitle:   { fontSize: 13, fontWeight: "600", color: Colors.text },
  histChevron: { fontSize: 11, color: Colors.text3 },
  histHeadRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.elevated, borderBottomWidth: 1, borderBottomColor: Colors.border },
  histHead:    { fontSize: 9, fontWeight: "700", color: Colors.text3, textTransform: "uppercase", letterSpacing: 0.6 },
  histRow:     { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  histCell:    { fontSize: 12, color: Colors.text2 },
  histTotalRow:{ backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, borderBottomWidth: 0 },

  // Note
  note:      { backgroundColor: Colors.elevated, borderRadius: R.md, padding: S.md, marginTop: S.md },
  noteTitle: { fontSize: 12, fontWeight: "700", color: Colors.primary, marginBottom: 6 },
  noteLine:  { fontSize: 11, color: Colors.text3, lineHeight: 16 },
});
