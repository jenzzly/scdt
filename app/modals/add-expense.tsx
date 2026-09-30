import { useState, useMemo } from "react";
import { StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup } from "../../stores/useStore";
import { Input, Select, Button, useToast, Toast, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import { KeyboardAwareScrollView } from "../../components/ui/KeyboardAwareScrollView";
import { S, type Palette } from "../../utils/theme";
import { useTheme } from "../../hooks/useTheme";

const CATEGORIES = [
  { label: "Bank Charges", value: "bank_charges" },
  { label: "Communication", value: "communication" },
  { label: "Meeting Expenses", value: "meeting" },
  { label: "System Maintenance", value: "system_maintenance" },
  { label: "Administrative Costs", value: "administrative" },
  { label: "Transport", value: "transport" },
  { label: "Other", value: "other" },
];

export default function AddExpenseModal() {
  const router = useRouter();
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);

  const { addExpense, activeGroupId } = useStore();
  const group = useActiveGroup();
  // const { show, Toast } = useToast();
  const { show, visible, msg, type } = useToast();

  const [category, setCategory] = useState("administrative");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const amtNum = parseFloat(amount);
    if (!amtNum || amtNum <= 0) { show("Enter a valid amount", "error"); return; }
    if (!description.trim()) { show("Description required", "error"); return; }
    setLoading(true);
    try {
      await addExpense({
        groupId: activeGroupId!,
        category: category as any,
        amount: amtNum,
        date: new Date(date).toISOString(),
        description: description.trim(),
      });
      show("Expense recorded ✅");
      setTimeout(() => router.back(), 800);
    } catch {
      show("Failed to record expense", "error");
    } finally { setLoading(false); }
  };

  return (
    <ModalShell noScroll title="Record Expense" onClose={() => router.back()}>
      <KeyboardAwareScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Select label="Category" value={category} options={CATEGORIES} onChange={setCategory} />
        <Input label={`Amount (${group?.currency ?? "RWF"}) *`} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="5000" prefix={group?.currency ?? "RWF"} />
        <DatePicker label="Date *" value={date} onChange={setDate} placeholder="Select expense date" />
        <Input label="Description *" value={description} onChangeText={setDescription} placeholder="What was this expense for?" multiline />
        <Button label="Record Expense" onPress={handleSave} fullWidth loading={loading} size="lg" />
      </KeyboardAwareScrollView>
      <Toast visible={visible} msg={msg} type={type}/>
    </ModalShell>
  );
}

const makeStyles = (C: Palette) => StyleSheet.create({
  body: { padding: S.lg },
});
