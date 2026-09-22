// app/(tabs)/loans.tsx

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  StatusBar,
  useWindowDimensions,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore,
  useGroupLoans,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMember,
  useIsGroupView,
  useActiveGroup,
} from "../../stores/useStore";
import { findOverdueInstallments } from "../../utils/lateFees";

import {
  useGroupWallet,
  useCurrentMemberPermissions,
  useMyMemberIds,
} from "../../stores/selectors";
import {
  TabRow,
  SearchBar,
  Card,
  Badge,
  Empty,
  LoanProgress,
  useToast,
  Toast,
  Button,
  BottomModal,
  Input,
} from "../../components/ui";
import {
  S,
  R,
  Colors,
  C,
  T,
  fmtCurrency,
  fmtDate,
  round2,
  showConfirm,
} from "../../utils/theme";
import { exportPdf, generatePaymentScheduleHtml } from "../../utils/export";
import type { Loan, WalletTransaction, Member } from "../../types";
import { KpiCard } from "../../components/ui/KpiCard";

import { computeTodayAccrued } from "../../utils/accrual";

import { useLoanLateFees } from "../../hooks/useLoanLateFees";
import { LateFeeWaiverModal } from "../../components/ui/LateFeeWaiverModal";

// ─── Tiny components ──────────────────────────────────────────────
const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
);

const Chip = ({
  label,
  bg,
  color,
}: {
  label: string;
  bg: string;
  color: string;
}) => (
  <View style={[styles.chip, { backgroundColor: bg }]}>
    <Text style={[styles.chipText, { color }]}>{label}</Text>
  </View>
);

const STATUS_COLOR: Record<string, string> = {
  pending_loan_officer: C.gold,
  pending_committee: C.info,
  pending_accountant: C.info,
  // `approved` means "money hasn't moved yet, waiting on the
  // accountant to click Disburse." Same action-required family as the
  // "Ready to disburse" pill and the row's amber stripe. Distinct from
  // `disbursed` (Active) which is the neutral teal that means "in
  // flight, nothing to do right now."
  approved: C.gold,
  disbursed: C.teal,
  repaid: C.success,
  rejected: C.text3,
  defaulted: C.error,
};

const STATUS_BG: Record<string, string> = {
  pending_loan_officer: C.goldBg,
  pending_committee: C.infoBg,
  pending_accountant: C.infoBg,
  // Gold background pairs with C.gold above; matches the pill bg.
  approved: C.goldBg,
  disbursed: C.tealBg,
  repaid: C.greenBg,
  rejected: C.mutedBg,
  defaulted: C.redBg,
};

const STATUS_LABEL: Record<string, string> = {
  pending_loan_officer: "Awaiting Officer",
  pending_committee: "Awaiting Committee",
  pending_accountant: "Awaiting Accountant",
  approved: "Ready to Disburse",
  disbursed: "Active",
  repaid: "Repaid",
  rejected: "Rejected",
  defaulted: "Defaulted",
};

const PENDING_STATUSES = ["pending_loan_officer", "pending_committee"];

const APPROVAL_STEPS = [
  { key: "pending_loan_officer", label: "Loan Officer", icon: "👤" },
  { key: "pending_committee", label: "Committee", icon: "📋" },
];

function getActableStep(loanStatus: string, role: string): string | null {
  if (role === "admin") {
    if (loanStatus === "pending_loan_officer") return "loan_officer";
    if (loanStatus === "pending_committee") return "committee";
  }
  if (role === "loan_officer" && loanStatus === "pending_loan_officer")
    return "loan_officer";
  if (role === "committee" && loanStatus === "pending_committee")
    return "committee";
  return null;
}

function canDisburseRole(role: string): boolean {
  return role === "accountant" || role === "admin";
}

function getApprovalStepIndex(status: string): number {
  const index = APPROVAL_STEPS.findIndex((s) => s.key === status);
  return index === -1 ? APPROVAL_STEPS.length : index;
}

// ─── UI date helpers ────────────────────────────────────────────
//
// Format-only validation. Deliberately accepts ANY calendar date, past
// or future — a planned release can legitimately be dated in the future,
// and a back-recorded release can be dated in the past. The previous
// version rejected future dates, which is exactly why "confirm
// disbursement for next months" failed.
function parseYmdToDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const dt = new Date(year, month, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
}

