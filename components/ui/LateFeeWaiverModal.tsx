// components/ui/LateFeeWaiverModal.tsx
//
// Shared per-member, per-period late-fee waiver modal.
//
// The `context` prop tells the modal which kind of fee is being waived
// — "contribution" or "loan". Because each screen only waives its own
// kind of fee, the modal no longer offers a scope picker: you can't
// accidentally waive contribution fees from the loans screen or vice
// versa. To waive both kinds at once, do it twice — once per screen.
//
// The `target` object the caller provides must have:
//   memberId      — required
//   periodStart   — YYYY-MM-DD; seeds the date picker
//   periodLabel   — human label shown in the header
//   applied       — true if the fee is already on the ledger
//   feeTxId       — the wallet tx to clear when applied is true

import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { BottomModal } from "./BottomModal";
import { Input } from "./Input";
import { DatePicker } from "./DatePicker";
import { C } from "../../utils/theme";
import type { LateFeeExemption, Member } from "../../types";

export function LateFeeWaiverModal({
  visible,
  onClose,
  target,
  member,
  group,
  saving,
  context,
  onConfirm,
  onRemoveExemption,
}: {
  visible: boolean;
  onClose: () => void;
  target: any;
  member: Member | null;
  group: any;
  saving: boolean;
  context: "contribution" | "loan";
  onConfirm: (
    periodStart: string,
    periodEnd: string,
    reason: string
  ) => void;
  onRemoveExemption: (exemptionId: string) => void;
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!visible || !target) return;

    const rawPeriodStart =
      typeof target.periodStart === "string"
        ? target.periodStart.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    setReason("");

    const start = new Date(rawPeriodStart + "T00:00:00");
    if (!isNaN(start.getTime())) {
      const firstOfMonth = new Date(
        start.getFullYear(),
        start.getMonth(),
        1
      );
      const lastOfMonth = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0
      );
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(d.getDate()).padStart(2, "0")}`;
      setPeriodStart(iso(firstOfMonth));
      setPeriodEnd(iso(lastOfMonth));
    } else {
      setPeriodStart(rawPeriodStart);
      setPeriodEnd(rawPeriodStart);
    }
  }, [visible, target?.feeTxId, target?.periodStart]);

  if (!member) return null;

  const existingExemptions: LateFeeExemption[] =
    (member.lateFeeExemptions ?? []) as LateFeeExemption[];

  const scopeNoun =
    context === "loan" ? "loan" : "contribution";

  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Waive Late Fees"
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.waiverIntro}>
          Record a per-member waiver for a period. No late fees on{" "}
          {scopeNoun} fees will accrue for {member.fullName} between the
          dates below.
        </Text>

        <View style={styles.waiverTargetCard}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.waiverTargetLabel}>Member</Text>
            <Text style={styles.waiverTargetName} numberOfLines={1}>
              {member.fullName}
            </Text>
            {target?.periodLabel && (
              <Text style={styles.waiverTargetSub} numberOfLines={1}>
                Fee period: {target.periodLabel}
              </Text>
            )}
          </View>
        </View>

        <Text style={styles.waiverSectionTitle}>Period</Text>
        <Text style={styles.waiverSectionHelp}>
          Defaults to the calendar month of the fee you clicked.
        </Text>

        <DatePicker
          label="From Date"
          value={periodStart}
          onChange={setPeriodStart}
          placeholder="YYYY-MM-DD"
        />
        <DatePicker
          label="To Date"
          value={periodEnd}
          onChange={setPeriodEnd}
          placeholder="YYYY-MM-DD"
        />

        <Text style={[styles.waiverSectionTitle, { marginTop: 12 }]}>
          Reason
        </Text>
        <Input
          value={reason}
          onChangeText={setReason}
          placeholder="Optional note (shown on the exemption list)"
          multiline
        />

        {existingExemptions.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.waiverSectionTitle}>
              Existing Waivers ({existingExemptions.length})
            </Text>
            <Text style={styles.waiverSectionHelp}>
              Revoke a waiver to allow fees to accrue for its period
              again. Fees already cleared when the waiver was created
              are not restored.
            </Text>

            {existingExemptions.map((ex) => (
              <View key={ex.id} style={styles.waiverExistingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={styles.waiverExistingTitle}
                    numberOfLines={1}
                  >
                    {ex.scope === "both"
                      ? "Contributions + Loans"
                      : ex.scope === "contribution"
                      ? "Contributions"
                      : "Loans"}
                  </Text>
                  <Text
                    style={styles.waiverExistingPeriod}
                    numberOfLines={1}
                  >
                    {ex.periodStart} → {ex.periodEnd}
                  </Text>
                  {ex.reason && (
                    <Text
                      style={styles.waiverExistingReason}
                      numberOfLines={2}
                    >
                      {ex.reason}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.waiverRevokeBtn}
                  onPress={() => onRemoveExemption(ex.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.waiverRevokeBtnText}>Revoke</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.waiverButtonRow}>
          <TouchableOpacity
            style={styles.waiverCancelBtn}
            onPress={onClose}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={styles.waiverCancelBtnText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.waiverSaveBtn, saving && { opacity: 0.6 }]}
            onPress={() =>
              onConfirm(periodStart, periodEnd, reason)
            }
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={styles.waiverSaveBtnText}>
              {saving ? "Saving…" : "Save Waiver"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </BottomModal>
  );
}

const styles = {
  waiverIntro: {
    fontSize: 12,
    lineHeight: 17,
    color: C.text3,
    marginBottom: 14,
  } as any,
  waiverTargetCard: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },
  waiverTargetLabel: {
    fontSize: 9,
    fontWeight: "800" as const,
    color: C.text3,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  waiverTargetName: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: C.text,
    marginTop: 2,
  },
  waiverTargetSub: { fontSize: 11, color: C.text3, marginTop: 2 },
  waiverSectionTitle: {
    fontSize: 13,
    fontWeight: "800" as const,
    color: C.text,
    marginBottom: 4,
  },
  waiverSectionHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: C.text3,
    marginBottom: 10,
  },
  waiverExistingRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  waiverExistingTitle: {
    fontSize: 12,
    fontWeight: "700" as const,
    color: C.text,
  },
  waiverExistingPeriod: { fontSize: 11, color: C.text3, marginTop: 2 },
  waiverExistingReason: {
    fontSize: 11,
    color: C.text2,
    marginTop: 2,
    fontStyle: "italic" as const,
  },
  waiverRevokeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
  },
  waiverRevokeBtnText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: C.error,
  },
  waiverButtonRow: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 20,
  },
  waiverCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center" as const,
  },
  waiverCancelBtnText: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: C.text2,
  },
  waiverSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center" as const,
  },
  waiverSaveBtnText: {
    fontSize: 13,
    fontWeight: "800" as const,
    color: "#fff",
  },
};
