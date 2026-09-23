import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore,
  useActiveGroup,
  useGroupMembers,
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
import { Colors, S, C } from "../../utils/theme";

export default function AddMeetingModal() {
  const router = useRouter();
  const { scheduleMeeting, activeGroupId } = useStore();
  const members = useGroupMembers();
  const { show, visible, msg, type } = useToast();
  const group = useActiveGroup();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [hostMemberId, setHostMemberId] = useState<string>("");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Field-level validation ────────────────────────────────────────────
  const timeEmpty = startTime.trim() === "";
  const timeValid = timeEmpty || /^\d{2}:\d{2}$/.test(startTime.trim());

  const handleSave = async () => {
    if (!title.trim()) {
      show("Meeting title required", "error");
      return;
    }
    if (!date) {
      show("Date required", "error");
      return;
    }
    if (!timeValid) {
      show("Start time must be HH:mm — e.g. 14:30", "error");
      return;
    }

    setLoading(true);
    try {
      await scheduleMeeting({
        groupId: activeGroupId!,
        title: title.trim(),
        date: new Date(`${date}T${timeEmpty ? "00:00" : startTime}:00`).toISOString(),
        startTime: timeEmpty ? undefined : startTime.trim(),
        durationMinutes,
        hostMemberId: hostMemberId || undefined,
        durationMinutes,
        location: location.trim() || undefined,
        agenda: agenda.trim() || undefined,
        attendees: [],
        status: "scheduled",
      });
      show("Meeting scheduled ✅");
      setTimeout(() => router.back(), 800);
    } catch {
      show("Failed to schedule meeting", "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Derived preview of what the time means for attendance ─────────────
  //
  // Group.meetingLateGraceMinutes defaults to 15 in utils/meetingFees.ts.
  // Showing the resulting cutoff inline means an admin who types "14:30"
  // sees "arrivals after 2:45 PM count as late" before saving — no
  // surprise fees a week later.
  const graceMinutes = group?.meetingLateGraceMinutes ?? 15;

  const timePreview = (() => {
    if (timeEmpty) {
      return `No start time set — meeting runs all day. Members can be marked late or absent at any point on ${date}.`;
    }
    if (!timeValid) {
      return "Enter a time in 24-hour HH:mm format — e.g. 14:30 for 2:30 PM.";
    }
    const [h, m] = startTime.split(":").map(Number);
    const start = new Date();
    start.setHours(h, m, 0, 0);
    const cutoff = new Date(start.getTime() + graceMinutes * 60_000);
    const fmt = (d: Date) =>
      d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `Arrivals after ${fmt(cutoff)} will be marked late (${graceMinutes}-minute grace).`;
  })();

  return (
    <ModalShell title="Schedule Meeting" onClose={() => router.back()}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Input
          label="Meeting Title *"
          value={title}
          onChangeText={setTitle}
          placeholder="Monthly General Meeting"
        />

        <DatePicker
          label="Date *"
          value={date}
          onChange={setDate}
          placeholder="Select meeting date"
        />

        <Input
          label="Start Time (HH:mm) — optional"
          value={startTime}
          onChangeText={setStartTime}
          placeholder="14:30"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          hint="Leave blank for an all-day meeting with no late-arrival window."
        />

        <Select
          label="Duration"
          value={durationMinutes}
          options={[
            { label: "30 minutes", value: 30 },
            { label: "1 hour", value: 60 },
            { label: "1h 30min", value: 90 },
            { label: "2 hours", value: 120 },
            { label: "2h 30min", value: 150 },
            { label: "3 hours", value: 180 },
            { label: "3h 30min", value: 210 },
            { label: "4 hours", value: 240 },
            { label: "4h 30min", value: 270 },
            { label: "5 hours", value: 300 },
          ]}
          onChange={(v) => setDurationMinutes(Number(v))}
        />

        <Select
          label="Meeting Owner / Host"
          value={hostMemberId}
          options={[
            { label: "— Not set —", value: "" },
            ...members
              .filter((m) => m.status === "active")
              .map((m) => ({ label: m.fullName, value: m.id })),
          ]}
          onChange={setHostMemberId}
        />

                {/* Derived hint — always visible so the admin sees the effect
            of the time they entered before saving. */}
        <View
          style={[
            styles.startTimePreview,
            !timeValid && styles.startTimePreviewError,
            !timeValid && styles.startTimePreviewErrorShadow,
          ]}
        >
          <Text
            style={[
              styles.startTimePreviewText,
              !timeValid && styles.startTimePreviewTextError,
            ]}
          >
            {timePreview}
          </Text>
        </View>

        <Input
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="Kigali City Hall, Room 3"
        />

        <Input
          label="Agenda"
          value={agenda}
          onChangeText={setAgenda}
          placeholder="Topics to be discussed…"
          multiline
        />

        <Button
          label="Schedule Meeting"
          onPress={handleSave}
          fullWidth
          loading={loading}
          size="lg"
        />
      </ScrollView>

      <Toast visible={visible} msg={msg} type={type} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 17, fontWeight: "700", color: Colors.text },
  cancel: { color: Colors.accent, fontSize: 15, fontWeight: "600" },
  body: { padding: S.lg, paddingBottom: 40 },

  startTimePreview: {
    marginTop: -6,
    marginBottom: S.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: C.elevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  startTimePreviewError: {
    backgroundColor: "rgba(239,68,68,0.06)",
    borderColor: "rgba(239,68,68,0.3)",
  },
  startTimePreviewErrorShadow: {
    boxShadow: "0px 1px 2px rgba(239,68,68,0.1)",
  },
  startTimePreviewText: {
    fontSize: 12,
    color: C.text2,
    lineHeight: 16,
  },
  startTimePreviewTextError: {
    color: C.error,
    fontWeight: "600",
  },
});
