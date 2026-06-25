// app/(tabs)/loans.tsx - Updated with delete investment button

import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, StatusBar } from "react-native";
import { useRouter } from "expo-router";
import {
  useStore, useGroupLoans, useGroupMembers,
  useCurrentUserRole, useCurrentMember,
} from "../../stores/useStore";
import { useGroupInvestments, useCurrentMemberPermissions } from "../../stores/selectors";
import {
  TabRow, Card, Badge, Empty, LoanProgress,
  useToast, Button, BottomModal, Input,
} from "../../components/ui";
import { S, R, Colors, C, T, fmtCurrency, fmtDate, round2, showConfirm } from "../../utils/theme";
import { exportPdf, generatePaymentScheduleHtml } from "../../utils/export";
import type { Loan, Investment } from "../../types";

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
  approved:             "Approved",
  disbursed:            "Active",
  repaid:               "Repaid",
  rejected:             "Rejected",
  defaulted:            "Defaulted",
};

const INVESTMENT_STATUS_LABEL: Record<string, string> = {
  pending_committee: "Awaiting Committee",
  pending: "Awaiting Accountant",
  open: "Active",
  closed: "Closed",
  matured: "Matured",
};

const INVESTMENT_STATUS_COLOR: Record<string, string> = {
  pending_committee: C.gold,
  pending: C.info,
  open: C.success,
  closed: C.text3,
  matured: C.gold,
};

const INVESTMENT_STATUS_BG: Record<string, string> = {
  pending_committee: C.goldBg,
  pending: C.infoBg,
  open: C.greenBg,
  closed: C.mutedBg,
  matured: C.goldBg,
};

const INVESTMENT_PENDING_STATUSES = ["pending_committee", "pending"];

const PENDING_STATUSES = [
  "pending_loan_officer",
  "pending_committee",
  "pending_accountant",
];

const APPROVAL_STEPS = [
  { key: "pending_loan_officer", label: "Loan Officer", icon: "👤" },
  { key: "pending_committee", label: "Committee", icon: "📋" },
  { key: "pending_accountant", label: "Accountant", icon: "💰" },
];

