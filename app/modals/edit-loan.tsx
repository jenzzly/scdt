// app/modals/edit-loan.tsx
//
// Rules for what "the date" means depend on the loan's lifecycle:
//
//   - NOT disbursed yet  → editing the date changes loan.applicationDate
//   - ALREADY disbursed  → editing the date changes loan.disbursementDate
//     (the date that drives interest accrual, wallet reconciliation,
//      and late-fee evaluation). The original applicationDate is shown
//      read-only so it's obvious it isn't being touched.
//
// updateLoanAndSync in loanSlice.ts is what actually applies the patch —
// this modal just decides which field to seed and what label to show.

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  useStore,
  useGroupLoans,
  useCurrentUserRole,
} from "../../stores/useStore";

import { Input, Button, useToast, Toast, DatePicker } from "../../components/ui";

import { ModalShell } from "../../components/ui/ModalShell";
import { C, S, fmtCurrency, fmtDate, showConfirm } from "../../utils/theme";

import type { Loan } from "../../types";

const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

export default function EditLoanModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const loanId = Array.isArray(params.id) ? params.id[0] : params.id;

  const allLoans = useGroupLoans();
  const role = useCurrentUserRole();
  const { updateLoanAndSync, rescheduleLoanInstallment, recalcTotals } =
    useStore();
  const { show, visible, msg, type } = useToast();

  const canEdit = EDIT_ROLES.includes(role);

  const loan = useMemo(() => {
    if (!loanId) return undefined;
    return allLoans.find((l: Loan) => l.id === loanId);
  }, [allLoans, loanId]);

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);

  const [reschedulingIndex, setReschedulingIndex] = useState<number | null>(null);
  const [newDueDate, setNewDueDate] = useState("");
  const [reschedulingLoading, setReschedulingLoading] = useState(false);

  const isDisbursed =
    loan?.status === "disbursed" ||
    loan?.status === "repaid" ||
    loan?.status === "defaulted";

  useEffect(() => {
    if (!loan) return;
    setAmount(String(Math.abs(Number(loan.amount ?? 0))));

    // Seed the editable date field from the field that actually matters
    // for this loan's lifecycle stage.
    const sourceDate = isDisbursed
      ? (loan as any).disbursementDate ?? loan.applicationDate
      : loan.applicationDate;

    setDate((sourceDate ?? "").slice(0, 10));
    setPurpose(loan.purpose ?? "");
  }, [loan?.id, isDisbursed]);

  if (!canEdit) {
    return (
      <ModalShell title="Edit Loan" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Not authorized</Text>
          <Text style={styles.subtitle}>
            You don't have permission to edit loans.
          </Text>
          <Button
            label="Go Back"
            onPress={() => router.back()}
            variant="secondary"
            fullWidth
          />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  if (!loan) {
    return (
      <ModalShell title="Edit Loan" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Loan not found</Text>
          <Text style={styles.subtitle}>
            This loan may have been deleted, or the link is invalid.
          </Text>
          <Button
            label="Go Back"
            onPress={() => router.back()}
            variant="secondary"
            fullWidth
          />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  const hasRepayments = (loan.amountRepaid ?? 0) > 0;
  const amountLocked = isDisbursed && hasRepayments;

  const originalAmount = Math.abs(Number(loan.amount ?? 0));
  const parsedAmount = Number(amount.replace(/,/g, "").trim());
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = amountValid && dateValid;

  const originalDate = isDisbursed
    ? ((loan as any).disbursementDate ?? "").slice(0, 10)
    : (loan.applicationDate ?? "").slice(0, 10);

  const hasChanges =
    purpose.trim() !== (loan.purpose ?? "") ||
    (!amountLocked && parsedAmount !== originalAmount) ||
    date !== originalDate;

  const handleSave = async () => {
    if (loading) return;
    if (!amountValid) {
      show("Enter a valid positive amount", "error");
      return;
    }
    if (!dateValid) {
      show("Enter a valid date", "error");
      return;
    }
    if (!hasChanges) {
      show("No changes to save");
      return;
    }

    setLoading(true);
    try {
      await updateLoanAndSync(loan.id, {
        amount: amountLocked ? undefined : parsedAmount,
        date,
        description: purpose.trim(),
      });
      recalcTotals();
      show(
        isDisbursed
          ? "Loan updated — disbursement and accrued interest synced"
          : "Loan updated",
      );
      router.back();
    } catch (error: any) {
      console.error("Failed to update loan:", error);
      show(error?.message || "Failed to update loan", "error");
    } finally {
      setLoading(false);
    }
  };

  const unpaidInstallments = (loan.schedule ?? [])
    .map((item, index) => ({ ...item, index }))
    .filter((item) => !item.paid);

  const handleReschedule = async (index: number) => {
    if (!newDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
      show("Enter a valid date", "error");
      return;
    }

    const affected = (loan.schedule ?? []).filter(
      (item, i) => i >= index && !item.paid,
    );

    const doReschedule = async () => {
      setReschedulingLoading(true);
      try {
        await rescheduleLoanInstallment(loan.id, index, newDueDate);
        show(
          affected.length > 1
            ? `Installments #${index + 1}–#${index + affected.length} shifted`
            : `Installment #${index + 1} rescheduled`,
        );
        setReschedulingIndex(null);
        setNewDueDate("");
      } catch (error: any) {
        console.error("Failed to reschedule installment:", error);
        show(error?.message || "Failed to reschedule installment", "error");
      } finally {
        setReschedulingLoading(false);
      }
    };

    if (affected.length > 1) {
      showConfirm(
        "Shift later installments?",
        `Moving installment #${index + 1} to ${newDueDate} will also ` +
          `shift the next ${affected.length - 1} unpaid installment${
            affected.length - 1 !== 1 ? "s" : ""
          } by the same number of days, keeping the monthly cadence ` +
          `intact. Continue?`,
        doReschedule,
      );
    } else {
      doReschedule();
    }
  };

  return (
    <ModalShell title="Edit Loan" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isDisbursed && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Disbursed loan</Text>
            <Text style={styles.noticeText}>
              Editing the disbursement date re-anchors when interest starts
              accruing and re-stamps the wallet transaction. For a
              reducing-balance loan this will also recompute the accrued
              interest total to reflect the new start day.
            </Text>
          </View>
        )}

        {amountLocked && (
          <View style={[styles.noticeBox, styles.lockedNoticeBox]}>
            <Text style={[styles.noticeTitle, styles.lockedNoticeTitle]}>
              Amount locked
            </Text>
            <Text style={styles.noticeText}>
              This loan has {fmtCurrency(loan.amountRepaid ?? 0)} in repayments
              recorded, so the amount can no longer be safely edited here — the
              outstanding balance can't be inferred from a simple change.
              Adjust the balance via a manual wallet correction instead if
              needed.
            </Text>
          </View>
        )}

        <Input
          label="Loan Amount *"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix="RWF"
          hint={`Original: ${fmtCurrency(originalAmount)}`}
          editable={!amountLocked}
        />
        {!amountValid && amount.length > 0 && (
          <Text style={styles.errorText}>Enter a valid positive amount.</Text>
        )}

        {/* Read-only application date — shown only when disbursed, so it's
            obvious that editing "the date" below does NOT touch it. */}
        {isDisbursed && loan.applicationDate ? (
          <View style={styles.readonlyBox}>
            <Text style={styles.readonlyLabel}>Application Date</Text>
            <Text style={styles.readonlyValue}>
              {fmtDate(loan.applicationDate)}
            </Text>
          </View>
        ) : null}

        <DatePicker
          label={isDisbursed ? "Disbursement Date *" : "Application Date *"}
          value={date}
          onChange={setDate}
          placeholder={
            isDisbursed ? "Select disbursement date" : "Select application date"
          }
        />
        {!dateValid && date.length > 0 && (
          <Text style={styles.errorText}>
            Enter a valid date in YYYY-MM-DD format.
          </Text>
        )}

        <Input
          label="Purpose"
          value={purpose}
          onChangeText={setPurpose}
          placeholder="Loan purpose"
          multiline
        />

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>
            {isDisbursed ? "Current disbursement" : "Current application"}
          </Text>
          <Text style={styles.summaryValue}>
            {fmtCurrency(originalAmount)} · {originalDate || "—"}
          </Text>
        </View>

        <View style={styles.spacer} />

        <Button
          label="Save Changes"
          onPress={handleSave}
          fullWidth
          loading={loading}
          disabled={!canSave || !hasChanges}
          size="lg"
        />

        {isDisbursed && unpaidInstallments.length > 0 && (
          <View style={styles.rescheduleSection}>
            <Text style={styles.sectionTitle}>Reschedule Installments</Text>
            <Text style={styles.sectionSubtitle}>
              Move an unpaid installment's due date. Every later
              installment shifts by the same number of days, so the
              cadence between installments stays intact — moving #2
              forward by 5 days also moves #3, #4, #5… forward by 5
              days. Paid installments are never moved. This does not
              change the amount owed on any installment, and does not
              refund any late fee already applied.
            </Text>

            {unpaidInstallments.map((item) => (
              <View key={item.index} style={styles.installmentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.installmentLabel}>
                    Installment #{item.index + 1}
                  </Text>
                  <Text style={styles.installmentMeta}>
                    Due {fmtDate(item.dueDate)} · {fmtCurrency(item.total)}
                  </Text>
                </View>

                {reschedulingIndex === item.index ? (
                  <View style={{ flex: 1 }}>
                    {(() => {
                      const remainingUnpaid = (loan.schedule ?? []).filter(
                        (s, i) => i >= item.index && !s.paid,
                      ).length;
                      if (remainingUnpaid <= 1) return null;
                      return (
                        <Text
                          style={{
                            fontSize: 11,
                            color: C.primary,
                            fontWeight: "600",
                            backgroundColor: C.primaryFaint,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            marginBottom: 6,
                            alignSelf: "flex-start",
                          }}
                        >
                          {remainingUnpaid - 1} later installment
                          {remainingUnpaid - 1 !== 1 ? "s" : ""} will
                          shift by the same amount
                        </Text>
                      );
                    })()}
                    <DatePicker
                      label=""
                      value={newDueDate}
                      onChange={setNewDueDate}
                      placeholder="New due date"
                    />
                    <View
                      style={{ flexDirection: "row", gap: 8, marginTop: 6 }}
                    >
                      <Button
                        label="Cancel"
                        variant="secondary"
                        onPress={() => {
                          setReschedulingIndex(null);
                          setNewDueDate("");
                        }}
                        style={{ flex: 1 }}
                      />
                      <Button
                        label="Save"
                        onPress={() => handleReschedule(item.index)}
                        loading={reschedulingLoading}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.rescheduleBtn}
                    onPress={() => {
                      setReschedulingIndex(item.index);
                      setNewDueDate(item.dueDate.slice(0, 10));
                    }}
                  >
                    <Text style={styles.rescheduleBtnText}>Reschedule</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, paddingBottom: 60 },
  center: { padding: S.lg, gap: 12 },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: C.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: C.text3,
    textAlign: "center",
    marginBottom: 8,
  },
  noticeBox: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: S.md,
    marginBottom: S.lg,
  },
  lockedNoticeBox: {
    backgroundColor: "rgba(239,68,68,0.06)",
    borderColor: "rgba(239,68,68,0.2)",
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  lockedNoticeTitle: { color: C.error },
  noticeText: { fontSize: 12, lineHeight: 18, color: C.text2 },
  errorText: {
    fontSize: 11,
    color: C.error,
    marginTop: -10,
    marginBottom: S.md,
  },
  readonlyBox: {
    padding: S.md,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.md,
  },
  readonlyLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  readonlyValue: { fontSize: 13, color: C.text2, fontWeight: "600" },
  summaryBox: {
    marginTop: S.sm,
    padding: S.md,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  summaryValue: { fontSize: 12, lineHeight: 18, color: C.text2 },
  spacer: { height: S.lg },
  bottomSpacer: { height: 12 },

  rescheduleSection: {
    marginTop: S.lg * 1.5,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: S.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: C.text3,
    marginBottom: 12,
    lineHeight: 16,
  },
  installmentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  installmentLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  installmentMeta: { fontSize: 11, color: C.text3, marginTop: 2 },
  rescheduleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  rescheduleBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.primary,
  },
});