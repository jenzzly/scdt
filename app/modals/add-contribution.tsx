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

import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";

import {
  useStore,
  useGroupMembers,
  useGroupContributions,
  useGroupWallet,
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
import { KeyboardAwareScrollView } from "../../components/ui/KeyboardAwareScrollView";
import { LateFeeWaiverModal } from "../../components/ui/LateFeeWaiverModal";
import { type Palette, S, fmtCurrency, fmtDate, formatAmountInput } from "../../utils/theme";
import { useTheme } from "../../hooks/useTheme";
import { findOverdueContributions } from "../../utils/lateFees";

import type { ContributionType } from "../../types";

const TYPE_LABELS: Record<string, string> = {
  regular: "Regular Contribution",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  label,
  value,
}));

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AddContributionModal() {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);

  const router = useRouter();

  const allMembers = useGroupMembers();
  const allContributions = useGroupContributions();
  const allWallet = useGroupWallet();
  const group = useActiveGroup();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const isGroupView = useIsGroupView();
  const permissions = useCurrentMemberPermissions();

  const {
    recordContribution,
    recalcTotals,
    addLateFeeExemption,
    removeLateFeeExemption,
  } = useStore();
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

  // ── Fee-freeze / resume state ────────────────────────────────────
  const [waiverTarget, setWaiverTarget] = useState<any | null>(null);
  const [waiverSaving, setWaiverSaving] = useState(false);

  // The member this contribution is actually for. In personal view
  // there's no picker, so we fall back to the signed-in member.
  const effectiveMemberId = isGroupView
    ? memberId
    : currentMember?.id ?? "";

  const effectiveMember = useMemo(
    () => allMembers.find((m) => m.id === effectiveMemberId) ?? null,
    [allMembers, effectiveMemberId]
  );

  // Outstanding (accrued-but-unpaid) contribution late fees for the
  // member this contribution is for. Reuses findOverdueContributions —
  // the same util the Contributions screen and the Late Fees report
  // already call — so the numbers here match those exactly.
  const outstandingFees = useMemo(() => {
    if (!group || !effectiveMemberId) return [];
    return findOverdueContributions(
      group,
      allMembers,
      allContributions,
      allWallet,
    ).filter((f) => {
      if (f.memberId !== effectiveMemberId) return false;
      // Hide any fee that already has a matching wallet tx
      // marked paid. Matches the Contributions → Late Fee tab
      // filter exactly, so the two views can't disagree on
      // the same member and the same period.
      const tx = allWallet.find(
        (t) => t.id === f.feeTxId && t.type === "late_fee",
      );
      return !(tx && (tx as any).feePaid);
    });
  }, [group, allMembers, allContributions, allWallet, effectiveMemberId]);

  // Exemptions already on this member, filtered to contribution scope.
  // These are the "frozen months" — tapping Resume removes the
  // exemption so accrual restarts from the next fee day.
  const activeExemptions = useMemo(
    () =>
      (effectiveMember?.lateFeeExemptions ?? []).filter(
        (ex: any) =>
          ex.scope === "contribution" || ex.scope === "both",
      ),
    [effectiveMember],
  );

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

  // ── Fee freeze / resume handlers ───────────────────────────────────

  const handleConfirmWaiver = async (
    periodStart: string,
    periodEnd: string,
    reason: string,
  ) => {
    if (!waiverTarget || !effectiveMemberId) return;
    setWaiverSaving(true);
    try {
      await addLateFeeExemption(
        effectiveMemberId,
        {
          scope: "contribution",
          periodStart,
          periodEnd,
          reason: reason || undefined,
          // Capture the amount being frozen so the member
          // risk view can display it later.
          amount: waiverTarget.feeAmount,
        } as any,
        // Only pass the fee tx id when the fee is already on the
        // ledger — accrued-but-unapplied fees have no tx to clear.
        waiverTarget.applied ? waiverTarget.feeTxId : undefined,
      );
      show("Late fee frozen");
      setWaiverTarget(null);
    } catch (e: any) {
      show(e?.message || "Failed to freeze late fee", "error");
    } finally {
      setWaiverSaving(false);
    }
  };

  const handleRemoveExemption = async (exemptionId: string) => {
    if (!effectiveMemberId) return;
    try {
      await removeLateFeeExemption(effectiveMemberId, exemptionId);
      show("Late fee resumed");
    } catch (e: any) {
      show(e?.message || "Failed to resume late fee", "error");
    }
  };

  return (
    <ModalShell noScroll title="Add Contribution" onClose={() => router.back()}>
      <KeyboardAwareScrollView
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
          onChangeText={(v) => setAmount(formatAmountInput(v))}
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

        {/* ── Late-fee freeze / resume panel ─────────────────── */}
        {effectiveMemberId ? (
          <>
            {outstandingFees.length > 0 && (
              <View style={styles.feesSection}>
                <Text style={styles.feesSectionTitle}>
                  Outstanding Late Fees
                </Text>
                <Text style={styles.feesSectionHelp}>
                  Freeze a month to waive its late fee before you
                  record this payment. Frozen months stop accruing
                  until you resume them.
                </Text>

                {outstandingFees.map((fee) => (
                  <View key={fee.feeTxId} style={styles.feeRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={styles.feeRowPeriod}
                        numberOfLines={1}
                      >
                        {fee.periodLabel}
                      </Text>
                      <Text
                        style={styles.feeRowMeta}
                        numberOfLines={1}
                      >
                        {fee.daysLate}d late · {fmtCurrency(fee.feeAmount)}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={styles.freezeBtn}
                      onPress={() => setWaiverTarget(fee)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.freezeBtnText}>Freeze</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {activeExemptions.length > 0 && (
              <View style={styles.feesSection}>
                <Text style={styles.feesSectionTitle}>Frozen Months</Text>
                <Text style={styles.feesSectionHelp}>
                  Late fees are paused for these periods. Tap Resume
                  to start accruing again from the next fee day.
                </Text>

                {activeExemptions.map((ex: any) => (
                  <View key={ex.id} style={styles.feeRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={styles.feeRowPeriod}
                        numberOfLines={1}
                      >
                        {fmtDate(ex.periodStart)} → {fmtDate(ex.periodEnd)}
                      </Text>
                      {ex.reason ? (
                        <Text
                          style={styles.feeRowMeta}
                          numberOfLines={1}
                        >
                          {ex.reason}
                        </Text>
                      ) : null}
                    </View>

                    <TouchableOpacity
                      style={styles.resumeBtn}
                      onPress={() => handleRemoveExemption(ex.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.resumeBtnText}>Resume</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}

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
      </KeyboardAwareScrollView>

      <LateFeeWaiverModal
        visible={!!waiverTarget}
        onClose={() => setWaiverTarget(null)}
        target={waiverTarget}
        member={effectiveMember}
        group={group}
        saving={waiverSaving}
        context="contribution"
        onConfirm={handleConfirmWaiver}
        onRemoveExemption={handleRemoveExemption}
      />

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  body: { padding: S.lg, paddingBottom: 60 },
  center: { padding: S.lg, gap: 12 },
  title: { fontSize: 17, fontWeight: "800", color: C.text, textAlign: "center" },
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
    marginTop: S.sm,
  },
  noticeTitle: { fontSize: 12, fontWeight: "800", color: C.text, marginBottom: 4 },
  noticeText: { fontSize: 12, lineHeight: 18, color: C.text2 },
  errorText: { fontSize: 11, color: C.error, marginTop: -10, marginBottom: S.md },

  // ── Late-fee freeze / resume panel ───────────────────────────────
  feesSection: {
    marginTop: S.md,
    padding: S.md,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  feesSectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: C.text,
  },
  feesSectionHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: C.text3,
    marginBottom: 4,
  },
  feeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  feeRowPeriod: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  feeRowMeta: {
    fontSize: 10.5,
    color: C.text3,
    marginTop: 2,
  },
  freezeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: C.gold,
  },
  freezeBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: C.goldText,
  },
  resumeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: C.success,
  },
  resumeBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: C.greenText,
  },

  spacer: { height: S.lg },
  bottomSpacer: { height: 12 },
});
