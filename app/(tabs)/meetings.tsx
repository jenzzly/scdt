// app/(tabs)/meetings.tsx
import React, { useState, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, useWindowDimensions} from "react-native";
import { useRouter } from "expo-router";
import { useStore, useGroupMeetings, useGroupMembers, useCurrentUserRole, useCurrentMember, useIsAdminView } from "../../stores/useStore";
import { useCurrentMemberPermissions } from "../../stores/selectors";
import { useToast, Button, BottomModal, Input } from "../../components/ui";
import { Colors, S, R, C, fmtDate, fmtCurrency, showConfirm } from "../../utils/theme";
import type { Meeting } from "../../types";

const Divider = () => <View style={{ height: 1, backgroundColor: C.border }} />;

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[st.chip, { backgroundColor: bg }]}>
      <Text style={[st.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export default function MeetingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const meetings = useGroupMeetings();
  const members = useGroupMembers();
  const currentMember = useCurrentMember();
  const isAdminView = useIsAdminView();
  const currentUserRole = useCurrentUserRole();
  const { cancelMeeting, clearMeetingPenalty, deleteMeeting, updateMeeting, activeGroupId } = useStore();
  const { show, Toast } = useToast();

  const [showPenaltyModal, setShowPenaltyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [editForm, setEditForm] = useState({ title: "", date: "", location: "", agenda: "" });

  const isAdmin = currentUserRole === "admin";
  const permissions = useCurrentMemberPermissions();
  const canCancelMeeting = ["admin", "committee", "loan_officer", "accountant"].includes(currentUserRole) && permissions.updateMeetings;
  const canClearPenalties = ["admin", "loan_officer"].includes(currentUserRole) && permissions.updateMeetings;
  const canRecordAttendance = ["admin", "committee", "loan_officer", "accountant"].includes(currentUserRole) && permissions.updateMeetings;
  const canScheduleMeeting = ["admin", "accountant"].includes(currentUserRole) && permissions.updateMeetings;
  const canEditMeeting = isAdmin;
  const canDeleteMeeting = isAdmin;

  const visibleMeetings = useMemo(
    () => isAdminView
      ? meetings
      : meetings.filter(meeting => meeting.attendees?.some(attendee => attendee.memberId === currentMember?.id)),
    [meetings, isAdminView, currentMember],
  );

  const getAttendanceSummary = (meeting: Meeting) => {
    const total = meeting.attendees?.length || 0;
    const present = meeting.attendees?.filter(a => a.attended).length || 0;
    const penalties = meeting.attendees?.reduce((sum, a) => sum + ((a.penaltyAmount ?? 0) || 0), 0) || 0;
    return { total, present, absent: total - present, penalties };
  };

  const handleCancelMeeting = (meeting: Meeting) => {
    showConfirm("Cancel Meeting", `Cancel "${meeting.title}"? This cannot be undone.`, async () => {
      try { await cancelMeeting(meeting.id); show("Meeting cancelled"); }
      catch { show("Failed to cancel meeting", "error"); }
    });
  };

  const handleDeleteMeeting = (meeting: Meeting) => {
    showConfirm("Delete Meeting", `Permanently delete "${meeting.title}"? All attendance records will be removed.`, async () => {
      try { await deleteMeeting(meeting.id, "Deleted by admin"); show("Meeting deleted"); }
      catch { show("Failed to delete meeting", "error"); }
    }, undefined, true);
  };

  const handleEditMeeting = (meeting: Meeting) => {
    setEditForm({
      title: meeting.title,
      date: meeting.date.split("T")[0],
      location: meeting.location || "",
      agenda: meeting.agenda || "",
    });
    setSelectedMeeting(meeting);
    setShowEditModal(true);
  };

  const handleUpdateMeeting = async () => {
    if (!editForm.title.trim()) { show("Meeting title required", "error"); return; }
    if (!editForm.date) { show("Meeting date required", "error"); return; }
    try {
      await updateMeeting(activeGroupId!, selectedMeeting!.id, {
        title: editForm.title.trim(),
        date: new Date(editForm.date).toISOString(),
        location: editForm.location.trim() || undefined,
        agenda: editForm.agenda.trim() || undefined,
      });
      show("Meeting updated");
      setShowEditModal(false);
      setSelectedMeeting(null);
    } catch { show("Failed to update meeting", "error"); }
  };

  const handleClearPenalty = (meeting: Meeting, memberId: string) => {
    showConfirm("Clear Penalty", "Clear this penalty? The member will be eligible for loans again.", async () => {
      try { await clearMeetingPenalty(meeting.id, memberId); show("Penalty cleared"); setShowPenaltyModal(false); }
      catch { show("Failed to clear penalty", "error"); }
    });
  };

  const sorted = useMemo(() => [...visibleMeetings].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [visibleMeetings]);
  const upcoming = sorted.filter(m => new Date(m.date) >= new Date() && m.status !== "cancelled");
  const past = sorted.filter(m => new Date(m.date) < new Date() || m.status === "cancelled");

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.header}>
        <View>
          <Text style={st.headerSub}>Schedule & Track</Text>
          <Text style={st.title}>Meetings</Text>
        </View>
        {canScheduleMeeting && (
          <TouchableOpacity style={st.primaryBtn} onPress={() => router.push("/modals/add-meeting")} activeOpacity={0.8}>
            <Text style={st.primaryBtnText}>+ Schedule</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, maxWidth: isWide ? 960 : undefined, alignSelf: isWide ? "center" as any : undefined, width: "100%" as any }} showsVerticalScrollIndicator={false}>
        {sorted.length === 0 ? (
          <View style={st.empty}>
            <Text style={st.emptyIcon}>📅</Text>
            <Text style={st.emptyText}>No meetings scheduled yet</Text>
            {canScheduleMeeting && (
              <TouchableOpacity style={st.emptyAction} onPress={() => router.push("/modals/add-meeting")} activeOpacity={0.8}>
                <Text style={st.emptyActionText}>Schedule First Meeting</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {(upcoming.length > 0) && (
              <>
                <Text style={st.sectionLabel}>Upcoming</Text>
                <View style={st.card}>
                  {upcoming.map((meeting, i) => (
                    <React.Fragment key={meeting.id}>
                      <MeetingRow
                        meeting={meeting}
                        members={members}
                        attendance={getAttendanceSummary(meeting)}
                        canRecordAttendance={canRecordAttendance}
                        canCancel={canCancelMeeting}
                        canEdit={canEditMeeting}
                        canDelete={canDeleteMeeting}
                        canClearPenalties={canClearPenalties}
                        onRecordAttendance={() => router.push(`/modals/meeting-attendance?meetingId=${meeting.id}`)}
                        onCancel={() => handleCancelMeeting(meeting)}
                        onEdit={() => handleEditMeeting(meeting)}
                        onDelete={() => handleDeleteMeeting(meeting)}
                        onClearPenalties={() => { setSelectedMeeting(meeting); setShowPenaltyModal(true); }}
                      />
                      {i < upcoming.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </View>
              </>
            )}

            {(past.length > 0) && (
              <>
                <Text style={[st.sectionLabel, { marginTop: 20 }]}>Past Meetings</Text>
                <View style={st.card}>
                  {past.map((meeting, i) => (
                    <React.Fragment key={meeting.id}>
                      <MeetingRow
                        meeting={meeting}
                        members={members}
                        attendance={getAttendanceSummary(meeting)}
                        canRecordAttendance={false}
                        canCancel={false}
                        canEdit={canEditMeeting}
                        canDelete={canDeleteMeeting}
                        canClearPenalties={canClearPenalties}
                        onRecordAttendance={() => {}}
                        onCancel={() => {}}
                        onEdit={() => handleEditMeeting(meeting)}
                        onDelete={() => handleDeleteMeeting(meeting)}
                        onClearPenalties={() => { setSelectedMeeting(meeting); setShowPenaltyModal(true); }}
                        isPast
                      />
                      {i < past.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Penalty Modal */}
      <BottomModal visible={showPenaltyModal && !!selectedMeeting && canClearPenalties} onClose={() => setShowPenaltyModal(false)} title="Clear Penalties">
        <View style={{ padding: 20 }}>
          <Text style={st.modalName}>{selectedMeeting?.title}</Text>
          <Text style={st.modalSub}>Select a member to clear their penalty</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {selectedMeeting?.attendees.filter(a => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid).map(attendee => {
              const member = members.find(m => m.id === attendee.memberId);
              return (
                <View key={attendee.memberId} style={st.penaltyRow}>
                  <View>
                    <Text style={st.penaltyName}>{member?.fullName}</Text>
                    <Text style={[st.penaltyAmount, { color: C.debit }]}>{fmtCurrency(attendee.penaltyAmount)}</Text>
                  </View>
                  <TouchableOpacity style={st.clearBtn} onPress={() => handleClearPenalty(selectedMeeting!, attendee.memberId)} activeOpacity={0.8}>
                    <Text style={st.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {!selectedMeeting?.attendees.some(a => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid) && (
              <Text style={st.noPenalties}>No unpaid penalties for this meeting</Text>
            )}
          </ScrollView>
          <Button label="Close" onPress={() => setShowPenaltyModal(false)} fullWidth variant="secondary" style={{ marginTop: 12 }} />
        </View>
      </BottomModal>

      {/* Edit Meeting Modal */}
      <BottomModal visible={showEditModal && !!selectedMeeting && canEditMeeting} onClose={() => { setShowEditModal(false); setSelectedMeeting(null); }} title="Edit Meeting">
        <View style={{ padding: 20 }}>
          <Input
            label="Meeting Title *"
            value={editForm.title}
            onChangeText={(text) => setEditForm(prev => ({ ...prev, title: text }))}
            placeholder="Monthly General Meeting"
          />
          <Input
            label="Date *"
            value={editForm.date}
            onChangeText={(text) => setEditForm(prev => ({ ...prev, date: text }))}
            placeholder="YYYY-MM-DD"
          />
          <Input
            label="Location"
            value={editForm.location}
            onChangeText={(text) => setEditForm(prev => ({ ...prev, location: text }))}
            placeholder="Meeting venue"
          />
          <Input
            label="Agenda"
            value={editForm.agenda}
            onChangeText={(text) => setEditForm(prev => ({ ...prev, agenda: text }))}
            placeholder="Topics to discuss..."
            multiline
            numberOfLines={3}
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Button label="Cancel" onPress={() => { setShowEditModal(false); setSelectedMeeting(null); }} variant="secondary" style={{ flex: 1 }} />
            <Button label="Save Changes" onPress={handleUpdateMeeting} variant="primary" style={{ flex: 1 }} />
          </View>
        </View>
      </BottomModal>

      <Toast />
    </View>
  );
}

function MeetingRow({
  meeting, members, attendance, canRecordAttendance, canCancel, canEdit, canDelete,
  canClearPenalties, onRecordAttendance, onCancel, onEdit, onDelete, onClearPenalties, isPast = false,
}: {
  meeting: Meeting; members: any[];
  attendance: { total: number; present: number; absent: number; penalties: number };
  canRecordAttendance: boolean; canCancel: boolean; canEdit: boolean; canDelete: boolean; canClearPenalties: boolean;
  onRecordAttendance: () => void; onCancel: () => void; onEdit: () => void; onDelete: () => void; onClearPenalties: () => void;
  isPast?: boolean;
}) {
  const isCancelled = meeting.status === "cancelled";
  const isScheduled = meeting.status === "scheduled";
  const hasUnpaidPenalties = meeting.attendees.some(a => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid);
  const isExpired = new Date(meeting.date) < new Date() && !isCancelled;

  let statusLabel = "";
  let statusBg = "";
  let statusColor = "";

  if (isCancelled) {
    statusLabel = "Cancelled";
    statusBg = C.mutedBg;
    statusColor = C.text3;
  } else if (isExpired) {
    statusLabel = "Expired";
    statusBg = C.redBg;
    statusColor = C.redText;
  } else if (isScheduled) {
    statusLabel = "Scheduled";
    statusBg = C.goldBg;
    statusColor = C.goldText;
  } else {
    statusLabel = "Completed";
    statusBg = C.greenBg;
    statusColor = C.greenText;
  }

  return (
    <View style={[st.meetingRow, isCancelled && { opacity: 0.6 }]}>
      {/* Date badge */}
      <View style={[st.dateBadge, isCancelled && { backgroundColor: C.mutedBg }]}>
        <Text style={[st.dateBadgeDay, isCancelled && { color: C.text3 }]}>
          {new Date(meeting.date).getDate()}
        </Text>
        <Text style={[st.dateBadgeMon, isCancelled && { color: C.text3 }]}>
          {new Date(meeting.date).toLocaleDateString("en", { month: "short" }).toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <View style={st.meetingTopRow}>
          <Text style={[st.meetingTitle, isCancelled && { textDecorationLine: "line-through", color: C.text3 }]} numberOfLines={1}>
            {meeting.title}
          </Text>
          <Chip label={statusLabel} bg={statusBg} color={statusColor} />
        </View>

        {meeting.location && (
          <Text style={st.meetingMeta}>📍 {meeting.location}</Text>
        )}

        {/* Attendance summary */}
        {attendance.total > 0 && !isCancelled && (
          <View style={st.attendanceRow}>
            <Text style={st.attendanceStat}><Text style={{ color: C.accent, fontWeight: "700" }}>{attendance.present}</Text> present</Text>
            <Text style={st.attendanceDot}>·</Text>
            <Text style={st.attendanceStat}><Text style={{ color: C.debit, fontWeight: "700" }}>{attendance.absent}</Text> absent</Text>
            {attendance.penalties > 0 && (
              <>
                <Text style={st.attendanceDot}>·</Text>
                <Text style={st.attendanceStat}><Text style={{ color: C.goldText, fontWeight: "700" }}>{fmtCurrency(attendance.penalties)}</Text> penalties</Text>
              </>
            )}
          </View>
        )}

        {meeting.agenda && !isCancelled && (
          <Text style={st.agenda} numberOfLines={2}>{meeting.agenda}</Text>
        )}

        {/* Action buttons - First row (primary actions) */}
        {!isCancelled && isScheduled && (
          <View style={st.meetingActions}>
            {canRecordAttendance && (
              <TouchableOpacity style={st.attendBtn} onPress={onRecordAttendance} activeOpacity={0.8}>
                <Text style={st.attendBtnText}>
                  {attendance.total > 0 ? "Update Attendance" : "Record Attendance"}
                </Text>
              </TouchableOpacity>
            )}
            {canCancel && (
              <TouchableOpacity style={st.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
                <Text style={st.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Action buttons - Second row (admin actions for any meeting) */}
        {(canEdit || canDelete) && (
          <View style={[st.meetingActions, { marginTop: 8 }]}>
            {canEdit && (
              <TouchableOpacity style={st.editBtn} onPress={onEdit} activeOpacity={0.8}>
                <Text style={st.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity style={st.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
                <Text style={st.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Clear Penalties button */}
        {canClearPenalties && !isCancelled && hasUnpaidPenalties && (
          <TouchableOpacity style={st.penaltyBtn} onPress={onClearPenalties} activeOpacity={0.8}>
            <Text style={st.penaltyBtnText}>Clear Penalties</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: 14, backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerSub: { fontSize: 11, fontWeight: "600", color: C.text3, letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 22, fontWeight: "800", color: C.text, letterSpacing: -0.5, marginTop: 1 },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16 },
  primaryBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  sectionLabel: { fontSize: 11, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden", marginBottom: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 10, fontWeight: "700" },

  meetingRow: { flexDirection: "row", gap: 14, padding: 16 },
  dateBadge: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: C.pill,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  dateBadgeDay: { fontSize: 16, fontWeight: "800", color: C.primary, lineHeight: 20 },
  dateBadgeMon: { fontSize: 8, fontWeight: "700", color: C.primary, letterSpacing: 0.5 },

  meetingTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  meetingTitle: { fontSize: 14, fontWeight: "700", color: C.text, flex: 1, marginRight: 8 },
  meetingMeta: { fontSize: 11, color: C.text3, marginBottom: 6 },

  attendanceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 5 },
  attendanceStat: { fontSize: 11, color: C.text2 },
  attendanceDot: { fontSize: 11, color: C.text3 },
  agenda: { fontSize: 12, color: C.text3, lineHeight: 17, marginBottom: 8 },

  meetingActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  attendBtn: { flex: 2, backgroundColor: C.primary, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  attendBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cancelBtn: { flex: 1, backgroundColor: C.redBg, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  cancelBtnText: { color: C.redText, fontSize: 12, fontWeight: "700" },
  editBtn: { flex: 1, backgroundColor: C.tealBg, borderWidth: 1, borderColor: "rgba(13,148,136,0.3)", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  editBtnText: { color: C.teal, fontSize: 12, fontWeight: "700" },
  deleteBtn: { flex: 1, backgroundColor: C.redBg, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  deleteBtnText: { color: C.redText, fontSize: 12, fontWeight: "700" },
  penaltyBtn: { backgroundColor: C.pill, borderRadius: 8, paddingVertical: 8, alignItems: "center", marginTop: 6 },
  penaltyBtnText: { color: C.primary, fontSize: 12, fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: 64, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { fontSize: 14, color: C.text2, fontWeight: "500" },
  emptyAction: { backgroundColor: C.pill, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 20, marginTop: 4 },
  emptyActionText: { color: C.primary, fontSize: 13, fontWeight: "700" },

  modalName: { fontSize: 16, fontWeight: "700", color: C.text, marginBottom: 2 },
  modalSub: { fontSize: 12, color: C.text3, marginBottom: 16 },
  penaltyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  penaltyName: { fontSize: 14, fontWeight: "600", color: C.text },
  penaltyAmount: { fontSize: 12, marginTop: 2 },
  clearBtn: { backgroundColor: C.greenBg, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  clearBtnText: { color: C.greenText, fontSize: 12, fontWeight: "700" },
  noPenalties: { fontSize: 13, color: C.text3, textAlign: "center", paddingVertical: 24 },
});