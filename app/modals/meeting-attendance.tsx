// app/modals/meeting-attendance.tsx
//
// Attendance recording, redesigned for speed.
//
// The workflow this optimises for:
//   1. Open the modal — everyone shows up already marked Present.
//   2. Tap "Absent" on the 2-3 people who didn't show.
//   3. Tap Save.
//
// Every other affordance (Late minutes, bulk actions, penalty preview)
// is available but secondary.
//
// Defaulting to Present (instead of Absent) is the single biggest
// change — the old flow required 15 taps to record attendance for a
// 15-person meeting where everyone showed up. Now it's 0 taps + Save.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useStore,
  useGroupMembers,
  useActiveGroup,
  useGroupMeetings,
} from "../../stores/useStore";
import {
  Colors,
  S,
  R,
  fmtCurrency,
  round2,
  showConfirm,
} from "../../utils/theme";
import { useToast, Toast } from "../../components/ui";

// ─── Model ──────────────────────────────────────────────────────────────

type AttendanceState = "present" | "late" | "absent";

interface AttendeeRow {
  memberId: string;
  fullName: string;
  role: string;
  state: AttendanceState;
  lateMinutes: number;
  // Original state from the meeting doc, for dirty comparison.
  originalState: AttendanceState;
  originalLateMinutes: number;
  // True when the meeting had no attendee record for this member at
  // load time. Used only for the "previously unrecorded" hint.
  wasUnrecorded: boolean;
}

const DEFAULT_LATE_MINUTES = 15;

// ─── Screen ─────────────────────────────────────────────────────────────

