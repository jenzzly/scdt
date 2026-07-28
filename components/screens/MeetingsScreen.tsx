import React, { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useStore, useGroupMembers } from "../../stores/useStore";
import { Card, CardRow, Badge, Empty, Button, BottomModal, useToast } from "../ui";
import { Colors, S, R, fmtCurrency, fmtDate } from "../../utils/theme";
import type { Meeting } from "../../types";

export default function MeetingsScreen() {
  const router = useRouter();
  const { meetings, updateMeetingLocal, recordAttendance, activeGroupId } = useStore();
  const members = useGroupMembers();
  const { show, Toast } = useToast();

  const groupMeetings = meetings.filter((m) => m.groupId === activeGroupId);
  const [selected, setSelected] = useState<Meeting | null>(null);

  const upcoming = groupMeetings.filter((m) => m.status === "scheduled" && new Date(m.date) >= new Date()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const past = groupMeetings.filter((m) => m.status === "completed" || new Date(m.date) < new Date()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const completeMeeting = async (meetingId: string) => {
    updateMeetingLocal(meetingId, { status: "completed" });
    const { updateMeeting } = await import("../../lib/firestore");
    updateMeeting(activeGroupId!, meetingId, { status: "completed" }).catch(console.warn);
    show("Meeting marked as completed ✅");
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={styles.header}>
        <Text style={styles.title}>Meetings</Text>
        <Button label="+ Schedule" onPress={() => router.push("/modals/add-meeting")} variant="primary" size="sm" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLbl}>Upcoming</Text>
            {upcoming.map((m) => (
              <React.Fragment key={m.id}>
                <MeetingCard meeting={m} onPress={() => setSelected(m)} onComplete={() => completeMeeting(m.id)} />
              </React.Fragment>
            ))}
          </>
        )}

        {past.length > 0 && (
          <>
            <Text style={[styles.sectionLbl, { marginTop: 16 }]}>Past Meetings</Text>
            {past.map((m) => (
              <React.Fragment key={m.id}>
                <MeetingCard meeting={m} onPress={() => setSelected(m)} />
              </React.Fragment>
            ))}
          </>
        )}

        {groupMeetings.length === 0 && (
          <Empty message="No meetings scheduled yet" icon="📋" />
        )}
      </ScrollView>

      {/* Detail modal */}
      {selected && (
        <MeetingDetailModal
          meeting={selected}
          members={members}
          onClose={() => setSelected(null)}
          onAttendance={(memberId, attended, late) => recordAttendance(selected.id, memberId, attended, late)}
        />
      )}
      <Toast />
    </View>
  );
}

function MeetingCard({ meeting, onPress, onComplete }: { meeting: Meeting; onPress: () => void; onComplete?: () => void }) {
  const isUpcoming = meeting.status === "scheduled";
  const attended = meeting.attendees.filter((a) => a.attended).length;
  return (
    <TouchableOpacity style={styles.meetingCard} onPress={onPress} activeOpacity={0.8}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={styles.meetingTitle}>{meeting.title}</Text>
        <Badge label={meeting.status} color={isUpcoming ? "teal" : "muted"} />
      </View>
      <Text style={styles.meetingDate}>📅 {fmtDate(meeting.date)}</Text>
      {meeting.location && <Text style={styles.meetingLoc}>📍 {meeting.location}</Text>}
      {meeting.attendees.length > 0 && (
        <Text style={styles.meetingAttendees}>👥 {attended}/{meeting.attendees.length} attended</Text>
      )}
      {isUpcoming && onComplete && (
        <TouchableOpacity style={styles.completeBtn} onPress={onComplete}>
          <Text style={{ color: Colors.success, fontSize: 12, fontWeight: "700" }}>Mark as Completed</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function MeetingDetailModal({ meeting, members, onClose, onAttendance }: {
  meeting: Meeting;
  members: ReturnType<typeof useGroupMembers>;
  onClose: () => void;
  onAttendance: (memberId: string, attended: boolean, lateMinutes?: number) => void;
}) {
  return (
    <BottomModal visible title={meeting.title} onClose={onClose}>
      <View style={{ padding: S.lg }}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLbl}>Date</Text>
          <Text style={styles.detailVal}>{fmtDate(meeting.date)}</Text>
        </View>
        {meeting.location && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLbl}>Location</Text>
            <Text style={styles.detailVal}>{meeting.location}</Text>
          </View>
        )}
        {meeting.agenda && (
          <View style={[styles.detailRow, { flexDirection: "column", gap: 4 }]}>
            <Text style={styles.detailLbl}>Agenda</Text>
            <Text style={[styles.detailVal, { color: Colors.text2 }]}>{meeting.agenda}</Text>
          </View>
        )}

        <Text style={[styles.sectionLbl, { marginTop: 16 }]}>Attendance ({members.length} members)</Text>
        {members.map((m) => {
          const att = meeting.attendees.find((a) => a.memberId === m.id);
          return (
            <View key={m.id} style={styles.attendeeRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: Colors.text }}>{m.fullName}</Text>
                {att?.penaltyAmount ? (
                  <Text style={{ fontSize: 12, color: Colors.error, marginTop: 2 }}>
                    Fine: {fmtCurrency(att.penaltyAmount)}
                  </Text>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TouchableOpacity
                  style={[styles.attBtn, att?.attended && styles.attBtnActive]}
                  onPress={() => onAttendance(m.id, true)}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: att?.attended ? Colors.success : Colors.text3 }}>✓ Present</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.attBtn, att && !att.attended && styles.attBtnAbsent]}
                  onPress={() => onAttendance(m.id, false)}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700", color: att && !att.attended ? Colors.error : Colors.text3 }}>✗ Absent</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    </BottomModal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingTop: 56, paddingBottom: S.md },
  title: { fontSize: 22, fontWeight: "800", color: Colors.text, letterSpacing: -0.5 },
  sectionLbl: { fontSize: 11, fontWeight: "700", color: Colors.text2, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  meetingCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: R.lg, padding: S.lg, marginBottom: 10 },
  meetingTitle: { fontSize: 15, fontWeight: "700", color: Colors.text, flex: 1 },
  meetingDate: { fontSize: 13, color: Colors.text3, marginBottom: 2 },
  meetingLoc: { fontSize: 13, color: Colors.text3, marginBottom: 2 },
  meetingAttendees: { fontSize: 13, color: Colors.text2, marginTop: 4 },
  completeBtn: { marginTop: 10, backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1, borderColor: "rgba(34,197,94,0.3)", borderRadius: R.md, paddingVertical: 8, alignItems: "center" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLbl: { fontSize: 13, color: Colors.text3 },
  detailVal: { fontSize: 13, fontWeight: "600", color: Colors.text },
  attendeeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  attBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: R.sm, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border },
  attBtnActive: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" },
  attBtnAbsent: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)" },
});