function getActableStep(loanStatus: string, role: string): string | null {
  if (role === "admin") {
    if (loanStatus === "pending_loan_officer") return "loan_officer";
    if (loanStatus === "pending_committee")    return "committee";
    if (loanStatus === "pending_accountant")   return "accountant";
  }
  if (role === "loan_officer" && loanStatus === "pending_loan_officer") return "loan_officer";
  if (role === "committee"    && loanStatus === "pending_committee")    return "committee";
  if (role === "accountant"   && loanStatus === "pending_accountant")   return "accountant";
  return null;
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
  onClose,
  onSchedule,
  onRepayment,
  onDisburse,
  onApprove,
  onReject,
  isAdmin,
  isPending,
}: {
  visible: boolean;
  loan: Loan | null;
  member: any;
  onClose: () => void;
  onSchedule: () => void;
  onRepayment: () => void;
  onDisburse: () => void;
  onApprove: () => void;
  onReject: () => void;
  isAdmin: boolean;
  isPending: boolean;
}) {
  if (!loan) return null;
  
  const pct = loan.totalRepayable > 0 ? round2((loan.amountRepaid / loan.totalRepayable) * 100) : 0;
  const statusColor = STATUS_COLOR[loan.status] || loan.status === "rejected" ? C.error : C.infoText;
  const statusBg = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;
  
  return (
    <BottomModal visible={visible} onClose={onClose} title="Loan Details">
      <ScrollView style={{ padding: 16, maxHeight: 500 }} showsVerticalScrollIndicator={false}>
        <View style={styles.modalInfo}>
          <Text style={styles.modalMember}>{member?.fullName ?? "Unknown"}</Text>
          <Text style={styles.modalAmount}>{fmtCurrency(loan.amount)}</Text>
          <Text style={styles.modalDetail}>
            Interest: {loan.interestRate}% · {loan.repaymentMonths} months
          </Text>
          <Text style={styles.modalDetail}>
            Total Repayable: {fmtCurrency(loan.totalRepayable)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusBg, alignSelf: 'center', marginTop: 4 }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        
        {loan.purpose && (
          <View style={styles.modalInfo}>
            <Text style={styles.modalDetail}>Purpose:</Text>
            <Text style={[styles.modalPurpose, { textAlign: 'center' }]}>
              {loan.purpose}
            </Text>
          </View>
        )}
        
        <View style={styles.modalInfo}>
          <Text style={styles.modalDetail}>Amount Repaid: {fmtCurrency(loan.amountRepaid)}</Text>
          <Text style={styles.modalDetail}>Balance: {fmtCurrency(loan.balance)}</Text>
          <Text style={styles.modalDetail}>Late Fees: {fmtCurrency(loan.lateFees || 0)}</Text>
          <Text style={styles.modalDetail}>Progress: {pct.toFixed(0)}% complete</Text>
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
          {loan.status === "approved" && isAdmin && (
            <TouchableOpacity style={[styles.disburseBtn, { flex: 1 }]} onPress={onDisburse}>
              <Text style={styles.disburseBtnText}>Disburse</Text>
            </TouchableOpacity>
          )}
          {isPending && (
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
        
        <Button label="Close" onPress={onClose} fullWidth variant="secondary" style={{ marginTop: 12 }} />
      </ScrollView>
    </BottomModal>
  );
}

export default function LoansScreen() {
  const router = useRouter();
  const { 
    approveLoanStep, 
    disburseLoan, 
    rejectLoan, 
    deleteLoan,
    closeInvestment,
    deleteInvestment,
    approveInvestmentStep,
  } = useStore();
  const allLoans = useGroupLoans();
  const investments = useGroupInvestments();
  const groupMembers = useGroupMembers();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const permissions = useCurrentMemberPermissions();
  const { show, Toast } = useToast();

  const [tab, setTab] = useState("All");
  const [activeSubTab, setActiveSubTab] = useState<"loans" | "investments">("loans");
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [selectedInvestment, setSelectedInvestment] = useState<Investment | null>(null);
  const [approvalComment, setApprovalComment] = useState("");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showInvestmentDetail, setShowInvestmentDetail] = useState(false);
  const [showCloseInvestmentModal, setShowCloseInvestmentModal] = useState(false);
  const [showLoanDetail, setShowLoanDetail] = useState(false);
  const [closeReturnAmount, setCloseReturnAmount] = useState("");
  const [closeActualReturn, setCloseActualReturn] = useState("");
  const [closingInvestment, setClosingInvestment] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    loanId: string; step: string; approve: boolean;
  } | null>(null);
  // Investment approval state
  const [showInvApprovalModal, setShowInvApprovalModal] = useState(false);
  const [invApprovalComment, setInvApprovalComment] = useState("");
  const [pendingInvAction, setPendingInvAction] = useState<{
    investmentId: string; step: "committee" | "accountant"; approve: boolean;
  } | null>(null);

  const canSeeAll = ["admin", "loan_officer", "committee", "accountant"].includes(role);
  const isAdmin = role === "admin";

  const getMember = (id: string) => groupMembers.find((m) => m.id === id);

  const visibleLoans = useMemo(() => {
    if (canSeeAll) return allLoans;
    return allLoans.filter((l) => l.memberId === currentMember?.id);
  }, [allLoans, canSeeAll, currentMember]);

  const visibleInvestments = useMemo(() => {
    if (canSeeAll) return investments;
    return investments.filter((i) => i.createdBy === currentMember?.id);
  }, [investments, canSeeAll, currentMember]);

  const filteredLoans = useMemo(() => {
    const list = visibleLoans;
    if (tab === "Pending")  return list.filter((l) => PENDING_STATUSES.includes(l.status));
    if (tab === "Active")   return list.filter((l) => l.status === "disbursed");
    if (tab === "Repaid")   return list.filter((l) => l.status === "repaid");
    if (tab === "Rejected") return list.filter((l) => ["rejected", "defaulted"].includes(l.status));
    return list;
  }, [visibleLoans, tab]);

  const filteredInvestments = useMemo(() => {
    const list = visibleInvestments;
    if (tab === "Active")   return list.filter((i) => i.status === "open");
    if (tab === "Closed")   return list.filter((i) => i.status === "closed");
    if (tab === "Matured")  return list.filter((i) => i.status === "matured");
    if (tab === "Pending")  return list.filter((i) => INVESTMENT_PENDING_STATUSES.includes(i.status));
    return list;
  }, [visibleInvestments, tab]);

  const outstanding = useMemo(() => allLoans.filter((l) => l.status === "disbursed").reduce((s, l) => s + l.balance, 0), [allLoans]);
  const totalRepaid = useMemo(() => allLoans.reduce((s, l) => s + l.amountRepaid, 0), [allLoans]);
  const totalDisbursed = useMemo(() => allLoans.filter((l) => ["disbursed", "repaid"].includes(l.status)).reduce((s, l) => s + l.amount, 0), [allLoans]);
  const pendingCount = useMemo(() => allLoans.filter((l) => PENDING_STATUSES.includes(l.status)).length, [allLoans]);
  const totalInvested = useMemo(() => investments.reduce((s, i) => s + i.investmentAmount, 0), [investments]);
  const totalReturns = useMemo(() => investments.reduce((s, i) => s + (i.actualReturn || 0), 0), [investments]);

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

  const handleInvestmentApproval = async () => {
    if (!pendingInvAction) return;
    try {
      await approveInvestmentStep(
        pendingInvAction.investmentId,
        pendingInvAction.step,
        pendingInvAction.approve,
        invApprovalComment || undefined,
      );
      show(
        pendingInvAction.approve
          ? pendingInvAction.step === "committee" ? "Forwarded to accountant" : "Investment approved & activated"
          : "Investment rejected",
        pendingInvAction.approve ? "success" : "error",
      );
      setShowInvestmentDetail(false);
    } catch (e: any) {
      show(e.message || "Action failed", "error");
    } finally {
      setShowInvApprovalModal(false);
      setInvApprovalComment("");
      setPendingInvAction(null);
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

  // ─── Delete Investment Function ──────────────────────────────────────
  const handleDeleteInvestment = (investment: Investment) => {
    showConfirm(
      "Delete Investment",
      `Are you sure you want to delete "${investment.investmentName}"?\n\nInvestment Amount: ${fmtCurrency(investment.investmentAmount)}\nStatus: ${INVESTMENT_STATUS_LABEL[investment.status] || investment.status}\n\n⚠️ This action cannot be undone!`,
      async () => {
        try {
          // Call the deleteInvestment function from the store
          await deleteInvestment(investment.id, "Deleted by admin");
          show("Investment deleted successfully ✅", "success");
          // Close any open modals
          setShowInvestmentDetail(false);
          setShowCloseInvestmentModal(false);
          setSelectedInvestment(null);
        } catch (error: any) {
          show(error.message || "Failed to delete investment", "error");
        }
      },
      undefined,
      true
    );
  };

  const handleCloseInvestment = async () => {
    if (!selectedInvestment) return;
    
    const returnAmount = parseFloat(closeReturnAmount);
    if (!returnAmount || returnAmount <= 0) {
      show("Enter a valid return amount", "error");
      return;
    }
    
    let actualReturn: number | undefined;
    if (closeActualReturn && closeActualReturn.trim() !== "") {
      const parsed = parseFloat(closeActualReturn);
      if (!isNaN(parsed)) {
        actualReturn = parsed;
      }
    }
    
    setClosingInvestment(true);
    try {
      await closeInvestment(selectedInvestment.id, returnAmount, actualReturn);
      show(`Investment closed! Return: ${fmtCurrency(returnAmount)}`, "success");
      setShowCloseInvestmentModal(false);
      setSelectedInvestment(null);
      setCloseReturnAmount("");
      setCloseActualReturn("");
      setShowInvestmentDetail(false);
    } catch (error: any) {
      show(error.message || "Failed to close investment", "error");
    } finally {
      setClosingInvestment(false);
    }
  };

  const LOAN_TABS = canSeeAll ? ["All", "Pending", "Active", "Repaid", "Rejected"] : ["All", "Active", "Repaid"];
  const INVEST_TABS = canSeeAll ? ["All", "Pending", "Active", "Matured", "Closed"] : ["All", "Active", "Matured", "Closed"];

  const getFilteredItems = () => {
    if (activeSubTab === "investments") {
      return filteredInvestments;
    }
    return filteredLoans;
  };

  const renderInvestmentCard = (investment: Investment) => {
    const statusLabel = INVESTMENT_STATUS_LABEL[investment.status] || investment.status;
    const statusColor = INVESTMENT_STATUS_COLOR[investment.status] || C.text3;
    const statusBg = INVESTMENT_STATUS_BG[investment.status] || C.mutedBg;
    const roi = investment.expectedReturn && investment.investmentAmount
      ? round2(((investment.expectedReturn - investment.investmentAmount) / investment.investmentAmount) * 100)
      : null;
    
    // Calculate actual ROI if investment is closed
    let actualRoi: number | null = null;
    let profitLoss: number | null = null;
    if (investment.status === "closed" && investment.returnAmount !== undefined) {
      profitLoss = round2(investment.returnAmount - investment.investmentAmount);
      actualRoi = investment.investmentAmount > 0 
        ? round2((profitLoss / investment.investmentAmount) * 100) 
        : null;
    }

    return (
      <View key={investment.id} style={styles.loanCard}>
        <View style={styles.loanHeader}>
          <View style={[styles.loanAvatar, { backgroundColor: C.goldBg }]}>
            <Text style={[styles.loanAvatarText, { color: C.gold }]}>📊</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.loanMember}>{investment.investmentName}</Text>
            <Text style={styles.loanDate}>
              {investment.investmentType.replace('_', ' ')} · {fmtDate(investment.startDate)}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.amountsRow}>
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Invested</Text>
            <Text style={styles.amountValue}>{fmtCurrency(investment.investmentAmount)}</Text>
          </View>
          <View style={styles.amountDivider} />
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>Expected Return</Text>
            <Text style={styles.amountValue}>{fmtCurrency(investment.expectedReturn || 0)}</Text>
          </View>
          <View style={styles.amountDivider} />
          <View style={styles.amountItem}>
            <Text style={styles.amountLabel}>ROI</Text>
            <Text style={[styles.amountValue, { color: roi && roi > 0 ? C.success : C.text3 }]}>
              {roi !== null ? `${roi > 0 ? '+' : ''}${roi}%` : '—'}
            </Text>
          </View>
        </View>

        {/* Show actual return for closed investments */}
        {investment.status === "closed" && investment.returnAmount !== undefined && (
          <View style={styles.actualReturnRow}>
            <View style={[styles.amountItem, { borderRightWidth: 1, borderRightColor: C.borderLight }]}>
              <Text style={styles.amountLabel}>Actual Return</Text>
              <Text style={[styles.amountValue, { color: C.primary }]}>
                {fmtCurrency(investment.returnAmount)}
              </Text>
            </View>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Profit/Loss</Text>
              <Text style={[
                styles.amountValue, 
                { color: profitLoss !== null && profitLoss >= 0 ? C.success : C.error }
              ]}>
                {profitLoss !== null ? fmtCurrency(profitLoss) : '—'}
              </Text>
            </View>
            <View style={styles.amountItem}>
              <Text style={styles.amountLabel}>Actual ROI</Text>
              <Text style={[
                styles.amountValue, 
                { color: actualRoi !== null && actualRoi >= 0 ? C.success : C.error }
              ]}>
                {actualRoi !== null ? `${actualRoi > 0 ? '+' : ''}${actualRoi}%` : '—'}
              </Text>
            </View>
          </View>
        )}

        {investment.description && (
          <Text style={styles.purpose} numberOfLines={2}>
            📝 {investment.description}
          </Text>
        )}

        {investment.representativeName && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text style={{ fontSize: 11, color: C.pillText }}>
              Rep: {investment.representativeName} {investment.representativeRole ? `· ${investment.representativeRole}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity 
            style={[styles.repayBtn, { flex: 1 }]} 
            onPress={() => {
              setSelectedInvestment(investment);
              setShowInvestmentDetail(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.repayBtnText}>View Details</Text>
          </TouchableOpacity>
          
          {/* Pending committee approval */}
          {isAdmin && investment.status === "pending_committee" && (
            <>
              <TouchableOpacity
                style={[styles.disburseBtn, { flex: 1 }]}
                onPress={() => { setPendingInvAction({ investmentId: investment.id, step: "committee", approve: true }); setShowInvApprovalModal(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.disburseBtnText}>✓ Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, { flex: 0.8 }]}
                onPress={() => { setPendingInvAction({ investmentId: investment.id, step: "committee", approve: false }); setShowInvApprovalModal(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.deleteBtnText}>✗ Reject</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Pending accountant approval */}
          {isAdmin && investment.status === "pending" && (
            <>
              <TouchableOpacity
                style={[styles.disburseBtn, { flex: 1 }]}
                onPress={() => { setPendingInvAction({ investmentId: investment.id, step: "accountant", approve: true }); setShowInvApprovalModal(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.disburseBtnText}>✓ Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, { flex: 0.8 }]}
                onPress={() => { setPendingInvAction({ investmentId: investment.id, step: "accountant", approve: false }); setShowInvApprovalModal(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.deleteBtnText}>✗ Reject</Text>
              </TouchableOpacity>
            </>
          )}

          {isAdmin && investment.status === "open" && (
            <TouchableOpacity 
              style={[styles.disburseBtn, { flex: 1 }]} 
              onPress={() => {
                setSelectedInvestment(investment);
                setCloseReturnAmount(String(investment.investmentAmount));
                setCloseActualReturn("");
                setShowCloseInvestmentModal(true);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.disburseBtnText}>Close</Text>
            </TouchableOpacity>
          )}
          
          {/* ─── DELETE INVESTMENT BUTTON ─── */}
          {isAdmin && (investment.status === "open" || investment.status === "pending" || investment.status === "pending_committee" || investment.status === "closed") && (
            <TouchableOpacity 
              style={[styles.deleteBtn, { flex: 0.7 }]} 
              onPress={() => handleDeleteInvestment(investment)}
              activeOpacity={0.8}
            >
              <Text style={styles.deleteBtnText}>🗑 Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const TABS = activeSubTab === "loans" ? LOAN_TABS : INVEST_TABS;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>Manage</Text>
          <Text style={styles.headerTitle}>Loans & Investments</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card — dark navy, matching wallet */}
        {canSeeAll && (
          <View style={styles.balanceCard}>
            <View style={styles.cardAccentDot} />
            <Text style={styles.balanceLabel}>PORTFOLIO OVERVIEW</Text>
            <Text style={styles.balanceAmount}>
              <Text style={styles.balanceCurrency}>RWF </Text>
              {Math.round(totalDisbursed).toLocaleString()}
            </Text>
            <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>total loans disbursed</Text>

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
                <Text style={styles.balancePillLabel}>INVESTED</Text>
                <Text style={[styles.balancePillValue, { color: C.gold }]}>{fmtCurrency(totalInvested)}</Text>
              </View>
              <View style={styles.balancePillDivider} />
              <View style={styles.balancePill}>
                <Text style={styles.balancePillLabel}>RETURNS</Text>
                <Text style={[styles.balancePillValue, { color: "#34D399" }]}>{fmtCurrency(totalReturns)}</Text>
              </View>
            </View>

            {pendingCount > 0 && (
              <View style={styles.pendingBadgeRow}>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>⏳ {pendingCount} pending approval{pendingCount > 1 ? "s" : ""}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Sub Tabs + Add buttons inline */}
        <View style={styles.subTabRow}>
          <View style={styles.subTabGroup}>
            <TouchableOpacity
              style={[styles.subTab, activeSubTab === "loans" && styles.subTabActive]}
              onPress={() => { setActiveSubTab("loans"); setTab("All"); }}
            >
              <Text style={[styles.subTabText, activeSubTab === "loans" && styles.subTabTextActive]}>
                💰 Loans
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subTab, activeSubTab === "investments" && styles.subTabActive]}
              onPress={() => { setActiveSubTab("investments"); setTab("All"); }}
            >
              <Text style={[styles.subTabText, activeSubTab === "investments" && styles.subTabTextActive]}>
                📊 Investments
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            {activeSubTab === "loans" && permissions.addLoan && (
              <TouchableOpacity
                style={styles.addInlineBtn}
                onPress={() => router.push("/modals/add-loan")}
                activeOpacity={0.8}
              >
                <Text style={styles.addInlineBtnText}>+ Loan</Text>
              </TouchableOpacity>
            )}
            {activeSubTab === "investments" && permissions.addInvestment && (
              <TouchableOpacity
                style={[styles.addInlineBtn, { backgroundColor: C.gold }]}
                onPress={() => router.push("/modals/add-investment")}
                activeOpacity={0.8}
              >
                <Text style={styles.addInlineBtnText}>+ Invest</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filter tabs */}
        <View style={styles.tabWrapper}>
          <TabRow tabs={TABS} active={tab} onChange={setTab} />
        </View>

        {/* Items List */}
        <View style={styles.listContainer}>
          {getFilteredItems().length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={T.body}>No {tab.toLowerCase()} {activeSubTab === "loans" ? "loans" : "investments"}</Text>
              {tab === "All" && activeSubTab === "loans" && permissions.addLoan && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/modals/add-loan")}>
                  <Text style={styles.emptyBtnText}>Apply for Loan →</Text>
                </TouchableOpacity>
              )}
              {tab === "All" && activeSubTab === "investments" && permissions.addInvestment && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/modals/add-investment")}>
                  <Text style={styles.emptyBtnText}>Add Investment →</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            getFilteredItems().map((item) => {
              if ('interestRate' in item) {
                // It's a loan
                const loan = item as Loan;
                const step = getActableStep(loan.status, role);
                const isPending = PENDING_STATUSES.includes(loan.status);
                return (
                  <LoanCard
                    key={loan.id}
                    loan={loan}
                    member={getMember(loan.memberId)}
                    actableStep={step}
                    isAdmin={isAdmin}
                    isPending={isPending}
                    onApprove={() => {
                      if (!step) return;
                      setPendingAction({ loanId: loan.id, step, approve: true });
                      setSelectedLoan(loan);
                      setShowApprovalModal(true);
                    }}
                    onReject={() => {
                      if (!step) return;
                      setPendingAction({ loanId: loan.id, step, approve: false });
                      setSelectedLoan(loan);
                      setShowApprovalModal(true);
                    }}
                    onDisburse={() => handleDisburse(loan.id)}
                    onDelete={() => handleDeleteLoan(loan)}
                    onRepayment={() =>
                      router.push({ pathname: "/modals/record-repayment", params: { loanId: loan.id } })
                    }
                    onSchedule={() => {
                      setSelectedLoan(loan);
                      setShowScheduleModal(true);
                    }}
                    onViewDetails={() => {
                      setSelectedLoan(loan);
                      setShowLoanDetail(true);
                    }}
                    onEditResubmit={
                      loan.status === "rejected" && (loan.memberId === currentMember?.id || isAdmin)
                        ? () => router.push({
                            pathname: "/modals/add-loan",
                            params: {
                              editLoanId: loan.id,
                              prefillAmount: String(loan.amount),
                              prefillPurpose: loan.purpose ?? "",
                              prefillMonths: String(loan.repaymentMonths ?? 6),
                              prefillMemberId: loan.memberId,
                            },
                          })
                        : undefined
                    }
                  />
                );
              } else {
                // It's an investment
                return renderInvestmentCard(item);
              }
            })
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
                  {selectedLoan.status === "pending_accountant" && "⏳ Awaiting Accountant review"}
                  {selectedLoan.status === "approved" && "✅ Loan Approved"}
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

      {/* Investment Detail Modal */}
      <BottomModal
        visible={showInvestmentDetail && !!selectedInvestment}
        onClose={() => { setShowInvestmentDetail(false); setSelectedInvestment(null); }}
        title="Investment Details"
      >
        <View style={{ padding: 16 }}>
          {selectedInvestment && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>{selectedInvestment.investmentName}</Text>
                <Text style={styles.modalAmount}>{fmtCurrency(selectedInvestment.investmentAmount)}</Text>
                <Text style={styles.modalDetail}>
                  Type: {selectedInvestment.investmentType.replace('_', ' ')}
                </Text>
                <Text style={styles.modalDetail}>
                  Expected Return: {fmtCurrency(selectedInvestment.expectedReturn || 0)}
                </Text>
                {selectedInvestment.expectedReturn && selectedInvestment.investmentAmount && (
                  <Text style={[styles.modalDetail, { color: C.gold }]}>
                    Expected ROI: {round2(((selectedInvestment.expectedReturn - selectedInvestment.investmentAmount) / selectedInvestment.investmentAmount) * 100)}%
                  </Text>
                )}
                <Text style={styles.modalDetail}>
                  Status: {INVESTMENT_STATUS_LABEL[selectedInvestment.status] || selectedInvestment.status}
                </Text>
                
                {/* Show actual return details if closed */}
                {selectedInvestment.status === "closed" && selectedInvestment.returnAmount !== undefined && (
                  <>
                    <View style={styles.divider} />
                    <Text style={[styles.modalDetail, { fontWeight: "700", color: C.text, marginTop: 8 }]}>
                      Actual Return: {fmtCurrency(selectedInvestment.returnAmount)}
                    </Text>
                    <Text style={[
                      styles.modalDetail, 
                      { 
                        fontWeight: "700", 
                        color: selectedInvestment.profit !== undefined && selectedInvestment.profit >= 0 
                          ? C.success 
                          : C.error 
                      }
                    ]}>
                      {selectedInvestment.profit !== undefined && selectedInvestment.profit >= 0 ? '📈' : '📉'} 
                      Profit/Loss: {selectedInvestment.profit !== undefined ? fmtCurrency(selectedInvestment.profit) : '—'}
                    </Text>
                    {selectedInvestment.actualReturn !== undefined && selectedInvestment.investmentAmount > 0 && (
                      <Text style={[
                        styles.modalDetail, 
                        { 
                          fontWeight: "700", 
                          color: selectedInvestment.actualReturn >= 0 ? C.success : C.error 
                        }
                      ]}>
                        Actual ROI: {selectedInvestment.actualReturn >= 0 ? '+' : ''}{selectedInvestment.actualReturn}%
                      </Text>
                    )}
                    {selectedInvestment.closedAt && (
                      <Text style={styles.modalDetail}>
                        Closed: {fmtDate(selectedInvestment.closedAt)}
                      </Text>
                    )}
                  </>
                )}
              </View>

              {selectedInvestment.description && (
                <View style={styles.modalInfo}>
                  <Text style={styles.modalDetail}>Description:</Text>
                  <Text style={[styles.modalPurpose, { textAlign: 'center' }]}>
                    {selectedInvestment.description}
                  </Text>
                </View>
              )}

              {(selectedInvestment.representativeName || selectedInvestment.representativeRole) && (
                <View style={styles.modalInfo}>
                  <Text style={styles.modalDetail}>Representative:</Text>
                  <Text style={[styles.modalPurpose, { textAlign: 'center' }]}>
                    {selectedInvestment.representativeName}
                    {selectedInvestment.representativeRole ? ` (${selectedInvestment.representativeRole})` : ''}
                  </Text>
                </View>
              )}

              {/* ─── DELETE INVESTMENT BUTTON IN DETAIL MODAL ─── */}
              {isAdmin && (selectedInvestment.status === "open" || selectedInvestment.status === "pending" || selectedInvestment.status === "matured") && (
                <TouchableOpacity 
                  style={[styles.deleteBtn, { marginBottom: 12 }]} 
                  onPress={() => {
                    setShowInvestmentDetail(false);
                    handleDeleteInvestment(selectedInvestment);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteBtnText}>🗑 Delete Investment</Text>
                </TouchableOpacity>
              )}

              <Button
                label="Close"
                onPress={() => { setShowInvestmentDetail(false); setSelectedInvestment(null); }}
                fullWidth
                variant="secondary"
              />
            </>
          )}
        </View>
      </BottomModal>

      {/* Close Investment Modal */}
      <BottomModal
        visible={showCloseInvestmentModal}
        onClose={() => { setShowCloseInvestmentModal(false); setSelectedInvestment(null); setCloseReturnAmount(""); setCloseActualReturn(""); }}
        title="Close Investment"
      >
        <View style={{ padding: 16 }}>
          {selectedInvestment && (
            <>
              <View style={styles.modalInfo}>
                <Text style={styles.modalMember}>{selectedInvestment.investmentName}</Text>
                <Text style={styles.modalAmount}>Invested: {fmtCurrency(selectedInvestment.investmentAmount)}</Text>
                <Text style={styles.modalDetail}>
                  Expected Return: {fmtCurrency(selectedInvestment.expectedReturn || 0)}
                </Text>
                {selectedInvestment.expectedReturn && selectedInvestment.investmentAmount && (
                  <Text style={[styles.modalDetail, { color: C.gold }]}>
                    Expected ROI: {round2(((selectedInvestment.expectedReturn - selectedInvestment.investmentAmount) / selectedInvestment.investmentAmount) * 100)}%
                  </Text>
                )}
              </View>

              <Input
                label="Total Return Amount *"
                value={closeReturnAmount}
                onChangeText={setCloseReturnAmount}
                keyboardType="numeric"
                placeholder="Enter total return amount"
                prefix="RWF"
              />
              
              <Input
                label="Actual Profit/Loss (Optional)"
                value={closeActualReturn}
                onChangeText={setCloseActualReturn}
                keyboardType="numeric"
                placeholder="Enter actual profit or loss"
                prefix="RWF"
                hint="Leave blank to use calculated profit/loss"
              />

              {closeReturnAmount && selectedInvestment.investmentAmount && (
                <View style={styles.profitPreview}>
                  <Text style={styles.profitLabel}>
                    {parseFloat(closeReturnAmount) >= selectedInvestment.investmentAmount ? '📈 Profit' : '📉 Loss'}
                  </Text>
                  <Text style={[
                    styles.profitAmount,
                    { color: parseFloat(closeReturnAmount) >= selectedInvestment.investmentAmount ? C.success : C.error }
                  ]}>
                    {fmtCurrency(Math.abs(parseFloat(closeReturnAmount) - selectedInvestment.investmentAmount))}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Button
                  label="Cancel"
                  onPress={() => { setShowCloseInvestmentModal(false); setSelectedInvestment(null); setCloseReturnAmount(""); setCloseActualReturn(""); }}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
                <Button
                  label="Close Investment"
                  onPress={handleCloseInvestment}
                  variant="primary"
                  style={{ flex: 1 }}
                  loading={closingInvestment}
                />
              </View>
            </>
          )}
        </View>
      </BottomModal>

      {/* Investment Approval Modal */}
      <BottomModal
        visible={showInvApprovalModal}
        onClose={() => { setShowInvApprovalModal(false); setInvApprovalComment(""); setPendingInvAction(null); }}
        title={pendingInvAction?.approve
          ? pendingInvAction.step === "committee" ? "Committee Approval" : "Accountant Approval"
          : "Reject Investment"}
      >
        <View style={{ padding: 16 }}>
          {pendingInvAction && (() => {
            const inv = investments.find(i => i.id === pendingInvAction.investmentId);
            if (!inv) return null;
            return (
              <>
                <View style={styles.modalInfo}>
                  <Text style={styles.modalMember}>{inv.investmentName}</Text>
                  <Text style={styles.modalAmount}>{fmtCurrency(inv.investmentAmount)}</Text>
                  <Text style={styles.modalDetail}>
                    {pendingInvAction.approve
                      ? pendingInvAction.step === "committee"
                        ? "Approve at committee level — will forward to accountant for final sign-off."
                        : "Final accountant approval — investment will become active and debit the group wallet."
                      : "Rejecting will close this investment request."}
                  </Text>
                </View>
                <Input
                  label={pendingInvAction.approve ? "Comment (Optional)" : "Reason for Rejection *"}
                  value={invApprovalComment}
                  onChangeText={setInvApprovalComment}
                  placeholder={pendingInvAction.approve ? "Add a note..." : "Explain why..."}
                  multiline
                />
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <Button
                    label="Cancel"
                    onPress={() => { setShowInvApprovalModal(false); setInvApprovalComment(""); setPendingInvAction(null); }}
                    variant="secondary"
                    style={{ flex: 1 }}
                  />
                  <Button
                    label={pendingInvAction.approve ? "Approve" : "Reject"}
                    onPress={handleInvestmentApproval}
                    variant={pendingInvAction.approve ? "primary" : "danger"}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            );
          })()}
        </View>
      </BottomModal>

      {/* Loan Detail Modal */}
      <LoanDetailModal
        visible={showLoanDetail}
        loan={selectedLoan}
        member={selectedLoan ? getMember(selectedLoan.memberId) : null}
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
        isAdmin={isAdmin}
        isPending={selectedLoan ? PENDING_STATUSES.includes(selectedLoan.status) : false}
      />

      <Toast />
    </View>
  );
}

// LoanCard Component with View Details button
function LoanCard({
  loan, member, actableStep, isAdmin, isPending,
  onApprove, onReject, onDisburse, onRepayment, onSchedule, onDelete, onEditResubmit,
  onViewDetails,
}: {
  loan: Loan;
  member: any;
  actableStep: string | null;
  isAdmin: boolean;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDisburse: () => void;
  onRepayment: () => void;
  onSchedule?: () => void;
  onDelete: () => void;
  onEditResubmit?: () => void;
  onViewDetails: () => void;
}) {
  const pct = loan.totalRepayable > 0 ? round2((loan.amountRepaid / loan.totalRepayable) * 100) : 0;
  const statusColor = STATUS_COLOR[loan.status] || C.infoText;
  const statusBg = STATUS_BG[loan.status] || C.mutedBg;
  const statusLabel = STATUS_LABEL[loan.status] || loan.status;

  return (
    <View style={styles.loanCard}>
      <View style={styles.loanHeader}>
        <View style={styles.loanAvatar}>
          <Text style={styles.loanAvatarText}>
            {(member?.fullName ?? "?").split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.loanMember}>{member?.fullName ?? "Unknown"}</Text>
          <Text style={styles.loanDate}>{fmtDate(loan.applicationDate)}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
          <Text style={[styles.statusText, { color: statusLabel }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.amountsRow}>
        <View style={styles.amountItem}>
          <Text style={styles.amountLabel}>Principal</Text>
          <Text style={styles.amountValue}>{fmtCurrency(loan.amount)}</Text>
        </View>
        <View style={styles.amountDivider} />
        <View style={styles.amountItem}>
          <Text style={styles.amountLabel}>Interest ({loan.interestRate}%)</Text>
          <Text style={styles.amountValue}>{fmtCurrency(loan.totalInterest)}</Text>
        </View>
        <View style={styles.amountDivider} />
        <View style={styles.amountItem}>
          <Text style={styles.amountLabel}>Total Due</Text>
          <Text style={[styles.amountValue, { color: C.primary, fontWeight: "800" }]}>
            {fmtCurrency(loan.totalRepayable)}
          </Text>
        </View>
      </View>

      {["disbursed", "repaid"].includes(loan.status) && (
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Repayment Progress</Text>
            <Text style={styles.progressPercent}>{pct.toFixed(0)}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressSub}>
            {fmtCurrency(loan.amountRepaid)} of {fmtCurrency(loan.totalRepayable)}
          </Text>
        </View>
      )}

      {loan.purpose && (
        <Text style={styles.purpose} numberOfLines={2}>
          📝 {loan.purpose}
        </Text>
      )}

      {loan.status === "rejected" && loan.rejectionReason && (
        <View style={styles.rejectionBox}>
          <Text style={styles.rejectionLabel}>Rejection Reason</Text>
          <Text style={styles.rejectionText}>{loan.rejectionReason}</Text>
        </View>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.repayBtn, { flex: 1 }]} onPress={onViewDetails} activeOpacity={0.8}>
          <Text style={styles.repayBtnText}>View Details</Text>
        </TouchableOpacity>
        
        {actableStep && isPending && (
          <>
            <TouchableOpacity style={[styles.rejectBtn, { flex: 1 }]} onPress={onReject} activeOpacity={0.8}>
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.approveBtn, { flex: 1 }]} onPress={onApprove} activeOpacity={0.8}>
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
          </>
        )}

        {loan.status === "approved" && (
          <>
            {onSchedule && (
              <TouchableOpacity style={[styles.scheduleBtn, { flex: 1 }]} onPress={onSchedule} activeOpacity={0.8}>
                <Text style={styles.scheduleBtnText}>Schedule</Text>
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity style={[styles.disburseBtn, { flex: 1 }]} onPress={onDisburse} activeOpacity={0.8}>
                <Text style={styles.disburseBtnText}>Disburse</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {loan.status === "disbursed" && (
          <>
            {onSchedule && (
              <TouchableOpacity style={[styles.scheduleBtn, { flex: 1 }]} onPress={onSchedule} activeOpacity={0.8}>
                <Text style={styles.scheduleBtnText}>Schedule</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.repayBtn, { flex: 1 }]} onPress={onRepayment} activeOpacity={0.8}>
              <Text style={styles.repayBtnText}>Record Repayment</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {loan.status === "rejected" && onEditResubmit && (
        <TouchableOpacity style={styles.editResubmitBtn} onPress={onEditResubmit} activeOpacity={0.8}>
          <Text style={styles.editResubmitBtnText}>✏️ Edit & Resubmit</Text>
        </TouchableOpacity>
      )}

      {isAdmin && (
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
          <Text style={styles.deleteBtnText}>🗑 Delete Loan</Text>
        </TouchableOpacity>
      )}
    </View>
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
    height: "100%",
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
});