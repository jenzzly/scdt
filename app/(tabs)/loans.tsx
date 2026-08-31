// app/(tabs)/loans.tsx - Updated with delete investment button

import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, StatusBar, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupLoans, useGroupMembers,
  useCurrentUserRole, useCurrentMember, useIsAdminView,
} from "../../stores/useStore";
import { useGroupWallet, useCurrentMemberPermissions } from "../../stores/selectors";
import {
  TabRow, SearchBar, Card, Badge, Empty, LoanProgress,
  useToast, Button, BottomModal, Input,
} from "../../components/ui";
import { S, R, Colors, C, T, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";
import { exportPdf, generatePaymentScheduleHtml } from "../../utils/export";
import type { Loan, WalletTransaction, Member } from "../../types";

// ─── Tiny components ──────────────────────────────────────────────
const Divider = () => (
  <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 16 }} />
);

const SectionHeader = ({
  title, action, actionLabel,
}: { title: string; action?: () => void; actionLabel?: string }) => (
  <View style={styles.sectionHeader}>
    <Text style={T.h2}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={action} activeOpacity={0.7}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: C.primary }}>{actionLabel ?? "See all"}</Text>
      </TouchableOpacity>
    )}
  </View>
);

const Chip = ({ label, bg, color }: { label: string; bg: string; color: string }) => (
  <View style={[styles.chip, { backgroundColor: bg }]}>
    <Text style={[styles.chipText, { color }]}>{label}</Text>
  </View>
);

const STATUS_COLOR: Record<string, string> = {
  pending_loan_officer: C.gold,
  pending_committee:    C.info,
  pending_accountant:   C.info,
  approved:             C.teal,
  disbursed:            C.teal,
  repaid:               C.success,
  rejected:             C.text3,
  defaulted:            C.error,
};

const STATUS_BG: Record<string, string> = {
  pending_loan_officer: C.goldBg,
  pending_committee:    C.infoBg,
  pending_accountant:   C.infoBg,
  approved:             C.tealBg,
  disbursed:            C.tealBg,
  repaid:               C.greenBg,
  rejected:             C.mutedBg,
  defaulted:            C.redBg,
};

const STATUS_LABEL: Record<string, string> = {
  pending_loan_officer: "Awaiting Officer",
  pending_committee:    "Awaiting Committee",
  pending_accountant:   "Awaiting Accountant",
  approved:             "Ready to Disburse",
  disbursed:            "Active",
  repaid:               "Repaid",
  rejected:             "Rejected",
  defaulted:            "Defaulted",
};

const PENDING_STATUSES = [
  "pending_loan_officer",
  "pending_committee",
];

const APPROVAL_STEPS = [
  { key: "pending_loan_officer", label: "Loan Officer", icon: "👤" },
  { key: "pending_committee", label: "Committee", icon: "📋" },
];

function getActableStep(loanStatus: string, role: string): string | null {
  if (role === "admin") {
    if (loanStatus === "pending_loan_officer") return "loan_officer";
    if (loanStatus === "pending_committee")    return "committee";
  }
  if (role === "loan_officer" && loanStatus === "pending_loan_officer") return "loan_officer";
  if (role === "committee"    && loanStatus === "pending_committee")    return "committee";
  return null;
}

// Disbursement is a separate action from approval — the accountant (or
// admin) acts on a loan that's already `approved` (cleared both
// approval steps above), not a "pending_" status. The role check lives
// here; call sites still separately check `loan.status === "approved"`
// before showing the disburse button (see LoanRow/LoanDetailModal).
function canDisburseRole(role: string): boolean {
  return role === "accountant" || role === "admin";
}

function getApprovalStepIndex(status: string): number {
  const index = APPROVAL_STEPS.findIndex(s => s.key === status);
  return index === -1 ? APPROVAL_STEPS.length : index;
}

