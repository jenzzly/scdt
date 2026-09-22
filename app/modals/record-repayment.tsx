// app/modals/record-repayment.tsx
//
// Mirror of splitRepayment() in lib/firestore/loans.ts — MUST stay in sync.
// For reducing-balance loans: daily accrual on exact calendar days.
// For flat loans: proportional split on totalRepayable.
//
// Anchor resolution and daily-rate math are shared with loans.tsx and
// lib/firestore/loans.ts via utils/accrual.ts. There is exactly one
// implementation of the priority chain
//   lastAccrualDate → disbursementDate → applicationDate → fallback
// so the two screens and the server can't drift.
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useStore,
  useGroupLoans,
  useGroupMembers,
  useActiveGroup,
  useGroupWallet,
} from "../../stores/useStore";
import { Button, useToast, Toast, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  Colors,
  S,
  R,
  fmtCurrency,
  fmtDate,
  round2,
  showConfirm,
  fmtFull,
} from "../../utils/theme";

import {
  daysBetween,
  toAnnualRate,
  resolveAccrualAnchor,
  computeTodayAccrued,
} from "../../utils/accrual";

import { useLoanLateFees } from "../../hooks/useLoanLateFees";

// ─────────────────────────────────────────────────────────────────────────────
// Math — mirror of lib/firestore/loans.ts splitRepayment
// Uses the shared accrual primitives so the anchor chain is identical
// to the server's.
// ─────────────────────────────────────────────────────────────────────────────

interface Split {
  interestPortion: number;
  principalPortion: number;
  overpaidAmount: number;
  isOverpaid: boolean;
  daysAccrued: number;
  dailyRatePct: number;
  annualRatePct: number;
  newInterestAccrued: number;
  priorAccruedInterest: number;
  totalAccruedBefore: number;
  accruedAfter: number;
  newBalance: number;
  newAmountRepaid: number;
  newTotalInterestPaid: number;
  isRepaid: boolean;
}

