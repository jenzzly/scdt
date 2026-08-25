// app/modals/add-investment.tsx - Add closing functionality

import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupInvestments } from "../../stores/useStore";
import { Input, Select, Button, useToast, BottomModal, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, R, fmtCurrency, round2, showConfirm } from "../../utils/theme";

const INV_TYPES = [
  { label: "Real Estate", value: "real_estate" },
  { label: "Agriculture", value: "agriculture" },
  { label: "Business / Trade", value: "business" },
  { label: "Stocks / Securities", value: "stocks" },
  { label: "Fixed Deposit", value: "fixed_deposit" },
  { label: "Other", value: "other" },
];

export default function AddInvestmentModal() {
  const router = useRouter();
  const { createInvestment, closeInvestment } = useStore();
  const group = useActiveGroup();
  const investments = useGroupInvestments();
  const { show, Toast } = useToast();

  const [name, setName] = useState("");
  const [type, setType] = useState("real_estate");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [expected, setExpected] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [maturityDate, setMaturityDate] = useState("");
  const [repName, setRepName] = useState("");
  const [repRole, setRepRole] = useState("");
  const [loading, setLoading] = useState(false);

  // Closing investment state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [selectedInvestment, setSelectedInvestment] = useState<any>(null);
  const [closeReturn, setCloseReturn] = useState("");
  const [closeActualReturn, setCloseActualReturn] = useState("");
  const [closingLoading, setClosingLoading] = useState(false);

  const roi = useMemo(() => {
    const a = parseFloat(amount) || 0;
    const e = parseFloat(expected) || 0;
    if (!a || !e) return null;
    return round2(((e - a) / a) * 100);
  }, [amount, expected]);

  const handleSave = async () => {
    if (!name.trim()) { show("Investment name required", "error"); return; }
    const amtNum = parseFloat(amount);
    if (!amtNum || amtNum <= 0) { show("Enter a valid amount", "error"); return; }
    setLoading(true);
    try {
      await createInvestment({
        groupId: group?.id!,
        investmentName: name.trim(),
        investmentType: type,
        description: desc.trim() || undefined,
        investmentAmount: amtNum,
        expectedReturn: parseFloat(expected) || amtNum,
        startDate: new Date(startDate).toISOString(),
        maturityDate: maturityDate ? new Date(maturityDate).toISOString() : undefined,
        representativeName: repName.trim() || undefined,
        representativeRole: repRole.trim() || undefined,
        status: "pending_committee",
      });
      show("Investment submitted — awaiting committee approval ✅");
      setTimeout(() => router.back(), 800);
    } catch {
      show("Failed to register investment", "error");
    } finally { setLoading(false); }
  };

  const handleCloseInvestment = async () => {
    if (!selectedInvestment) return;
    
    const returnAmount = parseFloat(closeReturn);
    if (!returnAmount || returnAmount <= 0) {
      show("Enter a valid return amount", "error");
      return;
    }
    
    const actualReturn = closeActualReturn ? parseFloat(closeActualReturn) : undefined;
    
    setClosingLoading(true);
    try {
      await closeInvestment(selectedInvestment.id, returnAmount, actualReturn);
      show(`Investment closed! Return: ${fmtCurrency(returnAmount)}`, "success");
      setShowCloseModal(false);
      setSelectedInvestment(null);
      setCloseReturn("");
      setCloseActualReturn("");
      router.back();
    } catch (error: any) {
      show(error.message || "Failed to close investment", "error");
    } finally {
      setClosingLoading(false);
    }
  };

  const openCloseModal = (investment: any) => {
    setSelectedInvestment(investment);
    setCloseReturn(String(investment.investmentAmount || 0));
    setCloseActualReturn("");
    setShowCloseModal(true);
  };

  const openInvestments = investments.filter(i => i.status === "open");

  return (
    <ModalShell title="Add Investment" onClose={() => router.back()}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={styles.sectionLbl}>Basic Info</Text>
        <Input label="Investment Name *" value={name} onChangeText={setName} placeholder="Real Estate Plot, Agricultural Co-op…" />
        <Select label="Type" value={type} options={INV_TYPES} onChange={setType} />
        <Input label="Description" value={desc} onChangeText={setDesc} placeholder="Brief description" multiline />

        <Text style={styles.sectionLbl}>Financials</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Input label={`Amount (${group?.currency ?? "RWF"}) *`} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="300000" prefix={group?.currency ?? "RWF"} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Expected Return" value={expected} onChangeText={setExpected} keyboardType="numeric" placeholder="360000" prefix={group?.currency ?? "RWF"} />
          </View>
        </View>
        {roi !== null && (
          <View style={styles.roiBadge}>
            <Text style={{ fontSize: 13, color: roi >= 0 ? Colors.success : Colors.error, fontWeight: "700" }}>
              {roi >= 0 ? "📈" : "📉"} Estimated ROI: {roi > 0 ? "+" : ""}{roi}%
            </Text>
          </View>
        )}

        <Text style={styles.sectionLbl}>Dates</Text>
        <DatePicker label="Start Date" value={startDate} onChange={setStartDate} placeholder="Select start date" />
        <DatePicker label="Maturity Date (Optional)" value={maturityDate} onChange={setMaturityDate} placeholder="Select maturity date" />

        <Text style={styles.sectionLbl}>Representative (Optional)</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Input label="Name" value={repName} onChangeText={setRepName} placeholder="Full name" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Role / Title" value={repRole} onChangeText={setRepRole} placeholder="Manager, Director…" />
          </View>
        </View>

        <Button label="Register Investment" onPress={handleSave} fullWidth loading={loading} size="lg" />

        {/* Open Investments Section */}
        {(openInvestments.length > 0) && (
          <View style={styles.openInvestmentsSection}>
            <Text style={styles.sectionLbl}>Open Investments</Text>
            {openInvestments.map((inv) => (
              <View key={inv.id} style={styles.investmentItem}>
                <View style={styles.investmentInfo}>
                  <Text style={styles.investmentName}>{inv.investmentName}</Text>
                  <Text style={styles.investmentAmount}>{fmtCurrency(inv.investmentAmount)}</Text>
                  <Text style={styles.investmentType}>{inv.investmentType.replace('_', ' ')}</Text>
                </View>
                <TouchableOpacity 
                  style={styles.closeBtn}
                  onPress={() => openCloseModal(inv)}
                >
                  <Text style={styles.closeBtnText}>Close & Return</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Close Investment Modal */}
      <BottomModal
        visible={showCloseModal}
        onClose={() => { setShowCloseModal(false); setSelectedInvestment(null); setCloseReturn(""); setCloseActualReturn(""); }}
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
                {!!(selectedInvestment.expectedReturn) && !!(selectedInvestment.investmentAmount) && (
                  <Text style={[styles.modalDetail, { color: Colors.gold }]}>
                    Expected ROI: {round2(((selectedInvestment.expectedReturn - selectedInvestment.investmentAmount) / selectedInvestment.investmentAmount) * 100)}%
                  </Text>
                )}
              </View>

              <Input
                label="Total Return Amount *"
                value={closeReturn}
                onChangeText={setCloseReturn}
                keyboardType="numeric"
                placeholder="Enter total return amount"
                prefix={group?.currency ?? "RWF"}
              />
              
              <Input
                label="Actual Profit/Loss (Optional)"
                value={closeActualReturn}
                onChangeText={setCloseActualReturn}
                keyboardType="numeric"
                placeholder="Enter actual profit or loss"
                prefix={group?.currency ?? "RWF"}
                hint="Leave blank to use calculated profit/loss"
              />

              {!!(closeReturn) && !!(selectedInvestment.investmentAmount) && (
                <View style={styles.profitPreview}>
                  <Text style={styles.profitLabel}>
                    {parseFloat(closeReturn) >= selectedInvestment.investmentAmount ? '📈 Profit' : '📉 Loss'}
                  </Text>
                  <Text style={[
                    styles.profitAmount,
                    { color: parseFloat(closeReturn) >= selectedInvestment.investmentAmount ? Colors.success : Colors.error }
                  ]}>
                    {fmtCurrency(Math.abs(parseFloat(closeReturn) - selectedInvestment.investmentAmount))}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Button
                  label="Cancel"
                  onPress={() => { setShowCloseModal(false); setSelectedInvestment(null); setCloseReturn(""); setCloseActualReturn(""); }}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
                <Button
                  label="Close Investment"
                  onPress={handleCloseInvestment}
                  variant="primary"
                  style={{ flex: 1 }}
                  loading={closingLoading}
                />
              </View>
            </>
          )}
        </View>
      </BottomModal>

      <Toast />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingTop: Platform.OS === "ios" ? 56 : 36, paddingBottom: S.lg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { fontSize: 17, fontWeight: "700", color: Colors.text },
  cancel: { color: Colors.accent, fontSize: 15, fontWeight: "600" },
  body: { padding: S.lg, paddingBottom: 60 },
  sectionLbl: { fontSize: 11, fontWeight: "700", color: Colors.text2, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 16, marginBottom: 10 },
  roiBadge: { backgroundColor: Colors.accentFaint, borderWidth: 1, borderColor: Colors.accentFaint, borderRadius: R.md, padding: S.md, marginBottom: S.md },
  
  openInvestmentsSection: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 16,
  },
  investmentItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: R.md,
    padding: S.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  investmentInfo: {
    flex: 1,
  },
  investmentName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  investmentAmount: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.primary,
    marginTop: 2,
  },
  investmentType: {
    fontSize: 11,
    color: Colors.text3,
    marginTop: 1,
  },
  closeBtn: {
    backgroundColor: Colors.goldBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
  },
  closeBtnText: {
    color: Colors.gold,
    fontSize: 11,
    fontWeight: "700",
  },
  
  modalInfo: {
    backgroundColor: Colors.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: "center",
  },
  modalMember: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
  },
  modalAmount: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.primary,
    marginTop: 4,
  },
  modalDetail: {
    fontSize: 12,
    color: Colors.text3,
    marginTop: 4,
  },
  
  profitPreview: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.elevated,
    padding: S.md,
    borderRadius: R.md,
    marginTop: 8,
  },
  profitLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  profitAmount: {
    fontSize: 16,
    fontWeight: "700",
  },
});