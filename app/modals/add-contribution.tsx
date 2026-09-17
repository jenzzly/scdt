// app/modals/add-contribution.tsx
//
// ASSUMPTIONS — please verify against your actual codebase:
// 1. Route registration: same expo-router file-based assumption as the
//    other modals — if app/modals/_layout.tsx lists screens explicitly,
//    add "modals/add-contribution" there too.
// 2. Store action: recordContribution(data, autoApprove) — a NEW contribution is created
//    with autoApprove=false to set status to "pending". This matches the
//    actual store action in contributionSlice.ts.
// 3. Member picker: assumed to be the same <Select> component used for
//    MANUAL_TYPES in edit-transaction.tsx, fed from useGroupMembers().
//    In personal view (non-group), the current member is used directly
//    and the picker is hidden — matching contributions.tsx's
//    isGroupView / currentMember pattern.
// 4. Type picker: uses the same TYPE_LABELS set as contributions.tsx
//    (regular, loan_repayment, loan_interest, late_fee,
//    investment_funding, investment_return, penalty, other). New
//    contributions default to "regular".
// 5. Who can add: reused permissions.addContribution || isAdmin check
//    from contributions.tsx (canAdd), NOT the EDIT_ROLES list — adding
//    a contribution is a broader permission than editing one in that
//    file, so this intentionally does not reuse EDIT_ROLES.
// 6. New contributions are created with status "pending" (matching the
//    approve/reject flow already in contributions.tsx) unless the actor
//    can approve, in which case they still land as "pending" — approval
//    stays a separate, explicit action. Adjust if your store already
//    defaults status on the backend.
//
// FIX NOTES (TypeScript/lint):
// - Removed unused `Contribution` and `fmtCurrency` imports
//   (no-unused-vars / noUnusedLocals).
// - `Select`'s onChange hands back a plain string, so the type picker's
//   handler now narrows to ContributionType explicitly instead of
//   passing setContributionType directly (which expects ContributionType,
//   not string).
// - NOTE: if your store's Contribution input field is named `type`
//   rather than `contributionType`, rename the key in the
//   recordContribution() call below to match — I couldn't verify this
//   against contributionSlice.ts.

import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import {
  useStore,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMember,
  useIsGroupView,
  useCurrentMemberPermissions,
  useActiveGroup,
} from "../../stores/useStore";

import {
  Input,
  Select,
  Button,
  useToast,
  Toast,
  DatePicker,
} from "../../components/ui";

import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S } from "../../utils/theme";

import type { ContributionType } from "../../types";

const TYPE_LABELS: Record<string, string> = {
  regular: "Regular Contribution",
  loan_repayment: "Loan Repayment",
  loan_interest: "Loan Interest",
  late_fee: "Late Fee",
  investment_funding: "Investment Funding",
  investment_return: "Investment Return",
  penalty: "Penalty",
  other: "Other",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  label,
  value,
}));

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AddContributionModal() {
  const router = useRouter();

  const allMembers = useGroupMembers();
  const group = useActiveGroup();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isGroupView = useIsGroupView();
  const permissions = useCurrentMemberPermissions();

  const { recordContribution, recalcTotals } = useStore();
  const { show, visible, msg, type } = useToast();

  const isAdmin = role === "admin";
  const canAdd = permissions.addContribution || isAdmin;

  const memberOptions = useMemo(
    () =>
      allMembers
        .filter((m) => m.status === "active")
        .map((m) => ({ label: m.fullName, value: m.id })),
    [allMembers]
  );

  // In personal view there's no member picker — the contribution is
  // always for the current member.
  const [memberId, setMemberId] = useState(
    isGroupView ? "" : currentMember?.id ?? ""
  );
  const [contributionType, setContributionType] = useState<ContributionType>(
    "regular" as ContributionType
  );
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  if (!canAdd) {
    return (
      <ModalShell title="Add Contribution" onClose={() => router.back()}>
        <View style={styles.center}>
          <Text style={styles.title}>Not authorized</Text>
          <Text style={styles.subtitle}>
            You don't have permission to add contributions.
          </Text>
          <Button label="Go Back" onPress={() => router.back()} variant="secondary" fullWidth />
        </View>
        <Toast visible={visible} msg={msg} type={type} />
      </ModalShell>
    );
  }

  const parsedAmount = Number(amount.replace(/,/g, "").trim());
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const memberValid = !!memberId;

  const canSave = amountValid && dateValid && memberValid;

  const handleSave = async () => {
    if (loading) return;

    if (!memberValid) {
      show("Select a member", "error");
      return;
    }
    if (!amountValid) {
      show("Enter a valid positive amount", "error");
      return;
    }
    if (!dateValid) {
      show("Enter a valid date", "error");
      return;
    }

    setLoading(true);
    try {
      await recordContribution(
        {
          memberId,
          contributionType,
          amount: parsedAmount,
          date,
          description: description.trim(),
          groupId: group?.id || "",
        },
        false // Don't auto-approve, set status to pending
      );

      recalcTotals();
      show("Contribution added");
      router.back();
    } catch (error) {
      console.error("Failed to add contribution:", error);
      show("Failed to add contribution", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Add Contribution" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isGroupView && (
          <Select
            label="Member *"
            value={memberId}
            options={memberOptions}
            onChange={setMemberId}
          />
        )}

        <Select
          label="Type *"
          value={contributionType}
          options={TYPE_OPTIONS}
          onChange={(value: string) =>
            setContributionType(value as ContributionType)
          }
        />

        <Input
          label="Amount *"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix={group?.currency ?? "RWF"}
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

        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>New contribution</Text>
          <Text style={styles.noticeText}>
            This will be added as pending and will need to be approved
            before it counts toward totals or goals.
          </Text>
        </View>

        <View style={styles.spacer} />

        <Button
          label="Add Contribution"
          onPress={handleSave}
          fullWidth
          loading={loading}
          disabled={!canSave}
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
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.text3,
    textAlign: "center",
    marginBottom: 8,
  },
  noticeBox: {
    backgroundColor: Colors.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: S.md,
    marginTop: S.sm,
  },
  noticeTitle: { fontSize: 12, fontWeight: "800", color: Colors.text, marginBottom: 4 },
  noticeText: { fontSize: 12, lineHeight: 18, color: Colors.text2 },
  errorText: { fontSize: 11, color: Colors.error, marginTop: -10, marginBottom: S.md },
  spacer: { height: S.lg },
  bottomSpacer: { height: 12 },
});