function computeSplit(loan: any, payment: number, paymentDate: string): Split {
  const p = round2(payment);
  const method = loan.interestMethod || "flat";

  if (method === "reducing_balance") {
    const annualRate = toAnnualRate(
      loan.interestRate,
      loan.interestRatePeriod ?? "monthly",
    );
    const dailyRate = annualRate / 100 / 365;

    // Anchor resolution lives in utils/accrual.ts — one implementation
    // for both this preview and the loan detail modal.
    const fromDate = resolveAccrualAnchor(loan, paymentDate);
    const days = daysBetween(fromDate, paymentDate);

    const newInterestAccrued = round2(loan.balance * dailyRate * days);
    const priorAccrued = round2(loan.accruedInterest ?? 0);
    const totalAccrued = round2(priorAccrued + newInterestAccrued);
    const totalDue = round2(loan.balance + totalAccrued);
    const isOverpaid = p > totalDue;
    const overpaidAmount = isOverpaid ? round2(p - totalDue) : 0;
    const effectiveAmt = isOverpaid ? totalDue : p;
    const interestPortion = round2(Math.min(effectiveAmt, totalAccrued));
    const principalPortion = round2(effectiveAmt - interestPortion);
    const accruedAfter = round2(totalAccrued - interestPortion);
    const newBalance = Math.max(0, round2(loan.balance - principalPortion));
    const newAmountRepaid = round2((loan.amountRepaid || 0) + effectiveAmt);
    const newTotalInterestPaid = round2(
      (loan.totalInterestPaid || 0) + interestPortion,
    );

    return {
      interestPortion,
      principalPortion,
      overpaidAmount,
      isOverpaid,
      daysAccrued: days,
      dailyRatePct: round2(dailyRate * 100),
      annualRatePct: annualRate,
      newInterestAccrued,
      priorAccruedInterest: priorAccrued,
      totalAccruedBefore: totalAccrued,
      accruedAfter,
      newBalance,
      newAmountRepaid,
      newTotalInterestPaid,
      isRepaid: newBalance === 0 && accruedAfter === 0,
    };
  }

  // Flat
  const amountRepaid = loan.amountRepaid || 0;
  const remaining = round2(loan.totalRepayable - amountRepaid);
  const isOverpaid = p > remaining;
  const overpaidAmount = isOverpaid ? round2(p - remaining) : 0;
  const effectiveAmt = isOverpaid ? remaining : p;
  const ratio =
    loan.totalRepayable > 0 ? loan.totalInterest / loan.totalRepayable : 0;
  const interestPortion = round2(effectiveAmt * ratio);
  const principalPortion = round2(effectiveAmt - interestPortion);
  const newAmountRepaid = round2(amountRepaid + effectiveAmt);
  const isRepaid = round2(newAmountRepaid) >= round2(loan.totalRepayable);
  const newBalance =
    isOverpaid || isRepaid
      ? 0
      : Math.max(0, round2(loan.balance - principalPortion));

  return {
    interestPortion,
    principalPortion,
    overpaidAmount,
    isOverpaid,
    daysAccrued: 0,
    dailyRatePct: 0,
    annualRatePct: 0,
    newInterestAccrued: 0,
    priorAccruedInterest: 0,
    totalAccruedBefore: 0,
    accruedAfter: 0,
    newBalance,
    newAmountRepaid,
    newTotalInterestPaid: round2(
      (loan.totalInterestPaid || 0) + interestPortion,
    ),
    isRepaid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function RecordRepaymentModal() {
  const router = useRouter();
  const { loanId } = useLocalSearchParams<{ loanId: string }>();
  const { recordRepayment } = useStore();
  const loans = useGroupLoans();
  const members = useGroupMembers();
  const group = useActiveGroup();
  const allWallet = useGroupWallet();
  const { show, visible, msg, type } = useToast();

  const loan = loans.find((l) => l.id === loanId);
  const member = loan ? members.find((m) => m.id === loan.memberId) : null;
  const currency = group?.currency ?? "RWF";
  const isRB = loan?.interestMethod === "reducing_balance";

  // Late fees owed on THIS loan — combines already-recorded (unpaid)
  // late_fee wallet txs plus live-accrued fees from overdue
  // installments that haven't been applied to the ledger yet.
  const lateFees = useLoanLateFees(loanId);

  const paymentTxs = allWallet
    .filter(
      (t) =>
        t.loanId === loanId &&
        [
          "loan_interest_income",
          "loan_principal_recovery",
          "loan_repayment",
        ].includes(t.type),
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const pairedPayments = (() => {
    const byDate = new Map<
      string,
      { interest: number; principal: number; legacyTotal: number }
    >();
    for (const t of paymentTxs) {
      const key = t.date;
      const entry = byDate.get(key) ?? {
        interest: 0,
        principal: 0,
        legacyTotal: 0,
      };
      if (t.type === "loan_interest_income") entry.interest += t.amount;
      else if (t.type === "loan_principal_recovery")
        entry.principal += t.amount;
      else if (t.type === "loan_repayment") entry.legacyTotal += t.amount;
      byDate.set(key, entry);
    }
    const legacyRatio =
      loan && loan.totalRepayable > 0
        ? loan.totalInterest / loan.totalRepayable
        : 0;
    return Array.from(byDate.entries())
      .map(([date, e]) => {
        if (e.legacyTotal > 0) {
          const legacyInterest = round2(e.legacyTotal * legacyRatio);
          const legacyPrincipal = round2(e.legacyTotal - legacyInterest);
          return {
            date,
            interest: legacyInterest,
            principal: legacyPrincipal,
            total: e.legacyTotal,
            isLegacyCombined: true,
          };
        }
        return {
          date,
          interest: e.interest,
          principal: e.principal,
          total: round2(e.interest + e.principal),
          isLegacyCombined: false,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  })();

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(
    loan?.monthlyPayment ? loan.monthlyPayment.toFixed(2) : "",
  );
  const [date, setDate] = useState(today);
  const submitting = useRef(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLateFees, setShowLateFees] = useState(false);

  if (!loan) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: Colors.text3 }}>Loan not found</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 16 }}
        >
          <Text style={{ color: Colors.accent }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const amtNum = parseFloat(amount) || 0;
  const split = amtNum > 0 && date ? computeSplit(loan, amtNum, date) : null;

  const pct =
    loan.status === "repaid"
      ? 100
      : loan.totalRepayable > 0
        ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
        : 0;

  // Today's accrued interest — shared with loans.tsx's loan detail
  // modal via utils/accrual.ts. Returns null for flat loans.
  const todayAccrued = computeTodayAccrued(loan);

  const doRecord = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await recordRepayment(
        loan.id,
        amtNum,
        new Date(date + "T12:00:00").toISOString(),
      );
      show(
        split?.isRepaid ? "Loan fully repaid! 🎉" : "Repayment recorded ✅",
      );
      setTimeout(() => router.back(), 700);
    } catch (e: any) {
      show(e?.message || "Failed to record repayment", "error");
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  const handleSave = () => {
    if (!amtNum || amtNum <= 0) {
      show("Enter a valid amount", "error");
      return;
    }
    if (submitting.current || loading) return;
    if (!date) {
      show("Enter a payment date", "error");
      return;
    }
    if (split?.isOverpaid) {
      showConfirm(
        "Overpayment",
        `Payment (${fmtCurrency(
          amtNum,
        )}) exceeds the total outstanding.\n\nExtra ${fmtCurrency(
          split.overpaidAmount,
        )} will be credited to the group wallet.\n\nContinue?`,
        doRecord,
      );
    } else {
      doRecord();
    }
  };

  return (
    <ModalShell title="Record Payment" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Header: member + context ───────────────────────────── */}
        <View style={st.header}>
          <View style={st.avatar}>
            <Text style={st.avatarText}>
              {(member?.fullName ?? "?")
                .split(" ")
                .map((w: string) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.memberName} numberOfLines={1}>
              {member?.fullName ?? "Unknown"}
            </Text>
            <Text style={st.memberMeta} numberOfLines={1}>
              {loan.interestRate}%{" "}
              {isRB ? "monthly · daily accrual" : "flat"} ·{" "}
              {loan.repaymentMonths} months
            </Text>
            {loan.purpose ? (
              <Text style={st.purpose} numberOfLines={1}>
                {loan.purpose}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── 2. Outstanding hero ───────────────────────────────────── */}
        <View style={st.outstanding}>
          <Text style={st.outstandingLabel}>TOTAL DUE TODAY</Text>
          <Text
            style={st.outstandingValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {isRB
              ? fmtCurrency(round2(loan.balance + (todayAccrued?.total ?? 0)))
              : fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid))}
          </Text>

          <View style={st.outstandingGrid}>
            <View style={st.outCol}>
              <Text style={st.outLbl}>Principal</Text>
              <Text
                style={[st.outVal, { color: Colors.error }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {fmtCurrency(loan.balance)}
              </Text>
            </View>
            <View style={st.outDiv} />
            <View style={st.outCol}>
              <Text style={st.outLbl}>Interest</Text>
              <Text
                style={[st.outVal, { color: Colors.gold }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {isRB
                  ? fmtCurrency(
                      todayAccrued?.total ??
                        (loan as any).accruedInterest ??
                        0,
                    )
                  : fmtCurrency(
                      round2(
                        loan.totalRepayable -
                          loan.amountRepaid -
                          loan.balance,
                      ),
                    )}
              </Text>
            </View>
            <View style={st.outDiv} />
            <View style={st.outCol}>
              <Text style={st.outLbl}>Repaid</Text>
              <Text
                style={[st.outVal, { color: Colors.primary }]}
                numberOfLines={1}
              >
                {pct.toFixed(0)}%
              </Text>
            </View>
          </View>

          {isRB && todayAccrued && (
            <Text style={st.accrualLine} numberOfLines={2}>
              Accruing {todayAccrued.days}d @{" "}
              {round2(todayAccrued.dailyRatePct * 1000) / 1000}%/day ·{" "}
              {fmtCurrency(todayAccrued.accrued)} added today
            </Text>
          )}
        </View>

        {/* ── 3. Late-fees alert (compact, expandable) ──────────────── */}
        {lateFees.count > 0 && (
          <View style={st.alertBox}>
            <TouchableOpacity
              style={st.alertHeader}
              onPress={() => setShowLateFees((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={st.alertIcon}>
                <Text style={{ fontSize: 14 }}>⚠️</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.alertTitle} numberOfLines={1}>
                  {lateFees.count} unpaid late fee
                  {lateFees.count !== 1 ? "s" : ""}
                </Text>
                <Text style={st.alertSub} numberOfLines={1}>
                  {fmtCurrency(lateFees.total)} owed on overdue
                  installments
                </Text>
              </View>
              <Text style={st.alertChevron}>
                {showLateFees ? "▲" : "▼"}
              </Text>
            </TouchableOpacity>

            {showLateFees && (
              <View style={st.alertBody}>
                {lateFees.rows.map((row, i) => (
                  <View
                    key={`${row.kind}-${i}`}
                    style={[
                      st.alertRow,
                      i === lateFees.rows.length - 1 && {
                        borderBottomWidth: 0,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={st.alertRowLabel}
                        numberOfLines={1}
                      >
                        {row.label}
                      </Text>
                      {row.sublabel ? (
                        <Text
                          style={st.alertRowSub}
                          numberOfLines={2}
                        >
                          {row.sublabel}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={st.alertRowAmount}>
                      {fmtCurrency(row.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── 4. Payment form ───────────────────────────────────────── */}
        <Text style={st.sectionHeading}>Payment</Text>

        <View style={st.inputGroup}>
          <Text style={st.inputLabel}>Amount ({currency})</Text>
          <View style={st.amountRow}>
            <Text style={st.amountPrefix}>{currency}</Text>
            <TextInput
              style={st.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={Colors.text3}
              returnKeyType="done"
            />
          </View>
        </View>

        <DatePicker
          label="Payment Date"
          value={date}
          onChange={setDate}
          placeholder="Select payment date"
        />

        {/* ── 5. Live preview ───────────────────────────────────────── */}
        {split && amtNum > 0 && (
          <View
            style={[
              st.preview,
              split.isRepaid && st.previewSuccess,
              split.isOverpaid && !split.isRepaid && st.previewWarn,
            ]}
          >
            <View style={st.previewHeader}>
              <Text style={st.previewTitle} numberOfLines={1}>
                {split.isRepaid
                  ? "🎉 This closes the loan"
                  : split.isOverpaid
                  ? "⚠️ Overpayment"
                  : "This payment"}
              </Text>
              <Text style={st.previewAmount} numberOfLines={1}>
                {fmtCurrency(amtNum)}
              </Text>
            </View>

            {/* Allocation */}
            <View style={st.previewSection}>
              <View style={st.previewRow}>
                <Text style={st.previewLbl}>→ Interest</Text>
                <Text style={[st.previewVal, { color: Colors.gold }]}>
                  {fmtCurrency(split.interestPortion)}
                </Text>
              </View>
              <View style={st.previewRow}>
                <Text style={st.previewLbl}>→ Principal</Text>
                <Text style={[st.previewVal, { color: Colors.accent }]}>
                  {fmtCurrency(split.principalPortion)}
                </Text>
              </View>
              {split.isOverpaid && (
                <View style={st.previewRow}>
                  <Text style={st.previewLbl}>
                    → Overpayment (credited)
                  </Text>
                  <Text
                    style={[st.previewVal, { color: Colors.success }]}
                  >
                    {fmtCurrency(split.overpaidAmount)}
                  </Text>
                </View>
              )}
            </View>

            {/* After */}
            <View style={st.previewAfter}>
              <Text style={st.previewAfterLabel}>
                AFTER THIS PAYMENT
              </Text>
              <View style={st.previewAfterGrid}>
                <View style={st.previewAfterCell}>
                  <Text style={st.previewAfterLbl}>Principal</Text>
                  <Text
                    style={[
                      st.previewAfterVal,
                      {
                        color:
                          split.newBalance === 0
                            ? Colors.success
                            : Colors.error,
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {split.newBalance === 0
                      ? "✓ Cleared"
                      : fmtCurrency(split.newBalance)}
                  </Text>
                </View>
                {isRB && (
                  <View style={st.previewAfterCell}>
                    <Text style={st.previewAfterLbl}>
                      Unpaid interest
                    </Text>
                    <Text
                      style={[
                        st.previewAfterVal,
                        {
                          color:
                            split.accruedAfter === 0
                              ? Colors.success
                              : Colors.gold,
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {split.accruedAfter === 0
                        ? "✓ Cleared"
                        : fmtCurrency(split.accruedAfter)}
                    </Text>
                  </View>
                )}
                <View style={st.previewAfterCell}>
                  <Text style={st.previewAfterLbl}>Progress</Text>
                  <Text
                    style={[
                      st.previewAfterVal,
                      { color: Colors.primary },
                    ]}
                    numberOfLines={1}
                  >
                    {split.isRepaid
                      ? "100%"
                      : `${Math.min(
                          100,
                          (split.newAmountRepaid /
                            loan.totalRepayable) *
                            100,
                        ).toFixed(0)}%`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ── 6. History (collapsible) ──────────────────────────────── */}
        {pairedPayments.length > 0 && (
          <View style={st.histCard}>
            <TouchableOpacity
              style={st.histHeader}
              onPress={() => setShowHistory(!showHistory)}
              activeOpacity={0.7}
            >
              <Text style={st.histTitle}>
                Payment History ({pairedPayments.length})
              </Text>
              <Text style={st.histChevron}>
                {showHistory ? "▲" : "▼"}
              </Text>
            </TouchableOpacity>

            {showHistory && (
              <View>
                <View style={st.histHeadRow}>
                  <Text style={[st.histHead, { flex: 1.2 }]}>DATE</Text>
                  <Text
                    style={[
                      st.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    INTEREST
                  </Text>
                  <Text
                    style={[
                      st.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    PRINCIPAL
                  </Text>
                  <Text
                    style={[
                      st.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    TOTAL
                  </Text>
                </View>
                {pairedPayments.map((p, i) => (
                  <View
                    key={i}
                    style={[
                      st.histRow,
                      i % 2 === 1 && {
                        backgroundColor: Colors.elevated,
                      },
                    ]}
                  >
                    <Text
                      style={[st.histCell, { flex: 1.2 }]}
                      numberOfLines={1}
                    >
                      {new Date(p.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                        year: "2-digit",
                      })}
                    </Text>
                    <Text
                      style={[
                        st.histCell,
                        {
                          flex: 1,
                          textAlign: "right",
                          color: Colors.gold,
                        },
                      ]}
                    >
                      {fmtCurrency(p.interest)}
                    </Text>
                    <Text
                      style={[
                        st.histCell,
                        {
                          flex: 1,
                          textAlign: "right",
                          color: Colors.accent,
                        },
                      ]}
                    >
                      {fmtCurrency(p.principal)}
                    </Text>
                    <Text
                      style={[
                        st.histCell,
                        {
                          flex: 1,
                          textAlign: "right",
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {fmtCurrency(p.total)}
                    </Text>
                  </View>
                ))}
                <View style={[st.histRow, st.histTotalRow]}>
                  <Text
                    style={[
                      st.histCell,
                      {
                        flex: 1.2,
                        fontWeight: "700",
                        color: Colors.text,
                      },
                    ]}
                  >
                    Total
                  </Text>
                  <Text
                    style={[
                      st.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: Colors.gold,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      pairedPayments.reduce(
                        (s, p) => s + p.interest,
                        0,
                      ),
                    )}
                  </Text>
                  <Text
                    style={[
                      st.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: Colors.accent,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      pairedPayments.reduce(
                        (s, p) => s + p.principal,
                        0,
                      ),
                    )}
                  </Text>
                  <Text
                    style={[
                      st.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: Colors.text,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      pairedPayments.reduce((s, p) => s + p.total, 0),
                    )}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── 7. CTA ────────────────────────────────────────────────── */}
        <Button
          label={
            split?.isRepaid
              ? "Close Loan — Final Payment"
              : "Record Payment"
          }
          onPress={handleSave}
          fullWidth
          loading={loading}
          size="lg"
        />

        {isRB && (
          <Text style={st.footnote}>
            Interest accrues daily at balance × {loan.interestRate}% ÷ 365.
            Payments cover interest first; the remainder reduces principal.
          </Text>
        )}
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const st = StyleSheet.create({
  body: { padding: S.lg, paddingBottom: 60 },

  // ── Header ──────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: S.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primaryFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.primary,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.text,
  },
  memberMeta: {
    fontSize: 11,
    color: Colors.text3,
    marginTop: 2,
  },
  purpose: {
    fontSize: 11,
    color: Colors.text3,
    marginTop: 1,
    fontStyle: "italic",
  },

  // ── Outstanding hero ────────────────────────────────────────────
  outstanding: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.lg,
  },
  outstandingLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: Colors.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  outstandingValue: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.error,
    letterSpacing: -0.8,
    marginBottom: 14,
  },
  outstandingGrid: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  outCol: { flex: 1, alignItems: "center", minWidth: 0 },
  outDiv: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: Colors.borderLight,
    marginHorizontal: 4,
  },
  outLbl: {
    fontSize: 9,
    color: Colors.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  outVal: { fontSize: 13, fontWeight: "800" },
  accrualLine: {
    fontSize: 10,
    color: Colors.gold,
    marginTop: 12,
    textAlign: "center",
    lineHeight: 14,
  },

  // ── Late-fee alert ──────────────────────────────────────────────
  alertBox: {
    backgroundColor: Colors.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: R.lg,
    marginBottom: S.lg,
    overflow: "hidden",
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: S.md,
  },
  alertIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(239,68,68,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.error,
  },
  alertSub: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 1,
  },
  alertChevron: {
    fontSize: 10,
    color: Colors.text3,
    marginLeft: 6,
  },
  alertBody: {
    borderTopWidth: 1,
    borderTopColor: "rgba(239,68,68,0.15)",
    paddingHorizontal: S.md,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239,68,68,0.1)",
  },
  alertRowLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.text,
  },
  alertRowSub: {
    fontSize: 10,
    color: Colors.text3,
    marginTop: 1,
    lineHeight: 14,
  },
  alertRowAmount: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.error,
    flexShrink: 0,
  },

  // ── Section heading ─────────────────────────────────────────────
  sectionHeading: {
    fontSize: 10,
    fontWeight: "800",
    color: Colors.text3,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },

  // ── Inputs ──────────────────────────────────────────────────────
  inputGroup: { marginBottom: 14 },
  inputLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  amountPrefix: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    color: Colors.text3,
    fontWeight: "700",
    backgroundColor: Colors.elevated,
    textAlignVertical: "center",
  },
  amountInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
  },

  // ── Payment preview ─────────────────────────────────────────────
  preview: {
    backgroundColor: Colors.elevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginTop: S.lg,
    marginBottom: S.lg,
  },
  previewSuccess: {
    borderColor: "rgba(16,185,129,0.4)",
    backgroundColor: "rgba(16,185,129,0.06)",
  },
  previewWarn: {
    borderColor: "rgba(217,119,6,0.4)",
    backgroundColor: "rgba(217,119,6,0.06)",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.text,
  },
  previewAmount: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.text,
  },
  previewSection: { marginBottom: 12 },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  previewLbl: {
    fontSize: 12,
    color: Colors.text2,
    fontWeight: "600",
  },
  previewVal: { fontSize: 12, fontWeight: "700" },
  previewAfter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  previewAfterLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: Colors.text3,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  previewAfterGrid: {
    flexDirection: "row",
    gap: 8,
  },
  previewAfterCell: { flex: 1, minWidth: 0 },
  previewAfterLbl: {
    fontSize: 9,
    color: Colors.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  previewAfterVal: { fontSize: 13, fontWeight: "800" },

  // ── History ─────────────────────────────────────────────────────
  histCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    marginBottom: S.lg,
    overflow: "hidden",
  },
  histHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: S.md,
  },
  histTitle: { fontSize: 12, fontWeight: "700", color: Colors.text },
  histChevron: { fontSize: 10, color: Colors.text3 },
  histHeadRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.elevated,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  histHead: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  histRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  histCell: { fontSize: 12, color: Colors.text2 },
  histTotalRow: { backgroundColor: Colors.elevated },

  // ── Footnote ────────────────────────────────────────────────────
  footnote: {
    fontSize: 11,
    color: Colors.text3,
    lineHeight: 16,
    marginTop: S.md,
    textAlign: "center",
    fontStyle: "italic",
  },
});
