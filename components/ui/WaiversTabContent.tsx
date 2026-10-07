// components/ui/WaiversTabContent.tsx
//
// Full waivers view for the Group Settings → Waivers tab.
//
// Two sections:
//
//   PENDING REVIEW — every entry across every member's
//     `pendingExemptions` array. Approve / Reject per row.
//
//   APPROVED — every entry across every member's
//     `lateFeeExemptions` array. Read-only, with Revoke per row.
//
// Reads directly from useGroupMembers(), so it updates the moment
// the store's member array changes — approving a waiver in one
// place updates this view immediately without a refresh.

import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, useWindowDimensions } from "react-native";
import {
  useStore,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMemberPermissions,
} from "../../stores/useStore";
import { useTheme } from "../../hooks/useTheme";
import { fmtCurrency, fmtDate } from "../../utils/theme";
import { KeyboardAwareScrollView } from "./KeyboardAwareScrollView";

function WaiverRow({
  memberName,
  exemption,
  kind,
  busy,
  onApprove,
  onReject,
  onRevoke,
}: {
  memberName: string;
  exemption: any;
  kind: "pending" | "approved";
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onRevoke?: () => void;
}) {
  const C = useTheme();
  const scopeLabel =
    exemption.scope === "loan"
      ? "Loan"
      : exemption.scope === "both"
      ? "Both"
      : "Contribution";

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: kind === "pending" ? C.info : C.gold,
        borderRadius: 12,
        padding: 14,
        gap: 6,
        backgroundColor: C.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{ fontSize: 15, fontWeight: "800", color: C.text, flex: 1 }}
          numberOfLines={1}
        >
          {memberName}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 5,
            backgroundColor: kind === "pending" ? C.infoBg : C.goldBg,
          }}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: "800",
              color: kind === "pending" ? C.infoText : C.goldText,
              letterSpacing: 0.4,
            }}
          >
            {scopeLabel.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 12, color: C.text2 }}>
        {fmtDate(exemption.periodStart)} → {fmtDate(exemption.periodEnd)}
      </Text>

      {typeof exemption.amount === "number" && exemption.amount > 0 ? (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "700",
            color: kind === "pending" ? C.infoText : C.goldText,
          }}
        >
          {fmtCurrency(exemption.amount)}{" "}
          {kind === "pending" ? "affected" : "waived"}
        </Text>
      ) : null}

      {exemption.reason ? (
        <Text
          style={{ fontSize: 11, color: C.text3, fontStyle: "italic", lineHeight: 15 }}
          numberOfLines={3}
        >
          {exemption.reason}
        </Text>
      ) : null}

      <Text style={{ fontSize: 10, color: C.text3 }}>
        {kind === "pending" ? "Requested" : "Created"} by{" "}
        {exemption.createdByName || "—"}
        {exemption.createdAt ? ` · ${fmtDate(exemption.createdAt)}` : ""}
      </Text>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        {kind === "pending" && onReject ? (
          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: C.error,
              backgroundColor: C.surface,
              alignItems: "center",
              opacity: busy ? 0.6 : 1,
            }}
            onPress={onReject}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: C.error }}>
              {busy ? "Working…" : "Reject"}
            </Text>
          </TouchableOpacity>
        ) : null}

        {kind === "pending" && onApprove ? (
          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: C.success,
              alignItems: "center",
              opacity: busy ? 0.6 : 1,
            }}
            onPress={onApprove}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>
              {busy ? "Working…" : "Approve"}
            </Text>
          </TouchableOpacity>
        ) : null}

        {kind === "approved" && onRevoke ? (
          <TouchableOpacity
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: C.error,
              backgroundColor: C.surface,
              alignItems: "center",
              opacity: busy ? 0.6 : 1,
            }}
            onPress={onRevoke}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: C.error }}>
              {busy ? "Working…" : "Revoke"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function WaiversTabContent() {
  const C = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;

  const members = useGroupMembers();
  const role = useCurrentUserRole();
  const perms = useCurrentMemberPermissions();

  const approve = useStore((s: any) => s.approveLateFeeExemption);
  const reject = useStore((s: any) => s.rejectLateFeeExemption);
  const removeExemption = useStore((s: any) => s.removeLateFeeExemption);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canReview =
    role === "admin" ||
    role === "accountant" ||
    role === "loan_officer" ||
    (perms as any)?.waiveLateFees === true;

  const pendingWaivers = useMemo(() => {
    const out: Array<{ key: string; memberId: string; memberName: string; exemption: any }> = [];
    for (const m of members) {
      for (const ex of ((m as any).pendingExemptions ?? []) as any[]) {
        out.push({
          key: `${m.id}:${ex.id}`,
          memberId: m.id,
          memberName: m.fullName,
          exemption: ex,
        });
      }
    }
    out.sort((a, b) => {
      const ta = new Date(a.exemption.createdAt || 0).getTime();
      const tb = new Date(b.exemption.createdAt || 0).getTime();
      return tb - ta;
    });
    return out;
  }, [members]);

  const activeWaivers = useMemo(() => {
    const out: Array<{ key: string; memberId: string; memberName: string; exemption: any }> = [];
    for (const m of members) {
      for (const ex of ((m as any).lateFeeExemptions ?? []) as any[]) {
        out.push({
          key: `${m.id}:${ex.id}`,
          memberId: m.id,
          memberName: m.fullName,
          exemption: ex,
        });
      }
    }
    out.sort((a, b) => {
      const ta = new Date(a.exemption.createdAt || 0).getTime();
      const tb = new Date(b.exemption.createdAt || 0).getTime();
      return tb - ta;
    });
    return out;
  }, [members]);

  const doApprove = async (memberId: string, exemptionId: string) => {
    setError(null);
    if (typeof approve !== "function") {
      setError("Approve action is not available. Reload and try again.");
      return;
    }
    const key = `${memberId}:${exemptionId}`;
    setBusyKey(key);
    try {
      await approve(memberId, exemptionId);
    } catch (e: any) {
      setError(e?.message || "Failed to approve waiver");
    } finally {
      setBusyKey(null);
    }
  };

  const doReject = async (memberId: string, exemptionId: string) => {
    setError(null);
    if (typeof reject !== "function") {
      setError("Reject action is not available. Reload and try again.");
      return;
    }
    const key = `${memberId}:${exemptionId}`;
    setBusyKey(key);
    try {
      await reject(memberId, exemptionId, "Rejected by approver");
    } catch (e: any) {
      setError(e?.message || "Failed to reject waiver");
    } finally {
      setBusyKey(null);
    }
  };

  const doRevoke = async (memberId: string, exemptionId: string) => {
    setError(null);
    if (typeof removeExemption !== "function") {
      setError("Revoke action is not available. Reload and try again.");
      return;
    }
    const key = `${memberId}:${exemptionId}`;
    setBusyKey(key);
    try {
      await removeExemption(memberId, exemptionId);
    } catch (e: any) {
      setError(e?.message || "Failed to revoke waiver");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={[
        { paddingBottom: 60 },
        isWide && {
          paddingHorizontal: 32,
          maxWidth: 1100,
          alignSelf: "center" as any,
          width: "100%" as any,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {error ? (
        <View
          style={{
            margin: 16,
            padding: 12,
            borderRadius: 10,
            backgroundColor: C.redBg,
            borderWidth: 1,
            borderColor: C.error,
          }}
        >
          <Text style={{ fontSize: 12, color: C.error }}>{error}</Text>
        </View>
      ) : null}

      {/* ── Pending review ──────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            color: C.text2,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          Pending Review ({pendingWaivers.length})
        </Text>
      </View>

      {pendingWaivers.length === 0 ? (
        <View
          style={{
            marginHorizontal: 16,
            padding: 24,
            borderRadius: 12,
            backgroundColor: C.elevated,
            borderWidth: 1,
            borderColor: C.border,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 20, marginBottom: 6 }}>✓</Text>
          <Text style={{ fontSize: 13, color: C.text2, textAlign: "center" }}>
            No pending waiver requests.
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {pendingWaivers.map(({ key, memberId, memberName, exemption }) => (
            <WaiverRow
              key={key}
              memberName={memberName}
              exemption={exemption}
              kind="pending"
              busy={busyKey === key}
              onApprove={
                canReview
                  ? () => doApprove(memberId, exemption.id)
                  : undefined
              }
              onReject={
                canReview
                  ? () => doReject(memberId, exemption.id)
                  : undefined
              }
            />
          ))}
        </View>
      )}

      {/* ── Approved ────────────────────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 8,
          marginTop: 8,
          borderTopWidth: 1,
          borderTopColor: C.borderLight,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            color: C.text2,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          Approved Waivers ({activeWaivers.length})
        </Text>
        <Text
          style={{
            fontSize: 11,
            color: C.text3,
            marginTop: 4,
            lineHeight: 15,
          }}
        >
          Revoking removes the exemption so fees can accrue again for
          that period. Fees already cleared by the waiver are not
          restored.
        </Text>
      </View>

      {activeWaivers.length === 0 ? (
        <View
          style={{
            marginHorizontal: 16,
            padding: 24,
            borderRadius: 12,
            backgroundColor: C.elevated,
            borderWidth: 1,
            borderColor: C.border,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 13, color: C.text2, textAlign: "center" }}>
            No approved waivers on record.
          </Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {activeWaivers.map(({ key, memberId, memberName, exemption }) => (
            <WaiverRow
              key={key}
              memberName={memberName}
              exemption={exemption}
              kind="approved"
              busy={busyKey === key}
              onRevoke={
                canReview
                  ? () => doRevoke(memberId, exemption.id)
                  : undefined
              }
            />
          ))}
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}

export default WaiversTabContent;
