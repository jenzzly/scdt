// lib/firestore/meetings.ts
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch,
  meetingsCol, membersCol, groupDoc,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2,
} from "./core";
import type { Meeting, MeetingAttendee, NewRecord } from "./core";
import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";

// ─────────────────────────────────────────────────────────────────────────────
// Meetings
// ─────────────────────────────────────────────────────────────────────────────
export async function addMeeting(gId: string, data: NewRecord<Meeting>): Promise<string> {
  try {
    const userInfo = await getCurrentUserInfo();
    const dRef = data.id ? doc(meetingsCol(gId), data.id) : doc(meetingsCol(gId));
    const now = new Date().toISOString();

    const meetingData = {
      ...stripUndefined(data as any),
      id: dRef.id,
      createdAt: now,
      createdBy: userInfo?.userId,
    };

    await setDoc(dRef, meetingData);

    if (userInfo) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "created",
        entityType: "meeting",
        entityId: dRef.id,
        after: meetingData,
        reason: data.title || "Meeting created",
      });
    }

    return dRef.id;
  } catch (error) {
    logError("addMeeting", "meeting", error, { groupId: gId });
    throw error;
  }
}

export async function updateMeeting(
  gId: string,
  id: string,
  data: Partial<Meeting>,
): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    const now = new Date().toISOString();

    const currentSnap = await getDoc(doc(meetingsCol(gId), id));
    const before = currentSnap.exists() ? currentSnap.data() : undefined;

    const cleanData = stripUndefined(data as any);

    await updateDoc(doc(meetingsCol(gId), id), cleanData);

    if (userInfo && before) {
      await writeAuditLog(gId, {
        groupId: gId,
        userId: userInfo.userId,
        userName: userInfo.userName,
        action: "updated",
        entityType: "meeting",
        entityId: id,
        before,
        after: { ...before, ...cleanData },
        reason: data.title || "Meeting updated",
      });
    }
  } catch (error) {
    logError("updateMeeting", "meeting", error, { groupId: gId, id });
    throw error;
  }
}

export function subscribeMeetings(
  gId: string,
  cb: (ms: Meeting[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return onSnapshot(
    query(meetingsCol(gId), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((s) => fromSnap<Meeting>(s))),
    onError,
  );
}

export async function deleteMeeting(gId: string, id: string, reason: string): Promise<void> {
  try {
    const userInfo = await getCurrentUserInfo();
    if (!userInfo) throw new Error("User not authenticated");

    const now = new Date().toISOString();
    const currentSnap = await getDoc(doc(meetingsCol(gId), id));
    if (!currentSnap.exists()) throw new Error("Meeting not found");

    const meeting = fromSnap<Meeting>(currentSnap);
    if (meeting.status !== "scheduled") {
      throw new Error("Only scheduled meetings can be deleted");
    }

    await recordDeletion(gId, "meeting", id, meeting as unknown as Record<string, unknown>, reason);

    await writeAuditLog(gId, {
      groupId: gId,
      userId: userInfo.userId,
      userName: userInfo.userName,
      action: "deleted",
      entityType: "meeting",
      entityId: id,
      before: meeting as unknown as Record<string, unknown>,
      reason,
    });

    await deleteDoc(doc(meetingsCol(gId), id));
  } catch (error) {
    logError("deleteMeeting", "meeting", error, { groupId: gId, id });
    throw error;
  }
}