// ─── Loan Detail Modal ──────────────────────────────────────────────
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
  onEditResubmit,
  isAdmin,
  isPending,
  actableStep,
  canDisburse,
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
  onEditResubmit?: () => void;
  isAdmin: boolean;
  isPending: boolean;
  actableStep: string | null;
  canDisburse: boolean;
}) {
  // Pair interest + principal txs into rows for the history table
  const paymentTxs = React.useMemo(() => {
    if (!loan) return [];
    const intTxs  = walletTxs.filter(t => t.loanId === loan.id && ["loan_interest_income","loan_repayment"].includes(t.type))
      .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const prinTxs = walletTxs.filter(t => t.loanId === loan.id && t.type === "loan_principal_recovery")
      .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return intTxs.map((itx, i) => ({
      date:      itx.date,
      interest:  itx.amount,
      principal: prinTxs[i]?.amount ?? 0,
    }));
  }, [loan, walletTxs]);
  if (!loan) return null;

  // Progress: repaid loans are always 100% regardless of amountRepaid vs totalRepayable
  const pct = loan.status === "repaid"
    ? 100
    : loan.totalRepayable > 0
      ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
      : 0;
  const isRB = loan.interestMethod === "reducing_balance";
  const accruedInterest = (loan as any).accruedInterest ?? 0;
  const statusColor = STATUS_COLOR[loan.status] || (loan.status === "rejected" ? C.error : C.infoText);
  const statusBg    = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;

  return (
    <BottomModal visible={visible} onClose={onClose} title="Loan Details">
      <ScrollView style={{ padding: 16, maxHeight: 560 }} showsVerticalScrollIndicator={false}>

        {/* Member + amount header */}
        <View style={styles.modalInfo}>
          <Text style={styles.modalMember}>{member?.fullName ?? "Unknown"}</Text>
          <Text style={styles.modalAmount}>{fmtCurrency(loan.amount)}</Text>
          <Text style={styles.modalDetail}>
            {loan.interestRate}% {(loan as any).interestRatePeriod === "annual" ? "annual" : "monthly"}{isRB ? " · daily accrual" : " flat"} · {loan.repaymentMonths} months
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusBg, alignSelf: "center", marginTop: 4 }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* ── Approval Progress — visible to everyone who can see this
             loan, including the borrower, not just approvers. Shows
             each step's outcome and any comment the reviewer left, so
             the loan owner can see exactly where their application
             stands and why, before the next step happens. ── */}
        {loan.status !== "rejected" && (
          <View style={styles.stepsContainer}>
            <Text style={styles.stepsTitle}>Approval Progress</Text>
            <View style={styles.stepsRow}>
              {APPROVAL_STEPS.map((step, index) => {
                const currentStepIndex = getApprovalStepIndex(loan.status);
                const isCompleted = index < currentStepIndex || loan.status === "disbursed" || loan.status === "repaid";
                const isCurrent = index === currentStepIndex && loan.status !== "disbursed" && loan.status !== "repaid";
                const isPendingStep = !isCompleted && !isCurrent;

                return (
                  <View key={step.key} style={styles.stepItem}>
                    <View style={[
                      styles.stepCircle,
                      isCompleted && styles.stepCompleted,
                      isCurrent && styles.stepCurrent,
                      isPendingStep && styles.stepPending,
                    ]}>
                      <Text style={[
                        styles.stepIcon,
                        isCompleted && styles.stepIconCompleted,
                        isCurrent && styles.stepIconCurrent,
                      ]}>
                        {isCompleted ? "✓" : step.icon}
                      </Text>
                    </View>
                    <Text style={[
                      styles.stepLabel,
                      isCompleted && styles.stepLabelCompleted,
                      isCurrent && styles.stepLabelCurrent,
                    ]}>
                      {step.label}
                    </Text>
                    {index < APPROVAL_STEPS.length - 1 && (
                      <View style={[styles.stepLine, isCompleted && styles.stepLineCompleted]} />
                    )}
                  </View>
                );
              })}
            </View>
            <Text style={styles.stepStatus}>
              {loan.status === "pending_loan_officer" && "⏳ Awaiting Loan Officer review"}
              {loan.status === "pending_committee" && "⏳ Awaiting Committee review"}
              {loan.status === "approved" && "✅ Approved — awaiting disbursement"}
              {loan.status === "disbursed" && "💰 Loan Disbursed"}
              {loan.status === "repaid" && "✅ Fully Repaid"}
              {loan.status === "defaulted" && "⚠️ Defaulted"}
            </Text>

            {/* Reviewer comments — shown per step, in order, only when
                a comment was actually left. */}
            {(["loanOfficer", "committee"] as const).map((stepKey) => {
              const approval = (loan.approvals as any)?.[stepKey];
              if (!approval?.comment) return null;
              const label = stepKey === "loanOfficer" ? "Loan Officer" : "Committee";
              return (
                <View key={stepKey} style={detailSt.commentBox}>
                  <Text style={detailSt.commentLabel}>
                    {label} comment {approval.date ? `· ${fmtDate(approval.date)}` : ""}
                  </Text>
                  <Text style={detailSt.commentText}>{approval.comment}</Text>
                </View>
              );
            })}
          </View>
        )}

        {loan.purpose ? (
          <View style={styles.modalInfo}>
            <Text style={styles.modalDetail}>Purpose: {loan.purpose}</Text>
          </View>
        ) : null}

        {/* Financial summary grid */}
        <View style={detailSt.grid}>
          <View style={detailSt.cell}>
            <Text style={detailSt.cellLbl}>Principal</Text>
            <Text style={detailSt.cellVal}>{fmtCurrency(loan.amount)}</Text>
          </View>
          <View style={detailSt.cell}>
            <Text style={detailSt.cellLbl}>Est. Total Interest</Text>
            <Text style={detailSt.cellVal}>{fmtCurrency(loan.totalInterest)}</Text>
          </View>
          <View style={detailSt.cell}>
            <Text style={detailSt.cellLbl}>Balance (Principal)</Text>
            <Text style={[detailSt.cellVal, { color: C.error }]}>{fmtCurrency(loan.balance)}</Text>
          </View>
          {isRB ? (
            <View style={detailSt.cell}>
              <Text style={detailSt.cellLbl}>Accrued Interest</Text>
              <Text style={[detailSt.cellVal, { color: C.gold }]}>{fmtCurrency(accruedInterest)}</Text>
            </View>
          ) : (
            <View style={detailSt.cell}>
              <Text style={detailSt.cellLbl}>Int. Left</Text>
              <Text style={[detailSt.cellVal, { color: C.gold }]}>
                {fmtCurrency(Math.max(0, round2(loan.totalRepayable - loan.amountRepaid - loan.balance)))}
              </Text>
            </View>
          )}
          <View style={detailSt.cell}>
            <Text style={detailSt.cellLbl}>Amount Repaid</Text>
            <Text style={[detailSt.cellVal, { color: C.success }]}>{fmtCurrency(loan.amountRepaid)}</Text>
          </View>
          <View style={detailSt.cell}>
            <Text style={detailSt.cellLbl}>Total Due</Text>
            <Text style={[detailSt.cellVal, { color: C.primary, fontWeight: "800" }]}>
              {isRB
                ? fmtCurrency(round2(loan.balance + accruedInterest))
                : fmtCurrency(round2(loan.totalRepayable - loan.amountRepaid))}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={detailSt.progressWrap}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={detailSt.progressLbl}>Repayment Progress</Text>
            <Text style={[detailSt.progressLbl, { color: pct >= 100 ? C.success : C.primary, fontWeight: "700" }]}>
              {pct.toFixed(1)}%
            </Text>
          </View>
          <View style={detailSt.progressTrack}>
            <View style={[detailSt.progressFill, { width: `${Math.min(100, pct)}%` as any, backgroundColor: pct >= 100 ? C.success : C.primary }]} />
          </View>
          <Text style={detailSt.progressSub}>
            {fmtCurrency(loan.amountRepaid)} repaid of {fmtCurrency(loan.totalRepayable)}
            {loan.status !== "repaid" ? ` · ${fmtCurrency(round2(Math.max(0, loan.totalRepayable - loan.amountRepaid)))} remaining` : " · Fully repaid ✓"}
          </Text>
        </View>
        
        <View style={styles.actionRow}>
          {loan.status === "disbursed" && (
            <>
              <TouchableOpacity style={[styles.scheduleBtn, { flex: 1 }]} onPress={onSchedule}>
                <Text style={styles.scheduleBtnText}>Schedule</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.repayBtn, { flex: 1 }]} onPress={onRepayment}>
                <Text style={styles.repayBtnText}>Repayment</Text>
              </TouchableOpacity>
            </>
          )}
          {loan.status === "approved" && canDisburse && (
            <TouchableOpacity style={[styles.disburseBtn, { flex: 1 }]} onPress={onDisburse}>
              <Text style={styles.disburseBtnText}>Disburse</Text>
            </TouchableOpacity>
          )}
          {actableStep && isPending && (
            <>
              <TouchableOpacity style={[styles.rejectBtn, { flex: 1 }]} onPress={onReject}>
                <Text style={styles.rejectBtnText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.approveBtn, { flex: 1 }]} onPress={onApprove}>
                <Text style={styles.approveBtnText}>Approve</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Rejected-loan follow-up actions — edit & resubmit is only
            offered to the borrower or an admin (checked by the caller
            before onEditResubmit is even passed in); delete is
            available to anyone with disburse-level trust (accountant/
            admin), same as before. Both used to live directly on the
            list row; they're here now since every action lives in this
            detail view, opened by tapping the loan. */}
        {loan.status === "rejected" && onEditResubmit && (
          <TouchableOpacity style={styles.editResubmitBtn} onPress={onEditResubmit} activeOpacity={0.8}>
            <Text style={styles.editResubmitBtnText}>✏️ Edit &amp; Resubmit</Text>
          </TouchableOpacity>
        )}
        {canDisburse && onDelete && (
          <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
            <Text style={styles.deleteBtnText}>🗑 Delete Loan</Text>
          </TouchableOpacity>
        )}

        <Button label="Close" onPress={onClose} fullWidth variant="secondary" style={{ marginTop: 12 }} />

        {/* Payment history — pulled from walletTxs prop */}
        {paymentTxs && paymentTxs.length > 0 && (
          <View style={detailSt.histCard}>
            <Text style={detailSt.histTitle}>Payment History ({paymentTxs.length} transactions)</Text>
            {/* Column headers */}
            <View style={detailSt.histHeadRow}>
              <Text style={[detailSt.histHead, { flex: 1.4 }]}>DATE</Text>
              <Text style={[detailSt.histHead, { flex: 1, textAlign: "right" }]}>INTEREST</Text>
              <Text style={[detailSt.histHead, { flex: 1, textAlign: "right" }]}>PRINCIPAL</Text>
              <Text style={[detailSt.histHead, { flex: 1, textAlign: "right" }]}>TOTAL</Text>
            </View>
            {paymentTxs.map((row: any, i: number) => (
              <View key={i} style={[detailSt.histRow, i % 2 === 1 && { backgroundColor: C.elevated }]}>
                <Text style={[detailSt.histCell, { flex: 1.4 }]} numberOfLines={1}>
                  {new Date(row.date).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "2-digit" })}
                </Text>
                <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", color: C.gold }]}>
                  {fmtCurrency(row.interest)}
                </Text>
                <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", color: C.success }]}>
                  {fmtCurrency(row.principal)}
                </Text>
                <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", fontWeight: "700" }]}>
                  {fmtCurrency(row.interest + row.principal)}
                </Text>
              </View>
            ))}
            {/* Totals row */}
            <View style={[detailSt.histRow, detailSt.histTotalRow]}>
              <Text style={[detailSt.histCell, { flex: 1.4, fontWeight: "700", color: C.text }]}>Total</Text>
              <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: C.gold }]}>
                {fmtCurrency(paymentTxs.reduce((s: number, r: any) => s + r.interest, 0))}
              </Text>
              <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: C.success }]}>
                {fmtCurrency(paymentTxs.reduce((s: number, r: any) => s + r.principal, 0))}
              </Text>
              <Text style={[detailSt.histCell, { flex: 1, textAlign: "right", fontWeight: "700", color: C.text }]}>
                {fmtCurrency(paymentTxs.reduce((s: number, r: any) => s + r.interest + r.principal, 0))}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </BottomModal>
  );
}

