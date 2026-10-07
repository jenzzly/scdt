// components/ui/PendingWaiversCard.tsx
//
// Pending waiver review card. Reads the member LIVE from the store
// by ID so any approve / reject anywhere in the app updates this
// view immediately — including the same tab that opened the request.
//
// The `member` prop is only used to obtain the ID and as a fallback
// for the very first render before the store subscription has fired.

import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import {
  useStore,
  useCurrentUserRole,
  useCurrentMemberPermissions,
} from "../../stores/useStore";
import { useTheme } from "../../hooks/useTheme";
import { fmtCurrency, fmtDate } from "../../utils/theme";
import type { Member } from "../../types";

interface Props {
  member: Member | null | undefined;
  canReviewOverride?: boolean;
}

export function PendingWaiversCard({ member, canReviewOverride }: Props) {
  const C = useTheme();
  const role = useCurrentUserRole();
  const perms = useCurrentMemberPermissions();

  const approve = useStore((s: any) => s.approveLateFeeExemption);
  const reject = useStore((s: any) => s.rejectLateFeeExemption);

  const memberId = member?.id;

  // Subscribe to the members array directly. Doing it this way means
  // React re-renders this card any time ANY member changes — which is
  // exactly what we want when approve/reject updates the store.
  const liveMember = useStore((s: any) =>
    memberId ? s.members.find((m: any) => m.id === memberId) ?? null : null,
  );

  const pending: any[] = useMemo(() => {
    const effective = liveMember ?? member;
    if (!effective) return [];
    return Array.isArray((effective as any).pendingExemptions)
      ? (effective as any).pendingExemptions
      : [];
  }, [liveMember, member]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canReview =
    typeof canReviewOverride === "boolean"
      ? canReviewOverride
      : role === "admin" ||
        role === "accountant" ||
        role === "loan_officer" ||
        (perms as any)?.waiveLateFees === true;

  if (!memberId) return null;
  if (pending.length === 0) return null;

  const doApprove = async (exemptionId: string) => {
    setError(null);
    if (typeof approve !== "function") {
      setError("Approve action unavailable. Reload and try again.");
      return;
    }
    setBusyId(exemptionId);
    try {
      await approve(memberId, exemptionId);
    } catch (e: any) {
      setError(e?.message || "Failed to approve waiver");
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (exemptionId: string) => {
    setError(null);
    if (typeof reject !== "function") {
      setError("Reject action unavailable. Reload and try again.");
      return;
    }
    setBusyId(exemptionId);
    try {
      await reject(memberId, exemptionId, "Rejected by approver");
    } catch (e: any) {
      setError(e?.message || "Failed to reject waiver");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 14,
        borderRadius: 12,
        backgroundColor: C.infoBg,
        borderWidth: 1,
        borderColor: C.info,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text
          style={{
            fontSize: 13,
            fontWeight: "800",
            color: C.infoText,
            letterSpacing: 0.3,
          }}
        >
          PENDING WAIVER REQUESTS
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 10,
            backgroundColor: C.info,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: "800", color: "#fff" }}>
            {pending.length}
          </Text>
        </View>
      </View>

      <Text
        style={{
          fontSize: 11,
          color: C.infoText,
          marginBottom: 10,
          lineHeight: 15,
        }}
      >
        {canReview
          ? "Approving moves the request into the member's active exemptions."
          : "Awaiting approval by an admin, accountant, or loan officer."}
      </Text>

      {error ? (
        <View
          style={{
            padding: 8,
            borderRadius: 8,
            backgroundColor: C.redBg,
            borderWidth: 1,
            borderColor: C.error,
            marginBottom: 8,
          }}
        >
          <Text style={{ fontSize: 11, color: C.error }}>{error}</Text>
        </View>
      ) : null}

      {pending.map((ex) => {
        const busy = busyId === ex.id;
        const scopeLabel =
          ex.scope === "loan"
            ? "Loan"
            : ex.scope === "both"
            ? "Both"
            : "Contribution";
        return (
          <View
            key={ex.id}
            style={{
              backgroundColor: C.surface,
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: C.infoBg,
                }}
              >
                <Text
                  style={{
                    fontSize: 9,
                    fontWeight: "800",
                    color: C.infoText,
                    letterSpacing: 0.3,
                  }}
                >
                  {scopeLabel.toUpperCase()}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: C.text3 }}>
                {fmtDate(ex.periodStart)} → {fmtDate(ex.periodEnd)}
              </Text>
            </View>

            {typeof ex.amount === "number" && ex.amount > 0 ? (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "700",
                  color: C.text,
                  marginBottom: 2,
                }}
              >
                {fmtCurrency(ex.amount)} affected
              </Text>
            ) : null}

            {ex.reason ? (
              <Text
                style={{
                  fontSize: 11,
                  color: C.text2,
                  fontStyle: "italic",
                  marginTop: 2,
                }}
                numberOfLines={3}
              >
                {ex.reason}
              </Text>
            ) : null}

            <Text style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>
              Requested by {ex.createdByName || "—"}
            </Text>

            {canReview ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: C.error,
                    backgroundColor: C.surface,
                    alignItems: "center",
                    opacity: busy ? 0.6 : 1,
                  }}
                  onPress={() => doReject(ex.id)}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: C.error,
                    }}
                  >
                    {busy ? "Working…" : "Reject"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: 8,
                    backgroundColor: C.success,
                    alignItems: "center",
                    opacity: busy ? 0.6 : 1,
                  }}
                  onPress={() => doApprove(ex.id)}
                  disabled={busy}
                  activeOpacity={0.8}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "700",
                      color: "#fff",
                    }}
                  >
                    {busy ? "Working…" : "Approve"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export default PendingWaiversCard;
