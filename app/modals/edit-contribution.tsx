// app/modals/edit-contribution.tsx
//
// ASSUMPTIONS — please verify against your actual codebase:
// 1. Route registration: same expo-router file-based assumption as
//    edit-transaction.tsx — if app/modals/_layout.tsx lists screens
//    explicitly, add "modals/edit-contribution" there too.
// 2. Store action: updateContributionAndSync(id, patch) — added in
//    contributionSlice.ts (see that file's new action).
// 3. Editable fields: amount, date, description only — same restriction
//    edit-transaction.tsx applies, and the contribution's `memberId`,
//    `contributionType`, and `status` are left untouched here (status
//    transitions stay on the approve/reject flow in contributions.tsx).
// 4. Who can edit: reused EDIT_ROLES from edit-transaction.tsx
//    (admin, loan_officer, accountant) — adjust if contributions should
//    have a different edit permission than wallet txs.
//
// NOTE: this modal is for editing an EXISTING contribution only — it
// requires an ?id= param and shows "Contribution not found" without one.
// Creating a new contribution goes through add-contribution.tsx instead.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  useStore,
  useGroupContributions,
  useCurrentUserRole,
} from "../../stores/useStore";

import {
  Input,
  Button,
  useToast,
  Toast,
  DatePicker,
} from "../../components/ui";

import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, fmtCurrency } from "../../utils/theme";

import type { Contribution } from "../../types";

const EDIT_ROLES = ["admin", "loan_officer", "accountant"];

export default function EditContributionModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const contributionId = Array.isArray(params.id) ? params.id[0] : params.id;

  const allContributions = useGroupContributions();
  const role = useCurrentUserRole();
  const { updateContributionAndSync, recalcTotals } = useStore();
  const { show, visible, msg, type } = useToast();

  const canEdit = EDIT_ROLES.includes(role);

  const contribution = useMemo(() => {
    if (!contributionId) return undefined;
    return allContributions.find((c: Contribution) => c.id === contributionId);
  }, [allContributions, contributionId]);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contribution) return;
    setDescription(contribution.description ?? "");
    setAmount(String(Math.abs(Number(contribution.amount ?? 0))));
    setDate((contribution.date ?? "").slice(0, 10));
  }, [contribution?.id]);

  if (!canEdit) {
    return (
      <ModalShell title="Edit Contribution" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Not authorized</Text>
          <Text style={styles.subtitle}>
            You don't have permission to edit contributions.
          </Text>
          <Button label="Go Back" onPress={() => router.back()} variant="secondary" fullWidth />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  if (!contribution) {
    return (
      <ModalShell title="Edit Contribution" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Contribution not found</Text>
          <Text style={styles.subtitle}>
            This contribution may have been deleted, or the link is invalid.
          </Text>
          <Button label="Go Back" onPress={() => router.back()} variant="secondary" fullWidth />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  const originalAmount = Math.abs(Number(contribution.amount ?? 0));
  const parsedAmount = Number(amount.replace(/,/g, "").trim());
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  // Description is optional for contributions (unlike edit-transaction.tsx,
  // where it's required), so there's no descriptionValid gate on canSave.
  const canSave = amountValid && dateValid;

  const originalDate = (contribution.date ?? "").slice(0, 10);
  const hasChanges =
    description.trim() !== (contribution.description ?? "") ||
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
      await updateContributionAndSync(contribution.id, {
        amount: parsedAmount,
        date,
        description: description.trim(),
      });
      recalcTotals();
      show("Contribution updated — wallet record synced");
      router.back();
    } catch (error) {
      console.error("Failed to update contribution:", error);
      show("Failed to update contribution", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Edit Contribution" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {contribution.status === "approved" && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Linked to wallet</Text>
            <Text style={styles.noticeText}>
              This contribution is approved and has a matching wallet
              transaction. Saving here will update both records together.
            </Text>
          </View>
        )}

        <Input
          label="Amount *"
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
          label="Contribution Date *"
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
          placeholder="Contribution description"
        />

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Original contribution</Text>
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