export default function MeetingAttendanceModal() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const twoCol = width >= 720;
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const { show, visible, msg, type } = useToast();

  const members = useGroupMembers();
  const meetings = useGroupMeetings();
  const group = useActiveGroup();
  const { recordAttendance, activeGroupId } = useStore();

  const [rows, setRows] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const initializedRef = useRef<string | null>(null);
  const meeting = meetings.find((m) => m.id === meetingId);

  // ── Penalty preview ─────────────────────────────────────────────────
  // Mirrors recordAttendance in meetingSlice.ts exactly.

  const contributionBase = group?.contributionAmount ?? 0;

  const absencePenaltyFor = useCallback(
    (role: string): number => {
      const isOfficer = role !== "member";
      const pct = isOfficer
        ? group?.absencePenaltyOfficerRatePct
        : group?.absencePenaltyMemberRatePct;
      const legacy = isOfficer
        ? group?.absencePenaltyOfficer
        : group?.absencePenaltyMember;
      const fallback = isOfficer ? 5000 : 2000;
      if (pct !== undefined && pct > 0 && contributionBase > 0) {
        return round2(contributionBase * (pct / 100));
      }
      return legacy ?? fallback;
    },
    [
      group?.absencePenaltyOfficerRatePct,
      group?.absencePenaltyMemberRatePct,
      group?.absencePenaltyOfficer,
      group?.absencePenaltyMember,
      contributionBase,
    ],
  );

  const latePenaltyFor = useCallback(
    (lateMinutes: number): number => {
      if (lateMinutes <= 0) return 0;
      const blocks = Math.floor(lateMinutes / 15);
      if (blocks <= 0) return 0;
      const ratePct = group?.latePenaltyRatePct;
      if (ratePct !== undefined && ratePct > 0 && contributionBase > 0) {
        return round2(contributionBase * (ratePct / 100) * blocks);
      }
      return blocks * (group?.latePenaltyAmount ?? 500);
    },
    [
      group?.latePenaltyRatePct,
      group?.latePenaltyAmount,
      contributionBase,
    ],
  );

  const penaltyForRow = useCallback(
    (row: AttendeeRow): number => {
      if (row.state === "absent") return absencePenaltyFor(row.role);
      if (row.state === "late") return latePenaltyFor(row.lateMinutes);
      return 0;
    },
    [absencePenaltyFor, latePenaltyFor],
  );

  // ── Initialisation ──────────────────────────────────────────────────
  //
  // The key change vs the previous version: a member with NO existing
  // attendee record on the meeting defaults to PRESENT, not ABSENT.
  // This makes the common case (everyone showed up) a zero-tap flow.
  // Members WITH an existing record are respected as-is.

  const buildRows = useCallback(
    (meetingData: any): AttendeeRow[] => {
      const activeMembers = members.filter((m) => m.status === "active");

      return activeMembers.map((member) => {
        const existing = meetingData.attendees?.find(
          (a: any) => a.memberId === member.id,
        );
        const isRecorded = !!existing;

        let state: AttendanceState;
        let lateMinutes = 0;

        if (!isRecorded) {
          // Default for a fresh record — assume present.
          state = "present";
        } else if (existing.attended) {
          lateMinutes = existing.lateMinutes ?? 0;
          state = lateMinutes > 0 ? "late" : "present";
        } else {
          state = "absent";
        }

        return {
          memberId: member.id,
          fullName: member.fullName,
          role: member.role ?? "member",
          state,
          lateMinutes: state === "late" ? lateMinutes : 0,
          originalState: state,
          originalLateMinutes: state === "late" ? lateMinutes : 0,
          wasUnrecorded: !isRecorded,
        };
      });
    },
    [members],
  );

  useEffect(() => {
    if (!meetingId || !meeting) return;
    if (initializedRef.current === meetingId) return;
    setRows(buildRows(meeting));
    initializedRef.current = meetingId;
    setLoading(false);
  }, [meetingId, meeting, buildRows]);

  useEffect(() => {
    return () => {
      initializedRef.current = null;
    };
  }, [meetingId]);

  // ── Derived state ───────────────────────────────────────────────────

  // A row is "dirty" — and therefore needs saving — if EITHER:
  //   • it has no prior attendee record on the meeting (wasUnrecorded),
  //     so the Present default is a real decision to persist; OR
  //   • its state or late minutes differ from the original load.
  //
  // Without the wasUnrecorded check, a fresh meeting where everyone
  // defaults to Present produced dirtyCount = 0, so Save was a no-op
  // and no attendee records were ever written. That's the "0 present,
  // 2 absent" bug on the meetings list.
  const dirtyCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.wasUnrecorded ||
          r.state !== r.originalState ||
          (r.state === "late" &&
            r.lateMinutes !== r.originalLateMinutes),
      ).length,
    [rows],
  );

  const counts = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    for (const r of rows) {
      if (r.state === "present") present++;
      else if (r.state === "late") late++;
      else absent++;
    }
    return { present, late, absent, total: rows.length };
  }, [rows]);

  const totalPenalties = useMemo(
    () =>
      round2(rows.reduce((sum, r) => sum + penaltyForRow(r), 0)),
    [rows, penaltyForRow],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Search only pays for itself once the list gets long.
  const showSearch = rows.length > 10;

  // ── Handlers ────────────────────────────────────────────────────────

  const setMemberState = useCallback(
    (memberId: string, state: AttendanceState) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.memberId !== memberId) return r;
          if (state === "present") {
            return { ...r, state, lateMinutes: 0 };
          }
          if (state === "late") {
            return {
              ...r,
              state,
              lateMinutes:
                r.lateMinutes > 0 ? r.lateMinutes : DEFAULT_LATE_MINUTES,
            };
          }
          return { ...r, state, lateMinutes: 0 };
        }),
      );
    },
    [],
  );

  const adjustLateMinutes = useCallback(
    (memberId: string, delta: number) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.memberId !== memberId || r.state !== "late") return r;
          const next = Math.max(0, Math.min(600, r.lateMinutes + delta));
          return { ...r, lateMinutes: next };
        }),
      );
    },
    [],
  );

  const setLateMinutesText = useCallback(
    (memberId: string, text: string) => {
      const digits = text.replace(/[^0-9]/g, "");
      const n = digits ? parseInt(digits, 10) : 0;
      setRows((prev) =>
        prev.map((r) =>
          r.memberId === memberId && r.state === "late"
            ? { ...r, lateMinutes: Math.max(0, Math.min(600, n)) }
            : r,
        ),
      );
    },
    [],
  );

  const markEveryonePresent = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => ({ ...r, state: "present", lateMinutes: 0 })),
    );
  }, []);

  const markRemainingAbsent = useCallback(() => {
    // Anyone not yet explicitly marked absent becomes absent.
    const remaining = rows.filter((r) => r.state !== "absent").length;
    if (remaining === 0) {
      show("Everyone is already marked absent");
      return;
    }
    showConfirm(
      "Mark everyone absent",
      `All ${remaining} member${remaining !== 1 ? "s" : ""} without an absence will be marked absent and incur the absence penalty on save.`,
      () => {
        setRows((prev) =>
          prev.map((r) => ({ ...r, state: "absent", lateMinutes: 0 })),
        );
      },
      undefined,
      true,
    );
  }, [rows, show]);

  const handleReset = useCallback(() => {
    if (!meeting) return;
    showConfirm(
      "Discard changes",
      "Revert to the last saved attendance?",
      () => setRows(buildRows(meeting)),
      undefined,
      true,
    );
  }, [meeting, buildRows]);

  const handleSave = async () => {
    if (dirtyCount === 0) return;
    if (!activeGroupId) {
      show("No active group", "error");
      return;
    }
    setSaving(true);
    try {
      const dirty = rows.filter(
        (r) =>
          r.wasUnrecorded ||
          r.state !== r.originalState ||
          (r.state === "late" &&
            r.lateMinutes !== r.originalLateMinutes),
      );
      // Sequential — recordAttendance rewrites the whole attendees
      // array on the meeting, so parallel writes would race.
      for (const r of dirty) {
        const attended = r.state !== "absent";
        const lateMinutes = r.state === "late" ? r.lateMinutes : 0;
        await recordAttendance(
          meetingId,
          r.memberId,
          attended,
          attended ? lateMinutes : undefined,
        );
      }
      show(
        `Saved · ${counts.present} present · ${counts.late} late · ${counts.absent} absent`,
      );
      router.back();
    } catch (error) {
      console.error("[meeting-attendance] save failed:", error);
      show(
        error instanceof Error ? error.message : "Failed to save",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = useCallback(() => {
    if (dirtyCount === 0) {
      router.back();
      return;
    }
    showConfirm(
      "Discard changes?",
      `${dirtyCount} unsaved change${dirtyCount !== 1 ? "s" : ""} will be lost.`,
      () => router.back(),
      undefined,
      true,
    );
  }, [dirtyCount, router]);

  // ── Guards ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.centerText}>Loading…</Text>
      </View>
    );
  }

  if (!meeting) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Meeting not found</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.errorBtn}
        >
          <Text style={styles.errorBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDirty = dirtyCount > 0;
  const dateLabel = new Date(meeting.date).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeLabel = meeting.startTime ? ` · ${meeting.startTime}` : "";

  // ── Main render ─────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleCancel}
          hitSlop={10}
          style={styles.headerLeft}
        >
          <Text style={styles.headerCancel}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          Attendance
        </Text>

        <View style={styles.headerRight}>
          {isDirty ? (
            <TouchableOpacity
              onPress={handleReset}
              hitSlop={10}
              style={styles.headerReset}
            >
              <Text style={styles.headerResetText}>Reset</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          twoCol && styles.scrollWide,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Meeting summary line ───────────────────────────────── */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle} numberOfLines={2}>
            {meeting.title}
          </Text>
          <Text style={styles.summaryMeta} numberOfLines={1}>
            {dateLabel}
            {timeLabel}
            {meeting.location ? `  ·  📍 ${meeting.location}` : ""}
          </Text>
        </View>

        {/* ── Live tally ─────────────────────────────────────────── */}
        <View style={styles.tallyRow}>
          <View style={styles.tallyCell}>
            <Text style={[styles.tallyValue, { color: Colors.success }]}>
              {counts.present}
            </Text>
            <Text style={styles.tallyLabel}>Present</Text>
          </View>
          <View style={styles.tallyDivider} />
          <View style={styles.tallyCell}>
            <Text
              style={[
                styles.tallyValue,
                { color: counts.late > 0 ? Colors.gold : Colors.text3 },
              ]}
            >
              {counts.late}
            </Text>
            <Text style={styles.tallyLabel}>Late</Text>
          </View>
          <View style={styles.tallyDivider} />
          <View style={styles.tallyCell}>
            <Text
              style={[
                styles.tallyValue,
                { color: counts.absent > 0 ? Colors.error : Colors.text3 },
              ]}
            >
              {counts.absent}
            </Text>
            <Text style={styles.tallyLabel}>Absent</Text>
          </View>
          {totalPenalties > 0 ? (
            <>
              <View style={styles.tallyDivider} />
              <View style={styles.tallyCell}>
                <Text
                  style={[styles.tallyValue, { color: Colors.error }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {fmtCurrency(totalPenalties)}
                </Text>
                <Text style={styles.tallyLabel}>Fees</Text>
              </View>
            </>
          ) : null}
        </View>

        {/* ── Bulk actions ───────────────────────────────────────── */}
        <View style={styles.bulkRow}>
          <TouchableOpacity
            style={styles.bulkBtn}
            onPress={markEveryonePresent}
            activeOpacity={0.8}
          >
            <Text style={styles.bulkBtnText}>✓ Everyone present</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bulkBtn, styles.bulkBtnDanger]}
            onPress={markRemainingAbsent}
            activeOpacity={0.8}
          >
            <Text style={[styles.bulkBtnText, { color: Colors.error }]}>
              ✗ Mark rest absent
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Search (only for long lists) ───────────────────────── */}
        {showSearch ? (
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search member…"
              placeholderTextColor={Colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search ? (
              <TouchableOpacity
                onPress={() => setSearch("")}
                hitSlop={8}
              >
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* ── Rows ───────────────────────────────────────────────── */}
        {filteredRows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No matching members</Text>
          </View>
        ) : (
          <View style={[styles.grid, twoCol && styles.gridWide]}>
            {filteredRows.map((row) => (
              <MemberCard
                key={row.memberId}
                row={row}
                penalty={penaltyForRow(row)}
                twoCol={twoCol}
                onSetState={(s) => setMemberState(row.memberId, s)}
                onAdjustLate={(d) =>
                  adjustLateMinutes(row.memberId, d)
                }
                onLateText={(t) => setLateMinutesText(row.memberId, t)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <View style={styles.footer}>
        {isDirty ? (
          <View style={styles.dirtyBar}>
            <Text style={styles.dirtyBarText}>
              {dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}
            </Text>
          </View>
        ) : (
          <Text style={styles.savedHint}>
            Tap a status above if you need to correct anyone
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.saveBtn,
            (!isDirty || saving) && styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={!isDirty || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>
              {isDirty
                ? `Save attendance · ${counts.present + counts.late} in`
                : "All changes saved"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <Toast visible={visible} msg={msg} type={type} />
    </View>
  );
}

// ─── Member card ────────────────────────────────────────────────────────

function MemberCard({
  row,
  penalty,
  twoCol,
  onSetState,
  onAdjustLate,
  onLateText,
}: {
  row: AttendeeRow;
  penalty: number;
  twoCol: boolean;
  onSetState: (s: AttendanceState) => void;
  onAdjustLate: (delta: number) => void;
  onLateText: (text: string) => void;
}) {
  const dirty =
    row.state !== row.originalState ||
    (row.state === "late" && row.lateMinutes !== row.originalLateMinutes);

  const initials = row.fullName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const stateMeta = {
    present: {
      color: Colors.success,
      bg: Colors.greenBg,
      icon: "✓",
      label: "Present",
    },
    late: {
      color: Colors.gold,
      bg: Colors.goldBg,
      icon: "⏱",
      label: "Late",
    },
    absent: {
      color: Colors.error,
      bg: Colors.redBg,
      icon: "✗",
      label: "Absent",
    },
  }[row.state];

  return (
    <View
      style={[
        styles.card,
        twoCol && styles.cardWide,
        dirty && styles.cardDirty,
        { borderLeftColor: stateMeta.color },
      ]}
    >
      {/* Header row: avatar + name/role + penalty badge */}
      <View style={styles.cardHeader}>
        <View
          style={[styles.avatar, { backgroundColor: stateMeta.bg }]}
        >
          <Text style={[styles.avatarText, { color: stateMeta.color }]}>
            {initials}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardName} numberOfLines={1}>
            {row.fullName}
          </Text>
          <Text style={styles.cardRole} numberOfLines={1}>
            {row.role.replace(/_/g, " ")}
            {row.wasUnrecorded && row.state === "present"
              ? " · new"
              : ""}
          </Text>
        </View>

        {penalty > 0 ? (
          <View style={styles.penaltyBadge}>
            <Text style={styles.penaltyText}>
              {fmtCurrency(penalty)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Three big status buttons */}
      <View style={styles.statusRow}>
        {(["present", "late", "absent"] as AttendanceState[]).map(
          (key) => {
            const meta = {
              present: {
                color: Colors.success,
                icon: "✓",
                label: "Present",
              },
              late: { color: Colors.gold, icon: "⏱", label: "Late" },
              absent: { color: Colors.error, icon: "✗", label: "Absent" },
            }[key];
            const active = row.state === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.statusBtn,
                  active && {
                    backgroundColor: meta.color,
                    borderColor: meta.color,
                  },
                ]}
                onPress={() => onSetState(key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={meta.label}
              >
                <Text
                  style={[
                    styles.statusBtnText,
                    active && { color: "#fff" },
                  ]}
                  numberOfLines={1}
                >
                  {meta.icon} {meta.label}
                </Text>
              </TouchableOpacity>
            );
          },
        )}
      </View>

      {/* Late minutes only when Late is active */}
      {row.state === "late" ? (
        <View style={styles.lateRow}>
          <Text style={styles.lateLabel}>Minutes late</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => onAdjustLate(-5)}
              activeOpacity={0.8}
            >
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.stepperInput}
              value={String(row.lateMinutes)}
              onChangeText={onLateText}
              keyboardType="number-pad"
              maxLength={3}
              selectTextOnFocus
            />
            <TouchableOpacity
              style={[styles.stepperBtn, styles.stepperBtnPrimary]}
              onPress={() => onAdjustLate(5)}
              activeOpacity={0.8}
            >
              <Text style={[styles.stepperBtnText, { color: "#fff" }]}>
                +
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bg,
    gap: 12,
    padding: 24,
  },
  centerText: { fontSize: 14, color: Colors.text3 },
  errorTitle: {
    fontSize: 16,
    color: Colors.error,
    fontWeight: "700",
  },
  errorBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.md,
  },
  errorBtnText: { color: "#fff", fontWeight: "700" },

  // ── Header ──────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: { minWidth: 70 },
  headerRight: {
    minWidth: 70,
    alignItems: "flex-end",
  },
  headerCancel: {
    color: Colors.text3,
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text,
    flex: 1,
    textAlign: "center",
  },
  headerReset: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.elevated,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerResetText: {
    color: Colors.text3,
    fontSize: 12,
    fontWeight: "700",
  },

  // ── Scroll ──────────────────────────────────────────────────────
  scroll: { padding: S.lg, paddingBottom: 40 },
  scrollWide: {
    paddingHorizontal: 32,
    maxWidth: 1100,
    alignSelf: "center",
    width: "100%",
  },

  // ── Summary card ────────────────────────────────────────────────
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: S.lg,
    marginBottom: S.md,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },
  summaryMeta: {
    fontSize: 12,
    color: Colors.text3,
  },

  // ── Tally ───────────────────────────────────────────────────────
  tallyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    marginBottom: S.md,
  },
  tallyCell: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
    paddingHorizontal: 4,
  },
  tallyDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
  tallyValue: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
  },
  tallyLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: Colors.text3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 2,
  },

  // ── Bulk actions ────────────────────────────────────────────────
  bulkRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: S.md,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: Colors.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  bulkBtnDanger: {
    borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.04)",
  },
  bulkBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.text2,
  },

  // ── Search ──────────────────────────────────────────────────────
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: S.md,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    paddingVertical: 0,
  },
  searchClear: {
    fontSize: 14,
    color: Colors.text3,
    fontWeight: "700",
    paddingHorizontal: 6,
  },

  // ── Grid of member cards ────────────────────────────────────────
  grid: { gap: 10 },
  gridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    borderLeftColor: Colors.border,
    padding: 14,
    gap: 12,
  },
  cardWide: {
    flexBasis: "49%",
    flexGrow: 1,
  },
  cardDirty: {
    backgroundColor: "rgba(245,158,11,0.04)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "800" },
  cardName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.text,
  },
  cardRole: {
    fontSize: 11,
    color: Colors.text3,
    textTransform: "capitalize",
    marginTop: 1,
  },
  penaltyBadge: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  penaltyText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.error,
  },

  // ── Status buttons ──────────────────────────────────────────────
  statusRow: {
    flexDirection: "row",
    gap: 6,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 6,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.text2,
  },

  // ── Late minutes stepper ────────────────────────────────────────
  lateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  lateLabel: {
    fontSize: 12,
    color: Colors.text3,
    fontWeight: "600",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepperBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  stepperBtnText: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text2,
    lineHeight: 20,
  },
  stepperInput: {
    width: 54,
    height: 34,
    textAlign: "center",
    backgroundColor: Colors.elevated,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 14,
    fontWeight: "700",
    color: Colors.text,
  },

  // ── Empty ───────────────────────────────────────────────────────
  empty: {
    paddingVertical: 48,
    alignItems: "center",
  },
  emptyText: { fontSize: 14, color: Colors.text3 },

  // ── Footer ──────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: Platform.OS === "ios" ? 28 : S.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  dirtyBar: {
    backgroundColor: Colors.goldBg,
    borderRadius: R.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.3)",
  },
  savedHint: {
    fontSize: 11,
    color: Colors.text3,
    textAlign: "center",
  },
  dirtyBarText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.gold,
    letterSpacing: 0.3,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: R.lg,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.mutedBg,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});