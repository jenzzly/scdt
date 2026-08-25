import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useActiveGroup } from "../../stores/useStore";
import { Input, Button, useToast, DatePicker } from "../../components/ui";
import { ModalShell } from "../../components/ui/ModalShell";
import { Colors, S } from "../../utils/theme";

export default function AddMeetingModal() {
  const router = useRouter();
  const { scheduleMeeting, activeGroupId } = useStore();
  const { show, Toast } = useToast();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) { show("Meeting title required", "error"); return; }
    if (!date) { show("Date required", "error"); return; }
    setLoading(true);
    try {
      await scheduleMeeting({
        groupId: activeGroupId!,
        title: title.trim(),
        date: new Date(date).toISOString(),
        location: location.trim() || undefined,
        agenda: agenda.trim() || undefined,
        attendees: [],
        status: "scheduled",
      });
      show("Meeting scheduled ✅");
      setTimeout(() => router.back(), 800);
    } catch {
      show("Failed to schedule meeting", "error");
    } finally { setLoading(false); }
  };

  return (
    <ModalShell title="Schedule Meeting" onClose={() => router.back()}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Input label="Meeting Title *" value={title} onChangeText={setTitle} placeholder="Monthly General Meeting" />
        <DatePicker label="Date *" value={date} onChange={setDate} placeholder="Select meeting date" />
        <Input label="Location" value={location} onChangeText={setLocation} placeholder="Kigali City Hall, Room 3" />
        <Input label="Agenda" value={agenda} onChangeText={setAgenda} placeholder="Topics to be discussed…" multiline />
        <Button label="Schedule Meeting" onPress={handleSave} fullWidth loading={loading} size="lg" />
      </ScrollView>
      <Toast />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingTop: Platform.OS === "ios" ? 56 : 36, paddingBottom: S.lg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { fontSize: 17, fontWeight: "700", color: Colors.text },
  cancel: { color: Colors.accent, fontSize: 15, fontWeight: "600" },
  body: { padding: S.lg },
});
