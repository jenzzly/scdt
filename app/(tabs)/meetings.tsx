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
  Select,
} from "../../components/ui";
import { KpiCard } from "../../components/ui/KpiCard";
import { C, fmtCurrency, showConfirm } from "../../utils/theme";
import {
  getMeetingStatus,
  findUnrecordedAttendees,
  formatMeetingTime,
  isAttendanceEditable,
  getMeetingEndMs,
} from "../../utils/meetingFees";
import type { Meeting } from "../../types";

// ── Permission helper ─────────────────────────────────────────────────
//
// MemberPermissions carries two meeting-related fields:
//   • manageMeetings   — the current, non-deprecated gate
//   • updateMeetings   — @deprecated alias kept for backward compat
//
// This screen previously checked ONLY updateMeetings. Members whose
// permissions object was written by the newer permissions UI have
// `manageMeetings: true, updateMeetings: undefined`, so every meeting
// action evaluated to false — no Edit, no Delete, no Cancel, no
// Record Attendance. This helper prefers the current field and falls
// back to the alias for old records.
function hasManageMeetingsPermission(
  permissions:
    | { manageMeetings?: boolean; updateMeetings?: boolean }
    | null
    | undefined,
): boolean {
  if (!permissions) return false;
  if (permissions.manageMeetings !== undefined) {
    return permissions.manageMeetings === true;
  }
  return permissions.updateMeetings === true;
}

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
  group,
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
  onFinalize,
}: {
  meeting: Meeting;
  group: any;
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
  onFinalize: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isCancelledStatus = meeting.status === "cancelled";
  const hasUnpaidPenalties = meeting.attendees.some(
    (a) => (a.penaltyAmount ?? 0) > 0 && !a.penaltyPaid,
  );

  const meetingStatus = getMeetingStatus(meeting, group);
  const isScheduled = meetingStatus === "scheduled";
  const isInProgress = meetingStatus === "in_progress";
  const isExpired = meetingStatus === "past" && !isCancelledStatus;

  const startTimeLabel = formatMeetingTime(meeting);
  const endMs = getMeetingEndMs(meeting);
  const endTimeLabel = Number.isFinite(endMs)
    ? new Date(endMs).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const unrecorded = isExpired
    ? findUnrecordedAttendees(meeting, members, group)
    : [];

  const host = meeting.hostMemberId
    ? members.find((m) => m.id === meeting.hostMemberId)
    : null;

  const myAttendee = meeting.attendees.find((a) => myIds.has(a.memberId));

  let statusLabel = "";
  let statusBg = "";
  let statusColor = "";

  if (isCancelledStatus) {
    statusLabel = "Cancelled";
    statusBg = C.mutedBg;
    statusColor = C.text3;
  } else if (isInProgress) {
    statusLabel = "In progress";
    statusBg = C.goldBg;
    statusColor = C.goldText;
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

  const canShowRecord = canRecordAttendance && !isCancelledStatus;
  const canShowFinalize =
    canRecordAttendance && isExpired && unrecorded.length > 0;

  const hasManageOnlyActions =
    canEdit ||
    canDelete ||
    (canCancel && !isCancelledStatus && (isScheduled || isInProgress)) ||
    (canClearPenalties && hasUnpaidPenalties && !isCancelledStatus);

  const hasAnyAction =
    canShowRecord || canShowFinalize || hasManageOnlyActions;

  const showMenuTrigger = !isCancelledStatus && hasManageOnlyActions;

  return (
    <>
      <View
        style={[
          st.rowWrap,
          isCancelledStatus && { opacity: 0.65 },
        ]}
      >
        <View style={st.rowHeader}>
          <View
            style={[
              st.dateBadge,
              isCancelledStatus && { backgroundColor: C.mutedBg },
              isInProgress && { backgroundColor: C.goldBg },
            ]}
          >
            <Text
              style={[
                st.dateBadgeDay,
                isCancelledStatus && { color: C.text3 },
                isInProgress && { color: C.goldText },
              ]}
            >
              {new Date(meeting.date).getDate()}
            </Text>
            <Text
              style={[
                st.dateBadgeMon,
                isCancelledStatus && { color: C.text3 },
                isInProgress && { color: C.goldText },
              ]}
            >
              {new Date(meeting.date)
                .toLocaleDateString("en", { month: "short" })
                .toUpperCase()}
            </Text>
          </View>

          <View style={st.rowTitleBlock}>
            <Text
              style={[
                st.rowTitleText,
                isCancelledStatus && {
                  textDecorationLine: "line-through",
                  color: C.text3,
                },
              ]}
              numberOfLines={2}
            >
              {meeting.title}
            </Text>

            <View style={st.rowMetaLine}>
              <Text style={st.rowMetaText} numberOfLines={1}>
                🕒 {startTimeLabel}
                {endTimeLabel ? ` – ${endTimeLabel}` : ""}
              </Text>
              <Chip label={statusLabel} bg={statusBg} color={statusColor} />
            </View>

            {(meeting.location || host) && (
              <View style={st.rowMetaLine}>
                {meeting.location ? (
                  <Text
                    style={[st.rowMetaText, { flexShrink: 1 }]}
                    numberOfLines={1}
                  >
                    📍 {meeting.location}
                  </Text>
                ) : null}
                {host ? (
                  <Text
                    style={[st.rowMetaText, { flexShrink: 1 }]}
                    numberOfLines={1}
                  >
                    👤 {host.fullName}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {myAttendee && !isCancelledStatus ? (
          <PersonalAttendanceStrip attendee={myAttendee} />
        ) : null}

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

        {hasAnyAction ? (
          <View style={st.actionBar}>
            <View style={st.actionPrimaryRow}>
              {canShowRecord ? (
                <TouchableOpacity
                  style={st.actionPrimary}
                  onPress={onRecordAttendance}
                  activeOpacity={0.85}
                >
                  <Text style={st.actionPrimaryText} numberOfLines={1}>
                    {attendance.total > 0
                      ? "📋  Update Attendance"
                      : "📋  Record Attendance"}
                  </Text>
                </TouchableOpacity>
              ) : isCancelledStatus && (canEdit || canDelete) ? (
                <TouchableOpacity
                  style={[st.actionPrimary, st.actionPrimaryMuted]}
                  onPress={() => setMenuOpen(true)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[st.actionPrimaryText, { color: C.text2 }]}
                    numberOfLines={1}
                  >
                    Manage meeting
                  </Text>
                </TouchableOpacity>
              ) : null}

              {showMenuTrigger ? (
                <TouchableOpacity
                  style={st.actionMenuBtn}
                  onPress={() => setMenuOpen(true)}
                  activeOpacity={0.85}
                  accessibilityLabel="More actions"
                  accessibilityRole="button"
                >
                  <Text style={st.actionMenuBtnText}>⋯</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {canShowFinalize ? (
              <TouchableOpacity
                style={st.finalizeBanner}
                onPress={onFinalize}
                activeOpacity={0.85}
              >
                <Text style={st.finalizeBannerIcon}>⚠️</Text>
                <Text style={st.finalizeBannerText} numberOfLines={1}>
                  {unrecorded.length} member
                  {unrecorded.length !== 1 ? "s" : ""} unrecorded
                </Text>
                <Text style={st.finalizeBannerCta}>Finalize →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      <BottomModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Meeting Actions"
      >
        <View style={st.menuBody}>
          <View style={st.menuHeaderBlock}>
            <Text style={st.menuHeaderTitle} numberOfLines={2}>
              {meeting.title}
            </Text>
            <Text style={st.menuHeaderSub} numberOfLines={2}>
              {new Date(meeting.date).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {` · ${startTimeLabel}`}
              {meeting.location ? ` · ${meeting.location}` : ""}
            </Text>
          </View>

          {canShowFinalize ? (
            <MenuAction
              icon="✓"
              label={`Finalize ${unrecorded.length} absent`}
              description="Mark every unrecorded member absent and apply the group's absence penalty"
              tone="primary"
              onPress={() => {
                setMenuOpen(false);
                onFinalize();
              }}
            />
          ) : null}

          {canEdit ? (
            <MenuAction
              icon="✏️"
              label="Edit meeting"
              description="Change time, host, location, or agenda"
              onPress={() => {
                setMenuOpen(false);
                onEdit();
              }}
            />
          ) : null}

          {canCancel && !isCancelledStatus && (isScheduled || isInProgress) ? (
            <MenuAction
              icon="🚫"
              label="Cancel meeting"
              description="All active members will be notified"
              tone="danger"
              onPress={() => {
                setMenuOpen(false);
                onCancel();
              }}
            />
          ) : null}

          {canClearPenalties &&
          hasUnpaidPenalties &&
          !isCancelledStatus ? (
            <MenuAction
              icon="💸"
              label="Clear penalties"
              description="Mark unpaid fees as settled for this meeting"
              onPress={() => {
                setMenuOpen(false);
                onClearPenalties();
              }}
            />
          ) : null}

          {canDelete ? (
            <>
              <View style={st.menuDivider} />
              <MenuAction
                icon="🗑"
                label="Delete meeting"
                description="Permanently removes the meeting and all its attendance records"
                tone="danger"
                onPress={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              />
            </>
          ) : null}
        </View>
      </BottomModal>
    </>
  );
}

function MenuAction({
  icon,
  label,
  description,
  tone = "default",
  onPress,
}: {
  icon: string;
  label: string;
  description?: string;
  tone?: "default" | "primary" | "danger";
  onPress: () => void;
}) {
  const labelColor =
    tone === "danger" ? C.error : tone === "primary" ? C.primary : C.text;
  const iconBg =
    tone === "danger"
      ? "rgba(239,68,68,0.10)"
      : tone === "primary"
      ? "rgba(46,125,108,0.10)"
      : C.elevated;

  return (
    <TouchableOpacity
      style={st.menuAction}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[st.menuActionIcon, { backgroundColor: iconBg }]}>
        <Text style={{ fontSize: 15 }}>{icon}</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[st.menuActionLabel, { color: labelColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {description ? (
          <Text style={st.menuActionDesc} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>

      <Text style={[st.menuActionChevron, { color: labelColor }]}>›</Text>
    </TouchableOpacity>
  );
}

export default function MeetingsScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const penaltyListMaxHeight = Math.min(360, height * 0.4);
  const isWide = width >= 768;

  const meetings = useGroupMeetings();
  const members = useGroupMembers();
  const currentUserRole = useCurrentUserRole();
  const activeGroup = useStore((s) =>
    s.groups.find((g) => g.id === s.activeGroupId),
  );

  // How long after a meeting start attendance can still be edited.
  // Default 7 days. See Group.attendanceEditWindowDays in types.
  const attendanceEditWindowDays = activeGroup?.attendanceEditWindowDays ?? 7;
  const attendanceWindowMs = attendanceEditWindowDays * 86_400_000;
  const {
    cancelMeeting,
    clearMeetingPenalty,
    deleteMeeting,
    updateMeeting,
    recordAttendance,
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
    ) && hasManageMeetingsPermission(permissions);
  const roleCanClearPenalties =
    ["admin", "loan_officer"].includes(currentUserRole) &&
    hasManageMeetingsPermission(permissions);
  const roleCanRecordAttendance =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && hasManageMeetingsPermission(permissions);
  const roleCanScheduleMeeting =
    ["admin", "accountant"].includes(currentUserRole) &&
    hasManageMeetingsPermission(permissions);
  const roleCanEditMeeting =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && hasManageMeetingsPermission(permissions);
  const roleCanDeleteMeeting =
    ["admin", "committee", "loan_officer", "accountant"].includes(
      currentUserRole,
    ) && hasManageMeetingsPermission(permissions);

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

  const handleFinalizeAttendance = async (meeting: Meeting) => {
    const unrecorded = findUnrecordedAttendees(
      meeting,
      members,
      activeGroup,
    );
    if (unrecorded.length === 0) {
      show("No unrecorded members to finalize");
      return;
    }
    showConfirm(
      "Finalize Attendance",
      `Mark ${unrecorded.length} unrecorded member${
        unrecorded.length !== 1 ? "s" : ""
      } as absent? Each will receive the group's standard absence penalty.`,
      async () => {
        try {
          // Sequential — each write awaits the previous. Firing these
          // in parallel against the same `attendees` array races: every
          // write sends the full array, so the last writer wins and
          // earlier members' updates are silently dropped.
          for (const m of unrecorded) {
            await recordAttendance(meeting.id, m.memberId, false);
          }
          show(
            `${unrecorded.length} member${
              unrecorded.length !== 1 ? "s" : ""
            } marked absent`,
          );
        } catch (e: any) {
          show(e?.message || "Failed to finalize", "error");
        }
      },
      undefined,
      true,
    );
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
  const upcoming = sorted.filter((m) => {
    if (m.status === "cancelled") return false;
    const s = getMeetingStatus(m, activeGroup);
    return s === "scheduled" || s === "in_progress";
  });
  const past = sorted.filter((m) => {
    if (m.status === "cancelled") return false;
    return getMeetingStatus(m, activeGroup) === "past";
  });
  const cancelled = sorted.filter((m) => m.status === "cancelled");

  // ── Render helpers ──────────────────────────────────────────────────
  const renderList = (items: Meeting[]) => (
    <View style={st.card}>
      {items.map((meeting, i) => (
        <React.Fragment key={meeting.id}>
          <MeetingRow
            meeting={meeting}
            group={activeGroup}
            members={members}
            attendance={getAttendanceSummary(meeting)}
            myIds={myIds}
            canRecordAttendance={
              canRecordAttendance &&
              isAttendanceEditable(meeting, activeGroup)
            }
            canCancel={canCancelMeeting}
            canEdit={canEditMeeting}
            canDelete={canDeleteMeeting}
            canClearPenalties={canClearPenalties}
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
            onFinalize={() => handleFinalizeAttendance(meeting)}
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
                {renderList(upcoming)}
              </>
            ) : null}

            {past.length > 0 ? (
              <>
                <Text style={[st.sectionLabel, { marginTop: 20 }]}>
                  Past Meetings
                </Text>
                {renderList(past)}
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
                {renderList(cancelled)}
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
            label="Start Time (HH:mm, optional)"
            value={editForm.startTime}
            onChangeText={(text) =>
              setEditForm((prev) => ({ ...prev, startTime: text }))
            }
            placeholder="14:30"
          />

          <Select
            label="Duration"
            value={editForm.durationMinutes}
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
            onChange={(v) =>
              setEditForm((prev) => ({ ...prev, durationMinutes: Number(v) }))
            }
          />

          <Select
            label="Meeting Owner / Host"
            value={editForm.hostMemberId}
            options={[
              { label: "— Not set —", value: "" },
              ...members
                .filter((m) => m.status === "active")
                .map((m) => ({ label: m.fullName, value: m.id })),
            ]}
            onChange={(v) =>
              setEditForm((prev) => ({ ...prev, hostMemberId: v }))
            }
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
  // ── Redesigned meeting row (2026 refresh) ──────────────────────
  rowWrap: {
    padding: 16,
    gap: 8,
  },
  rowHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  rowTitleBlock: { flex: 1, minWidth: 0 },
  rowTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 3,
  },
  rowMetaText: {
    fontSize: 12,
    color: C.text3,
    flexShrink: 1,
  },

  actionBar: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
    gap: 8,
  },
  actionPrimaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionPrimary: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimaryMuted: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionPrimaryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  actionMenuBtn: {
    width: 46,
    height: 44,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  actionMenuBtnText: {
    fontSize: 20,
    fontWeight: "800",
    color: C.text2,
    lineHeight: 22,
  },

  finalizeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.goldBg,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  finalizeBannerIcon: { fontSize: 13 },
  finalizeBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: C.goldText,
  },
  finalizeBannerCta: {
    fontSize: 12,
    fontWeight: "800",
    color: C.gold,
    letterSpacing: 0.2,
  },

  menuBody: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  menuHeaderBlock: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  menuHeaderTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: C.text,
    marginBottom: 4,
  },
  menuHeaderSub: {
    fontSize: 12,
    color: C.text3,
    lineHeight: 16,
  },
  menuAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  menuActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  menuActionLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  menuActionDesc: {
    fontSize: 11,
    color: C.text3,
    marginTop: 2,
    lineHeight: 15,
  },
  menuActionChevron: {
    fontSize: 20,
    fontWeight: "700",
    opacity: 0.5,
  },
  menuDivider: {
    height: 1,
    backgroundColor: C.borderLight,
    marginVertical: 8,
  },


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
  finalizeBtn: {
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 6,
  },
  finalizeBtnText: {
    color: C.success,
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
