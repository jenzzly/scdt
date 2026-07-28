// app/modals/meeting-attendance.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, ActivityIndicator, TextInput, useWindowDimensions} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useStore, useGroupMembers, useActiveGroup, useGroupMeetings } from "../../stores/useStore";
import { Colors, S, R, fmtCurrency, showConfirm } from "../../utils/theme";
import { Button, useToast } from "../../components/ui";

interface AttendeeWithStatus {
  memberId: string;
  fullName: string;
  role: string;
  present: boolean;
  lateMinutes: number;
  penaltyAmount: number;
  originalStatus?: boolean;
  originalLateMinutes?: number;
}

export default function MeetingAttendanceModal() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const { show, Toast } = useToast();
  
  const members = useGroupMembers();
  const meetings = useGroupMeetings();
  const group = useActiveGroup();
  const { recordAttendance, activeGroupId } = useStore();
  
  const [attendees, setAttendees] = useState<AttendeeWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [meeting, setMeeting] = useState<any>(null);
  
  // Use ref to track if initialized to prevent infinite loop
  const initializedRef = useRef(false);
  const meetingIdRef = useRef(meetingId);

  // Interest-based penalties: percentage of the group's standard contribution
  // amount, configured in Group Settings → Meeting Penalties. Falls back to
  // legacy fixed amounts only if the group hasn't set a percentage rate.
  const contributionBase = group?.contributionAmount ?? 0;
  const pctToAmount = (pct: number | undefined, legacyFixed: number | undefined, legacyDefault: number) => {
    if (pct !== undefined && pct > 0 && contributionBase > 0) {
      return Math.round(contributionBase * (pct / 100) * 100) / 100;
    }
    return legacyFixed ?? legacyDefault;
  };
  const pMember  = pctToAmount(group?.absencePenaltyMemberRatePct,  group?.absencePenaltyMember,  2000);
  const pOfficer = pctToAmount(group?.absencePenaltyOfficerRatePct, group?.absencePenaltyOfficer, 5000);

  // Memoize the initialize function to prevent recreation
  const initializeAttendees = useCallback((meetingData: any) => {
    if (!members.length) return;
    
    const activeMembers = members.filter(m => m.status === "active");
    
    const attendeesWithStatus = activeMembers.map(member => {
      const existing = meetingData.attendees?.find((a: any) => a.memberId === member.id);
      const isPresent = existing?.attended ?? false;
      const lateMinutes = existing?.lateMinutes ?? 0;
      
      let penaltyAmount = 0;
      if (!isPresent) {
        penaltyAmount = member.role === "member" ? pMember : pOfficer;
      } else if (lateMinutes > 0) {
        penaltyAmount = Math.floor(lateMinutes / 15) * 500;
      }
      
      return {
        memberId: member.id,
        fullName: member.fullName,
        role: member.role,
        present: isPresent,
        lateMinutes: lateMinutes,
        penaltyAmount,
        originalStatus: isPresent,
        originalLateMinutes: lateMinutes,
      };
    });
    
    setAttendees(attendeesWithStatus);
    setSelectAll(attendeesWithStatus.length > 0 && attendeesWithStatus.every(a => a.present));
  }, [members, pMember, pOfficer]);

  // Load meeting data - single effect with proper dependencies
  useEffect(() => {
    // Only run if we have meetingId, meetings loaded, and not initialized yet
    if (!meetingId || !meetings.length || initializedRef.current) return;
    
    const foundMeeting = meetings.find(m => m.id === meetingId);
    if (foundMeeting) {
      setMeeting(foundMeeting);
      initializeAttendees(foundMeeting);
      initializedRef.current = true;
    }
    setLoading(false);
  }, [meetingId, meetings, initializeAttendees]);

  // Reset initialized ref when meetingId changes
  useEffect(() => {
    if (meetingIdRef.current !== meetingId) {
      meetingIdRef.current = meetingId;
      initializedRef.current = false;
      setLoading(true);
      setMeeting(null);
      setAttendees([]);
    }
  }, [meetingId]);

  const handleToggleMember = useCallback((memberId: string) => {
    setAttendees(prev => prev.map(attendee => {
      if (attendee.memberId === memberId) {
        const newPresent = !attendee.present;
        let penaltyAmount = 0;
        let lateMinutes = attendee.lateMinutes;
        
        if (!newPresent) {
          penaltyAmount = attendee.role === "member" ? pMember : pOfficer;
          lateMinutes = 0;
        } else if (lateMinutes > 0) {
          penaltyAmount = Math.floor(lateMinutes / 15) * 500;
        }
        
        return {
          ...attendee,
          present: newPresent,
          penaltyAmount,
          lateMinutes: newPresent ? lateMinutes : 0,
        };
      }
      return attendee;
    }));
  }, [pMember, pOfficer]);

  const handleToggleAll = useCallback(() => {
    setSelectAll(prev => !prev);
    setAttendees(prev => prev.map(attendee => {
      const newPresent = !selectAll;
      return {
        ...attendee,
        present: newPresent,
        penaltyAmount: newPresent ? 0 : (attendee.role === "member" ? pMember : pOfficer),
        lateMinutes: newPresent ? attendee.lateMinutes : 0,
      };
    }));
  }, [selectAll, pMember, pOfficer]);

  const handleLateMinutesChange = useCallback((memberId: string, minutes: string) => {
    const lateMins = parseInt(minutes) || 0;
    setAttendees(prev => prev.map(attendee => {
      if (attendee.memberId === memberId && attendee.present) {
        const penaltyAmount = Math.floor(lateMins / 15) * 500;
        return {
          ...attendee,
          lateMinutes: lateMins,
          penaltyAmount,
        };
      }
      return attendee;
    }));
  }, []);

  const getTotalPenalties = useCallback(() => {
    return attendees.reduce((sum, a) => sum + (a.present ? a.penaltyAmount : a.penaltyAmount), 0);
  }, [attendees]);

  const getPresentCount = useCallback(() => attendees.filter(a => a.present).length, [attendees]);
  const getAbsentCount = useCallback(() => attendees.filter(a => !a.present).length, [attendees]);
  const getLateCount = useCallback(() => attendees.filter(a => a.present && a.lateMinutes > 0).length, [attendees]);

  const hasChanges = useCallback(() => {
    return attendees.some(a => 
      a.present !== a.originalStatus || 
      (a.present && a.lateMinutes !== a.originalLateMinutes)
    );
  }, [attendees]);

  const handleSave = async () => {
    if (!hasChanges()) {
      show("No changes to save");
      router.back();
      return;
    }
    
    setSaving(true);
    try {
      // Process each attendee update
      for (const attendee of attendees) {
        const hasChanged = attendee.present !== attendee.originalStatus ||
                          (attendee.present && attendee.lateMinutes !== attendee.originalLateMinutes);
        
        if (hasChanged && activeGroupId) {
          await recordAttendance(
            meetingId,
            attendee.memberId,
            attendee.present,
            attendee.present ? attendee.lateMinutes : undefined
          );
        }
      }
      
      show(`Attendance saved: ${getPresentCount()} present, ${getAbsentCount()} absent, ${getLateCount()} late`);
      router.back();
    } catch (error) {
      show("Failed to save attendance", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = useCallback(() => {
    showConfirm(
      "Reset Changes",
      "Are you sure you want to reset all changes?",
      () => {
        if (meeting) {
          initializeAttendees(meeting);
        }
      }
    );
  }, [meeting, initializeAttendees]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading meeting...</Text>
      </View>
    );
  }

  if (!meeting) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Meeting not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Meeting Attendance</Text>
        <View style={styles.headerRight}>
          {hasChanges() && (
            <TouchableOpacity onPress={handleReset} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>Reset</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Meeting Info */}
      <View style={styles.meetingInfo}>
        <Text style={styles.meetingTitle}>{meeting.title}</Text>
        <Text style={styles.meetingDate}>
          {new Date(meeting.date).toLocaleDateString()} at {new Date(meeting.date).toLocaleTimeString()}
        </Text>
        {meeting.location && (
          <Text style={styles.meetingLocation}>📍 {meeting.location}</Text>
        )}
      </View>

      {/* Summary Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.success }]}>{getPresentCount()}</Text>
          <Text style={styles.statLabel}>Present</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: getLateCount() > 0 ? Colors.gold : Colors.text3 }]}>
            {getLateCount()}
          </Text>
          <Text style={styles.statLabel}>Late</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.error }]}>{getAbsentCount()}</Text>
          <Text style={styles.statLabel}>Absent</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.gold }]}>{fmtCurrency(getTotalPenalties())}</Text>
          <Text style={styles.statLabel}>Penalties</Text>
        </View>
      </View>

      {/* Select All Button */}
      <TouchableOpacity style={styles.selectAllButton} onPress={handleToggleAll}>
        <View style={[styles.checkbox, selectAll && styles.checkboxChecked]}>
          {selectAll && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.selectAllText}>Mark All Present</Text>
        <Text style={styles.selectAllSubtext}>
          {attendees.length} members
        </Text>
      </TouchableOpacity>

      {/* Members List */}
      <ScrollView 
        style={styles.membersList}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.membersListContent}
      >
        {attendees.map((attendee) => (
          <View key={attendee.memberId} style={styles.attendeeRow}>
            <TouchableOpacity
              style={styles.attendeeInfo}
              onPress={() => handleToggleMember(attendee.memberId)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, attendee.present && styles.checkboxChecked]}>
                {attendee.present && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={styles.attendeeDetails}>
                <Text style={styles.attendeeName}>{attendee.fullName}</Text>
                <Text style={styles.attendeeRole}>
                  {attendee.role} • {attendee.present ? (attendee.lateMinutes > 0 ? `${attendee.lateMinutes} min late` : "On time") : "Absent"}
                </Text>
              </View>
            </TouchableOpacity>
            
            <View style={styles.attendeeActions}>
              {attendee.present ? (
                <View style={styles.lateInputContainer}>
                  <TouchableOpacity
                    style={styles.lateMinusButton}
                    onPress={() => {
                      const current = attendee.lateMinutes || 0;
                      const newValue = Math.max(0, current - 5);
                      handleLateMinutesChange(attendee.memberId, String(newValue));
                    }}
                  >
                    <Text style={styles.lateButtonText}>-</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.lateInput}
                    value={String(attendee.lateMinutes || 0)}
                    onChangeText={(text) => handleLateMinutesChange(attendee.memberId, text)}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  <TouchableOpacity
                    style={styles.latePlusButton}
                    onPress={() => {
                      const current = attendee.lateMinutes || 0;
                      const newValue = current + 5;
                      handleLateMinutesChange(attendee.memberId, String(newValue));
                    }}
                  >
                    <Text style={styles.lateButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.penaltyBadge}>
                  <Text style={styles.penaltyAmount}>{fmtCurrency(attendee.penaltyAmount)}</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer Summary */}
      <View style={styles.footer}>
        <View style={styles.footerSummary}>
          <View style={styles.footerStats}>
            <Text style={styles.footerStatText}>
              ✅ {getPresentCount()} present
            </Text>
            <Text style={[styles.footerStatText, { color: Colors.error }]}>
              ❌ {getAbsentCount()} absent
            </Text>
            <Text style={[styles.footerStatText, { color: Colors.gold }]}>
              💰 {fmtCurrency(getTotalPenalties())}
            </Text>
          </View>
          <Text style={styles.footerHint}>
            Late penalty: 500 RWF per 15 minutes
          </Text>
        </View>
        <Button
          label="Save Attendance"
          onPress={handleSave}
          loading={saving}
          fullWidth
          size="lg"
        />
      </View>

      <Toast />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.bg,
  },
  loadingText: {
    marginTop: S.md,
    fontSize: 14,
    color: Colors.text3,
  },
  errorText: {
    fontSize: 16,
    color: Colors.error,
    marginBottom: S.md,
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    borderRadius: R.md,
  },
  backButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingTop: Platform.OS === "ios" ? 56 : 36,
    paddingBottom: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  closeButtonText: {
    color: Colors.text3,
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.text,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resetButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.elevated,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resetButtonText: {
    color: Colors.text3,
    fontSize: 12,
    fontWeight: "600",
  },
  saveButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.primary,
    borderRadius: R.md,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  meetingInfo: {
    padding: S.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  meetingTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 4,
  },
  meetingDate: {
    fontSize: 13,
    color: Colors.text3,
    marginBottom: 2,
  },
  meetingLocation: {
    fontSize: 13,
    color: Colors.text3,
  },
  statsRow: {
    flexDirection: "row",
    padding: S.lg,
    gap: 8,
    backgroundColor: Colors.surface,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.elevated,
    borderRadius: R.lg,
    padding: S.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.text3,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  selectAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    flex: 1,
    marginLeft: 8,
  },
  selectAllSubtext: {
    fontSize: 11,
    color: Colors.text3,
  },
  membersList: {
    flex: 1,
  },
  membersListContent: {
    paddingBottom: 20,
  },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  attendeeInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 2,
  },
  attendeeDetails: {
    flex: 1,
  },
  attendeeName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  attendeeRole: {
    fontSize: 11,
    color: Colors.text3,
  },
  attendeeActions: {
    flex: 1,
    alignItems: "flex-end",
  },
  lateInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  lateMinusButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.elevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  latePlusButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  lateButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
  },
  lateInput: {
    width: 45,
    height: 36,
    textAlign: "center",
    backgroundColor: Colors.elevated,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  penaltyBadge: {
    backgroundColor: "rgba(220,38,38,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.2)",
  },
  penaltyAmount: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.error,
  },
  footer: {
    padding: S.lg,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: S.md,
  },
  footerSummary: {
    alignItems: "center",
  },
  footerStats: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginBottom: 4,
  },
  footerStatText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.text,
  },
  footerHint: {
    fontSize: 10,
    color: Colors.text3,
  },
});