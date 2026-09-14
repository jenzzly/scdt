// app/modals/edit-investment.tsx
//
// Updated once investmentSlice.ts (real file) was available — confirms:
//   - Investment.investmentAmount, .startDate, .description all exist
//     (used directly throughout investmentSlice.ts: createInvestment,
//     approveInvestmentStep, closeInvestment).
//   - updateInvestmentAndSync(id, { amount?, date?, description? }) is a
//     real, typed store action now (see investmentSlice.ts) — the `as any`
//     cast from the earlier draft is removed.
//   - A linked wallet tx (type: "investment_disbursement") only exists
//     once status reaches "open" — see approveInvestmentStep's accountant
//     branch. For "pending_committee" / "pending" investments there's
//     nothing to sync yet, which updateInvestmentAndSync already handles.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useStore, useCurrentUserRole } from "../../stores/useStore";
import { useGroupInvestments } from "../../stores/selectors";

import {
  Input,
  Button,
  useToast,
  Toast,
  DatePicker,
} from "../../components/ui";

import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, fmtCurrency } from "../../utils/theme";

import type { Investment } from "../../types";

const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

export default function EditInvestmentModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const investmentId = Array.isArray(params.id) ? params.id[0] : params.id;

  const allInvestments = useGroupInvestments();
  const role = useCurrentUserRole();
  const { updateInvestmentAndSync, recalcTotals } = useStore();
  const { show, visible, msg, type } = useToast();

  const canEdit = EDIT_ROLES.includes(role);

  const investment = useMemo(() => {
    if (!investmentId) return undefined;
    return allInvestments.find((i: Investment) => i.id === investmentId);
  }, [allInvestments, investmentId]);

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!investment) return;
    setAmount(String(Math.abs(Number(investment.investmentAmount ?? 0))));
    setDate((investment.startDate ?? "").slice(0, 10));
    setDescription(investment.description ?? "");
  }, [investment?.id]);

  if (!canEdit) {
    return (
      <ModalShell title="Edit Investment" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Not authorized</Text>
          <Text style={styles.subtitle}>You don't have permission to edit investments.</Text>
          <Button label="Go Back" onPress={() => router.back()} variant="secondary" fullWidth />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  if (!investment) {
    return (
      <ModalShell title="Edit Investment" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Investment not found</Text>
          <Text style={styles.subtitle}>
            This investment may have been deleted, or the link is invalid.
          </Text>
          <Button label="Go Back" onPress={() => router.back()} variant="secondary" fullWidth />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  // A linked wallet tx (investment_disbursement) only exists once the
  // investment has cleared both approval steps and reached "open" — or
  // moved on to "closed" from there. "pending_committee" / "pending"
  // investments have no tx to sync yet.
  const hasDisbursementTx = investment.status === "open" || investment.status === "closed";

  const originalAmount = Math.abs(Number(investment.investmentAmount ?? 0));
  const parsedAmount = Number(amount.replace(/,/g, "").trim());
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = amountValid && dateValid;

  const originalDate = (investment.startDate ?? "").slice(0, 10);
  const hasChanges =
    description.trim() !== (investment.description ?? "") ||
    parsedAmount !== originalAmount ||
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
      await updateInvestmentAndSync(investment.id, {
        amount: parsedAmount,
        date,
        description: description.trim(),
      });
      recalcTotals();
      show(
        hasDisbursementTx
          ? "Investment updated — disbursement record synced"
          : "Investment updated"
      );
      router.back();
    } catch (error) {
      console.error("Failed to update investment:", error);
      show("Failed to update investment", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Edit Investment" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {hasDisbursementTx && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>
              {investment.status === "closed" ? "Closed investment" : "Active investment"}
            </Text>
            <Text style={styles.noticeText}>
              This investment has a matching disbursement wallet
              transaction. Saving here updates both records together.
              {investment.status === "closed"
                ? " Note: this does not recompute the profit/loss recorded at closing."
                : ""}
            </Text>
          </View>
        )}
        {!hasDisbursementTx && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Not yet disbursed</Text>
            <Text style={styles.noticeText}>
              This investment is still awaiting approval, so there's no
              wallet transaction yet — this only updates the investment
              record itself.
            </Text>
          </View>
        )}

        <Input
          label="Investment Amount *"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix="RWF"
          hint={`Original: ${fmtCurrency(originalAmount)}`}
        />
        {!amountValid && amount.length > 0 && (
          <Text style={styles.errorText}>Enter a valid positive amount.</Text>
        )}

        <DatePicker
          label="Start Date *"
          value={date}
          onChange={setDate}
          placeholder="Select date"
        />
        {!dateValid && date.length > 0 && (
          <Text style={styles.errorText}>Enter a valid date in YYYY-MM-DD format.</Text>
        )}

        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Brief description"
          multiline
        />

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Original investment</Text>
          <Text style={styles.summaryValue}>
            {fmtCurrency(originalAmount)} · {originalDate}
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

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  body: { padding: S.lg, paddingBottom: 60 },
  center: { padding: S.lg, gap: 12 },
  title: { fontSize: 17, fontWeight: "800", color: Colors.text, textAlign: "center" },
  subtitle: { fontSize: 13, lineHeight: 19, color: Colors.text3, textAlign: "center", marginBottom: 8 },
  noticeBox: {
    backgroundColor: Colors.elevated, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, padding: S.md, marginBottom: S.lg,
  },
  noticeTitle: { fontSize: 12, fontWeight: "800", color: Colors.text, marginBottom: 4 },
  noticeText: { fontSize: 12, lineHeight: 18, color: Colors.text2 },
  errorText: { fontSize: 11, color: Colors.error, marginTop: -10, marginBottom: S.md },
  summaryBox: {
    marginTop: S.sm, padding: S.md, borderRadius: 10,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  summaryLabel: { fontSize: 10, fontWeight: "800", color: Colors.text3, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  summaryValue: { fontSize: 12, lineHeight: 18, color: Colors.text2 },
  spacer: { height: S.lg },
  bottomSpacer: { height: 12 },
});