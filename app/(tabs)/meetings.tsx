// app/(tabs)/meetings.tsx
//
// Redesigned with personal attendance visibility:
//
//   • "My Attendance" summary card shows the current user their own
//     present / late / absent / excused counts, attendance rate, and
//     any unpaid penalties they personally owe across all meetings.
//   • Every meeting row shows a "YOU:" strip with the current user's
//     own status for that meeting and any penalty they personally
//     incurred (paid or unpaid).
//   • Desktop and mobile layouts unified into one responsive render.
import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useStore,
  useGroupMeetings,
  useGroupMembers,
  useCurrentUserRole,
  useIsGroupView,
} from "../../stores/useStore";
import {
  useCurrentMemberPermissions,
  useMyMemberIds,
} from "../../stores/selectors";
import {
  useToast,
  Toast,
  Button,
  BottomModal,
  Input,
} from "../../components/ui";
import { KpiCard } from "../../components/ui/KpiCard";
import { C, fmtCurrency, showConfirm } from "../../utils/theme";
import type { Meeting } from "../../types";

const Divider = () => <View style={{ height: 1, backgroundColor: C.border }} />;

function Chip({
  label,
  bg,
  color,
}: {
  label: string;
  bg: string;
  color: string;
}) {
  return (
    <View style={[st.chip, { backgroundColor: bg }]}>
      <Text style={[st.chipText, { color }]}>{label}</Text>
    </View>
  );
}

// ── Personal attendance strip ────────────────────────────────────────
//
// Rendered inside each MeetingRow when the current user has an
// attendance record for that meeting. Makes the individual's own
// status (present / late / absent / excused) and any penalty they
// personally owe visible without having to scan the aggregate counts.
function PersonalAttendanceStrip({
  attendee,
}: {
  attendee: any;
}) {
  const status =
    attendee.status ?? (attendee.attended ? "present" : "absent");
  const penaltyAmount = attendee.penaltyAmount ?? 0;
  const penaltyPaid = !!attendee.penaltyPaid;

  let label = "Present";
  let labelColor = C.greenText;
  let bg = C.greenBg;
  let border = "rgba(16,185,129,0.25)";
  let icon = "✓";

  if (status === "late") {
    label = "Late";
    labelColor = C.goldText;
    bg = C.goldBg;
    border = "rgba(217,119,6,0.25)";
    icon = "⏱";
  } else if (status === "absent") {
    label = "Absent";
    labelColor = C.redText;
    bg = C.redBg;
    border = "rgba(239,68,68,0.3)";
    icon = "✗";
  } else if (status === "excused") {
    label = "Excused";
    labelColor = C.text2;
    bg = C.mutedBg;
    border = C.border;
    icon = "—";
  }

  return (
    <View
      style={[
        st.personalStrip,
        { backgroundColor: bg, borderColor: border },
      ]}
    >
      <Text style={st.personalStripLabel}>YOU</Text>
      <Text style={[st.personalStripStatus, { color: labelColor }]}>
        {icon} {label}
      </Text>

      {penaltyAmount > 0 ? (
        <Text
          style={[
            st.personalPenaltyText,
            { color: penaltyPaid ? C.greenText : C.redText },
          ]}
        >
          {fmtCurrency(penaltyAmount)}
          {penaltyPaid ? " · paid" : " · unpaid"}
        </Text>
      ) : (
        <Text style={st.personalNoPenalty}>No penalty</Text>
      )}
    </View>
  );
}

