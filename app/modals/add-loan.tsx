// app/modals/add-loan.tsx
import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, KeyboardAvoidingView, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStore, useActiveGroup, useGroupMembers, useCurrentUserRole, useCurrentMember, useGroupMeetings } from "../../stores/useStore";
import { Input, Select, Button, useToast } from "../../components/ui";
import { Colors, S, R, fmtCurrency, round2, loanSchedule, showConfirm } from "../../utils/theme";
import { useUnpaidPenalties } from "../../hooks/useUnpaidPenalties";

const MONTHS_OPTIONS = [
  { label: "3 months", value: "3" },
  { label: "6 months", value: "6" },
  { label: "9 months", value: "9" },
  { label: "12 months", value: "12" },
  { label: "18 months", value: "18" },
  { label: "24 months", value: "24" },
];

export default function AddLoanModal() {
  const router = useRouter();
  const group = useActiveGroup();
  const members = useGroupMembers();
  const { submitLoan, activeGroupId, authUid, clearAllMemberPenalties } = useStore();
  const role = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const { show, Toast } = useToast();

  // Read pre-fill params for rejected loan resubmission
  const params = useLocalSearchParams<{
    editLoanId?: string;
    prefillAmount?: string;
    prefillPurpose?: string;
    prefillMonths?: string;
    prefillMemberId?: string;
  }>();
  const isResubmit = !!params.editLoanId;

  const isAdmin = role === "admin";
  const isLoanOfficer = role === "loan_officer" || isAdmin;
  
  // State — pre-fill if resubmitting
  const [selectedMemberId, setSelectedMemberId] = useState(
    isAdmin ? (params.prefillMemberId ?? "") : (currentMember?.id ?? "")
  );
  const [amount, setAmount] = useState(params.prefillAmount ?? "");
  const [purpose, setPurpose] = useState(params.prefillPurpose ?? "");
  const [months, setMonths] = useState(params.prefillMonths ?? "6");
  const [loading, setLoading] = useState(false);
  const [showPenaltyDetails, setShowPenaltyDetails] = useState(false);
  const [clearingPenalties, setClearingPenalties] = useState(false);

  const selectedId = isAdmin ? selectedMemberId : (currentMember?.id ?? "");
  const selectedMember = members.find(m => m.id === selectedId);
  
  // Check for unpaid penalties
  const unpaidPenalties = useUnpaidPenalties(selectedId);
  
  const hasUnpaidPenalties = unpaidPenalties.hasUnpaidPenalties;
  const penaltyAmount = unpaidPenalties.totalAmount;
  
  // Loan calculation — uses the group's configured interest method
  // (flat or reducing balance) via the shared loanSchedule helper, instead
  // of a hardcoded flat-rate formula, so this preview always matches what
  // the loan will actually be submitted with.
  const rate = group?.loanInterestRate ?? 2;
  const interestMethod = group?.loanInterestMethod ?? "flat";
  const parsed = parseFloat(amount) || 0;
  const monthsNum = parseInt(months) || 0;
  const { totalInterest, totalRepayable, monthlyPayment } = useMemo(() => {
    if (parsed <= 0 || monthsNum <= 0) {
      return { totalInterest: 0, totalRepayable: parsed, monthlyPayment: 0 };
    }
    return loanSchedule(
      { amount: parsed, interestRate: rate, repaymentMonths: monthsNum, firstPaymentDate: new Date().toISOString() },
      interestMethod
    );
  }, [parsed, rate, monthsNum, interestMethod]);

  const memberOptions = members
    .filter((m) => m.status === "active")
    .map((m) => ({ label: m.fullName, value: m.id }));

  const handleApply = async () => {
    if (!selectedId) { 
      show("Please select a member", "error"); 
      return; 
    }
    
    if (hasUnpaidPenalties) {
      Alert.alert(
        "Unpaid Meeting Penalties",
        `This member has ${unpaidPenalties.count} unpaid meeting penalty/penalties totaling ${fmtCurrency(penaltyAmount)}.\n\nPlease resolve these penalties before applying for a loan.`,
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "View Details", 
            onPress: () => setShowPenaltyDetails(true)
          }
        ]
      );
      return;
    }
    
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { 
      show("Enter a valid amount", "error"); 
      return; 
    }
    
    if (!purpose.trim()) { 
      show("Enter the loan purpose", "error"); 
      return; 
    }
    
    if (!activeGroupId) return;
    
    setLoading(true);
    try {
      // If resubmitting a rejected loan, delete the old one first
      if (isResubmit && params.editLoanId && activeGroupId) {
        const { deleteLoan } = useStore.getState();
        await deleteLoan(params.editLoanId, "Resubmitted after rejection").catch(console.warn);
      }
      await submitLoan({
        groupId: activeGroupId,
        memberId: selectedId,
        amount: amt,
        purpose: purpose.trim(),
        interestRate: rate,
        repaymentPlan: "monthly",
        repaymentMonths: parseInt(months),
        applicationDate: new Date().toISOString(),
        firstPaymentDate: new Date().toISOString(),
      });
      show(isResubmit ? "Loan resubmitted — awaiting loan officer approval" : "Loan application submitted — awaiting loan officer approval");
      router.back();
    } catch (e: any) {
      show(e.message || "Failed to submit", "error");
    } finally { 
      setLoading(false); 
    }
  };

  const canClearPenalties = isLoanOfficer; // matches meetings.tsx's ["admin","loan_officer"] gate

  const handleClearAllPenalties = () => {
    if (!selectedId) return;
    showConfirm(
      "Clear All Penalties",
      `Clear all unpaid meeting penalties for ${selectedMember?.fullName ?? "this member"}? They'll be eligible for this loan afterward.`,
      async () => {
        try {
          setClearingPenalties(true);
          await clearAllMemberPenalties(selectedId);
          show("Penalties cleared");
          setShowPenaltyDetails(false);
        } catch {
          show("Failed to clear penalties", "error");
        } finally {
          setClearingPenalties(false);
        }
      }
    );
  };

  // Penalty Details Modal
  const PenaltyDetailsModal = () => (
    <View style={styles.penaltyModal}>
      <View style={styles.penaltyModalContent}>
        <Text style={styles.penaltyModalTitle}>Unpaid Meeting Penalties</Text>
        <Text style={styles.penaltyModalSubtitle}>Member: {selectedMember?.fullName}</Text>
        
        <ScrollView style={styles.penaltyList} showsVerticalScrollIndicator={false}>
          {unpaidPenalties.penalties.map((penalty, index) => (
            <View key={index} style={styles.penaltyItem}>
              <View style={styles.penaltyItemHeader}>
                <Text style={styles.penaltyItemTitle}>{penalty.meetingTitle}</Text>
                <Text style={styles.penaltyItemAmount}>{fmtCurrency(penalty.penaltyAmount)}</Text>
              </View>
              <Text style={styles.penaltyItemDate}>{new Date(penalty.meetingDate).toLocaleDateString()}</Text>
              <Text style={styles.penaltyItemStatus}>Status: {penalty.status}</Text>
            </View>
          ))}
          {unpaidPenalties.walletPenalties.map((penalty, index) => (
            <View key={`wallet-${index}`} style={styles.penaltyItem}>
              <View style={styles.penaltyItemHeader}>
                <Text style={styles.penaltyItemTitle}>Meeting Penalty</Text>
                <Text style={styles.penaltyItemAmount}>{fmtCurrency(penalty.amount)}</Text>
              </View>
              <Text style={styles.penaltyItemDate}>{new Date(penalty.date).toLocaleDateString()}</Text>
              <Text style={styles.penaltyItemDescription}>{penalty.description}</Text>
            </View>
          ))}
        </ScrollView>
        
        <View style={styles.penaltyModalFooter}>
          <Text style={styles.totalPenaltyText}>
            Total Unpaid: {fmtCurrency(penaltyAmount)}
          </Text>
          {canClearPenalties && unpaidPenalties.penalties.length > 0 && (
            <TouchableOpacity
              style={[styles.closePenaltyModalBtn, { backgroundColor: Colors.accent, marginBottom: 8 }]}
              onPress={handleClearAllPenalties}
              disabled={clearingPenalties}
            >
              <Text style={[styles.closePenaltyModalBtnText, { color: "#fff" }]}>
                {clearingPenalties ? "Clearing…" : "Clear All Penalties"}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={styles.closePenaltyModalBtn}
            onPress={() => setShowPenaltyDetails(false)}
          >
            <Text style={styles.closePenaltyModalBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isResubmit ? "Edit & Resubmit Loan" : "Loan Application"}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {/* Approval info banner */}
        {isResubmit ? (
          <View style={[styles.infoBanner, { backgroundColor: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.2)" }]}>
            <Text style={[styles.infoBannerText, { color: Colors.gold }]}>
              ✏️ You are editing a previously rejected loan application. Make changes and resubmit.
            </Text>
          </View>
        ) : (
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerText}>
              Applications go through: Loan Officer → Committee → Accountant → Admin disbursement
            </Text>
          </View>
        )}

        {/* Penalty Warning Banner */}
        {hasUnpaidPenalties && (
          <TouchableOpacity 
            style={[styles.infoBanner, { backgroundColor: "rgba(220,38,38,0.1)", borderColor: "rgba(220,38,38,0.2)" }]}
            onPress={() => setShowPenaltyDetails(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.infoBannerText, { color: Colors.error, fontWeight: "700" }]}>
              ⚠️ Cannot apply for loan: {unpaidPenalties.count} unpaid meeting penalty/penalties totaling {fmtCurrency(penaltyAmount)}
            </Text>
            <Text style={[styles.infoBannerText, { color: Colors.error, fontSize: 11 }]}>
              Tap to view details
            </Text>
          </TouchableOpacity>
        )}

        {/* Member selector - only admin/loan officer can pick */}
        {(isAdmin || isLoanOfficer) ? (
          <Select
            label="Member *"
            value={selectedMemberId}
            options={[{ label: "Select member…", value: "" }, ...memberOptions]}
            onChange={setSelectedMemberId}
          />
        ) : (
          <View style={styles.selfMemberRow}>
            <Text style={styles.selfMemberLbl}>Applying for</Text>
            <Text style={styles.selfMemberVal}>{currentMember?.fullName ?? "—"}</Text>
          </View>
        )}

        <Input
          label={`Loan Amount (${group?.currency ?? "RWF"}) *`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix={group?.currency ?? "RWF"}
          hint="Principal amount before interest"
        />
        
        <Input
          label="Purpose *"
          value={purpose}
          onChangeText={setPurpose}
          placeholder="e.g. Business expansion, Medical emergency"
          multiline
        />
        
        <Select 
          label="Repayment Period" 
          value={months} 
          options={MONTHS_OPTIONS} 
          onChange={setMonths} 
        />

        {/* Calculator preview - Shows full breakdown including interest */}
        {parsed > 0 && (
          <View style={styles.calcCard}>
            <Text style={styles.calcTitle}>Loan Summary</Text>
            <View style={styles.calcRow}>
              <Text style={styles.calcLbl}>Principal Amount</Text>
              <Text style={styles.calcVal}>{fmtCurrency(parsed)}</Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLbl}>Interest Rate</Text>
              <Text style={styles.calcVal}>{rate}% per month × {months} months</Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLbl}>Interest Method</Text>
              <Text style={styles.calcVal}>
                {interestMethod === "reducing_balance" ? "Reducing balance" : "Flat rate"}
              </Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLbl}>Total Interest</Text>
              <Text style={[styles.calcVal, { color: Colors.gold }]}>{fmtCurrency(totalInterest)}</Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLbl}>Total Repayable</Text>
              <Text style={[styles.calcVal, { color: Colors.primary, fontWeight: "800", fontSize: 15 }]}>
                {fmtCurrency(totalRepayable)}
              </Text>
            </View>
            <View style={[styles.calcRow, styles.calcRowLast]}>
              <Text style={[styles.calcLbl, { fontWeight: "700", color: Colors.text }]}>
                {interestMethod === "reducing_balance" ? "First Installment" : "Monthly Payment"}
              </Text>
              <Text style={[styles.calcVal, { color: Colors.accent, fontWeight: "800", fontSize: 16 }]}>
                {fmtCurrency(monthlyPayment)}
              </Text>
            </View>
            
            {/* Additional info about interest */}
            <View style={styles.interestNote}>
              <Text style={styles.interestNoteText}>
                ℹ️ {interestMethod === "reducing_balance"
                  ? `This loan accrues interest on the outstanding balance each month, so the principal/interest split changes as you repay. Estimated total interest is ${fmtCurrency(totalInterest)} if paid on schedule.`
                  : `This loan will accrue ${fmtCurrency(totalInterest)} in interest over ${months} months.`}
                {" "}Total amount to repay is {fmtCurrency(totalRepayable)}.
              </Text>
            </View>
          </View>
        )}

        <Button 
          label={isResubmit ? "Resubmit Application" : "Submit Application"} 
          onPress={handleApply} 
          fullWidth 
          loading={loading} 
          disabled={hasUnpaidPenalties || !selectedId}
          size="lg" 
        />
      </ScrollView>
      
      {/* Penalty Details Modal */}
      {showPenaltyDetails && <PenaltyDetailsModal />}
      
      <Toast />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.elevated, alignItems: "center", justifyContent: "center" },
  closeBtnText: { fontSize: 14, color: Colors.text2, fontWeight: "600" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: Colors.text },
  body: { padding: S.lg, paddingBottom: 60 },
  infoBanner: {
    backgroundColor: Colors.primaryFaint, borderWidth: 1, borderColor: "rgba(26,60,94,0.15)",
    borderRadius: R.md, padding: S.md, marginBottom: S.lg,
  },
  infoBannerText: { fontSize: 12, color: Colors.primary, lineHeight: 18 },
  selfMemberRow: {
    backgroundColor: Colors.elevated, borderRadius: R.md, borderWidth: 1,
    borderColor: Colors.border, padding: S.md, marginBottom: S.lg,
    flexDirection: "row", justifyContent: "space-between",
  },
  selfMemberLbl: { fontSize: 12, color: Colors.text3 },
  selfMemberVal: { fontSize: 13, fontWeight: "700", color: Colors.text },
  calcCard: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: R.lg, padding: S.lg, marginBottom: S.lg,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  calcTitle: { fontSize: 11, fontWeight: "700", color: Colors.text2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  calcRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  calcRowLast: { borderBottomWidth: 0, paddingTop: 12 },
  calcLbl: { fontSize: 13, color: Colors.text3 },
  calcVal: { fontSize: 13, fontWeight: "600", color: Colors.text },
  interestNote: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
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
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  penaltyModalContent: {
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.elevated,
    borderRadius: R.md,
    padding: S.md,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
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
    backgroundColor: Colors.primary,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.md,
  },
  closePenaltyModalBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
});