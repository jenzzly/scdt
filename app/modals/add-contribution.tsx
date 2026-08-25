import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, KeyboardAvoidingView} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup, useGroupMembers, useCurrentUserRole, useCurrentMember } from "../../stores/useStore";
import { Input, Select, Button, useToast, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S, R, fmtCurrency } from "../../utils/theme";

const CONTRIB_TYPES = [
  { label: "Regular Contribution", value: "regular"       },
  { label: "Late Fee",             value: "late_fee"      },
  { label: "Penalty",             value: "penalty"        },
  { label: "Other",                value: "other"         },
];

export default function AddContributionModal() {
  const router   = useRouter();
  const group    = useActiveGroup();
  const members  = useGroupMembers();
  const { recordContribution, activeGroupId } = useStore();
  const role     = useCurrentUserRole();
  const currentMember = useCurrentMember();
  const { show, Toast } = useToast();

  const isAdmin = role === "admin";

  const [memberId, setMemberId] = useState(currentMember?.id ?? "");
  const [amount,   setAmount]   = useState(String(group?.contributionAmount ?? ""));
  const [type,     setType]     = useState("regular");
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [desc,     setDesc]     = useState("");
  const [loading,  setLoading]  = useState(false);

  const memberOptions = members
    .filter((m) => m.status === "active")
    .map((m) => ({ label: m.fullName, value: m.id }));

  const handleSave = async () => {
    const contributionMemberId = isAdmin ? memberId : currentMember?.id;
    if (!contributionMemberId) { show("Your member account is not ready", "error"); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { show("Enter a valid amount", "error"); return; }
    if (!activeGroupId) return;
    setLoading(true);
    try {
      const fallbackDesc = CONTRIB_TYPES.find((t) => t.value === type)?.label ?? "Contribution";
      await recordContribution(
        {
          groupId: activeGroupId,
          memberId: contributionMemberId,
          amount: amt,
          contributionType: type as any,
          status: "approved",
          description: desc.trim() || fallbackDesc,
          date: date ? new Date(date + "T12:00:00").toISOString() : new Date().toISOString(),
        },
        true, // auto-approve
      );
      show("Contribution recorded");
      router.back();
    } catch { show("Failed to record contribution", "error"); }
    finally { setLoading(false); }
  };

  return (
    <ModalShell title="Record Contribution" onClose={() => router.back()}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {isAdmin ? (
          <Select
            label="Member *"
            value={memberId}
            options={[{ label: "Select member…", value: "" }, ...memberOptions]}
            onChange={setMemberId}
          />
        ) : (
          <Input label="Member" value={currentMember?.fullName ?? "Current member"} onChangeText={() => {}} editable={false} />
        )}
        <Select
          label="Type *"
          value={type}
          options={CONTRIB_TYPES}
          onChange={setType}
        />
        <Input
          label={`Amount (${group?.currency ?? "RWF"}) *`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          prefix={group?.currency ?? "RWF"}
          hint={`Standard: ${fmtCurrency(group?.contributionAmount ?? 0)}`}
        />
        <DatePicker
          label="Contribution Date"
          value={date}
          onChange={setDate}
          placeholder="Select contribution date"
        />
        <Input
          label="Note (optional)"
          value={desc}
          onChangeText={setDesc}
          placeholder="Any additional notes"
        />
        <View style={{ height: 8 }} />
        <Button label="Record Contribution" onPress={handleSave} fullWidth loading={loading} size="lg" />
      </ScrollView>
      <Toast />
    </ModalShell>
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
});