// ── Personal attendance summary card ────────────────────────────────
function PersonalAttendanceCard({
  stats,
}: {
  stats: {
    total: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    unpaidPenalties: number;
    paidPenalties: number;
  };
}) {
  const attendanceRate =
    stats.total > 0
      ? Math.round(((stats.present + stats.late) / stats.total) * 100)
      : 0;

  const hasUnpaid = stats.unpaidPenalties > 0;

  return (
    <View style={[st.personalCard, hasUnpaid && st.personalCardAlert]}>
      <View style={st.personalCardHeader}>
        <Text style={st.personalCardIcon}>🧑</Text>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.personalCardTitle}>My Attendance</Text>
          <Text style={st.personalCardSub}>
            {stats.total} meeting{stats.total !== 1 ? "s" : ""} recorded
          </Text>
        </View>

        <View style={st.personalRateBadge}>
          <Text style={st.personalRateValue}>{attendanceRate}%</Text>
          <Text style={st.personalRateLabel}>rate</Text>
        </View>
      </View>

      <View style={st.personalStatsGrid}>
        <View style={st.personalStat}>
          <Text style={[st.personalStatValue, { color: C.success }]}>
            {stats.present}
          </Text>
          <Text style={st.personalStatLabel}>Present</Text>
        </View>
        <View style={st.personalStat}>
          <Text style={[st.personalStatValue, { color: C.gold }]}>
            {stats.late}
          </Text>
          <Text style={st.personalStatLabel}>Late</Text>
        </View>
        <View style={st.personalStat}>
          <Text style={[st.personalStatValue, { color: C.error }]}>
            {stats.absent}
          </Text>
          <Text style={st.personalStatLabel}>Absent</Text>
        </View>
        <View style={st.personalStat}>
          <Text style={[st.personalStatValue, { color: C.text2 }]}>
            {stats.excused}
          </Text>
          <Text style={st.personalStatLabel}>Excused</Text>
        </View>
      </View>

      {hasUnpaid ? (
        <View style={st.personalUnpaidRow}>
          <Text style={st.personalUnpaidLabel}>⚠️ Unpaid penalties</Text>
          <Text style={st.personalUnpaidValue}>
            {fmtCurrency(stats.unpaidPenalties)}
          </Text>
        </View>
      ) : stats.paidPenalties > 0 ? (
        <View style={st.personalPaidRow}>
          <Text style={st.personalPaidLabel}>✓ All penalties cleared</Text>
          <Text style={st.personalPaidValue}>
            {fmtCurrency(stats.paidPenalties)} paid
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Meeting row ──────────────────────────────────────────────────────
function MeetingRow({
  meeting,
  members,
  attendance,
  myIds,
  canRecordAttendance,
  canCancel,
  canEdit,
  canDelete,
  canClearPenalties,
  onRecordAttendance,
  onCancel,
  onEdit,
  onDelete,
  onClearPenalties,
  isPast = false,
  isCancelled = false,
}: {
  meeting: Meeting;
  members: any[];
  attendance: {
    total: number;
    present: number;
    absent: number;
    penalties: number;
  };
  myIds: Set<string>;
  canRecordAttendance: boolean;
  canCancel: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canClearPenalties: boolean;
  onRecordAttendance: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClearPenalties: () => void;
  isPast?: boolean;
  isCancelled?: boolean;
}) {
  const isCancelledStatus = meeting.status === "cancelled" || isCancelled;
  const isScheduled = meeting.status === "scheduled";
  const hasUnpaidPenalties = meeting.attendees.some(
    (a) => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid,
  );
  const isExpired =
    new Date(meeting.date) < new Date() && !isCancelledStatus;

  // The current user's own attendance record for this meeting, if any.
  const myAttendee = meeting.attendees.find((a) => myIds.has(a.memberId));

  let statusLabel = "";
  let statusBg = "";
  let statusColor = "";

  if (isCancelledStatus) {
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
    <View style={[st.meetingRow, isCancelledStatus && { opacity: 0.6 }]}>
      <View
        style={[
          st.dateBadge,
          isCancelledStatus && { backgroundColor: C.mutedBg },
        ]}
      >
        <Text
          style={[
            st.dateBadgeDay,
            isCancelledStatus && { color: C.text3 },
          ]}
        >
          {new Date(meeting.date).getDate()}
        </Text>
        <Text
          style={[
            st.dateBadgeMon,
            isCancelledStatus && { color: C.text3 },
          ]}
        >
          {new Date(meeting.date)
            .toLocaleDateString("en", { month: "short" })
            .toUpperCase()}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.meetingTopRow}>
          <Text
            style={[
              st.meetingTitle,
              isCancelledStatus && {
                textDecorationLine: "line-through",
                color: C.text3,
              },
            ]}
            numberOfLines={1}
          >
            {meeting.title}
          </Text>
          <Chip label={statusLabel} bg={statusBg} color={statusColor} />
        </View>

        {meeting.location ? (
          <Text style={st.meetingMeta} numberOfLines={1}>
            📍 {meeting.location}
          </Text>
        ) : null}

        {/* Personal status — always shown inside a row. Even in
            group view an admin benefits from seeing "my" status for a
            given meeting at a glance; the *card* at the top of the
            screen is what changes between views, not this strip. */}
        {myAttendee ? (
          <PersonalAttendanceStrip attendee={myAttendee} />
        ) : null}

        {/* Aggregate attendance (staff-facing summary) */}
        {attendance.total > 0 && !isCancelledStatus ? (
          <View style={st.attendanceRow}>
            <Text style={st.attendanceStat}>
              <Text style={{ color: C.accent, fontWeight: "700" }}>
                {attendance.present}
              </Text>{" "}
              present
            </Text>
            <Text style={st.attendanceDot}>·</Text>
            <Text style={st.attendanceStat}>
              <Text style={{ color: C.debit, fontWeight: "700" }}>
                {attendance.absent}
              </Text>{" "}
              absent
            </Text>
            {attendance.penalties > 0 ? (
              <>
                <Text style={st.attendanceDot}>·</Text>
                <Text style={st.attendanceStat}>
                  <Text
                    style={{ color: C.goldText, fontWeight: "700" }}
                  >
                    {fmtCurrency(attendance.penalties)}
                  </Text>{" "}
                  penalties
                </Text>
              </>
            ) : null}
          </View>
        ) : null}

        {meeting.agenda && !isCancelledStatus ? (
          <Text style={st.agenda} numberOfLines={2}>
            {meeting.agenda}
          </Text>
        ) : null}

        {!isCancelledStatus && isScheduled ? (
          <View style={st.meetingActions}>
            {canRecordAttendance ? (
              <TouchableOpacity
                style={st.attendBtn}
                onPress={onRecordAttendance}
                activeOpacity={0.8}
              >
                <Text style={st.attendBtnText}>
                  {attendance.total > 0
                    ? "Update Attendance"
                    : "Record Attendance"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {canCancel ? (
              <TouchableOpacity
                style={st.cancelBtn}
                onPress={onCancel}
                activeOpacity={0.8}
              >
                <Text style={st.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {canEdit || canDelete ? (
          <View style={[st.meetingActions, { marginTop: 8 }]}>
            {canEdit ? (
              <TouchableOpacity
                style={st.editBtn}
                onPress={onEdit}
                activeOpacity={0.8}
              >
                <Text style={st.editBtnText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
            {canDelete ? (
              <TouchableOpacity
                style={st.deleteBtn}
                onPress={onDelete}
                activeOpacity={0.8}
              >
                <Text style={st.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {canClearPenalties && !isCancelledStatus && hasUnpaidPenalties ? (
          <TouchableOpacity
            style={st.penaltyBtn}
            onPress={onClearPenalties}
            activeOpacity={0.8}
          >
            <Text style={st.penaltyBtnText}>Clear Penalties</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────
export default function MeetingsScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const penaltyListMaxHeight = Math.min(360, height * 0.4);
  const isWide = width >= 768;

  const meetings = useGroupMeetings();
  const members = useGroupMembers();
  const currentUserRole = useCurrentUserRole();
  const {
    cancelMeeting,
    clearMeetingPenalty,
    deleteMeeting,
    updateMeeting,
    activeGroupId,
  } = useStore();
  const { show, visible, msg, type } = useToast();

  const [showPenaltyModal, setShowPenaltyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    date: "",
    location: "",
    agenda: "",
  });

  const permissions = useCurrentMemberPermissions();
  const myIds = useMyMemberIds();
  const isGroupView = useIsGroupView();

  // Role-based capability — what the user is *allowed* to do, if the
  // right view mode is active.
  const roleCanCancelMeeting =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && (permissions.updateMeetings ?? false);
  const roleCanClearPenalties =
    ["admin", "loan_officer"].includes(currentUserRole) &&
    (permissions.updateMeetings ?? false);
  const roleCanRecordAttendance =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && (permissions.updateMeetings ?? false);
  const roleCanScheduleMeeting =
    ["admin", "accountant"].includes(currentUserRole) &&
    (permissions.updateMeetings ?? false);
  const roleCanEditMeeting =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && (permissions.updateMeetings ?? false);
  const roleCanDeleteMeeting =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && (permissions.updateMeetings ?? false);

  // Effective capability — role AND group view mode. Switching to
  // Personal is an explicit "show me my stuff" signal, so admin
  // affordances disappear even for admins/accountants in that mode.
  const canCancelMeeting = isGroupView && roleCanCancelMeeting;
  const canClearPenalties = isGroupView && roleCanClearPenalties;
  const canRecordAttendance = isGroupView && roleCanRecordAttendance;
  const canScheduleMeeting = isGroupView && roleCanScheduleMeeting;
  const canEditMeeting = isGroupView && roleCanEditMeeting;
  const canDeleteMeeting = isGroupView && roleCanDeleteMeeting;

  const visibleMeetings = meetings;

  const getAttendanceSummary = (meeting: Meeting) => {
    const total = meeting.attendees?.length || 0;
    const present =
      meeting.attendees?.filter((a) => a.attended).length || 0;
    const penalties =
      meeting.attendees?.reduce(
        (sum, a) => sum + ((a.penaltyAmount ?? 0) || 0),
        0,
      ) || 0;
    return { total, present, absent: total - present, penalties };
  };

  const stats = useMemo(() => {
    const total = visibleMeetings.length;
    const upcoming = visibleMeetings.filter(
      (m) => new Date(m.date) >= new Date() && m.status !== "cancelled",
    ).length;
    const past = visibleMeetings.filter(
      (m) => new Date(m.date) < new Date() && m.status !== "cancelled",
    ).length;
    const cancelled = visibleMeetings.filter(
      (m) => m.status === "cancelled",
    ).length;
    return { total, upcoming, past, cancelled };
  }, [visibleMeetings]);

  // Personal attendance stats — for any user with attendance records.
  const myStats = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let excused = 0;
    let unpaidPenalties = 0;
    let paidPenalties = 0;
    let total = 0;

    for (const meeting of visibleMeetings) {
      const a = meeting.attendees?.find((att) => myIds.has(att.memberId));
      if (!a) continue;
      total++;

      const status = a.status ?? (a.attended ? "present" : "absent");
      if (status === "present") present++;
      else if (status === "late") late++;
      else if (status === "absent") absent++;
      else if (status === "excused") excused++;

      const p = a.penaltyAmount ?? 0;
      if (p > 0) {
        if (a.penaltyPaid) paidPenalties += p;
        else unpaidPenalties += p;
      }
    }

    return {
      total,
      present,
      late,
      absent,
      excused,
      unpaidPenalties,
      paidPenalties,
    };
  }, [visibleMeetings, myIds]);

  // ── Handlers (unchanged) ────────────────────────────────────────────
  const handleCancelMeeting = (meeting: Meeting) => {
    showConfirm(
      "Cancel Meeting",
      `Cancel "${meeting.title}"? This cannot be undone.`,
      async () => {
        try {
          await cancelMeeting(meeting.id);
          show("Meeting cancelled");
        } catch {
          show("Failed to cancel meeting", "error");
        }
      },
    );
  };

  const handleDeleteMeeting = (meeting: Meeting) => {
    showConfirm(
      "Delete Meeting",
      `Permanently delete "${meeting.title}"? All attendance records will be removed.`,
      async () => {
        try {
          await deleteMeeting(meeting.id, "Deleted by admin");
          show("Meeting deleted");
        } catch {
          show("Failed to delete meeting", "error");
        }
      },
      undefined,
      true,
    );
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
    if (!editForm.title.trim()) {
      show("Meeting title required", "error");
      return;
    }
    if (!editForm.date) {
      show("Meeting date required", "error");
      return;
    }
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
    } catch {
      show("Failed to update meeting", "error");
    }
  };

  const handleClearPenalty = (meeting: Meeting, memberId: string) => {
    showConfirm(
      "Clear Penalty",
      "Clear this penalty? The member will be eligible for loans again.",
      async () => {
        try {
          await clearMeetingPenalty(meeting.id, memberId);
          show("Penalty cleared");
          setShowPenaltyModal(false);
        } catch {
          show("Failed to clear penalty", "error");
        }
      },
    );
  };

  const sorted = useMemo(
    () =>
      [...visibleMeetings].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
    [visibleMeetings],
  );
  const upcoming = sorted.filter(
    (m) => new Date(m.date) >= new Date() && m.status !== "cancelled",
  );
  const past = sorted.filter(
    (m) => new Date(m.date) < new Date() && m.status !== "cancelled",
  );
  const cancelled = sorted.filter((m) => m.status === "cancelled");

  // ── Render helpers ──────────────────────────────────────────────────
  const renderList = (
    items: Meeting[],
    opts: { isPast?: boolean; isCancelled?: boolean },
  ) => (
    <View style={st.card}>
      {items.map((meeting, i) => (
        <React.Fragment key={meeting.id}>
          <MeetingRow
            meeting={meeting}
            members={members}
            attendance={getAttendanceSummary(meeting)}
            myIds={myIds}
            canRecordAttendance={
              opts.isPast || opts.isCancelled ? false : canRecordAttendance
            }
            canCancel={
              opts.isPast || opts.isCancelled ? false : canCancelMeeting
            }
            canEdit={canEditMeeting}
            canDelete={canDeleteMeeting}
            canClearPenalties={
              opts.isCancelled ? false : canClearPenalties
            }
            onRecordAttendance={() =>
              router.push(
                `/modals/meeting-attendance?meetingId=${meeting.id}`,
              )
            }
            onCancel={() => handleCancelMeeting(meeting)}
            onEdit={() => handleEditMeeting(meeting)}
            onDelete={() => handleDeleteMeeting(meeting)}
            onClearPenalties={() => {
              setSelectedMeeting(meeting);
              setShowPenaltyModal(true);
            }}
            isPast={opts.isPast}
            isCancelled={opts.isCancelled}
          />
          {i < items.length - 1 ? <Divider /> : null}
        </React.Fragment>
      ))}
    </View>
  );

  const renderKpiGrid = () => {
    const cards = (
      <>
        {/* <KpiCard
          label={isWide ? "Total Meetings" : "Total"}
          value={String(stats.total)}
          icon="📅"
          subtext={isWide ? "All meetings" : "All"}
          accentColor={C.primary}
          onPress={() => {}}
          layout={isWide ? undefined : "fixed"}
        /> */}
        <KpiCard
          label="Upcoming"
          value={String(stats.upcoming)}
          icon="⏳"
          subtext={isWide ? "Scheduled meetings" : "Scheduled"}
          accentColor={C.gold}
          onPress={() => {}}
          layout={isWide ? undefined : "fixed"}
        />
        <KpiCard
          label="Past"
          value={String(stats.past)}
          icon="✅"
          subtext={isWide ? "Completed meetings" : "Completed"}
          accentColor={C.success}
          onPress={() => {}}
          layout={isWide ? undefined : "fixed"}
        />
        <KpiCard
          label="Cancelled"
          value={String(stats.cancelled)}
          icon="❌"
          subtext={isWide ? "Cancelled meetings" : "Cancelled"}
          accentColor={C.error}
          onPress={() => {}}
          layout={isWide ? undefined : "fixed"}
        />
      </>
    );

    if (isWide) {
      return <View style={st.kpiGrid}>{cards}</View>;
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.mobileKpiScroll}
      >
        <View style={st.mobileKpiRow}>{cards}</View>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Toast visible={visible} msg={msg} type={type} />

      <ScrollView
        contentContainerStyle={
          isWide ? st.container : { padding: 16, paddingBottom: 100 }
        }
        showsVerticalScrollIndicator={false}
      >
        {/* KPI grid is a group-mode surface. In personal view we
            replace it with the personal attendance card instead, so
            both modes have exactly one "summary" block at the top. */}
        {isGroupView ? renderKpiGrid() : null}

        {/* Personal attendance summary — only shown in personal view,
            and only when the user actually has attendance records. */}
        {!isGroupView && myStats.total > 0 ? (
          <PersonalAttendanceCard stats={myStats} />
        ) : null}

        {/* Controls row — the count is always useful, the "+ Schedule"
            button only in group view (already gated by
            canScheduleMeeting, which is now view-gated too). */}
        <View style={isWide ? st.controlsSection : st.mobileControls}>
          <View style={isWide ? st.controlsLeft : undefined}>
            <Text style={isWide ? st.meetingCount : st.mobileMeetingCount}>
              {visibleMeetings.length} meeting
              {visibleMeetings.length !== 1 ? "s" : ""}
            </Text>
          </View>

          {canScheduleMeeting ? (
            <TouchableOpacity
              style={isWide ? st.primaryBtn : st.mobilePrimaryBtn}
              onPress={() => router.push("/modals/add-meeting")}
              activeOpacity={0.8}
            >
              <Text
                style={isWide ? st.primaryBtnText : st.mobilePrimaryBtnText}
              >
                + Schedule
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Meeting lists */}
        {sorted.length === 0 ? (
          <View style={st.empty}>
            <Text style={st.emptyIcon}>📅</Text>
            <Text style={st.emptyText}>No meetings scheduled yet</Text>
            {canScheduleMeeting ? (
              <TouchableOpacity
                style={st.emptyAction}
                onPress={() => router.push("/modals/add-meeting")}
                activeOpacity={0.8}
              >
                <Text style={st.emptyActionText}>
                  Schedule First Meeting
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <>
            {upcoming.length > 0 ? (
              <>
                <Text style={st.sectionLabel}>Upcoming</Text>
                {renderList(upcoming, {})}
              </>
            ) : null}

            {past.length > 0 ? (
              <>
                <Text style={[st.sectionLabel, { marginTop: 20 }]}>
                  Past Meetings
                </Text>
                {renderList(past, { isPast: true })}
              </>
            ) : null}

            {cancelled.length > 0 ? (
              <>
                <Text
                  style={[
                    st.sectionLabel,
                    { marginTop: 20, color: C.error },
                  ]}
                >
                  Cancelled
                </Text>
                {renderList(cancelled, {
                  isPast: true,
                  isCancelled: true,
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* ── Penalty modal ─────────────────────────────────────────── */}
      <BottomModal
        visible={
          showPenaltyModal &&
          !!selectedMeeting &&
          (canClearPenalties ?? false)
        }
        onClose={() => setShowPenaltyModal(false)}
        title="Clear Penalties"
      >
        <View style={{ padding: 20 }}>
          <Text style={st.modalName}>{selectedMeeting?.title}</Text>
          <Text style={st.modalSub}>
            Select a member to clear their penalty
          </Text>

          <ScrollView style={{ maxHeight: penaltyListMaxHeight }}>
            {selectedMeeting?.attendees
              .filter(
                (a) => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid,
              )
              .map((attendee) => {
                const member = members.find(
                  (m) => m.id === attendee.memberId,
                );
                return (
                  <View key={attendee.memberId} style={st.penaltyRow}>
                    <View
                      style={{
                        flex: 1,
                        minWidth: 0,
                        marginRight: 10,
                      }}
                    >
                      <Text style={st.penaltyName} numberOfLines={1}>
                        {member?.fullName}
                      </Text>
                      <Text
                        style={[
                          st.penaltyAmount,
                          { color: C.debit },
                        ]}
                        numberOfLines={1}
                      >
                        {fmtCurrency(attendee.penaltyAmount ?? 0)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={st.clearBtn}
                      onPress={() =>
                        handleClearPenalty(
                          selectedMeeting!,
                          attendee.memberId,
                        )
                      }
                      activeOpacity={0.8}
                    >
                      <Text style={st.clearBtnText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

            {!selectedMeeting?.attendees.some(
              (a) => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid,
            ) ? (
              <Text style={st.noPenalties}>
                No unpaid penalties for this meeting
              </Text>
            ) : null}
          </ScrollView>

          <Button
            label="Close"
            onPress={() => setShowPenaltyModal(false)}
            fullWidth
            variant="secondary"
            style={{ marginTop: 12 }}
          />
        </View>
      </BottomModal>

      {/* ── Edit modal ────────────────────────────────────────────── */}
      <BottomModal
        visible={
          showEditModal &&
          !!selectedMeeting &&
          (canEditMeeting ?? false)
        }
        onClose={() => {
          setShowEditModal(false);
          setSelectedMeeting(null);
        }}
        title="Edit Meeting"
      >
        <View style={{ padding: 20 }}>
          <Input
            label="Meeting Title *"
            value={editForm.title}
            onChangeText={(text) =>
              setEditForm((prev) => ({ ...prev, title: text }))
            }
            placeholder="Monthly General Meeting"
          />
          <Input
            label="Date *"
            value={editForm.date}
            onChangeText={(text) =>
              setEditForm((prev) => ({ ...prev, date: text }))
            }
            placeholder="YYYY-MM-DD"
          />
          <Input
            label="Location"
            value={editForm.location}
            onChangeText={(text) =>
              setEditForm((prev) => ({ ...prev, location: text }))
            }
            placeholder="Meeting venue"
          />
          <Input
            label="Agenda"
            value={editForm.agenda}
            onChangeText={(text) =>
              setEditForm((prev) => ({ ...prev, agenda: text }))
            }
            placeholder="Topics to discuss..."
            multiline
            numberOfLines={3}
          />
          <View
            style={{ flexDirection: "row", gap: 10, marginTop: 16 }}
          >
            <Button
              label="Cancel"
              onPress={() => {
                setShowEditModal(false);
                setSelectedMeeting(null);
              }}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              label="Save Changes"
              onPress={handleUpdateMeeting}
              variant="primary"
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </BottomModal>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },

  // ── KPI grid ──
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  mobileKpiScroll: {
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  mobileKpiRow: {
    flexDirection: "row",
    gap: 10,
  },

  // ── Personal summary card ──
  personalCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  personalCardAlert: {
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.04)",
  },
  personalCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  personalCardIcon: { fontSize: 20 },
  personalCardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: C.text,
  },
  personalCardSub: {
    fontSize: 11,
    color: C.text3,
    marginTop: 1,
  },
  personalRateBadge: {
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: C.pill,
    borderRadius: 10,
  },
  personalRateValue: {
    fontSize: 14,
    fontWeight: "800",
    color: C.primary,
    lineHeight: 16,
  },
  personalRateLabel: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  personalStatsGrid: {
    flexDirection: "row",
    gap: 8,
  },
  personalStat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    backgroundColor: C.elevated,
    borderRadius: 8,
    minWidth: 0,
  },
  personalStatValue: {
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 20,
  },
  personalStatLabel: {
    fontSize: 9,
    color: C.text3,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginTop: 2,
  },
  personalUnpaidRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(239,68,68,0.2)",
  },
  personalUnpaidLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: C.error,
  },
  personalUnpaidValue: {
    fontSize: 15,
    fontWeight: "800",
    color: C.error,
  },
  personalPaidRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  personalPaidLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: C.success,
  },
  personalPaidValue: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text2,
  },

  // ── Personal attendance strip (inside row) ──
  personalStrip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 6,
  },
  personalStripLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: C.text3,
    letterSpacing: 1,
  },
  personalStripStatus: {
    fontSize: 12,
    fontWeight: "800",
  },
  personalPenaltyText: {
    fontSize: 12,
    fontWeight: "800",
    marginLeft: "auto",
  },
  personalNoPenalty: {
    fontSize: 11,
    color: C.text3,
    fontWeight: "600",
    marginLeft: "auto",
  },

  // ── Controls ──
  controlsSection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 16,
  },
  controlsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  controlsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  meetingCount: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text2,
  },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  mobileControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  mobileMeetingCount: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text2,
  },
  mobilePrimaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  mobilePrimaryBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.text3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 8,
  },

  // ── Card ──
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    marginBottom: 4,
  },

  // ── Chip ──
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "700",
  },

  // ── Meeting row ──
  meetingRow: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  dateBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dateBadgeDay: {
    fontSize: 16,
    fontWeight: "800",
    color: C.primary,
    lineHeight: 20,
  },
  dateBadgeMon: {
    fontSize: 8,
    fontWeight: "700",
    color: C.primary,
    letterSpacing: 0.5,
  },
  meetingTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  meetingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    flex: 1,
    marginRight: 8,
  },
  meetingMeta: {
    fontSize: 11,
    color: C.text3,
    marginBottom: 6,
  },
  attendanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 5,
  },
  attendanceStat: {
    fontSize: 11,
    color: C.text2,
  },
  attendanceDot: {
    fontSize: 11,
    color: C.text3,
  },
  agenda: {
    fontSize: 12,
    color: C.text3,
    lineHeight: 17,
    marginBottom: 8,
  },
  meetingActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  attendBtn: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  attendBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  cancelBtnText: {
    color: C.redText,
    fontSize: 12,
    fontWeight: "700",
  },
  editBtn: {
    flex: 1,
    backgroundColor: C.tealBg,
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.3)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  editBtnText: {
    color: C.teal,
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    flex: 1,
    backgroundColor: C.redBg,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  deleteBtnText: {
    color: C.redText,
    fontSize: 12,
    fontWeight: "700",
  },
  penaltyBtn: {
    backgroundColor: C.pill,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 6,
  },
  penaltyBtnText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Empty ──
  empty: {
    alignItems: "center",
    paddingVertical: 64,
    gap: 8,
  },
  emptyIcon: { fontSize: 36 },
  emptyText: {
    fontSize: 14,
    color: C.text2,
    fontWeight: "500",
  },
  emptyAction: {
    backgroundColor: C.pill,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  emptyActionText: {
    color: C.primary,
    fontSize: 13,
    fontWeight: "700",
  },

  // ── Modal ──
  modalName: {
    fontSize: 16,
    fontWeight: "700",
    color: C.text,
    marginBottom: 2,
  },
  modalSub: {
    fontSize: 12,
    color: C.text3,
    marginBottom: 16,
  },
  penaltyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  penaltyName: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
  },
  penaltyAmount: {
    fontSize: 12,
    marginTop: 2,
  },
  clearBtn: {
    backgroundColor: C.greenBg,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  clearBtnText: {
    color: C.greenText,
    fontSize: 12,
    fontWeight: "700",
  },
  noPenalties: {
    fontSize: 13,
    color: C.text3,
    textAlign: "center",
    paddingVertical: 24,
  },
});
