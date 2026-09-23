// utils/meetingFees.ts
//
// Time-aware meeting status + unrecorded-attendee detection.
//
// Replaces the old `new Date(meeting.date) < new Date()` check, which
// treated every meeting as starting at midnight and flipped to "past"
// the moment the calendar day began — meaning a 2pm meeting showed as
// Expired at 00:01 that morning, and the Record Attendance button
// disappeared before the meeting had even started.
//
// The window now runs off real start/end times:
//
//   [date + startTime]  → meeting begins
//   [+ durationMinutes] → meeting ends (default 60 min)
//   [+ N days]          → attendance still editable (default 7 days)
import type { Group, Meeting, Member } from "../types";

export type MeetingStatus =
  | "scheduled"
  | "in_progress"
  | "past"
  | "cancelled";

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_ATTENDANCE_EDIT_DAYS = 7;
const LEAD_TIME_MS = 60 * 60_000; // 1 hour before start

/**
 * Combine `meeting.date` and `meeting.startTime` into a local-time
 * epoch millisecond value.
 *
 * `date` may be stored as a bare "YYYY-MM-DD" or as a full ISO string
 * (`new Date(editForm.date).toISOString()` produces the latter). We
 * only need the calendar day, so slicing to the first 10 characters
 * is safe either way.
 *
 * `startTime` is interpreted in local time. In a single-group
 * deployment (one org, one timezone) this matches how an admin thinks
 * about "14:30" when they type it. Multi-timezone groups would need a
 * stored TZ identifier, which the current schema doesn't carry.
 */
export function getMeetingStartMs(meeting: Meeting): number {
  const datePart = meeting.date?.slice(0, 10);
  if (!datePart) return NaN;

  const timePart =
    meeting.startTime && /^\d{2}:\d{2}$/.test(meeting.startTime)
      ? meeting.startTime
      : "00:00";

  const dt = new Date(`${datePart}T${timePart}:00`);
  return dt.getTime();
}

/**
 * Meeting end time in epoch ms — start + duration, falling back to
 * start + 60 minutes when no duration is recorded.
 */
export function getMeetingEndMs(meeting: Meeting): number {
  const startMs = getMeetingStartMs(meeting);
  if (!Number.isFinite(startMs)) return NaN;

  const durationMs = Math.max(
    0,
    (meeting.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000,
  );

  return startMs + durationMs;
}

/** Grace window after start, in ms. Defaults to 15 minutes. */
export function getMeetingGraceMs(group: Group | null | undefined): number {
  const minutes = Math.max(0, group?.meetingLateGraceMinutes ?? 15);
  return minutes * 60_000;
}

/**
 * Time-aware status.
 *
 *   cancelled                       → cancelled
 *   now < start                     → scheduled
 *   start <= now < start + duration → in_progress
 *   now >= start + duration         → past
 *
 * "In progress" now runs for the meeting's full duration, not just a
 * 15-minute grace window. A 2-hour meeting stays "in_progress" for
 * those two hours; "past" begins at start + duration.
 */
export function getMeetingStatus(
  meeting: Meeting,
  group: Group | null | undefined,
  nowMs: number = Date.now(),
): MeetingStatus {
  if (meeting.status === "cancelled") return "cancelled";

  const startMs = getMeetingStartMs(meeting);
  if (!Number.isFinite(startMs)) return "scheduled";

  const endMs = getMeetingEndMs(meeting);

  if (nowMs < startMs) return "scheduled";
  if (Number.isFinite(endMs) && nowMs < endMs) return "in_progress";
  return "past";
}

/**
 * True when the attendance record for this meeting can still be edited.
 *
 * Window: [start − 1h, start + duration + attendanceEditWindowDays].
 *
 * The one-hour lead lets an admin pre-mark confirmed arrivals before
 * the meeting begins. The trailing window is what lets an officer
 * correct records after the meeting ended, instead of the Record
 * Attendance button disappearing at midnight the next day.
 *
 * Falls back to 7 days after the meeting ends when the group has no
 * explicit attendanceEditWindowDays set. Set to 0 to allow edits only
 * up through end-of-meeting + 1h lead time.
 */
export function isAttendanceEditable(
  meeting: Meeting,
  group: Group | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (meeting.status === "cancelled") return false;

  const startMs = getMeetingStartMs(meeting);
  if (!Number.isFinite(startMs)) return false;

  const endMs = getMeetingEndMs(meeting);
  const editDays = Math.max(
    0,
    group?.attendanceEditWindowDays ?? DEFAULT_ATTENDANCE_EDIT_DAYS,
  );

  const windowStart = startMs - LEAD_TIME_MS;
  const windowEnd = endMs + editDays * 86_400_000;

  return nowMs >= windowStart && nowMs <= windowEnd;
}

export interface UnrecordedMember {
  memberId: string;
  fullName: string;
  role: string;
}

/**
 * Active members who haven't been recorded on this meeting's attendee
 * list. Returns empty for meetings that aren't past-due yet — the
 * point of this is "who still needs a decision made about them", and
 * that only matters after the meeting has ended.
 *
 * Cancelled meetings always return empty.
 */
export function findUnrecordedAttendees(
  meeting: Meeting,
  members: Member[],
  group: Group | null | undefined,
  nowMs: number = Date.now(),
): UnrecordedMember[] {
  const status = getMeetingStatus(meeting, group, nowMs);
  if (status !== "past") return [];

  const recorded = new Set(meeting.attendees.map((a) => a.memberId));

  return members
    .filter((m) => m.status === "active" && !recorded.has(m.id))
    .map((m) => ({
      memberId: m.id,
      fullName: m.fullName,
      role: m.role,
    }));
}

/**
 * Pretty-print the start time for the UI: "2:30 PM" style, or
 * "All day" when no startTime is set.
 */
export function formatMeetingTime(meeting: Meeting): string {
  if (!meeting.startTime || !/^\d{2}:\d{2}$/.test(meeting.startTime)) {
    return "All day";
  }
  const [h, m] = meeting.startTime.split(":").map(Number);
  const dt = new Date();
  dt.setHours(h, m, 0, 0);
  return dt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Pretty-print the full time range for a meeting, e.g.
 * "2:30 PM – 4:00 PM" or "All day · 60 min".
 */
export function formatMeetingTimeRange(meeting: Meeting): string {
  const start = formatMeetingTime(meeting);
  if (start === "All day") {
    const duration = meeting.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    return `All day · ${duration} min`;
  }
  const endMs = getMeetingEndMs(meeting);
  if (!Number.isFinite(endMs)) return start;
  const end = new Date(endMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${start} – ${end}`;
}

/**
 * Roll up meeting penalty totals per attendee — how much has been
 * charged vs how much has actually been cleared.
 */
export interface MeetingPenaltyTotals {
  charged: number;
  paid: number;
  outstanding: number;
  unpaidCount: number;
  paidCount: number;
}

export function getMeetingPenaltyTotals(
  meeting: Meeting,
): MeetingPenaltyTotals {
  let charged = 0;
  let paid = 0;
  let unpaidCount = 0;
  let paidCount = 0;

  for (const a of meeting.attendees) {
    const amt = a.penaltyAmount ?? 0;
    if (amt <= 0) continue;
    charged += amt;
    if (a.penaltyPaid) {
      paid += amt;
      paidCount++;
    } else {
      unpaidCount++;
    }
  }

  return {
    charged,
    paid,
    outstanding: charged - paid,
    unpaidCount,
    paidCount,
  };
}