function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Loan Detail Modal (mobile-first redesign) ─────────────────────────
function LoanDetailModal({
  visible,
  loan,
  member,
  walletTxs,
  onClose,
  onSchedule,
  onRepayment,
  onDisburse,
  onApprove,
  onReject,
  onDelete,
  onEdit,
  onEditResubmit,
  isAdmin,
  isPending,
  actableStep,
  canDisburse,
  canManageFees,
  onWaive,
}: {
  visible: boolean;
  loan: Loan | null;
  member: any;
  walletTxs: any[];
  onClose: () => void;
  onSchedule?: () => void;
  onRepayment: () => void;
  onDisburse: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onEditResubmit?: () => void;
  isAdmin: boolean;
  isPending: boolean;
  actableStep: string | null;
  canDisburse: boolean;
  canManageFees?: boolean;
  onWaive?: (fee: any) => void;
}) {
  const [applyingFeeId, setApplyingFeeId] = useState<string | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [feesExpanded, setFeesExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const { show } = useToast();

  const handleApplyFee = async (row: any) => {
    if (!row.overdueInstallment) return;
    const feeId = row.feeTxId || `inst-${row.installmentIndex}`;
    const customStr = customAmounts[feeId]?.trim();
    const customNum = customStr ? Number(customStr) : undefined;
    setApplyingFeeId(feeId);
    try {
      await useStore
        .getState()
        .applyLoanLateFee(row.overdueInstallment, customNum);
      useStore.getState().recalcTotals();
      show("Late fee applied");
    } catch (e: any) {
      show(e?.message || "Failed to apply late fee", "error");
    } finally {
      setApplyingFeeId(null);
    }
  };

  const paymentTxs = React.useMemo(() => {
    if (!loan) return [];
    const intTxs = walletTxs
      .filter(
        (t) =>
          t.loanId === loan.id &&
          ["loan_interest_income", "loan_repayment"].includes(t.type),
      )
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    const prinTxs = walletTxs
      .filter(
        (t) =>
          t.loanId === loan.id && t.type === "loan_principal_recovery",
      )
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    return intTxs.map((itx, i) => ({
      date: itx.date,
      interest: itx.amount,
      principal: prinTxs[i]?.amount ?? 0,
    }));
  }, [loan, walletTxs]);

  const lateFees = useLoanLateFees(loan?.id);

  if (!loan) return null;

  const pct =
    loan.status === "repaid"
      ? 100
      : loan.totalRepayable > 0
        ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
        : 0;

  const isRB = loan.interestMethod === "reducing_balance";
  const todayAccrued = computeTodayAccrued(loan);

  const accruedInterestForDisplay = isRB
    ? todayAccrued?.total ?? round2(Number((loan as any).accruedInterest) || 0)
    : Math.max(
        0,
        round2(loan.totalRepayable - loan.amountRepaid - loan.balance),
      );

  const totalDueForDisplay = isRB
    ? round2(loan.balance + (todayAccrued?.total ?? 0))
    : round2(loan.totalRepayable - loan.amountRepaid);

  const statusColor =
    STATUS_COLOR[loan.status] ||
    (loan.status === "rejected" ? C.error : C.infoText);
  const statusBg = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;

  const hasFeesOwed = lateFees.count > 0;
  const shouldRenderLateFeesCard = hasFeesOwed || canManageFees;

  const initials = (member?.fullName ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const showPrimaryActions =
    loan.status === "disbursed" ||
    (loan.status === "approved" && canDisburse) ||
    (!!actableStep && isPending);

  const showAdminActions =
    !!onEdit ||
    !!onDelete ||
    (loan.status === "rejected" && !!onEditResubmit);

  return (
    <BottomModal visible={visible} onClose={onClose} title="Loan Details">
      <ScrollView
        contentContainerStyle={detailSt.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── 1. Header ──────────────────────────────────────────── */}
        <View style={detailSt.header}>
          <View style={detailSt.avatar}>
            <Text style={detailSt.avatarText}>{initials}</Text>
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={detailSt.memberName} numberOfLines={1}>
              {member?.fullName ?? "Unknown"}
            </Text>
            <Text style={detailSt.memberMeta} numberOfLines={1}>
              {loan.interestRate}%{" "}
              {isRB ? "monthly · daily accrual" : "flat"} ·{" "}
              {loan.repaymentMonths} months
            </Text>
          </View>

          <View style={[detailSt.statusChip, { backgroundColor: statusBg }]}>
            <Text
              style={[detailSt.statusChipText, { color: statusColor }]}
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* ── 2. Hero ─────────────────────────────────────────────── */}
        <View style={detailSt.loanDetailHero}>
          <Text style={detailSt.heroLabel}>TOTAL DUE</Text>
          <Text
            style={detailSt.heroValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {fmtCurrency(totalDueForDisplay)}
          </Text>

          <View style={detailSt.heroMeta}>
            <Text style={detailSt.heroMetaText} numberOfLines={1}>
              {fmtCurrency(loan.amountRepaid)} of{" "}
              {fmtCurrency(loan.totalRepayable)}
            </Text>
            <Text
              style={[
                detailSt.heroMetaPct,
                { color: pct >= 100 ? C.success : C.primary },
              ]}
            >
              {pct.toFixed(1)}%
            </Text>
          </View>

          <View style={detailSt.progressTrack}>
            <View
              style={[
                detailSt.progressFill,
                {
                  width: `${Math.min(100, pct)}%` as any,
                  backgroundColor: pct >= 100 ? C.success : C.primary,
                },
              ]}
            />
          </View>
        </View>

        {/* ── 3. Metric strip ─────────────────────────────────────── */}
        <View style={detailSt.metricRow}>
          <View style={detailSt.metricCol}>
            <Text style={detailSt.metricLbl}>Principal</Text>
            <Text
              style={[detailSt.metricVal, { color: C.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fmtCurrency(loan.balance)}
            </Text>
            <Text style={detailSt.metricSub} numberOfLines={1}>
              balance
            </Text>
          </View>

          <View style={detailSt.metricDiv} />

          <View style={detailSt.metricCol}>
            <Text style={detailSt.metricLbl}>Interest</Text>
            <Text
              style={[detailSt.metricVal, { color: C.gold }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fmtCurrency(accruedInterestForDisplay)}
            </Text>
            <Text style={detailSt.metricSub} numberOfLines={1}>
              {isRB ? "accrued" : "remaining"}
            </Text>
          </View>

          <View style={detailSt.metricDiv} />

          <View style={detailSt.metricCol}>
            <Text style={detailSt.metricLbl}>Amount</Text>
            <Text
              style={[detailSt.metricVal, { color: C.primary }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {fmtCurrency(loan.amount)}
            </Text>
            <Text style={detailSt.metricSub} numberOfLines={1}>
              original
            </Text>
          </View>
        </View>

        {/* ── 4. Accrual line ─────────────────────────────────────── */}
        {isRB && todayAccrued && loan.status === "disbursed" && (
          <View style={detailSt.accrualLine}>
            <Text style={detailSt.accrualLineText} numberOfLines={2}>
              Accruing {todayAccrued.days}d from{" "}
              {fmtDate(todayAccrued.anchor)} ·{" "}
              {round2(todayAccrued.dailyRatePct * 1000) / 1000}%/day ·{" "}
              {fmtCurrency(todayAccrued.accrued)} today
            </Text>
          </View>
        )}

        {/* ── 5. Primary actions ──────────────────────────────────── */}
        {showPrimaryActions && (
          <View style={detailSt.primaryActions}>
            {loan.status === "disbursed" && (
              <>
                <TouchableOpacity
                  style={detailSt.repayBtn}
                  onPress={onRepayment}
                  activeOpacity={0.8}
                >
                  <Text style={detailSt.repayBtnText}>
                    💵 Record Payment
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={detailSt.scheduleBtn}
                  onPress={onSchedule}
                  activeOpacity={0.8}
                >
                  <Text style={detailSt.scheduleBtnText}>📅 Schedule</Text>
                </TouchableOpacity>
              </>
            )}

            {loan.status === "approved" && canDisburse && (
              <TouchableOpacity
                style={detailSt.disburseBtn}
                onPress={onDisburse}
                activeOpacity={0.8}
              >
                <Text style={detailSt.disburseBtnText}>
                  ⚡ Disburse Loan
                </Text>
              </TouchableOpacity>
            )}

            {!!actableStep && isPending && (
              <>
                <TouchableOpacity
                  style={detailSt.rejectBtn}
                  onPress={onReject}
                  activeOpacity={0.8}
                >
                  <Text style={detailSt.rejectBtnText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={detailSt.approveBtn}
                  onPress={onApprove}
                  activeOpacity={0.8}
                >
                  <Text style={detailSt.approveBtnText}>Approve</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── 6. Late-fees alert ──────────────────────────────────── */}
        {shouldRenderLateFeesCard && (
          <View style={detailSt.alertBox}>
            <TouchableOpacity
              style={detailSt.alertHeader}
              onPress={() => setFeesExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={detailSt.alertIcon}>
                <Text style={{ fontSize: 14 }}>⚠️</Text>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={detailSt.alertTitle} numberOfLines={1}>
                  {hasFeesOwed
                    ? `${lateFees.count} unpaid late fee${
                        lateFees.count !== 1 ? "s" : ""
                      }`
                    : "Late Fees"}
                </Text>
                <Text style={detailSt.alertSub} numberOfLines={1}>
                  {hasFeesOwed
                    ? `${fmtCurrency(lateFees.total)} owed`
                    : "No fees currently owed"}
                </Text>
              </View>

              {hasFeesOwed && (
                <Text style={detailSt.alertChevron}>
                  {feesExpanded ? "▲" : "▼"}
                </Text>
              )}
            </TouchableOpacity>

            {feesExpanded && hasFeesOwed && (
              <View style={detailSt.alertBody}>
                {lateFees.rows.map((row, i) => {
                  const feeId =
                    row.feeTxId || `inst-${row.installmentIndex ?? i}`;
                  const isSaving = applyingFeeId === feeId;
                  const unappliedAmount =
                    row.unappliedFeeAmount ?? row.amount;
                  const customVal = customAmounts[feeId] ?? "";

                  return (
                    <View key={`${row.kind}-${i}`} style={detailSt.alertRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <View
                            style={[
                              detailSt.alertKindBadge,
                              row.kind === "applied"
                                ? { backgroundColor: C.infoBg }
                                : { backgroundColor: C.goldBg },
                            ]}
                          >
                            <Text
                              style={[
                                detailSt.alertKindText,
                                {
                                  color:
                                    row.kind === "applied"
                                      ? C.infoText
                                      : C.gold,
                                },
                              ]}
                            >
                              {row.kind === "applied"
                                ? "RECORDED"
                                : "ACCRUED"}
                            </Text>
                          </View>
                          <Text
                            style={detailSt.alertRowLabel}
                            numberOfLines={1}
                          >
                            {row.label}
                          </Text>
                        </View>

                        {row.sublabel ? (
                          <Text
                            style={detailSt.alertRowSub}
                            numberOfLines={2}
                          >
                            {row.sublabel}
                          </Text>
                        ) : null}
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={detailSt.alertRowAmount}>
                          {fmtCurrency(row.amount)}
                        </Text>

                        {canManageFees && (
                          <View style={detailSt.alertActions}>
                            {row.kind === "accrued" && (
                              <>
                                <TextInput
                                  style={detailSt.alertInput}
                                  placeholder={String(unappliedAmount)}
                                  placeholderTextColor={C.text3}
                                  keyboardType="numeric"
                                  value={customVal}
                                  onChangeText={(v) =>
                                    setCustomAmounts((prev) => ({
                                      ...prev,
                                      [feeId]: v,
                                    }))
                                  }
                                />
                                <TouchableOpacity
                                  style={detailSt.alertMiniBtn}
                                  onPress={() => handleApplyFee(row)}
                                  disabled={isSaving}
                                  activeOpacity={0.8}
                                >
                                  <Text style={detailSt.alertMiniBtnText}>
                                    {isSaving ? "…" : "Apply"}
                                  </Text>
                                </TouchableOpacity>
                              </>
                            )}
                            {onWaive && (
                              <TouchableOpacity
                                style={[
                                  detailSt.alertMiniBtn,
                                  detailSt.alertMiniBtnDanger,
                                ]}
                                onPress={() =>
                                  onWaive({
                                    memberId: loan.memberId,
                                    periodStart:
                                      row.overdueInstallment?.dueDate ??
                                      walletTxs.find(
                                        (t) => t.id === row.feeTxId,
                                      )?.date ??
                                      new Date().toISOString(),
                                    periodLabel: `Installment #${
                                      (row.installmentIndex ?? 0) + 1
                                    }`,
                                    applied: row.kind === "applied",
                                    feeTxId: row.feeTxId,
                                  })
                                }
                                disabled={isSaving}
                                activeOpacity={0.8}
                              >
                                <Text
                                  style={[
                                    detailSt.alertMiniBtnText,
                                    { color: C.error },
                                  ]}
                                >
                                  Waive
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── 7. Approval pipeline ────────────────────────────────── */}
        {loan.status !== "rejected" && (
          <View style={detailSt.pipelineCard}>
            <Text style={detailSt.pipelineTitle}>Approval Progress</Text>

            <View style={styles.stepsRow}>
              {APPROVAL_STEPS.map((step, index) => {
                const currentStepIndex = getApprovalStepIndex(loan.status);
                const isCompleted =
                  index < currentStepIndex ||
                  loan.status === "disbursed" ||
                  loan.status === "repaid";
                const isCurrent =
                  index === currentStepIndex &&
                  loan.status !== "disbursed" &&
                  loan.status !== "repaid";
                const isPendingStep = !isCompleted && !isCurrent;

                return (
                  <View key={step.key} style={styles.stepItem}>
                    <View
                      style={[
                        styles.stepCircle,
                        isCompleted && styles.stepCompleted,
                        isCurrent && styles.stepCurrent,
                        isPendingStep && styles.stepPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepIcon,
                          isCompleted && styles.stepIconCompleted,
                          isCurrent && styles.stepIconCurrent,
                        ]}
                      >
                        {isCompleted ? "✓" : step.icon}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.stepLabel,
                        isCompleted && styles.stepLabelCompleted,
                        isCurrent && styles.stepLabelCurrent,
                      ]}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                    {index < APPROVAL_STEPS.length - 1 && (
                      <View
                        style={[
                          styles.stepLine,
                          isCompleted && styles.stepLineCompleted,
                        ]}
                      />
                    )}
                  </View>
                );
              })}
            </View>

            <Text style={styles.stepStatus}>
              {loan.status === "pending_loan_officer" &&
                "⏳ Awaiting Loan Officer review"}
              {loan.status === "pending_committee" &&
                "⏳ Awaiting Committee review"}
              {loan.status === "approved" &&
                "✅ Approved — awaiting disbursement"}
              {loan.status === "disbursed" && "💰 Loan disbursed"}
              {loan.status === "repaid" && "✅ Fully repaid"}
              {loan.status === "defaulted" && "⚠️ Defaulted"}
            </Text>

            {(["loanOfficer", "committee"] as const).map((stepKey) => {
              const approval = (loan.approvals as any)?.[stepKey];
              if (!approval?.comment) return null;
              const label =
                stepKey === "loanOfficer" ? "Loan Officer" : "Committee";
              return (
                <View key={stepKey} style={detailSt.commentBox}>
                  <Text style={detailSt.commentLabel}>
                    {label} comment{" "}
                    {approval.date ? `· ${fmtDate(approval.date)}` : ""}
                  </Text>
                  <Text style={detailSt.commentText}>
                    {approval.comment}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 8. Details (collapsible) ────────────────────────────── */}
        <TouchableOpacity
          style={detailSt.collapsibleHeader}
          onPress={() => setDetailsExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={detailSt.collapsibleTitle}>Loan Details</Text>
          <Text style={detailSt.collapsibleChevron}>
            {detailsExpanded ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>

        {detailsExpanded && (
          <View style={detailSt.detailsBody}>
            <View style={detailSt.detailRow}>
              <Text style={detailSt.detailLbl}>Total repayable</Text>
              <Text style={detailSt.detailVal}>
                {fmtCurrency(loan.totalRepayable)}
              </Text>
            </View>
            <View style={detailSt.detailRow}>
              <Text style={detailSt.detailLbl}>Est. total interest</Text>
              <Text style={detailSt.detailVal}>
                {fmtCurrency(loan.totalInterest)}
              </Text>
            </View>
            <View style={detailSt.detailRow}>
              <Text style={detailSt.detailLbl}>Amount repaid</Text>
              <Text
                style={[detailSt.detailVal, { color: C.success }]}
              >
                {fmtCurrency(loan.amountRepaid)}
              </Text>
            </View>
            <View style={detailSt.detailRow}>
              <Text style={detailSt.detailLbl}>Applied</Text>
              <Text style={detailSt.detailVal}>
                {fmtDate(loan.applicationDate)}
              </Text>
            </View>
            {(loan as any).disbursementDate ? (
              <View style={detailSt.detailRow}>
                <Text style={detailSt.detailLbl}>Disbursed</Text>
                <Text style={detailSt.detailVal}>
                  {fmtDate((loan as any).disbursementDate)}
                </Text>
              </View>
            ) : null}
            {loan.purpose ? (
              <View style={detailSt.detailRow}>
                <Text style={detailSt.detailLbl}>Purpose</Text>
                <Text
                  style={[
                    detailSt.detailVal,
                    { flex: 1, textAlign: "right" },
                  ]}
                  numberOfLines={2}
                >
                  {loan.purpose}
                </Text>
              </View>
            ) : null}
            {!!(loan as any).lateFeeRatePct && (
              <View style={detailSt.detailRow}>
                <Text style={detailSt.detailLbl}>Late fee rate</Text>
                <Text style={detailSt.detailVal}>
                  {(loan as any).lateFeeRatePct}%
                  {(loan as any).lateFeeGraceDays
                    ? ` · ${(loan as any).lateFeeGraceDays}d grace`
                    : ""}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 9. Payment history (collapsible) ────────────────────── */}
        {paymentTxs && paymentTxs.length > 0 && (
          <>
            <TouchableOpacity
              style={detailSt.collapsibleHeader}
              onPress={() => setHistoryExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={detailSt.collapsibleTitle}>
                Payment History ({paymentTxs.length})
              </Text>
              <Text style={detailSt.collapsibleChevron}>
                {historyExpanded ? "▲" : "▼"}
              </Text>
            </TouchableOpacity>

            {historyExpanded && (
              <View style={detailSt.histBody}>
                <View style={detailSt.histHeadRow}>
                  <Text style={[detailSt.histHead, { flex: 1.4 }]}>
                    DATE
                  </Text>
                  <Text
                    style={[
                      detailSt.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    INTEREST
                  </Text>
                  <Text
                    style={[
                      detailSt.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    PRINCIPAL
                  </Text>
                  <Text
                    style={[
                      detailSt.histHead,
                      { flex: 1, textAlign: "right" },
                    ]}
                  >
                    TOTAL
                  </Text>
                </View>

                {paymentTxs.map((row: any, i: number) => (
                  <View
                    key={i}
                    style={[
                      detailSt.histRow,
                      i % 2 === 1 && {
                        backgroundColor: C.elevated,
                      },
                    ]}
                  >
                    <Text
                      style={[detailSt.histCell, { flex: 1.4 }]}
                      numberOfLines={1}
                    >
                      {new Date(row.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                        year: "2-digit",
                      })}
                    </Text>
                    <Text
                      style={[
                        detailSt.histCell,
                        { flex: 1, textAlign: "right", color: C.gold },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {fmtCurrency(row.interest)}
                    </Text>
                    <Text
                      style={[
                        detailSt.histCell,
                        {
                          flex: 1,
                          textAlign: "right",
                          color: C.success,
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {fmtCurrency(row.principal)}
                    </Text>
                    <Text
                      style={[
                        detailSt.histCell,
                        {
                          flex: 1,
                          textAlign: "right",
                          fontWeight: "700",
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {fmtCurrency(row.interest + row.principal)}
                    </Text>
                  </View>
                ))}

                <View style={[detailSt.histRow, detailSt.histTotalRow]}>
                  <Text
                    style={[
                      detailSt.histCell,
                      { flex: 1.4, fontWeight: "700", color: C.text },
                    ]}
                  >
                    Total
                  </Text>
                  <Text
                    style={[
                      detailSt.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: C.gold,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      paymentTxs.reduce(
                        (s: number, r: any) => s + r.interest,
                        0,
                      ),
                    )}
                  </Text>
                  <Text
                    style={[
                      detailSt.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: C.success,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      paymentTxs.reduce(
                        (s: number, r: any) => s + r.principal,
                        0,
                      ),
                    )}
                  </Text>
                  <Text
                    style={[
                      detailSt.histCell,
                      {
                        flex: 1,
                        textAlign: "right",
                        fontWeight: "700",
                        color: C.text,
                      },
                    ]}
                  >
                    {fmtCurrency(
                      paymentTxs.reduce(
                        (s: number, r: any) =>
                          s + r.interest + r.principal,
                        0,
                      ),
                    )}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {/* ── 10. Admin actions ───────────────────────────────────── */}
        {showAdminActions && (
          <View style={detailSt.adminZone}>
            <Text style={detailSt.adminZoneLabel}>ADMIN ACTIONS</Text>

            {loan.status === "rejected" && onEditResubmit && (
              <TouchableOpacity
                style={detailSt.adminBtnAmber}
                onPress={onEditResubmit}
                activeOpacity={0.8}
              >
                <Text style={detailSt.adminBtnAmberText}>
                  ✏️ Edit & Resubmit
                </Text>
              </TouchableOpacity>
            )}

            {onEdit && (
              <TouchableOpacity
                style={detailSt.adminBtnNeutral}
                onPress={onEdit}
                activeOpacity={0.8}
              >
                <Text style={detailSt.adminBtnNeutralText}>Edit Loan</Text>
              </TouchableOpacity>
            )}

            {onDelete && (
              <TouchableOpacity
                style={detailSt.adminBtnDanger}
                onPress={onDelete}
                activeOpacity={0.8}
              >
                <Text style={detailSt.adminBtnDangerText}>Delete Loan</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 11. Close ───────────────────────────────────────────── */}
        <TouchableOpacity
          style={detailSt.closeBtn}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <Text style={detailSt.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomModal>
  );
}

// ─── Loan Detail Modal styles ─────────────────────────────────────────────────
const detailSt = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: C.primary,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "800",
    color: C.text,
  },
  memberMeta: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    flexShrink: 0,
    maxWidth: 130,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // ── Hero ──
  loanDetailHero: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: 18,
    marginBottom: 12,
  },
  heroLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  heroValue: {
    fontSize: 28,
    fontWeight: "800",
    color: C.error,
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  heroMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  heroMetaText: {
    fontSize: 11,
    color: C.text3,
    flex: 1,
    minWidth: 0,
  },
  heroMetaPct: {
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 8,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%" as any,
    borderRadius: 3,
  },

  // ── Metric strip ──
  metricRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    paddingVertical: 14,
    marginBottom: 12,
  },
  metricCol: { flex: 1, alignItems: "center", minWidth: 0, paddingHorizontal: 4 },
  metricDiv: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: C.borderLight,
  },
  metricLbl: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricVal: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "600",
    textAlign: "center",
  },

  // ── Accrual line ──
  accrualLine: {
    backgroundColor: C.goldBg,
    borderRadius: R.md,
    padding: 10,
    marginBottom: 12,
  },
  accrualLineText: {
    fontSize: 11,
    color: C.gold,
    lineHeight: 15,
    textAlign: "center",
    fontWeight: "600",
  },

  // ── Primary actions ──
  primaryActions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  repayBtn: {
    flex: 1,
    minWidth: 140,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  repayBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  scheduleBtn: {
    flex: 1,
    minWidth: 120,
    backgroundColor: C.tealBg,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.3)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  scheduleBtnText: { color: C.teal, fontSize: 13, fontWeight: "700" },
  disburseBtn: {
    flex: 1,
    backgroundColor: C.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  disburseBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  approveBtn: {
    flex: 1,
    backgroundColor: C.success,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  approveBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  rejectBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  rejectBtnText: { color: C.error, fontSize: 14, fontWeight: "800" },

  // ── Late fee alert ──
  alertBox: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: R.lg,
    marginBottom: 16,
    overflow: "hidden",
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
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
    color: C.error,
  },
  alertSub: {
    fontSize: 11,
    color: C.text2,
    marginTop: 1,
  },
  alertChevron: {
    fontSize: 10,
    color: C.text3,
    marginLeft: 6,
  },
  alertBody: {
    borderTopWidth: 1,
    borderTopColor: "rgba(239,68,68,0.15)",
    paddingHorizontal: 12,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239,68,68,0.1)",
  },
  alertKindBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    flexShrink: 0,
  },
  alertKindText: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  alertRowLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
    flexShrink: 1,
  },
  alertRowSub: {
    fontSize: 10,
    color: C.text3,
    marginTop: 2,
    lineHeight: 13,
  },
  alertRowAmount: {
    fontSize: 13,
    fontWeight: "800",
    color: C.error,
    flexShrink: 0,
  },
  alertActions: {
    flexDirection: "row",
    gap: 5,
    marginTop: 6,
    alignItems: "center",
  },
  alertInput: {
    height: 26,
    width: 68,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 5,
    paddingHorizontal: 6,
    fontSize: 11,
    color: C.text,
    textAlign: "right",
  },
  alertMiniBtn: {
    backgroundColor: C.primary,
    borderRadius: 5,
    paddingHorizontal: 10,
    height: 26,
    justifyContent: "center",
    alignItems: "center",
  },
  alertMiniBtnDanger: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.error,
  },
  alertMiniBtnText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },

  // ── Pipeline ──
  pipelineCard: {
    backgroundColor: C.elevated,
    borderRadius: R.lg,
    padding: 14,
    marginBottom: 12,
  },
  pipelineTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text2,
    marginBottom: 12,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // ── Approval comments ──
  commentBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: C.infoBg,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.2)",
  },
  commentLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.infoText,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  commentText: { fontSize: 12, color: C.text, lineHeight: 17 },

  // ── Collapsibles ──
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  collapsibleTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  collapsibleChevron: {
    fontSize: 10,
    color: C.text3,
  },

  // ── Details body ──
  detailsBody: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
    gap: 10,
  },
  detailLbl: {
    fontSize: 12,
    color: C.text3,
    fontWeight: "600",
    flexShrink: 0,
  },
  detailVal: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
    flexShrink: 0,
  },

  // ── History body ──
  histBody: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    overflow: "hidden",
    marginBottom: 8,
  },
  histHeadRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.elevated,
  },
  histHead: {
    fontSize: 9,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  histRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  histCell: { fontSize: 11, color: C.text2, minWidth: 0 },
  histTotalRow: {
    backgroundColor: C.elevated,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },

  // ── Admin zone ──
  adminZone: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
    gap: 8,
  },
  adminZoneLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  adminBtnAmber: {
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  adminBtnAmberText: {
    color: C.gold,
    fontSize: 13,
    fontWeight: "700",
  },
  adminBtnNeutral: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  adminBtnNeutralText: {
    color: C.text2,
    fontSize: 13,
    fontWeight: "700",
  },
  adminBtnDanger: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  adminBtnDangerText: {
    color: C.error,
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Close ──
  closeBtn: {
    backgroundColor: C.mutedBg,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  closeBtnText: {
    color: C.text2,
    fontSize: 14,
    fontWeight: "700",
  },
});

export default function LoansScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { approveLoanStep, disburseLoan, rejectLoan, deleteLoan } = useStore();
  const allLoans = useGroupLoans();
  const walletTxs = useGroupWallet();
  const groupMembers = useGroupMembers();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const permissions = useCurrentMemberPermissions();
  const { show, visible, msg, type } = useToast();

  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showLoanDetail, setShowLoanDetail] = useState(false);
  const [showDisburseModal, setShowDisburseModal] = useState(false);
  const [disburseLoanTarget, setDisburseLoanTarget] = useState<Loan | null>(
    null,
  );
  const [disburseApplicationDate, setDisburseApplicationDate] =
    useState<Date>(new Date());
  const [disburseDateText, setDisburseDateText] = useState("");
  const [isDisbursing, setIsDisbursing] = useState(false);

  const [pendingAction, setPendingAction] = useState<{
    loanId: string;
    step: string;
    approve: boolean;
  } | null>(null);

  // Late-fee waiver modal (per-member, per-period)
  const [waiverTarget, setWaiverTarget] = useState<any | null>(null);
  const [waiverSaving, setWaiverSaving] = useState(false);

  const isGroupView = useIsGroupView();
  const isAdmin = role === "admin";

  const getMember = (id: string) =>
    groupMembers.find((m: Member) => m.id === id);

  const myIds = useMyMemberIds();

  const visibleLoans = useMemo(() => {
    if (isGroupView) return allLoans;
    return allLoans.filter(
      (l: Loan) =>
        myIds.has(l.memberId) ||
        myIds.has((l as any).userId),
    );
  }, [allLoans, isGroupView, myIds]);

  const LOAN_TABS = isGroupView
    ? ["All", "Pending", "Active", "Repaid", "Rejected"]
    : ["All", "Pending", "Active", "Repaid"];

  const SORT_OPTIONS = [
    { value: "date_desc", label: "Newest" },
    { value: "date_asc", label: "Oldest" },
    { value: "amount_desc", label: "Largest" },
  ];
  const PAGE_SIZE = 20;

  const byTab = useMemo(() => {
    const list = visibleLoans;
    if (tab === "Pending")
      return list.filter((l: Loan) => PENDING_STATUSES.includes(l.status));
    if (tab === "Active")
      return list.filter((l: Loan) => l.status === "disbursed");
    if (tab === "Repaid")
      return list.filter((l: Loan) => l.status === "repaid");
    if (tab === "Rejected")
      return list.filter((l: Loan) =>
        ["rejected", "defaulted"].includes(l.status),
      );
    return list;
  }, [visibleLoans, tab]);

  const filteredLoans = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = byTab;
    if (q) {
      list = list.filter((l: Loan) => {
        const memberName =
          getMember(l.memberId)?.fullName?.toLowerCase() ?? "";
        return (
          memberName.includes(q) || (l.purpose ?? "").toLowerCase().includes(q)
        );
      });
    }
    const sorted = [...list];
    if (sort === "date_desc")
      sorted.sort(
        (a, b) =>
          new Date(b.applicationDate).getTime() -
          new Date(a.applicationDate).getTime(),
      );
    else if (sort === "date_asc")
      sorted.sort(
        (a, b) =>
          new Date(a.applicationDate).getTime() -
          new Date(b.applicationDate).getTime(),
      );
    else if (sort === "amount_desc")
      sorted.sort((a, b) => b.amount - a.amount);
    return sorted;
  }, [byTab, search, sort, groupMembers]);

  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));
  const paginatedLoans = useMemo(
    () => filteredLoans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredLoans, page],
  );

  const handleTabChange = (t: string) => {
    setTab(t);
    setPage(1);
  };
  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handleSort = (v: string) => {
    setSort(v);
    setPage(1);
  };

  const outstanding = useMemo(
    () =>
      visibleLoans
        .filter((l: Loan) => l.status === "disbursed")
        .reduce((s: number, l: Loan) => s + l.balance, 0),
    [visibleLoans],
  );
  const totalRepaid = useMemo(
    () => visibleLoans.reduce((s: number, l: Loan) => s + l.amountRepaid, 0),
    [visibleLoans],
  );
  const totalDisbursed = useMemo(
    () =>
      visibleLoans
        .filter((l: Loan) => ["disbursed", "repaid"].includes(l.status))
        .reduce((s: number, l: Loan) => s + l.amount, 0),
    [visibleLoans],
  );
  const pendingCount = useMemo(
    () =>
      visibleLoans.filter((l: Loan) => PENDING_STATUSES.includes(l.status))
        .length,
    [visibleLoans],
  );

  const activeGroup = useActiveGroup();
  const totalLateFeesOwed = useMemo(() => {
    if (!activeGroup) return 0;
    const overdue = findOverdueInstallments(
      activeGroup,
      groupMembers,
      visibleLoans,
      walletTxs,
    );
    const accruedTotal = overdue.reduce((sum, o) => sum + (o.feeAmount || 0), 0);
    const visibleLoanIds = new Set(visibleLoans.map((l) => l.id));
    const appliedTotal = walletTxs
      .filter(
        (t) =>
          t.type === "late_fee" &&
          t.loanId &&
          visibleLoanIds.has(t.loanId) &&
          !(t as any).feePaid &&
          !(t as any).deletedAt,
      )
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    return round2(accruedTotal + appliedTotal);
  }, [activeGroup, groupMembers, visibleLoans, walletTxs]);


  // ── Late-fee waiver ────────────────────────────────────────────
  const openWaiverModal = (feeItem: any) => setWaiverTarget(feeItem);
  const closeWaiverModal = () => setWaiverTarget(null);

  const handleConfirmWaiver = async (
    periodStart: string,
    periodEnd: string,
    reason: string,
  ) => {
    if (!waiverTarget) return;
    setWaiverSaving(true);
    try {
      await useStore.getState().addLateFeeExemption(
        waiverTarget.memberId,
        { scope: "loan", periodStart, periodEnd, reason: reason || undefined },
        waiverTarget.applied ? waiverTarget.feeTxId : undefined,
      );
      show("Late fee waiver saved");
      closeWaiverModal();
    } catch (e: any) {
      show(e?.message || "Failed to save waiver", "error");
    } finally {
      setWaiverSaving(false);
    }
  };

  const handleRemoveExemption = async (exemptionId: string) => {
    if (!waiverTarget) return;
    try {
      await useStore
        .getState()
        .removeLateFeeExemption(waiverTarget.memberId, exemptionId);
      show("Waiver removed");
    } catch (e: any) {
      show(e?.message || "Failed to remove waiver", "error");
    }
  };

  const handleApproval = async () => {
    if (!pendingAction) return;
    try {
      await approveLoanStep(
        pendingAction.loanId,
        pendingAction.step as any,
        pendingAction.approve,
        approvalComment || undefined,
      );
      show(
        pendingAction.approve ? "Step approved" : "Loan rejected",
        pendingAction.approve ? "success" : "error",
      );
      setShowLoanDetail(false);
    } catch (e: any) {
      show(e.message || "Action failed", "error");
    } finally {
      setShowApprovalModal(false);
      setApprovalComment("");
      setPendingAction(null);
      setSelectedLoan(null);
    }
  };

  const handleDisburse = (loan: Loan) => {
    const today = new Date();
    setDisburseLoanTarget(loan);
    setDisburseApplicationDate(today);
    setDisburseDateText("");
    setShowDisburseModal(true);
  };

  // Confirm Disbursement — validation is format-only. Past, present, and
  // future dates are all accepted. Rejecting future dates here was the
  // exact cause of "confirm disbursement for next months" failing.
  const confirmDisbursement = async () => {
    if (!disburseLoanTarget) return;

    if (!disburseDateText.trim()) {
      show("First payment date is required", "error");
      return;
    }

    if (!parseYmdToDate(disburseDateText)) {
      show("Please enter a valid date in YYYY-MM-DD format", "error");
      return;
    }

    if (!Number.isFinite(disburseApplicationDate.getTime())) {
      show("Please select a valid first payment date", "error");
      return;
    }

    const disbursementDate = dateToYmd(disburseApplicationDate);

    try {
      setIsDisbursing(true);
      await disburseLoan(disburseLoanTarget.id, disbursementDate);
      show("Loan disbursed successfully", "success");
      setShowDisburseModal(false);
      setDisburseLoanTarget(null);
      setDisburseDateText("");
      setShowLoanDetail(false);
    } catch (e: any) {
      show(e?.message || "Failed to disburse loan", "error");
    } finally {
      setIsDisbursing(false);
    }
  };

  const handleDeleteLoan = (loan: Loan) => {
    const hasRepayments = loan.amountRepaid > 0;
    let message = `Delete this ${
      STATUS_LABEL[loan.status] ?? loan.status
    } loan? This action cannot be undone.`;
    if (hasRepayments) {
      message = `⚠️ WARNING: This loan has ${fmtCurrency(
        loan.amountRepaid,
      )} in repayments.\n\nDeleting this loan will also delete all associated repayment transactions.\n\n${message}`;
    }
    showConfirm(
      "Delete Loan",
      message,
      async () => {
        try {
          await deleteLoan(loan.id, "Deleted by admin");
          show("Loan and all related transactions deleted successfully");
          setSelectedLoan(null);
          setShowLoanDetail(false);
        } catch (e: any) {
          show(e.message || "Failed to delete loan", "error");
        }
      },
      undefined,
      true,
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View
        style={[
          styles.topBar,
          isWide && {
            maxWidth: 960,
            alignSelf: "center" as any,
            width: "100%" as any,
          },
        ]}
      >
        <View>
          <Text style={styles.pageSummaryLabel}>
            {isGroupView ? "Group" : "Personal"}
          </Text>
          <Text style={styles.pageSummaryTitle}>
            {isGroupView ? " " : " "}
          </Text>
        </View>
        {permissions.addLoan && (
          <TouchableOpacity
            style={styles.addInlineBtn}
            onPress={() => router.push("/modals/add-loan")}
            activeOpacity={0.8}
          >
            <Text style={styles.addInlineBtnText}>+ New Loan</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          { paddingBottom: 100 },
          isWide && {
            maxWidth: 960,
            alignSelf: "center" as any,
            width: "100%" as any,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.block,
            isWide && {
              maxWidth: 960,
              alignSelf: "center" as any,
              width: "100%" as any,
            },
          ]}
        >
          <View style={styles.kpiGrid}>
            <KpiCard
              label="Total Disbursed"
              value={fmtCurrency(totalDisbursed)}
              icon="💰"
              subtext={`${
                visibleLoans.filter((l) =>
                  ["disbursed", "repaid"].includes(l.status),
                ).length
              } loans`}
              accentColor={C.primary}
              onPress={() => router.push("/(tabs)/loans")}
            />
            <KpiCard
              label="Outstanding"
              value={fmtCurrency(outstanding)}
              icon="💳"
              subtext={`${
                visibleLoans.filter((l) => l.status === "disbursed").length
              } active loans`}
              accentColor={C.error}
              onPress={() => {
                setTab("Active");
                setPage(1);
              }}
            />
            <KpiCard
              label="Repaid"
              value={fmtCurrency(totalRepaid)}
              icon="✅"
              subtext={`${
                visibleLoans.filter((l) => l.status === "repaid").length
              } completed`}
              accentColor={C.success}
              onPress={() => {
                setTab("Repaid");
                setPage(1);
              }}
            />
            <KpiCard
              label="Pending"
              value={String(pendingCount)}
              icon="⏳"
              subtext="Awaiting approval"
              accentColor={C.gold}
              onPress={() => {
                setTab("Pending");
                setPage(1);
              }}
            />
            <KpiCard
              label="Late Fees"
              value={fmtCurrency(totalLateFeesOwed)}
              icon="⚠️"
              subtext="Unpaid late fees"
              accentColor={C.error}
              onPress={() => {}}
            />
          </View>
        </View>


        <View style={styles.controlsBlock}>
          <View style={styles.controlsTop}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={search}
                onChange={handleSearch}
                placeholder="Search loans by member or purpose…"
              />
            </View>
            <View style={styles.sortRow}>
              {SORT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.sortChip,
                    sort === opt.value && styles.sortChipActive,
                  ]}
                  onPress={() => handleSort(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      sort === opt.value && styles.sortChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TabRow tabs={LOAN_TABS} active={tab} onChange={handleTabChange} />
        </View>

        <View style={styles.listContainer}>
          {paginatedLoans.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={T.body}>
                No {tab.toLowerCase()} loans
                {search ? " match your search" : ""}
              </Text>
              {tab === "All" && !search && permissions.addLoan && (
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => router.push("/modals/add-loan")}
                >
                  <Text style={styles.emptyBtnText}>
                    Apply for Loan →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.rowList}>
              {paginatedLoans.map((loan, i) => {
                const isOwn =
                  myIds.has(loan.memberId) ||
                  myIds.has((loan as any).userId);
                const canActOnThis = !!getActableStep(loan.status, role);

                return (
                  <React.Fragment key={loan.id}>
                    <LoanRow
                      loan={loan}
                      member={getMember(loan.memberId)}
                      isOwn={isOwn}
                      canActOnThis={canActOnThis}
                      onPress={() => {
                        setSelectedLoan(loan);
                        setShowLoanDetail(true);
                      }}
                    />
                    {i < paginatedLoans.length - 1 && <Divider />}
                  </React.Fragment>
                );
              })}

            </View>
          )}

          {totalPages > 1 && (
            <View style={styles.pagination}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                style={[
                  styles.pageBtn,
                  page <= 1 && styles.pageBtnDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.pageBtnText,
                    page <= 1 && styles.pageBtnTextDisabled,
                  ]}
                >
                  Prev
                </Text>
              </TouchableOpacity>
              <Text style={styles.pageLabel}>
                Page {page} of {totalPages}
              </Text>
              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() =>
                  setPage((p) => Math.min(totalPages, p + 1))
                }
                style={[
                  styles.pageBtn,
                  page >= totalPages && styles.pageBtnDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.pageBtnText,
                    page >= totalPages && styles.pageBtnTextDisabled,
                  ]}
                >
                  Next
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Approval Modal */}
      <BottomModal
        visible={showApprovalModal}
        onClose={() => {
          setShowApprovalModal(false);
          setPendingAction(null);
          setSelectedLoan(null);
        }}
        title="Loan Approval"
      >
        <View style={{ padding: 16 }}>
          {selectedLoan && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>
                  {getMember(selectedLoan.memberId)?.fullName ??
                    "Unknown"}
                </Text>
                <Text style={styles.modalAmount}>
                  {fmtCurrency(selectedLoan.amount)}
                </Text>
                <Text style={styles.modalDetail}>
                  Total Repayable:{" "}
                  {fmtCurrency(selectedLoan.totalRepayable)} (inc.
                  interest)
                </Text>
                {selectedLoan.purpose && (
                  <Text style={styles.modalPurpose}>
                    {selectedLoan.purpose}
                  </Text>
                )}
              </View>

              <View style={styles.stepsContainer}>
                <Text style={styles.stepsTitle}>Approval Progress</Text>
                <View style={styles.stepsRow}>
                  {APPROVAL_STEPS.map((step, index) => {
                    const currentStepIndex = getApprovalStepIndex(
                      selectedLoan.status,
                    );
                    const isCompleted = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isPending = index > currentStepIndex;

                    return (
                      <View key={step.key} style={styles.stepItem}>
                        <View
                          style={[
                            styles.stepCircle,
                            isCompleted && styles.stepCompleted,
                            isCurrent && styles.stepCurrent,
                            isPending && styles.stepPending,
                          ]}
                        >
                          <Text
                            style={[
                              styles.stepIcon,
                              isCompleted && styles.stepIconCompleted,
                              isCurrent && styles.stepIconCurrent,
                            ]}
                          >
                            {isCompleted ? "✓" : step.icon}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.stepLabel,
                            isCompleted && styles.stepLabelCompleted,
                            isCurrent && styles.stepLabelCurrent,
                          ]}
                        >
                          {step.label}
                        </Text>
                        {index < APPROVAL_STEPS.length - 1 && (
                          <View
                            style={[
                              styles.stepLine,
                              isCompleted && styles.stepLineCompleted,
                            ]}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.stepStatus}>
                  {selectedLoan.status === "pending_loan_officer" &&
                    "⏳ Awaiting Loan Officer review"}
                  {selectedLoan.status === "pending_committee" &&
                    "⏳ Awaiting Committee review"}
                  {selectedLoan.status === "approved" &&
                    "✅ Approved — awaiting disbursement"}
                  {selectedLoan.status === "disbursed" &&
                    "💰 Loan Disbursed"}
                  {selectedLoan.status === "rejected" &&
                    "❌ Loan Rejected"}
                </Text>
              </View>
            </>
          )}
          <Input
            label="Comment (optional)"
            value={approvalComment}
            onChangeText={setApprovalComment}
            placeholder={
              pendingAction?.approve
                ? "Add approval conditions…"
                : "Reason for rejection…"
            }
            multiline
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Button
              label="Cancel"
              onPress={() => {
                setShowApprovalModal(false);
                setPendingAction(null);
                setSelectedLoan(null);
              }}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              label={
                pendingAction?.approve
                  ? "Confirm Approval"
                  : "Confirm Rejection"
              }
              onPress={handleApproval}
              variant={pendingAction?.approve ? "success" : "danger"}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </BottomModal>

      {/* Schedule Modal */}
      <BottomModal
        visible={showScheduleModal && !!selectedLoan}
        onClose={() => {
          setShowScheduleModal(false);
          setSelectedLoan(null);
        }}
        title="Payment Schedule"
      >
        <View style={{ padding: 16 }}>
          {selectedLoan && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>
                  {getMember(selectedLoan.memberId)?.fullName ??
                    "Unknown"}
                </Text>
                <Text style={styles.modalAmount}>
                  {fmtCurrency(selectedLoan.amount)}
                </Text>
                <Text style={styles.modalDetail}>
                  {selectedLoan.interestRate}% interest ·{" "}
                  {fmtCurrency(selectedLoan.totalInterest)} total
                  interest
                </Text>
                <Text style={styles.modalDetail}>
                  Monthly: {fmtCurrency(selectedLoan.monthlyPayment)} ×{" "}
                  {selectedLoan.repaymentMonths} months
                </Text>
              </View>

              <ScrollView
                style={{ flexGrow: 0, flexShrink: 1, marginBottom: 16 }}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {selectedLoan.schedule &&
                selectedLoan.schedule.length > 0 ? (
                  selectedLoan.schedule.map((item) => (
                    <View key={item.index} style={styles.scheduleItem}>
                      <View style={styles.scheduleHeader}>
                        <Text style={styles.scheduleMonth}>
                          Month {item.index + 1}
                        </Text>
                        <Text
                          style={styles.scheduleDate}
                          numberOfLines={1}
                        >
                          {fmtDate(item.dueDate)}
                        </Text>
                      </View>
                      <View style={styles.scheduleRow}>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>
                            Principal
                          </Text>
                          <Text
                            style={styles.scheduleCellValue}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {fmtCurrency(item.principal)}
                          </Text>
                        </View>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>
                            Interest
                          </Text>
                          <Text
                            style={styles.scheduleCellValue}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {fmtCurrency(item.interest)}
                          </Text>
                        </View>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>
                            Total
                          </Text>
                          <Text
                            style={[
                              styles.scheduleCellValue,
                              { color: C.primary, fontWeight: "800" },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {fmtCurrency(item.total)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.scheduleEmpty}>
                    No schedule available yet
                  </Text>
                )}
              </ScrollView>

              <Button
                label="Export as PDF"
                onPress={async () => {
                  const member = getMember(selectedLoan.memberId);
                  if (member && selectedLoan.schedule) {
                    const html = generatePaymentScheduleHtml(
                      member.fullName,
                      selectedLoan.amount,
                      selectedLoan.interestRate,
                      selectedLoan.monthlyPayment,
                      selectedLoan.totalRepayable,
                      selectedLoan.schedule,
                    );
                    await exportPdf(
                      `Payment-Schedule-${member.fullName}`,
                      `Payment Schedule - ${member.fullName}`,
                      html,
                    );
                    show("Schedule exported");
                  }
                }}
                fullWidth
              />
            </>
          )}
        </View>
      </BottomModal>

      {/* Disburse Modal */}
      <BottomModal
        visible={showDisburseModal}
        onClose={() => {
          if (isDisbursing) return;
          setShowDisburseModal(false);
          setDisburseLoanTarget(null);
          setDisburseDateText("");
        }}
        title="Confirm Disbursement"
      >
        <View style={{ padding: 16 }}>
          {disburseLoanTarget && (
            <View style={styles.modalInfo}>
              <Text style={styles.modalMember}>
                {getMember(disburseLoanTarget.memberId)?.fullName ??
                  "Unknown"}
              </Text>
              <Text style={styles.modalAmount}>
                {fmtCurrency(disburseLoanTarget.amount)}
              </Text>
              <Text style={styles.modalDetail}>
                {disburseLoanTarget.interestRate}% ·{" "}
                {disburseLoanTarget.repaymentMonths} months · Total
                repayable{" "}
                {fmtCurrency(disburseLoanTarget.totalRepayable)}
              </Text>
              {disburseLoanTarget.applicationDate ? (
                <Text style={[styles.modalDetail, { marginTop: 6 }]}>
                  Applied for:{" "}
                  {fmtDate(disburseLoanTarget.applicationDate)}
                </Text>
              ) : null}
              {disburseLoanTarget.purpose ? (
                <Text style={styles.modalPurpose}>
                  {disburseLoanTarget.purpose}
                </Text>
              ) : null}
            </View>
          )}

          <View style={styles.stepsContainer}>
            <Text style={styles.stepsTitle}>Loan Status</Text>
            <View style={styles.stepsRow}>
              {APPROVAL_STEPS.map((step, index) => (
                <View key={step.key} style={styles.stepItem}>
                  <View
                    style={[styles.stepCircle, styles.stepCompleted]}
                  >
                    <Text
                      style={[styles.stepIcon, styles.stepIconCompleted]}
                    >
                      ✓
                    </Text>
                  </View>
                  <Text
                    style={[styles.stepLabel, styles.stepLabelCompleted]}
                  >
                    {step.label}
                  </Text>
                  {index < APPROVAL_STEPS.length - 1 && (
                    <View
                      style={[styles.stepLine, styles.stepLineCompleted]}
                    />
                  )}
                </View>
              ))}
            </View>
            <Text style={styles.stepStatus}>
              ✅ Approved — ready to disburse
            </Text>
          </View>

          {/* First Payment Date — raw TextInput instead of the shared
              Input component. The shared Input was rendering "" as
              today's date on web (likely an <input type="date"> under
              the hood, which browsers initialise to today when the
              controlled value is empty). TextInput is a plain text box
              and honours value="" exactly, so the field opens clean. */}
          <Text style={styles.disburseDateLabel}>First Payment Date *</Text>

          <TextInput
            style={styles.disburseDateInput}
            value={disburseDateText}
            onChangeText={(v) => {
              setDisburseDateText(v);
              const parsed = parseYmdToDate(v);
              if (parsed) setDisburseApplicationDate(parsed);
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.text3}
            keyboardType="numbers-and-punctuation"
            inputMode="numeric"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />

          <Text style={styles.disburseDateHint}>
            Required. May be a past, present, or future date — the money
            is recorded as leaving the wallet on this day.
          </Text>

          <Text
            style={{
              fontSize: 12,
              lineHeight: 18,
              color: C.text3,
              marginTop: 4,
              marginBottom: 16,
            }}
          >
            This date anchors interest accrual (on reducing-balance loans), the
            wallet transaction, and every installment due date in the repayment
            schedule — the first installment is due one month from this date.
            The loan's original application date (
            {disburseLoanTarget?.applicationDate
              ? fmtDate(disburseLoanTarget.applicationDate)
              : "—"}
            ) is preserved separately and is not affected.
          </Text>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Cancel"
              onPress={() => {
                if (isDisbursing) return;
                setShowDisburseModal(false);
                setDisburseLoanTarget(null);
                setDisburseDateText("");
              }}
              variant="secondary"
              style={{ flex: 1 }}
            />

            {/* Confirm uses a plain TouchableOpacity instead of the
                shared Button component so its amber background matches
                the "Ready to disburse" row highlight — the Button
                component's variant set doesn't include a gold option.
                Height matches Button's default via minHeight so the
                Cancel button beside it lines up. */}
            <TouchableOpacity
              style={[
                styles.confirmDisburseBtn,
                (isDisbursing ||
                  !disburseDateText.trim() ||
                  !parseYmdToDate(disburseDateText)) &&
                  styles.confirmDisburseBtnDisabled,
              ]}
              onPress={confirmDisbursement}
              disabled={
                isDisbursing ||
                !disburseDateText.trim() ||
                !parseYmdToDate(disburseDateText)
              }
              activeOpacity={0.8}
            >
              <Text style={styles.confirmDisburseBtnText}>
                {isDisbursing ? "Disbursing…" : "Confirm Disbursement"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomModal>

      {/* Loan Detail Modal */}
      <LoanDetailModal
        visible={showLoanDetail}
        loan={selectedLoan}
        member={
          selectedLoan ? getMember(selectedLoan.memberId) : null
        }
        walletTxs={walletTxs}
        actableStep={
          selectedLoan
            ? getActableStep(selectedLoan.status, role)
            : null
        }
        onClose={() => {
          setShowLoanDetail(false);
          setSelectedLoan(null);
        }}
        onSchedule={() => {
          if (selectedLoan) {
            setShowLoanDetail(false);
            setShowScheduleModal(true);
          }
        }}
        onRepayment={() => {
          if (selectedLoan) {
            setShowLoanDetail(false);
            router.push({
              pathname: "/modals/record-repayment",
              params: { loanId: selectedLoan.id },
            });
          }
        }}
        onDisburse={() => {
          if (selectedLoan) {
            setShowLoanDetail(false);
            handleDisburse(selectedLoan);
          }
        }}
        onApprove={() => {
          if (selectedLoan) {
            const step = getActableStep(selectedLoan.status, role);
            if (step) {
              setPendingAction({
                loanId: selectedLoan.id,
                step,
                approve: true,
              });
              setShowApprovalModal(true);
              setShowLoanDetail(false);
            }
          }
        }}
        onReject={() => {
          if (selectedLoan) {
            const step = getActableStep(selectedLoan.status, role);
            if (step) {
              setPendingAction({
                loanId: selectedLoan.id,
                step,
                approve: false,
              });
              setShowApprovalModal(true);
              setShowLoanDetail(false);
            }
          }
        }}
        onDelete={
          selectedLoan
            ? () => handleDeleteLoan(selectedLoan)
            : undefined
        }
        onEdit={
          selectedLoan
            ? () => {
                setShowLoanDetail(false);
                router.push({
                  pathname: "/modals/edit-loan",
                  params: { id: selectedLoan.id },
                });
              }
            : undefined
        }
        onEditResubmit={
          selectedLoan &&
          selectedLoan.status === "rejected" &&
          (selectedLoan.memberId === currentMember?.id || isAdmin)
            ? () =>
                router.push({
                  pathname: "/modals/add-loan",
                  params: {
                    editLoanId: selectedLoan.id,
                    prefillAmount: String(selectedLoan.amount),
                    prefillPurpose: selectedLoan.purpose ?? "",
                    prefillMonths: String(
                      selectedLoan.repaymentMonths ?? 6,
                    ),
                    prefillMemberId: selectedLoan.memberId,
                    prefillDate:
                      selectedLoan.applicationDate?.slice(0, 10) ?? "",
                  },
                })
            : undefined
        }
        isAdmin={isAdmin}
        isPending={
          selectedLoan
            ? PENDING_STATUSES.includes(selectedLoan.status)
            : false
        }
        canDisburse={canDisburseRole(role)}
        canManageFees={
          ["admin", "accountant", "loan_officer"].includes(role) || isAdmin
        }
        onWaive={(fee) => {
          setShowLoanDetail(false);
          openWaiverModal(fee);
        }}
      />

      <LateFeeWaiverModal
        visible={!!waiverTarget}
        onClose={closeWaiverModal}
        context="loan"
        target={waiverTarget}
        member={
          waiverTarget
            ? groupMembers.find(
                (m) => m.id === waiverTarget.memberId,
              ) ?? null
            : null
        }
        group={activeGroup}
        saving={waiverSaving}
        onConfirm={handleConfirmWaiver}
        onRemoveExemption={handleRemoveExemption}
      />

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

function LoanRow({
  loan,
  member,
  onPress,
  isOwn,
  canActOnThis,
}: {
  loan: Loan;
  member: any;
  onPress: () => void;
  isOwn?: boolean;
  canActOnThis?: boolean;
}) {
  const statusColor = STATUS_COLOR[loan.status] || C.infoText;
  const statusBg = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;

  const pct =
    loan.status === "repaid"
      ? 100
      : loan.totalRepayable > 0
        ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
        : 0;

  const isPending = PENDING_STATUSES.includes(loan.status);
  const showTracker = !!isOwn && isPending;
  const showActionPill = !!canActOnThis && isPending;

  // Left-edge stripe: amber when the current user needs to act on this
  // specific loan, otherwise the status color. This is the primary
  // "scan me" affordance for approvers working down the list.
  const stripeColor = showActionPill ? C.gold : statusColor;

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { borderLeftColor: stripeColor },
        showActionPill && styles.rowActionable,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.rowAvatar}>
        <Text style={styles.rowAvatarText}>
          {(member?.fullName ?? "?")
            .split(" ")
            .map((w: string) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </Text>
      </View>

      <View style={styles.rowMid}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {member?.fullName ?? "Unknown"}
        </Text>

        <Text style={styles.rowMeta} numberOfLines={1}>
          {fmtDate(loan.applicationDate)}
          {["disbursed", "repaid"].includes(loan.status)
            ? ` · ${pct.toFixed(0)}% repaid`
            : ""}
        </Text>

        {showActionPill && (
          <View style={styles.actionNeededPill}>
            <Text style={styles.actionNeededText}>
              ⚡ Awaiting your review
            </Text>
          </View>
        )}

        {showTracker && <PendingProgress status={loan.status} />}
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.rowAmount}>{fmtCurrency(loan.amount)}</Text>
        <View style={{ marginTop: 4 }}>
          <Chip label={statusLabel} bg={statusBg} color={statusColor} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Compact pipeline tracker shown on the applicant's own pending loans
//
// Three nodes: Officer → Committee → Approved. Filled dot = completed
// stage, ringed amber dot = current stage, empty dot = future stage.
// Rejected / defaulted loans never reach here (not in PENDING_STATUSES).
function PendingProgress({ status }: { status: string }) {
  const steps = [
    { key: "pending_loan_officer", label: "Officer" },
    { key: "pending_committee", label: "Committee" },
    { key: "approved", label: "Approved" },
  ];

  const currentIdx = Math.max(
    0,
    steps.findIndex((s) => s.key === status),
  );

  return (
    <View style={styles.pendingTracker}>
      {steps.map((step, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;

        return (
          <React.Fragment key={step.key}>
            <View style={styles.pendingTrackerNode}>
              <View
                style={[
                  styles.pendingDot,
                  isDone && styles.pendingDotDone,
                  isCurrent && styles.pendingDotCurrent,
                ]}
              >
                {isDone ? (
                  <Text style={styles.pendingCheck}>✓</Text>
                ) : null}
              </View>

              <Text
                style={[
                  styles.pendingLabel,
                  (isDone || isCurrent) && styles.pendingLabelActive,
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>

            {i < steps.length - 1 && (
              <View
                style={[
                  styles.pendingConnector,
                  isDone && styles.pendingConnectorDone,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  pageSummaryLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.primary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  pageSummaryTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.2,
    marginTop: 1,
  },
  addBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  block: { marginHorizontal: 16, marginBottom: 14 },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  balanceCard: {
    margin: 16,
    borderRadius: 20,
    backgroundColor: C.card,
    padding: 24,
    overflow: "hidden",
  },
  cardAccentDot: {
    position: "absolute",
    top: -50,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(26,86,219,0.15)",
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  balanceAmount: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1.2,
    marginTop: 6,
  },
  balanceCurrency: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.45)",
  },
  balancePills: {
    flexDirection: "row",
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  balancePill: { flex: 1, alignItems: "center" },
  balancePillLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  balancePillValue: { fontSize: 12, fontWeight: "700", marginTop: 3 },
  balancePillDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  pendingBadgeRow: { marginTop: 14, alignItems: "flex-start" },
  pendingBadge: {
    backgroundColor: "rgba(251,191,36,0.2)",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FCD34D",
  },

  subTabRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  subTabGroup: { flexDirection: "row", gap: 8 },
  subTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  subTabActive: { backgroundColor: C.primary, borderColor: C.primary },
  subTabText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  subTabTextActive: { color: "#fff" },
  addInlineBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  addInlineBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  tabWrapper: { paddingHorizontal: 16, marginBottom: 12 },

  listContainer: { paddingHorizontal: 16 },

  loanCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
    overflow: "hidden",
  },
  loanHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  loanAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  loanAvatarText: { fontSize: 14, fontWeight: "800", color: C.primary },
  loanMember: { fontSize: 14, fontWeight: "700", color: C.text },
  loanDate: { fontSize: 11, color: C.text3, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "capitalize",
  },

  amountsRow: {
    flexDirection: "row",
    paddingVertical: 14,
    backgroundColor: C.elevated,
  },
  amountItem: { flex: 1, alignItems: "center" },
  amountLabel: {
    fontSize: 10,
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  amountValue: { fontSize: 13, fontWeight: "700", color: C.text },
  amountDivider: { width: 1, backgroundColor: C.borderLight },

  actualReturnRow: {
    flexDirection: "row",
    paddingVertical: 14,
    backgroundColor: C.goldBg,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },

  progressSection: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressLabel: { fontSize: 11, color: C.text3 },
  progressPercent: { fontSize: 11, fontWeight: "700", color: C.accent },
  progressBar: {
    height: 6,
    backgroundColor: C.elevated,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%" as any,
    backgroundColor: C.accent,
    borderRadius: 3,
  },
  progressSub: { fontSize: 10, color: C.text3, marginTop: 6 },

  purpose: {
    fontSize: 12,
    color: C.text2,
    paddingHorizontal: 16,
    paddingBottom: 12,
    fontStyle: "italic",
  },

  actionRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    paddingTop: 8,
    flexWrap: "wrap",
  },

  viewDetailsBtn: {
    backgroundColor: C.infoBg,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  viewDetailsBtnText: {
    color: C.info,
    fontSize: 12,
    fontWeight: "700",
  },

  approveBtn: {
    flex: 1,
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  approveBtnText: { color: C.success, fontSize: 12, fontWeight: "700" },
  rejectBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  rejectBtnText: { color: C.error, fontSize: 12, fontWeight: "700" },
  disburseBtn: {
    flex: 1,
    backgroundColor: C.gold,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  disburseBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  scheduleBtn: {
    flex: 1,
    backgroundColor: C.tealBg,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  scheduleBtnText: { color: C.teal, fontSize: 12, fontWeight: "700" },
  repayBtn: {
    flex: 1,
    backgroundColor: C.pill,
    borderWidth: 1,
    borderColor: "rgba(26,60,94,0.2)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  repayBtnText: { color: C.primary, fontSize: 12, fontWeight: "700" },
  deleteBtn: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  deleteBtnText: { color: C.error, fontSize: 12, fontWeight: "700" },
  editBtn: {
    backgroundColor: C.infoBg,
    borderWidth: 1,
    borderColor: "rgba(59,130,246,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  editBtnText: { color: C.info, fontSize: 12, fontWeight: "700" },
  rejectionBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: "rgba(239,68,68,0.06)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.15)",
    borderRadius: 10,
    padding: 12,
  },
  rejectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.error,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  rejectionText: { fontSize: 12, color: C.text2, lineHeight: 18 },
  editResubmitBtn: {
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  editResubmitBtnText: { color: C.gold, fontSize: 13, fontWeight: "700" },

  modalInfo: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: "center",
  },
  modalMember: { fontSize: 14, fontWeight: "700", color: C.text },
  modalAmount: {
    fontSize: 20,
    fontWeight: "800",
    color: C.primary,
    marginTop: 4,
  },
  modalDetail: { fontSize: 12, color: C.text3, marginTop: 4 },
  modalPurpose: {
    fontSize: 12,
    color: C.text2,
    marginTop: 6,
    fontStyle: "italic",
  },

  accrualBox: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 16,
  },
  accrualText: { fontSize: 11, color: C.gold, lineHeight: 16 },

  // ── Late fees card (redesigned) ──
  lateFeesCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    padding: 14,
    marginBottom: 16,
  },
  lateFeesCardDisabled: {
    backgroundColor: C.elevated,
    borderColor: C.border,
  },

  lateFeesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  lateFeesTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: C.error,
  },
  lateFeesTotalInline: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
  },
  lateFeesToggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  lateFeesToggleLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  lateFeesDisabledMsg: {
    fontSize: 12,
    color: C.text2,
    lineHeight: 17,
    marginTop: 8,
  },
  lateFeesEmptyMsg: {
    fontSize: 12,
    color: C.text3,
    marginTop: 8,
  },

  lateFeesExpandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingVertical: 4,
  },
  lateFeesSubtitle: {
    fontSize: 11,
    fontWeight: "700",
    color: C.primary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  lateFeesExpandChevron: {
    fontSize: 10,
    color: C.text3,
  },

  lateFeeRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  lateFeeRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  lateFeeKindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    flexShrink: 0,
  },
  lateFeeKindText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  lateFeeLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  lateFeeSublabel: {
    fontSize: 11,
    color: C.text3,
    lineHeight: 16,
    marginTop: 2,
  },
  lateFeeRowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },
  lateFeeAmount: {
    fontSize: 14,
    fontWeight: "800",
    color: C.error,
  },
  lateFeeActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  lateFeeInput: {
    height: 30,
    width: 78,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    fontSize: 11,
    color: C.text,
    textAlign: "right",
  },
  lateFeeApplyBtn: {
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  lateFeeApplyBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  lateFeeVoidBtn: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.error,
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  lateFeeVoidBtnText: {
    color: C.error,
    fontSize: 11,
    fontWeight: "700",
  },
  lateFeeTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    marginTop: 8,
    borderTopWidth: 2,
    borderTopColor: "rgba(239,68,68,0.25)",
  },
  lateFeeTotalLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: C.text,
  },
  lateFeeTotalValue: {
    fontSize: 15,
    fontWeight: "800",
    color: C.error,
  },

  stepsContainer: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  stepsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
    marginBottom: 12,
    textAlign: "center",
  },
  stepsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  stepItem: { alignItems: "center", flex: 1, position: "relative" },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    backgroundColor: C.surface,
  },
  stepCompleted: { backgroundColor: C.success, borderColor: C.success },
  stepCurrent: {
    borderColor: C.gold,
    borderWidth: 3,
    backgroundColor: C.goldBg,
  },
  stepPending: { borderColor: C.border, backgroundColor: C.bg },
  stepIcon: { fontSize: 14, color: C.text3 },
  stepIconCompleted: { color: "#fff" },
  stepIconCurrent: { color: C.gold },
  stepLabel: {
    fontSize: 9,
    marginTop: 4,
    textAlign: "center",
    color: C.primary,
  },
  stepLabelCompleted: { color: C.success, fontWeight: "700" },
  stepLabelCurrent: { color: C.gold, fontWeight: "700" },
  stepLine: {
    position: "absolute",
    top: 18,
    left: "50%",
    right: "-50%",
    height: 2,
    backgroundColor: C.border,
    zIndex: -1,
  },
  stepLineCompleted: { backgroundColor: C.success },
  stepStatus: {
    fontSize: 12,
    textAlign: "center",
    color: C.text2,
    marginTop: 12,
    fontWeight: "600",
  },

  scheduleItem: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
  },
  scheduleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  scheduleMonth: { fontSize: 12, fontWeight: "700", color: C.text },
  scheduleDate: { fontSize: 11, color: C.text3 },
  scheduleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
  },
  scheduleCell: { flex: 1, minWidth: 0, alignItems: "center" },
  scheduleCellLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: C.text3,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  scheduleCellValue: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
    textAlign: "center",
  },
  scheduleEmpty: {
    fontSize: 12,
    color: C.text3,
    textAlign: "center",
    paddingVertical: 20,
  },

  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  chipText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  emptyState: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyIcon: { fontSize: 48, opacity: 0.5 },
  emptyBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: C.primary,
    borderRadius: 20,
  },
  emptyBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  controlsBlock: { paddingHorizontal: 16, gap: 10, marginTop: 12 },
  controlsTop: { flexDirection: "row", gap: 8, alignItems: "center" },
  sortRow: { flexDirection: "row", gap: 6 },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.mutedBg,
  },
  sortChipActive: { backgroundColor: C.primary },
  sortChipText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  sortChipTextActive: { color: "#fff" },

  rowList: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderLeftWidth: 4,
    borderLeftColor: C.border,
  },
  rowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.mutedBg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowAvatarText: { fontSize: 12, fontWeight: "700", color: C.text2 },
  rowMid: { flex: 1, marginRight: 10 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: C.text },
  rowMeta: { fontSize: 12, color: C.text3, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "800", color: C.text },

  disburseDateLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text2,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  disburseDateInput: {
    minHeight: 46,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: C.text,
  },

  disburseDateHint: {
    fontSize: 11,
    color: C.text3,
    lineHeight: 16,
    marginTop: 6,
  },
  confirmDisburseBtn: {
    flex: 1,
    minHeight: 46,
    backgroundColor: C.gold,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  confirmDisburseBtnDisabled: {
    opacity: 0.45,
  },

  confirmDisburseBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  rowActionable: {
    backgroundColor: "rgba(245,158,11,0.07)",
  },

  actionNeededPill: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
  },

  actionNeededText: {
    fontSize: 10,
    fontWeight: "800",
    color: C.gold,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  pendingTracker: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 10,
  },

  pendingTrackerNode: {
    alignItems: "center",
    minWidth: 58,
    gap: 3,
  },

  pendingDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  pendingDotDone: {
    backgroundColor: C.success,
    borderColor: C.success,
  },

  pendingDotCurrent: {
    borderColor: C.gold,
    backgroundColor: C.goldBg,
  },

  pendingCheck: {
    fontSize: 8,
    color: "#fff",
    fontWeight: "800",
    lineHeight: 10,
  },

  pendingLabel: {
    fontSize: 8,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.2,
    textAlign: "center",
  },

  pendingLabelActive: {
    color: C.text2,
  },

  pendingConnector: {
    flex: 1,
    height: 2,
    backgroundColor: C.border,
    marginTop: 6,
    marginHorizontal: -4,
  },

  pendingConnectorDone: {
    backgroundColor: C.success,
  },

  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 20,
  },
  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.mutedBg,
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: "700", color: C.text },
  pageBtnTextDisabled: { color: C.text3 },
  pageLabel: { fontSize: 13, color: C.text3, fontWeight: "600" },
});