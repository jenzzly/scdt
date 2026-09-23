// stores/slices/meetingSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, Meeting, MeetingAttendee, WalletTransaction, Member } from "../../types";
import * as FS from "../../lib/firestore";
import { uid, round2 } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";

export const createMeetingSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addMeetingLocal" | "cancelMeeting" | "clearAllMemberPenalties" | "clearMeetingPenalty" | "deleteMeeting" | "deleteMeetingLocal" | "recordAttendance" | "scheduleMeeting" | "setMeetings" | "updateMeeting" | "updateMeetingLocal"> => ({
      setMeetings: (ms) => set({ meetings: ms }),
      addMeetingLocal: (m) => set((s: StoreState) => ({ meetings: [m, ...s.meetings] })),
      updateMeetingLocal: (id, data) => set((s: StoreState) => {
        const cleanData: Partial<Meeting> = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            cleanData[key as keyof Meeting] = value as any;
          }
        }
        return {
          meetings: s.meetings.map((m: Meeting) => (m.id === id ? { ...m, ...cleanData } : m)),
        };
      }),
      deleteMeetingLocal: (id) => set((s: StoreState) => ({ meetings: s.meetings.filter((m: Meeting) => m.id !== id) })),

      cancelMeeting: async (meetingId: ID) => {
        const { activeGroupId, meetings, members, authName } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        try {
          get().setSyncStatus("pending");
          await FS.updateMeeting(activeGroupId, meetingId, { status: "cancelled" });
          get().setSyncStatus("synced");

          const meeting = meetings.find((m) => m.id === meetingId);
          const notifyTargets = members.filter(
            (m) => m.groupId === activeGroupId && m.status === "active" && !!m.userId
          );
          for (const target of notifyTargets) {
            FS.addNotification(target.userId!, {
              userId: target.userId!,
              groupId: activeGroupId,
              type: "meeting_cancelled",
              title: "Meeting Cancelled",
              message: `${meeting?.title ?? "A meeting"} scheduled for ${meeting?.date ?? ""} has been cancelled${authName ? ` by ${authName}` : ""}`,
              read: false,
              metadata: { meetingId },
              createdAt: new Date().toISOString(),
            }, target.email).catch(console.warn);
          }
        } catch (error) {
          get().setSyncStatus("failed", error instanceof Error ? error.message : "Failed to cancel meeting");
          throw error;
        }
      },

      deleteMeeting: async (meetingId: ID, reason: string) => {
        const { activeGroupId, authUid, authName, meetings, members } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const previousMeetings = [...meetings];
        const previousWalletTxs = [...get().walletTransactions];
        
        const meeting = meetings.find(m => m.id === meetingId);

        get().deleteMeetingLocal(meetingId);
        
        if (meeting) {
          meeting.attendees.forEach(attendee => {
            if (attendee.penaltyAmount && attendee.penaltyAmount > 0) {
              const penaltyTxId = `meeting-penalty-${meetingId}-${attendee.memberId}`;
              get().deleteWalletTxLocal(penaltyTxId);
            }
          });
        }
        
        try {
          get().setSyncStatus("pending");
          await FS.deleteMeetingWithRelations(activeGroupId, meetingId, reason);
          get().recalcTotals();
          get().setSyncStatus("synced");

          if (meeting) {
            const notifyTargets = members.filter(
              (m) => m.groupId === activeGroupId && m.status === "active" && !!m.userId
            );
            for (const target of notifyTargets) {
              FS.addNotification(target.userId!, {
                userId: target.userId!,
                groupId: activeGroupId,
                type: "meeting_deleted",
                title: "Meeting Removed",
                message: `${meeting.title} (${meeting.date}) was removed by ${authName || "an admin"}${reason ? `: ${reason}` : ""}`,
                read: false,
                metadata: { meetingId, reason },
                createdAt: new Date().toISOString(),
              }, target.email).catch(console.warn);
            }
          }
        } catch (error) {
          const rolledBack = { ...get(), meetings: previousMeetings, walletTransactions: previousWalletTxs };
          set({
            meetings: previousMeetings,
            walletTransactions: previousWalletTxs,
            ...recalcGroupTotals(rolledBack),
          });
          get().setSyncStatus("failed", error instanceof Error ? error.message : "Failed to delete meeting");
          throw error;
        }
      },

      updateMeeting: async (groupId: ID, meetingId: ID, data: Partial<Meeting>) => {
        try {
          get().setSyncStatus("pending");
          await FS.updateMeeting(groupId, meetingId, data);
          get().setSyncStatus("synced");

          // A date/time/location change is a reschedule worth notifying
          // everyone about; other field-only edits (e.g. attendee
          // updates, which go through recordAttendance separately) stay
          // quiet to avoid noise.
          if (data.date || data.location) {
            const { members, meetings, authName } = get();
            const meeting = meetings.find((m) => m.id === meetingId);
            const notifyTargets = members.filter(
              (m) => m.groupId === groupId && m.status === "active" && !!m.userId
            );
            for (const target of notifyTargets) {
              FS.addNotification(target.userId!, {
                userId: target.userId!,
                groupId,
                type: "meeting_updated",
                title: "Meeting Rescheduled",
                message: `${meeting?.title ?? "A meeting"} has been updated${authName ? ` by ${authName}` : ""} — check the new details`,
                read: false,
                metadata: { meetingId },
                createdAt: new Date().toISOString(),
              }, target.email).catch(console.warn);
            }
          }
        } catch (error) {
          get().setSyncStatus("failed", error instanceof Error ? error.message : "Failed to update meeting");
          throw error;
        }
      },

      clearMeetingPenalty: async (meetingId: ID, memberId: ID) => {
        const { activeGroupId, meetings } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const meeting = meetings.find(m => m.id === meetingId);
        if (!meeting) throw new Error("Meeting not found");
        
        const updatedAttendees = meeting.attendees.map(attendee => {
          if (attendee.memberId === memberId && attendee.penaltyAmount > 0) {
            return { ...attendee, penaltyPaid: true };
          }
          return attendee;
        });
        
        try {
          get().setSyncStatus("pending");
          await FS.updateMeeting(activeGroupId, meetingId, { attendees: updatedAttendees });
          get().updateMeetingLocal(meetingId, { attendees: updatedAttendees });
          get().setSyncStatus("synced");
        } catch (error) {
          get().setSyncStatus("failed", error instanceof Error ? error.message : "Failed to clear penalty");
          throw error;
        }
      },

      clearAllMemberPenalties: async (memberId: ID) => {
        const { activeGroupId, meetings } = get();
        if (!activeGroupId) throw new Error("No active group");
        
        const memberMeetings = meetings.filter(m => 
          m.attendees.some(a => a.memberId === memberId && a.penaltyAmount > 0 && !a.penaltyPaid)
        );
        
        const updates = memberMeetings.map(async (meeting) => {
          const updatedAttendees = meeting.attendees.map(attendee => {
            if (attendee.memberId === memberId && attendee.penaltyAmount > 0) {
              return { ...attendee, penaltyPaid: true };
            }
            return attendee;
          });
          await FS.updateMeeting(activeGroupId, meeting.id, { attendees: updatedAttendees });
          get().updateMeetingLocal(meeting.id, { attendees: updatedAttendees });
        });
        
        try {
          get().setSyncStatus("pending");
          await Promise.all(updates);
          get().setSyncStatus("synced");
        } catch (error) {
          get().setSyncStatus("failed", error instanceof Error ? error.message : "Failed to clear penalties");
          throw error;
        }
      },

      // ── Loan Actions ─────────────────────────────────────────────────────────
      scheduleMeeting: async (data) => {
        const { activeGroupId, members } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const meeting: Meeting = { ...data, id: uid(), createdAt: now };
        get().addMeetingLocal(meeting);
        FS.addMeeting(activeGroupId, meeting).catch(console.warn);
        members
          .filter((m: Member) => m.groupId === activeGroupId && m.status === "active" && m.userId)
          .forEach((member) => {
            FS.addNotification(member.userId!, {
              userId: member.userId!,
              groupId: activeGroupId,
              type: "meeting_scheduled",
              title: "New meeting scheduled",
              message: `${meeting.title} is scheduled for ${meeting.date}`,
              read: false,
              metadata: { meetingId: meeting.id },
              createdAt: now,
            }, member.email).catch(console.warn);
          });
        return meeting.id;
      },

      recordAttendance: async (meetingId, memberId, attended, lateMinutes) => {
        const { activeGroupId, meetings, members, groups } = get();
        if (!activeGroupId) return;
        
        const meeting = meetings.find((m: Meeting) => m.id === meetingId);
        if (!meeting) return;
        
        const member = members.find((m: Member) => m.id === memberId);
        const group = groups.find((g) => g.id === activeGroupId);

        // Interest-based penalties: a percentage of the group's standard
        // contribution amount, configured in Group Settings → Meeting
        // Penalties. Falls back to the legacy fixed-amount fields only if
        // the group hasn't been migrated to percentage-based penalties yet.
        const contributionBase = group?.contributionAmount ?? 0;
        const pctToAmount = (pct: number | undefined, legacyFixed: number | undefined, legacyDefault: number) => {
          if (pct !== undefined && pct > 0 && contributionBase > 0) {
            return round2(contributionBase * (pct / 100));
          }
          return legacyFixed ?? legacyDefault;
        };

        const pMember  = pctToAmount(group?.absencePenaltyMemberRatePct,  group?.absencePenaltyMember,  2000);
        const pOfficer = pctToAmount(group?.absencePenaltyOfficerRatePct, group?.absencePenaltyOfficer, 5000);
        const lateRatePct = group?.latePenaltyRatePct;

        let penaltyAmount = 0;
        let status: MeetingAttendee["status"] = "present";

        if (!attended) {
          penaltyAmount = member?.role === "member" ? pMember : pOfficer;
          status = "absent";
        } else if (lateMinutes && lateMinutes > 0) {
          // Late penalty: percentage-per-15-minutes-late of the contribution
          // amount, if a rate is configured; otherwise fall back to the old
          // fixed RWF 500 per 15 minutes.
          const lateBlocks = Math.floor(lateMinutes / 15);
          if (lateRatePct !== undefined && lateRatePct > 0 && contributionBase > 0) {
            penaltyAmount = round2(contributionBase * (lateRatePct / 100) * lateBlocks);
          } else {
            penaltyAmount = lateBlocks * (group?.latePenaltyAmount ?? 500);
          }
          status = "late";
        }

        const existingAttendeeIndex = meeting.attendees.findIndex((a) => a.memberId === memberId);
        let updatedAttendees;
        
        if (existingAttendeeIndex >= 0) {
          updatedAttendees = [...meeting.attendees];
          updatedAttendees[existingAttendeeIndex] = {
            ...updatedAttendees[existingAttendeeIndex],
            attended,
            lateMinutes,
            penaltyAmount,
            status,
            penaltyPaid: false,
          };
        } else {
          updatedAttendees = [
            ...meeting.attendees,
            {
              memberId,
              attended,
              lateMinutes,
              penaltyAmount,
              status,
              penaltyPaid: false,
            },
          ];
        }

        // Local store update is instant; the server write below is
        // awaited so a failure surfaces to the caller instead of being
        // silently swallowed. Previously this was fire-and-forget, so
        // a network blip left local state showing the new attendees
        // while the server kept the old ones — the next subscription
        // snapshot then overwrote the local change.
        get().updateMeetingLocal(meetingId, { attendees: updatedAttendees });

        if (activeGroupId) {
          try {
            await FS.updateMeeting(activeGroupId, meetingId, {
              attendees: updatedAttendees,
            });
          } catch (e) {
            console.error(
              "[recordAttendance] failed to persist attendees:",
              e,
            );
            throw e;
          }
        }

        const penaltyTxId = `meeting-penalty-${meetingId}-${memberId}`;
        // Wallet transaction fires for ANY penalty — absent OR late —
        // not just absence. Previously this only checked `!attended`,
        // so a member marked "late" got a penaltyAmount computed and
        // shown in their attendee record, but no wallet_tx was ever
        // created for it: the penalty displayed as owed but was never
        // actually charged in the group's ledger. Both cases go
        // through the same tx now; the description below distinguishes
        // which kind of penalty it was.
        if (penaltyAmount > 0 && (!attended || status === "late")) {
          const existingPenalty = get().walletTransactions.find((t) => t.id === penaltyTxId);
          if (!existingPenalty) {
            const tx: WalletTransaction = {
              id: penaltyTxId,
              groupId: activeGroupId,
              type: "late_fee",
              sourceType: "manual",
              sourceId: meetingId,
              amount: penaltyAmount,
              description: !attended
                ? `Meeting absence penalty for ${member?.fullName ?? "member"} - ${meeting.title}`
                : `Meeting late arrival penalty (${lateMinutes} min) for ${member?.fullName ?? "member"} - ${meeting.title}`,
              date: meeting.date,
              memberId,
              createdAt: new Date().toISOString(),
            };
            get().addWalletTxLocal(tx);
            try {
              await FS.addWalletTx(activeGroupId, tx);
            } catch (e) {
              console.error(
                "[recordAttendance] failed to persist penalty tx:",
                e,
              );
              throw e;
            }
            set((s: StoreState) => recalcGroupTotals(s));

            // Alert the member directly — this is the "late fees,
            // penalties" notification gap: previously a penalty could
            // be applied with no signal to the person it applies to.
            if (member?.userId) {
              FS.addNotification(member.userId, {
                userId: member.userId,
                groupId: activeGroupId,
                type: "penalty_applied",
                title: !attended ? "Absence Penalty Applied" : "Late Arrival Penalty Applied",
                message: `A penalty of ${penaltyAmount} RWF was applied for ${meeting.title} (${meeting.date})`,
                read: false,
                metadata: { meetingId, penaltyAmount },
                createdAt: new Date().toISOString(),
              }, member.email).catch(console.warn);
            }
          }
        }
      },


});