// ─── Loan Detail Modal styles ─────────────────────────────────────────────────
const detailSt = StyleSheet.create({
  grid: {
    flexDirection: "row", flexWrap: "wrap",
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    overflow: "hidden", marginBottom: 16,
  },
  cell: {
    width: "50%", padding: 12,
    borderRightWidth: 1, borderRightColor: C.border,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cellLbl: { fontSize: 10, color: C.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  cellVal: { fontSize: 14, fontWeight: "700", color: C.text },

  commentBox: {
    marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: C.infoBg, borderWidth: 1, borderColor: "rgba(59,130,246,0.2)",
  },
  commentLabel: { fontSize: 11, fontWeight: "700", color: C.infoText, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  commentText:  { fontSize: 13, color: C.text, lineHeight: 18 },

  progressWrap:  { marginBottom: 16 },
  progressLbl:   { fontSize: 12, color: C.text3, fontWeight: "600" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: C.border, overflow: "hidden", marginVertical: 6 },
  progressFill:  { height: "100%" as any, borderRadius: 4 },
  progressSub:   { fontSize: 11, color: C.text3 },

  histCard:    { marginTop: 16, borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: "hidden" },
  histTitle:   { fontSize: 13, fontWeight: "700", color: C.text, padding: 12, backgroundColor: C.elevated, borderBottomWidth: 1, borderBottomColor: C.border },
  histHeadRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.elevated },
  histHead:    { fontSize: 9, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.6 },
  histRow:     { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.borderLight },
  histCell:    { fontSize: 12, color: C.text2 },
  histTotalRow:{ backgroundColor: C.elevated, borderTopWidth: 1, borderTopColor: C.border },
});

export default function LoansScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const {
    approveLoanStep,
    disburseLoan,
    rejectLoan,
    deleteLoan,
  } = useStore();
  const allLoans = useGroupLoans();
  const walletTxs = useGroupWallet();
  const groupMembers = useGroupMembers();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const permissions = useCurrentMemberPermissions();
  const { show, Toast } = useToast();

  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showLoanDetail, setShowLoanDetail] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    loanId: string; step: string; approve: boolean;
  } | null>(null);

  const isAdminView = useIsAdminView();
  const isAdmin = role === "admin";

  const getMember = (id: string) => groupMembers.find((m: Member) => m.id === id);

  const visibleLoans = useMemo(() => {
    if (isAdminView) return allLoans;
    return allLoans.filter((l: Loan) => l.memberId === currentMember?.id);
  }, [allLoans, isAdminView, currentMember]);

  const LOAN_TABS = isAdminView ? ["All", "Pending", "Active", "Repaid", "Rejected"] : ["All", "Active", "Repaid"];
  const SORT_OPTIONS = [
    { value: "date_desc", label: "Newest" },
    { value: "date_asc", label: "Oldest" },
    { value: "amount_desc", label: "Largest" },
  ];
  const PAGE_SIZE = 20;

  const byTab = useMemo(() => {
    const list = visibleLoans;
    if (tab === "Pending")  return list.filter((l: Loan) => PENDING_STATUSES.includes(l.status));
    if (tab === "Active")   return list.filter((l: Loan) => l.status === "disbursed");
    if (tab === "Repaid")   return list.filter((l: Loan) => l.status === "repaid");
    if (tab === "Rejected") return list.filter((l: Loan) => ["rejected", "defaulted"].includes(l.status));
    return list;
  }, [visibleLoans, tab]);

  // Search + sort match Wallet's pattern exactly — free-text match
  // against member name / purpose, then a small set of sort options,
  // same shape as wallet.tsx's controls.
  const filteredLoans = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = byTab;
    if (q) {
      list = list.filter((l: Loan) => {
        const memberName = getMember(l.memberId)?.fullName?.toLowerCase() ?? "";
        return memberName.includes(q) || (l.purpose ?? "").toLowerCase().includes(q);
      });
    }
    const sorted = [...list];
    if (sort === "date_desc") sorted.sort((a, b) => new Date(b.applicationDate).getTime() - new Date(a.applicationDate).getTime());
    else if (sort === "date_asc") sorted.sort((a, b) => new Date(a.applicationDate).getTime() - new Date(b.applicationDate).getTime());
    else if (sort === "amount_desc") sorted.sort((a, b) => b.amount - a.amount);
    return sorted;
  }, [byTab, search, sort, groupMembers]);

  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));
  const paginatedLoans = useMemo(
    () => filteredLoans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredLoans, page],
  );

  const handleTabChange = (t: string) => { setTab(t); setPage(1); };
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleSort = (v: string) => { setSort(v); setPage(1); };

  const outstanding = useMemo(() => visibleLoans.filter((l: Loan) => l.status === "disbursed").reduce((s: number, l: Loan) => s + l.balance, 0), [visibleLoans]);
  const totalRepaid = useMemo(() => visibleLoans.reduce((s: number, l: Loan) => s + l.amountRepaid, 0), [visibleLoans]);
  const totalDisbursed = useMemo(() => visibleLoans.filter((l: Loan) => ["disbursed", "repaid"].includes(l.status)).reduce((s: number, l: Loan) => s + l.amount, 0), [visibleLoans]);
  const pendingCount = useMemo(() => visibleLoans.filter((l: Loan) => PENDING_STATUSES.includes(l.status)).length, [visibleLoans]);

  const handleApproval = async () => {
    if (!pendingAction) return;
    try {
      await approveLoanStep(
        pendingAction.loanId,
        pendingAction.step as any,
        pendingAction.approve,
        approvalComment || undefined,
      );
      show(pendingAction.approve ? "Step approved" : "Loan rejected", pendingAction.approve ? "success" : "error");
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

  const handleDisburse = (loanId: string) => {
    showConfirm(
      "Confirm Disbursement",
      "Disburse this loan? This will debit the group wallet.",
      async () => {
        await disburseLoan(loanId);
        show("Loan disbursed");
        setShowLoanDetail(false);
      },
    );
  };

  const handleDeleteLoan = (loan: Loan) => {
    const hasRepayments = loan.amountRepaid > 0;
    let message = `Delete this ${STATUS_LABEL[loan.status] ?? loan.status} loan? This action cannot be undone.`;
    if (hasRepayments) {
      message = `⚠️ WARNING: This loan has ${fmtCurrency(loan.amountRepaid)} in repayments.\n\nDeleting this loan will also delete all associated repayment transactions.\n\n${message}`;
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
      true
    );
  };


  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={[styles.header, isWide && { paddingHorizontal: 32 }]}>
        <View>
          <Text style={styles.headerSub}>{isAdminView ? "Group" : "My"}</Text>
          <Text style={styles.headerTitle}>Loans</Text>
        </View>
        {permissions.addLoan && (
          <TouchableOpacity style={styles.addInlineBtn} onPress={() => router.push("/modals/add-loan")} activeOpacity={0.8}>
            <Text style={styles.addInlineBtnText}>+ Loan</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          { paddingBottom: 100 },
          isWide && { maxWidth: 960, alignSelf: "center" as any, width: "100%" as any },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card — dark navy, matching wallet */}
        <View style={styles.balanceCard}>
          <View style={styles.cardAccentDot} />
          <Text style={styles.balanceLabel}>{isAdminView ? "PORTFOLIO OVERVIEW" : "MY PORTFOLIO"}</Text>
          <Text style={styles.balanceAmount}>
            <Text style={styles.balanceCurrency}>RWF </Text>
            {fmtCurrency(totalDisbursed).replace("RWF ", "")}
          </Text>
          <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{isAdminView ? "total loans disbursed" : "my loans disbursed"}</Text>

          <View style={styles.balancePills}>
            <View style={styles.balancePill}>
              <Text style={styles.balancePillLabel}>OUTSTANDING</Text>
              <Text style={[styles.balancePillValue, { color: "#F87171" }]}>{fmtCurrency(outstanding)}</Text>
            </View>
            <View style={styles.balancePillDivider} />
            <View style={styles.balancePill}>
              <Text style={styles.balancePillLabel}>REPAID</Text>
              <Text style={[styles.balancePillValue, { color: "#34D399" }]}>{fmtCurrency(totalRepaid)}</Text>
            </View>
            <View style={styles.balancePillDivider} />
            <View style={styles.balancePill}>
              <Text style={styles.balancePillLabel}>COUNT</Text>
              <Text style={[styles.balancePillValue, { color: "#fff" }]}>{filteredLoans.length}</Text>
            </View>
          </View>

          {(pendingCount > 0) && (
            <View style={styles.pendingBadgeRow}>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>⏳ {pendingCount} pending approval{pendingCount > 1 ? "s" : ""}</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Controls: search + tabs + sort — matches Wallet's pattern
             exactly, per an explicit request to make these consistent
             across the app. ── */}
        <View style={styles.controlsBlock}>
          <View style={styles.controlsTop}>
            <View style={{ flex: 1 }}>
              <SearchBar value={search} onChange={handleSearch} placeholder="Search loans by member or purpose…" />
            </View>
            <View style={styles.sortRow}>
              {SORT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sortChip, sort === opt.value && styles.sortChipActive]}
                  onPress={() => handleSort(opt.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sortChipText, sort === opt.value && styles.sortChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TabRow tabs={LOAN_TABS} active={tab} onChange={handleTabChange} />
        </View>

        {/* ── List — compact summary rows only. Tapping a row opens the
             full detail modal, where every relevant action (approve,
             reject, disburse, repayment, schedule, delete, edit &
             resubmit) lives — nothing acts directly from the list
             anymore. ── */}
        <View style={styles.listContainer}>
          {paginatedLoans.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={T.body}>No {tab.toLowerCase()} loans{search ? " match your search" : ""}</Text>
              {tab === "All" && !search && permissions.addLoan && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/modals/add-loan")}>
                  <Text style={styles.emptyBtnText}>Apply for Loan →</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.rowList}>
              {paginatedLoans.map((loan, i) => (
                <React.Fragment key={loan.id}>
                  <LoanRow
                    loan={loan}
                    member={getMember(loan.memberId)}
                    onPress={() => { setSelectedLoan(loan); setShowLoanDetail(true); }}
                  />
                  {i < paginatedLoans.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </View>
          )}

          {totalPages > 1 && (
            <View style={styles.pagination}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              >
                <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>Prev</Text>
              </TouchableOpacity>
              <Text style={styles.pageLabel}>Page {page} of {totalPages}</Text>
              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
              >
                <Text style={[styles.pageBtnText, page >= totalPages && styles.pageBtnTextDisabled]}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>


      {/* Approval Modal with Steps Visual */}
      <BottomModal
        visible={showApprovalModal}
        onClose={() => { setShowApprovalModal(false); setPendingAction(null); setSelectedLoan(null); }}
        title="Loan Approval"
      >
        <View style={{ padding: 16 }}>
          {selectedLoan && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>
                  {getMember(selectedLoan.memberId)?.fullName ?? "Unknown"}
                </Text>
                <Text style={styles.modalAmount}>{fmtCurrency(selectedLoan.amount)}</Text>
                <Text style={styles.modalDetail}>
                  Total Repayable: {fmtCurrency(selectedLoan.totalRepayable)} (inc. interest)
                </Text>
                {selectedLoan.purpose && (
                  <Text style={styles.modalPurpose}>{selectedLoan.purpose}</Text>
                )}
              </View>

              {/* Approval Steps Visual */}
              <View style={styles.stepsContainer}>
                <Text style={styles.stepsTitle}>Approval Progress</Text>
                <View style={styles.stepsRow}>
                  {APPROVAL_STEPS.map((step, index) => {
                    const currentStepIndex = getApprovalStepIndex(selectedLoan.status);
                    const isCompleted = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isPending = index > currentStepIndex;
                    
                    return (
                      <View key={step.key} style={styles.stepItem}>
                        <View style={[
                          styles.stepCircle,
                          isCompleted && styles.stepCompleted,
                          isCurrent && styles.stepCurrent,
                          isPending && styles.stepPending,
                        ]}>
                          <Text style={[
                            styles.stepIcon,
                            isCompleted && styles.stepIconCompleted,
                            isCurrent && styles.stepIconCurrent,
                          ]}>
                            {isCompleted ? "✓" : step.icon}
                          </Text>
                        </View>
                        <Text style={[
                          styles.stepLabel,
                          isCompleted && styles.stepLabelCompleted,
                          isCurrent && styles.stepLabelCurrent,
                        ]}>
                          {step.label}
                        </Text>
                        {index < APPROVAL_STEPS.length - 1 && (
                          <View style={[
                            styles.stepLine,
                            isCompleted && styles.stepLineCompleted,
                          ]} />
                        )}
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.stepStatus}>
                  {selectedLoan.status === "pending_loan_officer" && "⏳ Awaiting Loan Officer review"}
                  {selectedLoan.status === "pending_committee" && "⏳ Awaiting Committee review"}
                  {selectedLoan.status === "approved" && "✅ Approved — awaiting disbursement"}
                  {selectedLoan.status === "disbursed" && "💰 Loan Disbursed"}
                  {selectedLoan.status === "rejected" && "❌ Loan Rejected"}
                </Text>
              </View>
            </>
          )}
          <Input
            label="Comment (optional)"
            value={approvalComment}
            onChangeText={setApprovalComment}
            placeholder={pendingAction?.approve ? "Add approval conditions…" : "Reason for rejection…"}
            multiline
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Button
              label="Cancel"
              onPress={() => { setShowApprovalModal(false); setPendingAction(null); setSelectedLoan(null); }}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              label={pendingAction?.approve ? "Confirm Approval" : "Confirm Rejection"}
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
        onClose={() => { setShowScheduleModal(false); setSelectedLoan(null); }}
        title="Payment Schedule"
      >
        <View style={{ padding: 16 }}>
          {selectedLoan && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>
                  {getMember(selectedLoan.memberId)?.fullName ?? "Unknown"}
                </Text>
                <Text style={styles.modalAmount}>{fmtCurrency(selectedLoan.amount)}</Text>
                <Text style={styles.modalDetail}>
                  {selectedLoan.interestRate}% interest · {fmtCurrency(selectedLoan.totalInterest)} total interest
                </Text>
                <Text style={styles.modalDetail}>
                  Monthly: {fmtCurrency(selectedLoan.monthlyPayment)} × {selectedLoan.repaymentMonths} months
                </Text>
              </View>

              <ScrollView style={{ maxHeight: 350, marginBottom: 16 }} showsVerticalScrollIndicator={false}>
                {selectedLoan.schedule && selectedLoan.schedule.length > 0 ? (
                  selectedLoan.schedule.map((item) => (
                    <View key={item.index} style={styles.scheduleItem}>
                      <View style={styles.scheduleHeader}>
                        <Text style={styles.scheduleMonth}>Month {item.index + 1}</Text>
                        <Text style={styles.scheduleDate}>{fmtDate(item.dueDate)}</Text>
                      </View>
                      <View style={styles.scheduleRow}>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>Principal</Text>
                          <Text style={styles.scheduleCellValue}>{fmtCurrency(item.principal)}</Text>
                        </View>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>Interest</Text>
                          <Text style={styles.scheduleCellValue}>{fmtCurrency(item.interest)}</Text>
                        </View>
                        <View style={styles.scheduleCell}>
                          <Text style={styles.scheduleCellLabel}>Total</Text>
                          <Text style={[styles.scheduleCellValue, { color: C.primary, fontWeight: "800" }]}>
                            {fmtCurrency(item.total)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.scheduleEmpty}>No schedule available yet</Text>
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

      {/* Loan Detail Modal */}
      <LoanDetailModal
        visible={showLoanDetail}
        loan={selectedLoan}
        member={selectedLoan ? getMember(selectedLoan.memberId) : null}
        walletTxs={walletTxs}
        actableStep={selectedLoan ? getActableStep(selectedLoan.status, role) : null}
        onClose={() => { setShowLoanDetail(false); setSelectedLoan(null); }}
        onSchedule={() => {
          if (selectedLoan) {
            setShowScheduleModal(true);
          }
        }}
        onRepayment={() => {
          if (selectedLoan) {
            setShowLoanDetail(false);
            router.push({ pathname: "/modals/record-repayment", params: { loanId: selectedLoan.id } });
          }
        }}
        onDisburse={() => {
          if (selectedLoan) {
            handleDisburse(selectedLoan.id);
          }
        }}
        onApprove={() => {
          if (selectedLoan) {
            const step = getActableStep(selectedLoan.status, role);
            if (step) {
              setPendingAction({ loanId: selectedLoan.id, step, approve: true });
              setShowApprovalModal(true);
              setShowLoanDetail(false);
            }
          }
        }}
        onReject={() => {
          if (selectedLoan) {
            const step = getActableStep(selectedLoan.status, role);
            if (step) {
              setPendingAction({ loanId: selectedLoan.id, step, approve: false });
              setShowApprovalModal(true);
              setShowLoanDetail(false);
            }
          }
        }}
        onDelete={selectedLoan ? () => handleDeleteLoan(selectedLoan) : undefined}
        onEditResubmit={
          selectedLoan && selectedLoan.status === "rejected" && (selectedLoan.memberId === currentMember?.id || isAdmin)
            ? () => router.push({
                pathname: "/modals/add-loan",
                params: {
                  editLoanId: selectedLoan.id,
                  prefillAmount: String(selectedLoan.amount),
                  prefillPurpose: selectedLoan.purpose ?? "",
                  prefillMonths: String(selectedLoan.repaymentMonths ?? 6),
                  prefillMemberId: selectedLoan.memberId,
                },
              })
            : undefined
        }
        isAdmin={isAdmin}
        isPending={selectedLoan ? PENDING_STATUSES.includes(selectedLoan.status) : false}
        canDisburse={canDisburseRole(role)}
      />

      <Toast />
    </View>
  );
}

// ── Compact loan list row — summary only. Tapping anywhere on the row
//    opens LoanDetailModal, where every action (approve, reject,
//    disburse, repayment, schedule, delete, edit & resubmit) lives.
//    Nothing acts directly from this row anymore. ──────────────────────
function LoanRow({ loan, member, onPress }: { loan: Loan; member: any; onPress: () => void }) {
  const statusColor = STATUS_COLOR[loan.status] || C.infoText;
  const statusBg = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;
  const pct = loan.status === "repaid"
    ? 100
    : loan.totalRepayable > 0
      ? Math.min(100, (loan.amountRepaid / loan.totalRepayable) * 100)
      : 0;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowAvatar}>
        <Text style={styles.rowAvatarText}>
          {(member?.fullName ?? "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowMid}>
        <Text style={styles.rowTitle} numberOfLines={1}>{member?.fullName ?? "Unknown"}</Text>
        <Text style={styles.rowMeta}>
          {fmtDate(loan.applicationDate)}
          {["disbursed", "repaid"].includes(loan.status) ? ` · ${pct.toFixed(0)}% repaid` : ""}
        </Text>
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

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14,
    backgroundColor: C.bg,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    color: C.text3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.5,
    marginTop: 1,
  },
  addBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Dark wallet-style summary card ──────────────────────────────
  balanceCard: {
    margin: 16, borderRadius: 20, backgroundColor: C.card,
    padding: 24, overflow: "hidden",
  },
  cardAccentDot: {
    position: "absolute", top: -50, right: -30,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(26,86,219,0.15)",
  },
  balanceLabel: {
    fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.45)",
    letterSpacing: 1.2, textTransform: "uppercase",
  },
  balanceAmount: { fontSize: 34, fontWeight: "800", color: "#fff", letterSpacing: -1.2, marginTop: 6 },
  balanceCurrency: { fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.45)" },
  balancePills: {
    flexDirection: "row", marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)",
  },
  balancePill: { flex: 1, alignItems: "center" },
  balancePillLabel: {
    fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.8, textTransform: "uppercase",
  },
  balancePillValue: { fontSize: 12, fontWeight: "700", marginTop: 3 },
  balancePillDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  pendingBadgeRow: { marginTop: 14, alignItems: "flex-start" },
  pendingBadge: {
    backgroundColor: "rgba(251,191,36,0.2)", borderRadius: 20,
    paddingVertical: 5, paddingHorizontal: 12,
    borderWidth: 1, borderColor: "rgba(251,191,36,0.3)",
  },
  pendingBadgeText: { fontSize: 11, fontWeight: "700", color: "#FCD34D" },

  // ── Sub-tabs row with inline add buttons ─────────────────────────
  subTabRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, marginBottom: 8,
  },
  subTabGroup: { flexDirection: "row", gap: 8 },
  subTab: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
  },
  subTabActive: { backgroundColor: C.primary, borderColor: C.primary },
  subTabText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  subTabTextActive: { color: "#fff" },
  addInlineBtn: {
    backgroundColor: C.primary, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14,
  },
  addInlineBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  tabWrapper: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },

  listContainer: {
    paddingHorizontal: 16,
  },

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
  loanAvatarText: {
    fontSize: 14,
    fontWeight: "800",
    color: C.primary,
  },
  loanMember: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
  },
  loanDate: {
    fontSize: 11,
    color: C.text3,
    marginTop: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
  },
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
  amountItem: {
    flex: 1,
    alignItems: "center",
  },
  amountLabel: {
    fontSize: 10,
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
  },
  amountDivider: {
    width: 1,
    backgroundColor: C.borderLight,
  },

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
  progressLabel: {
    fontSize: 11,
    color: C.text3,
  },
  progressPercent: {
    fontSize: 11,
    fontWeight: "700",
    color: C.accent,
  },
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
  progressSub: {
    fontSize: 10,
    color: C.text3,
    marginTop: 6,
  },

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
  approveBtnText: {
    color: C.success,
    fontSize: 12,
    fontWeight: "700",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  rejectBtnText: {
    color: C.error,
    fontSize: 12,
    fontWeight: "700",
  },
  disburseBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  disburseBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  scheduleBtn: {
    flex: 1,
    backgroundColor: C.tealBg,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.3)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  scheduleBtnText: {
    color: C.teal,
    fontSize: 12,
    fontWeight: "700",
  },
  repayBtn: {
    flex: 1,
    backgroundColor: C.pill,
    borderWidth: 1,
    borderColor: "rgba(26,60,94,0.2)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  repayBtnText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  deleteBtnText: {
    color: C.error,
    fontSize: 12,
    fontWeight: "700",
  },
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
  rejectionText: {
    fontSize: 12,
    color: C.text2,
    lineHeight: 18,
  },
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
  editResubmitBtnText: {
    color: C.gold,
    fontSize: 13,
    fontWeight: "700",
  },

  modalInfo: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: "center",
  },
  modalMember: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
  },
  modalAmount: {
    fontSize: 20,
    fontWeight: "800",
    color: C.primary,
    marginTop: 4,
  },
  modalDetail: {
    fontSize: 12,
    color: C.text3,
    marginTop: 4,
  },
  modalPurpose: {
    fontSize: 12,
    color: C.text2,
    marginTop: 6,
    fontStyle: "italic",
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
  stepItem: {
    alignItems: "center",
    flex: 1,
    position: "relative",
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    backgroundColor: C.surface,
  },
  stepCompleted: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  stepCurrent: {
    borderColor: C.gold,
    borderWidth: 3,
    backgroundColor: C.goldBg,
  },
  stepPending: {
    borderColor: C.border,
    backgroundColor: C.bg,
  },
  stepIcon: {
    fontSize: 14,
    color: C.text3,
  },
  stepIconCompleted: {
    color: "#fff",
  },
  stepIconCurrent: {
    color: C.gold,
  },
  stepLabel: {
    fontSize: 9,
    marginTop: 4,
    textAlign: "center",
    color: C.primary,
  },
  stepLabelCompleted: {
    color: C.success,
    fontWeight: "700",
  },
  stepLabelCurrent: {
    color: C.gold,
    fontWeight: "700",
  },
  stepLine: {
    position: "absolute",
    top: 18,
    left: "50%",
    right: "-50%",
    height: 2,
    backgroundColor: C.border,
    zIndex: -1,
  },
  stepLineCompleted: {
    backgroundColor: C.success,
  },
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
  scheduleMonth: {
    fontSize: 12,
    fontWeight: "700",
    color: C.text,
  },
  scheduleDate: {
    fontSize: 11,
    color: C.text3,
  },
  scheduleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  scheduleCell: {
    flex: 1,
    alignItems: "center",
  },
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
  },
  scheduleEmpty: {
    fontSize: 12,
    color: C.text3,
    textAlign: "center",
    paddingVertical: 20,
  },

  chip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  chipText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.5,
  },
  emptyBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: C.primary,
    borderRadius: 20,
  },
  emptyBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  divider: {
    width: '100%',
    height: 1,
    backgroundColor: C.borderLight,
    marginVertical: 8,
  },

  profitPreview: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.elevated,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  profitLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
  },
  profitAmount: {
    fontSize: 16,
    fontWeight: "700",
  },

  // ── New styles for the wallet-matching controls + compact row list ──
  controlsBlock: { paddingHorizontal: 16, gap: 10, marginTop: 12 },
  controlsTop: { flexDirection: "row", gap: 8, alignItems: "center" },
  sortRow: { flexDirection: "row", gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: C.mutedBg },
  sortChipActive: { backgroundColor: C.primary },
  sortChipText: { fontSize: 12, fontWeight: "600", color: C.text3 },
  sortChipTextActive: { color: "#fff" },

  rowList: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  rowAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.mutedBg,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  rowAvatarText: { fontSize: 12, fontWeight: "700", color: C.text2 },
  rowMid: { flex: 1, marginRight: 10 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: C.text },
  rowMeta: { fontSize: 12, color: C.text3, marginTop: 2 },
  rowAmount: { fontSize: 14, fontWeight: "800", color: C.text },

  pagination: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16,
    paddingVertical: 20,
  },
  pageBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: C.mutedBg },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontSize: 13, fontWeight: "700", color: C.text },
  pageBtnTextDisabled: { color: C.text3 },
  pageLabel: { fontSize: 13, color: C.text3, fontWeight: "600" },
});