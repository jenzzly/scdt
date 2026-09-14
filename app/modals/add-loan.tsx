// app/modals/add-loan.tsx

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";

import {
  useStore,
  useActiveGroup,
  useGroupMembers,
  useCurrentUserRole,
  useCurrentMember,
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

import {
  Colors,
  S,
  R,
  fmtCurrency,
  round2,
  loanSchedule,
  showConfirm,
} from "../../utils/theme";

import { useUnpaidPenalties } from "../../hooks/useUnpaidPenalties";

// Months are free-typed by the user.

export default function AddLoanModal() {
  const router = useRouter();

  const group = useActiveGroup();
  const members = useGroupMembers();

  const {
    submitLoan,
    activeGroupId,
    clearAllMemberPenalties,
    clearStandaloneLateFee,
  } = useStore();

  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();

  const { show, visible, msg, type } = useToast();

  // ------------------------------------------------------------
  // ROLE / PERMISSIONS
  // ------------------------------------------------------------

  const isAdmin = role === "admin";
  const isLoanOfficer = role === "loan_officer";

  // Anyone with this permission can manage loan applications.
  // They can select another member, override rates, clear penalties,
  // and submit loans even when the selected member has unpaid items.
  const canManageLoans = isAdmin || isLoanOfficer;

  // ------------------------------------------------------------
  // RESUBMISSION PARAMS
  // ------------------------------------------------------------

  const params = useLocalSearchParams<{
    editLoanId?: string;
    prefillAmount?: string;
    prefillPurpose?: string;
    prefillMonths?: string;
    prefillMemberId?: string;
    prefillDate?: string;
  }>();

  const isResubmit = !!params.editLoanId;

  // ------------------------------------------------------------
  // MEMBER SELECTION
  // ------------------------------------------------------------

  const [selectedMemberId, setSelectedMemberId] = useState(
    canManageLoans
      ? (params.prefillMemberId ?? "")
      : (currentMember?.id ?? "")
  );

  // IMPORTANT:
  // Admin and loan officer use the selected member.
  // Regular member uses their own member ID.
  const selectedId = canManageLoans
    ? selectedMemberId
    : (currentMember?.id ?? "");

  const selectedMember = members.find(
    (member) => member.id === selectedId
  );

  // ------------------------------------------------------------
  // FORM STATE
  // ------------------------------------------------------------

  const [amount, setAmount] = useState(
    params.prefillAmount ?? ""
  );

  const [purpose, setPurpose] = useState(
    params.prefillPurpose ?? ""
  );

  const [months, setMonths] = useState(
    params.prefillMonths ?? "6"
  );

  const [loanDate, setLoanDate] = useState(
    params.prefillDate ??
      new Date().toISOString().slice(0, 10)
  );

  const [loading, setLoading] = useState(false);

  const [showPenaltyDetails, setShowPenaltyDetails] =
    useState(false);

  const [clearingPenalties, setClearingPenalties] =
    useState(false);

  const [clearingFeeId, setClearingFeeId] =
    useState<string | null>(null);

  // ------------------------------------------------------------
  // UNPAID PENALTIES
  // ------------------------------------------------------------

  const unpaidPenalties = useUnpaidPenalties(selectedId);

  const hasUnpaidPenalties =
    unpaidPenalties.hasUnpaidPenalties;

  const penaltyAmount =
    unpaidPenalties.totalAmount;

  const hasMeetingPenalties =
    unpaidPenalties.penalties.length > 0;

  const hasLateFees =
    unpaidPenalties.walletPenalties.length > 0;

  const hasUnpaidContributions =
    unpaidPenalties.unpaidContributions?.length > 0;

  const hasOverdueLoans =
    unpaidPenalties.overdueLoans?.length > 0;

  const hasLiveLateContributions =
    unpaidPenalties.liveLateContributions?.length > 0;

  const hasLiveLateInstallments =
    unpaidPenalties.liveLateInstallments?.length > 0;

  // ------------------------------------------------------------
  // LOAN SETTINGS
  // ------------------------------------------------------------

  const groupDefaultRate =
    group?.loanInterestRate ?? 2;

  const groupDefaultPenaltyRate =
    group?.loanLateFeeRatePct ?? 0;

  const [rateInput, setRateInput] = useState(
    String(groupDefaultRate)
  );

  const [penaltyRateInput, setPenaltyRateInput] =
    useState(
      String(groupDefaultPenaltyRate)
    );

  // Admin and loan officer can override rates.
  const canSetRate = canManageLoans;

  const rate = canSetRate
    ? (parseFloat(rateInput) || 0)
    : groupDefaultRate;

  const penaltyRate = canSetRate
    ? (parseFloat(penaltyRateInput) || 0)
    : groupDefaultPenaltyRate;

  const interestMethod =
    group?.loanInterestMethod ?? "flat";

  const interestRatePeriod =
    group?.loanInterestRatePeriod ?? "monthly";

  // ------------------------------------------------------------
  // LOAN CALCULATION
  // ------------------------------------------------------------

  const parsed = parseFloat(amount) || 0;

  const monthsNum = parseInt(months) || 0;

  const {
    totalInterest,
    totalRepayable,
    monthlyPayment,
  } = useMemo(() => {
    if (parsed <= 0 || monthsNum <= 0) {
      return {
        totalInterest: 0,
        totalRepayable: parsed,
        monthlyPayment: 0,
      };
    }

    const loanDateForCalc = loanDate
      ? new Date(loanDate).toISOString()
      : new Date().toISOString();

    return loanSchedule(
      {
        amount: parsed,
        interestRate: rate,
        repaymentMonths: monthsNum,
        firstPaymentDate: loanDateForCalc,
      },
      interestMethod,
      interestRatePeriod
    );
  }, [
    parsed,
    rate,
    monthsNum,
    interestMethod,
    interestRatePeriod,
    loanDate,
  ]);

  // ------------------------------------------------------------
  // MEMBER OPTIONS
  // ------------------------------------------------------------

  const memberOptions = members
    .filter((member) => member.status === "active")
    .map((member) => ({
      label: member.fullName,
      value: member.id,
    }));

  // ------------------------------------------------------------
  // SUBMIT / APPLY LOAN
  // ------------------------------------------------------------

  const handleApply = async () => {
    // ----------------------------------------------------------
    // MEMBER VALIDATION
    // ----------------------------------------------------------

    if (!selectedId) {
      show("Please select a member", "error");
      return;
    }

    // ----------------------------------------------------------
    // PENALTY RULE
    //
    // Regular members are blocked when they have unpaid items.
    //
    // Admins and loan officers are allowed to continue.
    // ----------------------------------------------------------

    if (hasUnpaidPenalties && !canManageLoans) {
      const issues: string[] = [];

      if (hasMeetingPenalties) {
        issues.push(
          `${unpaidPenalties.penalties.length} meeting penalty(ies)`
        );
      }

      if (hasLateFees) {
        issues.push(
          `${unpaidPenalties.walletPenalties.length} late fee(s)`
        );
      }

      if (hasUnpaidContributions) {
        issues.push(
          `${unpaidPenalties.unpaidContributions.length} unpaid contribution(s)`
        );
      }

      if (hasOverdueLoans) {
        issues.push(
          `${unpaidPenalties.overdueLoans.length} overdue loan(s)`
        );
      }

      if (hasLiveLateContributions) {
        issues.push(
          `${unpaidPenalties.liveLateContributions.length} accruing late contribution fee(s)`
        );
      }

      if (hasLiveLateInstallments) {
        issues.push(
          `${unpaidPenalties.liveLateInstallments.length} accruing late loan fee(s)`
        );
      }

      const issuesList = issues.join(", ");

      Alert.alert(
        "Outstanding Obligations",
        `This member has ${unpaidPenalties.count} unpaid item(s) — ${issuesList} — totaling ${fmtCurrency(
          penaltyAmount
        )}.\n\nPlease resolve these before applying for a loan.`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "View Details",
            onPress: () =>
              setShowPenaltyDetails(true),
          },
        ]
      );

      return;
    }

    // ----------------------------------------------------------
    // AMOUNT VALIDATION
    // ----------------------------------------------------------

    const amt = parseFloat(amount);

    if (!amt || amt <= 0) {
      show("Enter a valid amount", "error");
      return;
    }

    // ----------------------------------------------------------
    // PURPOSE VALIDATION
    // ----------------------------------------------------------

    if (!purpose.trim()) {
      show("Enter the loan purpose", "error");
      return;
    }

    // ----------------------------------------------------------
    // DATE VALIDATION
    // ----------------------------------------------------------

    if (!loanDate || loanDate.trim() === "") {
      show("Please select a loan date", "error");
      return;
    }

    // ----------------------------------------------------------
    // GROUP VALIDATION
    // ----------------------------------------------------------

    if (!activeGroupId) {
      show("No active group selected", "error");
      return;
    }

    // ----------------------------------------------------------
    // SUBMIT
    // ----------------------------------------------------------

    setLoading(true);

    try {
      // If resubmitting a rejected loan, remove the old
      // rejected application first.
      if (
        isResubmit &&
        params.editLoanId &&
        activeGroupId
      ) {
        const { deleteLoan } =
          useStore.getState();

        await deleteLoan(
          params.editLoanId,
          "Resubmitted after rejection"
        ).catch(console.warn);
      }

      await submitLoan({
        groupId: activeGroupId,

        // IMPORTANT:
        // This now correctly uses the selected member for
        // both admin and loan officer.
        memberId: selectedId,

        amount: amt,

        purpose: purpose.trim(),

        // Snapshot interest rate on the loan.
        interestRate: rate,

        interestRatePeriod,

        // Snapshot late fee rate on the loan.
        lateFeeRatePct: penaltyRate,

        lateFeeGraceDays:
          group?.loanLateFeeGraceDays,

        repaymentPlan: "monthly",

        repaymentMonths: parseInt(months),

        applicationDate: loanDate
          ? new Date(loanDate).toISOString()
          : new Date().toISOString(),

        firstPaymentDate: loanDate
          ? new Date(loanDate).toISOString()
          : new Date().toISOString(),
      });

      show(
        isResubmit
          ? "Loan resubmitted — awaiting loan officer approval"
          : "Loan application submitted — awaiting loan officer approval"
      );

      router.back();
    } catch (e: any) {
      show(
        e?.message || "Failed to submit",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------
  // PENALTY PERMISSIONS
  // ------------------------------------------------------------

  const canClearPenalties = canManageLoans;

  // ------------------------------------------------------------
  // CLEAR ALL MEETING PENALTIES
  // ------------------------------------------------------------

  const handleClearAllPenalties = () => {
    if (!selectedId) return;

    showConfirm(
      "Clear All Penalties",
      `Clear all unpaid meeting penalties for ${
        selectedMember?.fullName ?? "this member"
      }? They'll be eligible for this loan afterward.`,
      async () => {
        try {
          setClearingPenalties(true);

          await clearAllMemberPenalties(
            selectedId
          );

          show("Penalties cleared");

          setShowPenaltyDetails(false);
        } catch {
          show(
            "Failed to clear penalties",
            "error"
          );
        } finally {
          setClearingPenalties(false);
        }
      }
    );
  };

  // ------------------------------------------------------------
  // CLEAR ONE WALLET LATE FEE
  // ------------------------------------------------------------

  const handleClearOneFee = (
    feeTxId: string,
    title: string
  ) => {
    showConfirm(
      `Clear ${title}?`,
      "This marks the fee as paid. It will no longer block this member from taking a loan.",
      async () => {
        try {
          setClearingFeeId(feeTxId);

          await clearStandaloneLateFee(
            feeTxId
          );

          show("Fee cleared");
        } catch {
          show(
            "Failed to clear fee",
            "error"
          );
        } finally {
          setClearingFeeId(null);
        }
      }
    );
  };

  // ------------------------------------------------------------
  // PENALTY DETAILS MODAL
  // ------------------------------------------------------------

  const PenaltyDetailsModal = () => (
    <View style={styles.penaltyModal}>
      <View style={styles.penaltyModalContent}>
        <Text style={styles.penaltyModalTitle}>
          Outstanding Obligations
        </Text>

        <Text style={styles.penaltyModalSubtitle}>
          Member: {selectedMember?.fullName}
        </Text>

        <ScrollView
          style={styles.penaltyList}
          showsVerticalScrollIndicator={false}
        >
          {/* -------------------------------------------------- */}
          {/* MEETING PENALTIES */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.penalties.map(
            (penalty, index) => (
              <View
                key={`meeting-${index}`}
                style={styles.penaltyItem}
              >
                <View
                  style={styles.penaltyItemHeader}
                >
                  <Text
                    style={
                      styles.penaltyItemTitle
                    }
                  >
                    📅 {penalty.meetingTitle}
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemAmount
                    }
                  >
                    {fmtCurrency(
                      penalty.penaltyAmount
                    )}
                  </Text>
                </View>

                <Text
                  style={styles.penaltyItemDate}
                >
                  {new Date(
                    penalty.meetingDate
                  ).toLocaleDateString()}
                </Text>

                <Text
                  style={styles.penaltyItemStatus}
                >
                  Status: {penalty.status}
                </Text>

                <Text
                  style={styles.penaltyItemType}
                >
                  Meeting Penalty
                </Text>
              </View>
            )
          )}

          {/* -------------------------------------------------- */}
          {/* WALLET LATE FEES */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.walletPenalties.map(
            (penalty, index) => {
              const title =
                penalty.description?.startsWith(
                  "Late contribution fee"
                )
                  ? "Late Contribution Fee"
                  : penalty.description?.startsWith(
                      "Late repayment fee"
                    )
                  ? "Late Repayment Fee"
                  : "Other Fee";

              return (
                <View
                  key={`wallet-${index}`}
                  style={styles.penaltyItem}
                >
                  <View
                    style={
                      styles.penaltyItemHeader
                    }
                  >
                    <Text
                      style={
                        styles.penaltyItemTitle
                      }
                    >
                      ⚠️ {title}
                    </Text>

                    <Text
                      style={
                        styles.penaltyItemAmount
                      }
                    >
                      {fmtCurrency(
                        penalty.amount
                      )}
                    </Text>
                  </View>

                  <Text
                    style={styles.penaltyItemDate}
                  >
                    {new Date(
                      penalty.date
                    ).toLocaleDateString()}
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemDescription
                    }
                  >
                    {penalty.description}
                  </Text>

                  <Text
                    style={styles.penaltyItemType}
                  >
                    Late Fee
                  </Text>

                  {canClearPenalties && (
                    <TouchableOpacity
                      style={
                        styles.penaltyClearOneBtn
                      }
                      onPress={() =>
                        handleClearOneFee(
                          penalty.id,
                          title
                        )
                      }
                      disabled={
                        clearingFeeId ===
                        penalty.id
                      }
                    >
                      <Text
                        style={
                          styles.penaltyClearOneBtnText
                        }
                      >
                        {clearingFeeId ===
                        penalty.id
                          ? "Clearing…"
                          : "Clear this fee"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }
          )}

          {/* -------------------------------------------------- */}
          {/* LIVE LATE CONTRIBUTION FEES */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.liveLateContributions?.map(
            (fee: any, index: number) => (
              <View
                key={`live-contrib-${index}`}
                style={styles.penaltyItem}
              >
                <View
                  style={
                    styles.penaltyItemHeader
                  }
                >
                  <Text
                    style={
                      styles.penaltyItemTitle
                    }
                  >
                    📈 Late Contribution —{" "}
                    {fee.periodLabel}
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemAmount
                    }
                  >
                    {fmtCurrency(
                      fee.feeAmount
                    )}
                  </Text>
                </View>

                <Text
                  style={styles.penaltyItemDate}
                >
                  Due:{" "}
                  {new Date(
                    fee.dueDate
                  ).toLocaleDateString()}
                </Text>

                <Text
                  style={
                    styles.penaltyItemDescription
                  }
                >
                  {fee.daysLate} day(s) late
                </Text>

                <Text
                  style={styles.penaltyItemType}
                >
                  Accruing Late Fee (not yet applied)
                </Text>
              </View>
            )
          )}

          {/* -------------------------------------------------- */}
          {/* LIVE LATE LOAN INSTALLMENT FEES */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.liveLateInstallments?.map(
            (fee: any, index: number) => (
              <View
                key={`live-loan-${index}`}
                style={styles.penaltyItem}
              >
                <View
                  style={
                    styles.penaltyItemHeader
                  }
                >
                  <Text
                    style={
                      styles.penaltyItemTitle
                    }
                  >
                    🏦 Late Loan Installment
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemAmount
                    }
                  >
                    {fmtCurrency(
                      fee.feeAmount
                    )}
                  </Text>
                </View>

                <Text
                  style={styles.penaltyItemDate}
                >
                  Due:{" "}
                  {new Date(
                    fee.dueDate
                  ).toLocaleDateString()}
                </Text>

                <Text
                  style={
                    styles.penaltyItemDescription
                  }
                >
                  {fee.daysLate} day(s) late
                </Text>

                <Text
                  style={styles.penaltyItemType}
                >
                  Accruing Late Fee (not yet applied)
                </Text>
              </View>
            )
          )}

          {/* -------------------------------------------------- */}
          {/* UNPAID CONTRIBUTIONS */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.unpaidContributions?.map(
            (contribution, index) => (
              <View
                key={`contrib-${index}`}
                style={styles.penaltyItem}
              >
                <View
                  style={
                    styles.penaltyItemHeader
                  }
                >
                  <Text
                    style={
                      styles.penaltyItemTitle
                    }
                  >
                    📈 Pending Contribution
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemAmount
                    }
                  >
                    {fmtCurrency(
                      contribution.amount
                    )}
                  </Text>
                </View>

                <Text
                  style={styles.penaltyItemDate}
                >
                  {new Date(
                    contribution.date
                  ).toLocaleDateString()}
                </Text>

                <Text
                  style={
                    styles.penaltyItemDescription
                  }
                >
                  {contribution.description}
                </Text>

                <Text
                  style={styles.penaltyItemType}
                >
                  Unpaid Contribution
                </Text>
              </View>
            )
          )}

          {/* -------------------------------------------------- */}
          {/* OVERDUE LOANS */}
          {/* -------------------------------------------------- */}

          {unpaidPenalties.overdueLoans?.map(
            (loan, index) => (
              <View
                key={`loan-${index}`}
                style={styles.penaltyItem}
              >
                <View
                  style={
                    styles.penaltyItemHeader
                  }
                >
                  <Text
                    style={
                      styles.penaltyItemTitle
                    }
                  >
                    🏦 Overdue Loan
                  </Text>

                  <Text
                    style={
                      styles.penaltyItemAmount
                    }
                  >
                    {fmtCurrency(
                      loan.amount
                    )}
                  </Text>
                </View>

                <Text
                  style={styles.penaltyItemDate}
                >
                  Applied:{" "}
                  {new Date(
                    loan.applicationDate
                  ).toLocaleDateString()}
                </Text>

                <Text
                  style={
                    styles.penaltyItemDescription
                  }
                >
                  Repaid:{" "}
                  {fmtCurrency(
                    loan.amountRepaid
                  )}{" "}
                  of{" "}
                  {fmtCurrency(
                    loan.totalRepayable
                  )}
                </Text>

                <Text
                  style={styles.penaltyItemType}
                >
                  Overdue Loan Balance
                </Text>
              </View>
            )
          )}
        </ScrollView>

        {/* ---------------------------------------------------- */}
        {/* MODAL FOOTER */}
        {/* ---------------------------------------------------- */}

        <View
          style={styles.penaltyModalFooter}
        >
          <Text
            style={styles.totalPenaltyText}
          >
            Total Outstanding:{" "}
            {fmtCurrency(penaltyAmount)}
          </Text>

          {canClearPenalties &&
            unpaidPenalties.penalties.length >
              0 && (
              <TouchableOpacity
                style={[
                  styles.closePenaltyModalBtn,
                  {
                    backgroundColor:
                      Colors.accent,
                    marginBottom: 8,
                  },
                ]}
                onPress={
                  handleClearAllPenalties
                }
                disabled={clearingPenalties}
              >
                <Text
                  style={[
                    styles.closePenaltyModalBtnText,
                    { color: "#fff" },
                  ]}
                >
                  {clearingPenalties
                    ? "Clearing…"
                    : "Clear All Penalties"}
                </Text>
              </TouchableOpacity>
            )}

          <TouchableOpacity
            style={
              styles.closePenaltyModalBtn
            }
            onPress={() =>
              setShowPenaltyDetails(false)
            }
          >
            <Text
              style={
                styles.closePenaltyModalBtnText
              }
            >
              Close
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  return (
    <ModalShell
      title="Apply for Loan"
      onClose={() => router.back()}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* ---------------------------------------------------- */}
        {/* APPROVAL INFO */}
        {/* ---------------------------------------------------- */}

        {isResubmit ? (
          <View
            style={[
              styles.infoBanner,
              {
                backgroundColor:
                  "rgba(245,158,11,0.1)",
                borderColor:
                  "rgba(245,158,11,0.2)",
              },
            ]}
          >
            <Text
              style={[
                styles.infoBannerText,
                { color: Colors.gold },
              ]}
            >
              ✏️ You are editing a previously
              rejected loan application. Make
              changes and resubmit.
            </Text>
          </View>
        ) : (
          <View style={styles.infoBanner}>
            <Text
              style={styles.infoBannerText}
            >
              Applications go through: Loan
              Officer → Committee → Accountant
              → Admin disbursement
            </Text>
          </View>
        )}

        {/* ---------------------------------------------------- */}
        {/* PENALTY WARNING */}
        {/* ---------------------------------------------------- */}

        {hasUnpaidPenalties && (
          <TouchableOpacity
            style={[
              styles.infoBanner,
              {
                backgroundColor:
                  "rgba(220,38,38,0.1)",
                borderColor:
                  "rgba(220,38,38,0.2)",
              },
            ]}
            onPress={() =>
              setShowPenaltyDetails(true)
            }
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.infoBannerText,
                {
                  color: Colors.error,
                  fontWeight: "700",
                },
              ]}
            >
              {canManageLoans
                ? "⚠️ This member has outstanding obligations: "
                : "⚠️ Cannot apply for loan: "}
              {unpaidPenalties.count} unpaid
              item(s) totaling{" "}
              {fmtCurrency(penaltyAmount)}
            </Text>

            <Text
              style={[
                styles.infoBannerText,
                {
                  color: Colors.error,
                  fontSize: 11,
                },
              ]}
            >
              {hasMeetingPenalties &&
                `${unpaidPenalties.penalties.length} meeting penalty(ies) • `}

              {hasLateFees &&
                `${unpaidPenalties.walletPenalties.length} late fee(s) • `}

              {hasLiveLateContributions &&
                `${unpaidPenalties.liveLateContributions.length} accruing late contribution fee(s) • `}

              {hasLiveLateInstallments &&
                `${unpaidPenalties.liveLateInstallments.length} accruing late loan fee(s) • `}

              {hasUnpaidContributions &&
                `${unpaidPenalties.unpaidContributions.length} unpaid contribution(s) • `}

              {hasOverdueLoans &&
                `${unpaidPenalties.overdueLoans.length} overdue loan(s) • `}

              Tap to view details
            </Text>

            {canManageLoans && (
              <Text
                style={[
                  styles.infoBannerText,
                  {
                    color: Colors.primary,
                    fontSize: 11,
                    fontWeight: "700",
                    marginTop: 4,
                  },
                ]}
              >
                Admin/Loan Officer override: You
                can still submit this application.
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* ---------------------------------------------------- */}
        {/* MEMBER SELECTOR */}
        {/* ---------------------------------------------------- */}

        {canManageLoans ? (
          <Select
            label="Member *"
            value={selectedMemberId}
            options={[
              {
                label: "Select member…",
                value: "",
              },
              ...memberOptions,
            ]}
            onChange={setSelectedMemberId}
          />
        ) : (
          <View
            style={styles.selfMemberRow}
          >
            <Text
              style={styles.selfMemberLbl}
            >
              Applying for
            </Text>

            <Text
              style={styles.selfMemberVal}
            >
              {currentMember?.fullName ?? "—"}
            </Text>
          </View>
        )}

        {/* ---------------------------------------------------- */}
        {/* LOAN AMOUNT */}
        {/* ---------------------------------------------------- */}

        <Input
          label={`Loan Amount (${
            group?.currency ?? "RWF"
          }) *`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix={group?.currency ?? "RWF"}
          hint="Principal amount before interest"
        />

        {/* ---------------------------------------------------- */}
        {/* PURPOSE */}
        {/* ---------------------------------------------------- */}

        <Input
          label="Purpose *"
          value={purpose}
          onChangeText={setPurpose}
          placeholder="e.g. Business expansion, Medical emergency"
          multiline
        />

        {/* ---------------------------------------------------- */}
        {/* LOAN DATE */}
        {/* ---------------------------------------------------- */}

        <DatePicker
          label="Loan Date *"
          value={loanDate}
          onChange={setLoanDate}
          placeholder="Select loan application date"
          hint="Default is today's date"
        />

        {/* ---------------------------------------------------- */}
        {/* REPAYMENT PERIOD */}
        {/* ---------------------------------------------------- */}

        <Input
          label="Repayment Period (months) *"
          value={months}
          onChangeText={(value) =>
            setMonths(
              value.replace(
                /[^0-9]/g,
                ""
              )
            )
          }
          keyboardType="numeric"
          placeholder="e.g. 6"
          hint="Enter any number of months (1–120)"
        />

        {/* ---------------------------------------------------- */}
        {/* RATE OVERRIDE */}
        {/* ---------------------------------------------------- */}

        {canSetRate && (
          <>
            <Input
              label={`Interest Rate (% ${
                interestRatePeriod === "annual"
                  ? "per year"
                  : "per month"
              }) *`}
              value={rateInput}
              onChangeText={(value) =>
                setRateInput(
                  value.replace(
                    /[^0-9.]/g,
                    ""
                  )
                )
              }
              keyboardType="numeric"
              hint={`Defaults to this group's setting (${groupDefaultRate}%) — change it for a negotiated rate on this specific loan`}
            />

            <Input
              label="Penalty Rate (% of overdue installment)"
              value={penaltyRateInput}
              onChangeText={(value) =>
                setPenaltyRateInput(
                  value.replace(
                    /[^0-9.]/g,
                    ""
                  )
                )
              }
              keyboardType="numeric"
              hint={`Defaults to this group's setting (${groupDefaultPenaltyRate}%)`}
            />
          </>
        )}

        {/* ---------------------------------------------------- */}
        {/* LOAN CALCULATOR */}
        {/* ---------------------------------------------------- */}

        {parsed > 0 && (
          <View style={styles.calcCard}>
            <Text
              style={styles.calcTitle}
            >
              Loan Summary
            </Text>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Principal Amount
              </Text>

              <Text
                style={styles.calcVal}
              >
                {fmtCurrency(parsed)}
              </Text>
            </View>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Loan Date
              </Text>

              <Text
                style={styles.calcVal}
              >
                {loanDate
                  ? new Date(
                      loanDate
                    ).toLocaleDateString()
                  : "Today"}
              </Text>
            </View>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Interest Rate
              </Text>

              <Text
                style={styles.calcVal}
              >
                {rate}%{" "}
                {interestRatePeriod ===
                "annual"
                  ? "per year"
                  : "per month"}

                {interestRatePeriod ===
                  "annual" &&
                  ` (${round2(
                    rate / 12
                  )}%/mo)`}
              </Text>
            </View>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Interest Method
              </Text>

              <Text
                style={styles.calcVal}
              >
                {interestMethod ===
                "reducing_balance"
                  ? "Reducing balance"
                  : "Flat rate"}
              </Text>
            </View>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Total Interest
              </Text>

              <Text
                style={[
                  styles.calcVal,
                  { color: Colors.gold },
                ]}
              >
                {fmtCurrency(
                  totalInterest
                )}
              </Text>
            </View>

            <View style={styles.calcRow}>
              <Text
                style={styles.calcLbl}
              >
                Total Repayable
              </Text>

              <Text
                style={[
                  styles.calcVal,
                  {
                    color: Colors.primary,
                    fontWeight: "800",
                    fontSize: 15,
                  },
                ]}
              >
                {fmtCurrency(
                  totalRepayable
                )}
              </Text>
            </View>

            <View
              style={[
                styles.calcRow,
                styles.calcRowLast,
              ]}
            >
              <Text
                style={[
                  styles.calcLbl,
                  {
                    fontWeight: "700",
                    color: Colors.text,
                  },
                ]}
              >
                {interestMethod ===
                "reducing_balance"
                  ? "First Installment"
                  : "Monthly Payment"}
              </Text>

              <Text
                style={[
                  styles.calcVal,
                  {
                    color: Colors.accent,
                    fontWeight: "800",
                    fontSize: 16,
                  },
                ]}
              >
                {fmtCurrency(
                  monthlyPayment
                )}
              </Text>
            </View>

            {/* Interest information */}
            <View
              style={styles.interestNote}
            >
              <Text
                style={
                  styles.interestNoteText
                }
              >
                ℹ️{" "}
                {interestMethod ===
                "reducing_balance"
                  ? `This loan accrues interest on the outstanding balance each month, so the principal/interest split changes as you repay. Estimated total interest is ${fmtCurrency(
                      totalInterest
                    )} if paid on schedule.`
                  : `This loan will accrue ${fmtCurrency(
                      totalInterest
                    )} in interest over ${months} months.`}

                {" "}Total amount to repay is{" "}
                {fmtCurrency(
                  totalRepayable
                )}

                {loanDate &&
                  loanDate !==
                    new Date()
                      .toISOString()
                      .slice(0, 10) &&
                  ` Loan date: ${new Date(
                    loanDate
                  ).toLocaleDateString()}.`}
              </Text>
            </View>
          </View>
        )}

        {/* ---------------------------------------------------- */}
        {/* SUBMIT BUTTON */}
        {/* ---------------------------------------------------- */}

        <Button
          label={
            isResubmit
              ? "Resubmit Application"
              : "Submit Application"
          }
          onPress={handleApply}
          fullWidth
          loading={loading}

          // Regular members are blocked by unpaid obligations.
          // Admin and loan officer can submit regardless.
          disabled={
            !canManageLoans &&
            (
              hasUnpaidPenalties ||
              !selectedId
            )
          }

          size="lg"
        />
      </ScrollView>

      {/* ------------------------------------------------------ */}
      {/* PENALTY DETAILS */}
      {/* ------------------------------------------------------ */}

      {showPenaltyDetails && (
        <PenaltyDetailsModal />
      )}

      <Toast
        visible={visible}
        msg={msg}
        type={type}
      />
    </ModalShell>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop:
      Platform.OS === "ios"
        ? 56
        : 36,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },

  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor:
      Colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },

  closeBtnText: {
    fontSize: 14,
    color: Colors.text2,
    fontWeight: "600",
  },

  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
  },

  body: {
    padding: S.lg,
    paddingBottom: 60,
  },

  infoBanner: {
    backgroundColor:
      Colors.primaryFaint,
    borderWidth: 1,
    borderColor:
      "rgba(26,60,94,0.15)",
    borderRadius: R.md,
    padding: S.md,
    marginBottom: S.lg,
  },

  infoBannerText: {
    fontSize: 12,
    color: Colors.primary,
    lineHeight: 18,
  },

  selfMemberRow: {
    backgroundColor:
      Colors.elevated,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: S.md,
    marginBottom: S.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  selfMemberLbl: {
    fontSize: 12,
    color: Colors.text3,
  },

  selfMemberVal: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
  },

  calcCard: {
    backgroundColor:
      Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.lg,
    shadowColor: Colors.primary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  calcTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.text2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },

  calcRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor:
      Colors.borderLight,
  },

  calcRowLast: {
    borderBottomWidth: 0,
    paddingTop: 12,
  },

  calcLbl: {
    fontSize: 13,
    color: Colors.text3,
  },

  calcVal: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },

  interestNote: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor:
      Colors.borderLight,
  },

  interestNoteText: {
    fontSize: 11,
    color: Colors.text3,
    fontStyle: "italic",
  },

  penaltyModal: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor:
      "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },

  penaltyModalContent: {
    backgroundColor:
      Colors.surface,
    borderRadius: R.xl,
    width: "90%",
    maxHeight: "80%",
    padding: S.lg,
  },

  penaltyModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.text,
    textAlign: "center",
    marginBottom: 4,
  },

  penaltyModalSubtitle: {
    fontSize: 13,
    color: Colors.text3,
    textAlign: "center",
    marginBottom: S.md,
  },

  penaltyList: {
    maxHeight: 300,
    marginVertical: S.md,
  },

  penaltyItem: {
    backgroundColor:
      Colors.elevated,
    borderRadius: R.md,
    padding: S.md,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor:
      Colors.borderLight,
  },

  penaltyItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },

  penaltyItemTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
  },

  penaltyItemAmount: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.error,
  },

  penaltyItemDate: {
    fontSize: 11,
    color: Colors.text3,
    marginBottom: 2,
  },

  penaltyItemStatus: {
    fontSize: 11,
    color: Colors.text3,
    textTransform: "capitalize",
  },

  penaltyItemDescription: {
    fontSize: 11,
    color: Colors.text3,
  },

  penaltyItemType: {
    fontSize: 10,
    color: Colors.text3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },

  penaltyClearOneBtn: {
    alignSelf: "flex-start",
    marginTop: S.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: R.sm,
    backgroundColor:
      Colors.primaryFaint ??
      Colors.elevated,
  },

  penaltyClearOneBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primary,
  },

  penaltyModalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  totalPenaltyText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.error,
  },

  closePenaltyModalBtn: {
    backgroundColor:
      Colors.primary,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.md,
  },

  closePenaltyModalBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
});