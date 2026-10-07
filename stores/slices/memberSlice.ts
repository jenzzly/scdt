// stores/slices/memberSlice.ts

import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { Member } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";

export const createMemberSlice = (
  set: SetFn,
  get: GetFn
): Pick<
  StoreState,
  | "addMemberLocal"
  | "approveMember"
  | "bulkImportMembers"
  | "createMember"
  | "deleteMember"
  | "deleteMemberLocal"
  | "setMembers"
  | "updateMember"
  | "updateMemberLocal"
  | "updateOwnProfile"
> => ({

  // ─────────────────────────────
  // LOCAL MEMBER STATE
  // ─────────────────────────────

  setMembers: (members) =>
    set({ members }),

  addMemberLocal: (member) =>
    set((s: StoreState) => ({
      members: [...s.members, member],
    })),

  updateMemberLocal: (id, data) =>
    set((s) => ({
      members: s.members.map((m: Member) =>
        m.id === id
          ? { ...m, ...data }
          : m
      ),
    })),

  deleteMemberLocal: (id) =>
    set((s: StoreState) => ({
      members: s.members.filter(
        (m: Member) => m.id !== id
      ),
    })),

  // ─────────────────────────────
  // CREATE MEMBER
  // ─────────────────────────────

  createMember: async (data) => {
    const { activeGroupId, members } = get();

    if (!activeGroupId) {
      throw new Error("No active group");
    }

    const member: Member = {
      ...data,
      id: uid(),
      totalContributions: 0,
      totalSavings: 0,
      loanEarnings: 0,
    };

    // Optimistic update
    get().addMemberLocal(member);

    try {
      get().setSyncStatus("pending");

      const result = await FS.addMember(
        activeGroupId,
        member
      );

      // Notify active admins
      members
        .filter(
          (m: Member) =>
            m.groupId === activeGroupId &&
            m.role === "admin" &&
            m.status === "active" &&
            !!m.userId
        )
        .forEach((admin) => {
          FS.addNotification(
            admin.userId!,
            {
              userId: admin.userId!,
              groupId: activeGroupId,
              type: "member_request",
              title: "New member request",
              message: `${member.fullName} has requested access to the group`,
              read: false,
              metadata: {
                memberId: member.id,
              },
              createdAt: new Date().toISOString(),
            },
            admin.email
          ).catch(console.warn);
        });

      get().setSyncStatus("synced");

      return result;

    } catch (e) {

      // Rollback optimistic update
      get().deleteMemberLocal(member.id);

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to create member"
      );

      throw e;
    }
  },

  // ─────────────────────────────
  // UPDATE MEMBER
  // ─────────────────────────────

  updateMember: async (memberId, data) => {
    const {
      activeGroupId,
      members,
    } = get();

    const member = members.find(
      (m: Member) => m.id === memberId
    );

    const previous = member
      ? { ...member }
      : null;

    // Optimistic update
    get().updateMemberLocal(
      memberId,
      data
    );

    if (!activeGroupId) {
      return;
    }

    try {
      get().setSyncStatus("pending");

      const docId =
        (member as any)?._docId ??
        memberId;

      const userId =
        data.userId ??
        member?.userId ??
        undefined;

      await FS.updateMember(
        activeGroupId,
        docId,
        {
          ...data,
          ...(userId
            ? { userId }
            : {}),
        }
      );

      get().setSyncStatus("synced");

    } catch (e) {

      // Rollback
      if (previous) {
        get().updateMemberLocal(
          memberId,
          previous
        );
      }

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to update member"
      );

      throw e;
    }
  },

  // ─────────────────────────────
  // APPROVE MEMBER
  // ─────────────────────────────

  approveMember: async (memberId) => {
    const {
      activeGroupId,
      members,
      authUid,
      authName,
    } = get();

    const member = members.find(
      (m: Member) => m.id === memberId
    );

    const previous = member
      ? { ...member }
      : null;

    // Optimistic update
    get().updateMemberLocal(
      memberId,
      {
        status: "active",
      }
    );

    if (!activeGroupId) {
      return;
    }

    try {
      get().setSyncStatus("pending");

      const docId =
        (member as any)?._docId ??
        memberId;

      await FS.updateMember(
        activeGroupId,
        docId,
        {
          status: "active",
          ...(member?.userId
            ? { userId: member.userId }
            : {}),
        }
      );

      // Audit log
      await FS.writeAuditLog(
        activeGroupId,
        {
          userId: authUid || "",
          groupId: activeGroupId,
          userName: authName || "Unknown",
          action: "APPROVE_MEMBER",
          entityType: "member",
          entityId: memberId,
          before: {
            status: previous?.status,
          },
          after: {
            status: "active",
          },
          reason: `Member ${member?.fullName} approved`,
        }
      );

      get().setSyncStatus("synced");

    } catch (e) {

      // Rollback
      if (previous) {
        get().updateMemberLocal(
          memberId,
          previous
        );
      }

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to approve member"
      );

      throw e;
    }

    // Notification happens after successful approval
    if (member?.userId) {
      FS.addNotification(
        member.userId,
        {
          userId: member.userId,
          groupId: activeGroupId,
          type: "member_approved",
          title: "Membership approved",
          message:
            "Your membership request has been approved",
          read: false,
          metadata: {
            memberId,
          },
          createdAt:
            new Date().toISOString(),
        },
        member.email
      ).catch(console.warn);
    }
  },

  // ─────────────────────────────
  // DELETE MEMBER
  // ─────────────────────────────

  deleteMember: async (memberId) => {
    const {
      activeGroupId,
      members,
    } = get();

    if (!activeGroupId) {
      throw new Error("No active group");
    }

    const member = members.find(
      (m: Member) => m.id === memberId
    );

    if (!member) {
      throw new Error("Member not found");
    }

    const previous = {
      ...member,
    };

    /*
     * IMPORTANT:
     *
     * member.id / _docId is the document inside:
     *
     * groups/{groupId}/members/{memberId}
     *
     * member.userId is used to locate:
     *
     * groupMemberships/{groupId}_{userId}
     */

    // Optimistic UI update
    get().deleteMemberLocal(
      memberId
    );

    try {
      get().setSyncStatus("pending");

      const docId =
        (member as any)?._docId ??
        member.id;

      await FS.deleteMember(
        activeGroupId,
        docId,
        member.userId
      );

      get().setSyncStatus("synced");

    } catch (e) {

      // Rollback UI if Firestore deletion failed
      get().addMemberLocal(
        previous
      );

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to delete member"
      );

      throw e;
    }
  },

  // ─────────────────────────────
  // UPDATE OWN PROFILE
  // ─────────────────────────────

  updateOwnProfile: async (
    memberId,
    data
  ) => {
    const {
      activeGroupId,
      authUid,
      members,
    } = get();

    const member = members.find(
      (m: Member) => m.id === memberId
    );

    if (!member) {
      throw new Error(
        "Member not found"
      );
    }

    if (member.userId !== authUid) {
      throw new Error(
        "You can only update your own profile"
      );
    }

    // Only allow safe profile fields
    const safeData: Partial<Member> = {};

    if (data.fullName !== undefined) {
      safeData.fullName =
        data.fullName;
    }

    if (data.phone !== undefined) {
      safeData.phone =
        data.phone;
    }

    if (
      data.languagePreference !==
      undefined
    ) {
      safeData.languagePreference =
        data.languagePreference;
    }

    if (
      data.nationalId !== undefined
    ) {
      safeData.nationalId =
        data.nationalId;
    }

    if (
      data.physicalAddress !== undefined
    ) {
      safeData.physicalAddress =
        data.physicalAddress;
    }

    const previous = {
      ...member,
    };

    // Optimistic update
    get().updateMemberLocal(
      memberId,
      safeData
    );

    if (!activeGroupId) {
      return;
    }

    try {
      get().setSyncStatus("pending");

      const docId =
        (member as any)?._docId ??
        member.id;

      await FS.updateMember(
        activeGroupId,
        docId,
        safeData
      );

      get().setSyncStatus("synced");

    } catch (e) {

      // Rollback
      get().updateMemberLocal(
        memberId,
        previous
      );

      get().setSyncStatus(
        "failed",
        e instanceof Error
          ? e.message
          : "Failed to update profile"
      );

      throw e;
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // BULK IMPORT MEMBERS
  // ═══════════════════════════════════════════════════════════════════
  //
  // Parses rows from a .xlsx / .csv produced (ideally) by the
  // matching "Export members" button. Expected columns:
  //
  //   Full Name | Email | Phone | National ID | Role | Status | Date Joined
  //
  // Rows only create Firestore member docs. No Firebase Auth
  // accounts are made here — a 200-row import would otherwise
  // spin up 200 temp-password Auth users, each requiring a
  // separate secondary-auth round-trip. Instead, every row is
  // created with status "pending" and no userId; the admin
  // follows up per member with "Send login link" (which now
  // creates the Auth account on demand — see adminUsers.ts).
  //
  // Existing members (matched by lowercased email) are skipped
  // rather than duplicated. A row that fails validation does not
  // abort the batch — its error is collected and the next row
  // runs. Same shape as bulkImportContributions.
  bulkImportMembers: async (rows, groupId) => {
    const errors: string[] = [];
    if (!groupId) throw new Error("No group id");
    if (!Array.isArray(rows) || rows.length === 0) {
      return { created: 0, skipped: 0, errors: ["File is empty"] };
    }

    const now = new Date().toISOString();
    const existingEmails = new Set(
      get()
        .members.filter((m) => m.groupId === groupId)
        .map((m) => (m.email ?? "").trim().toLowerCase())
        .filter(Boolean),
    );

    // Skip a leading header row — the export produces one and
    // re-importing the file straight from the export is common.
    const firstRow = rows[0];
    const startIndex =
      Array.isArray(firstRow) &&
      String(firstRow[0] ?? "").trim().toLowerCase() === "full name"
        ? 1
        : 0;

    let created = 0;
    let skipped = 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      if (row.every((c) => c === "" || c == null)) continue;

      const fullName = String(row[0] ?? "").trim();
      const email = String(row[1] ?? "").trim();
      const phone = String(row[2] ?? "").trim();
      const nationalId = String(row[3] ?? "").trim();
      const roleRaw = String(row[4] ?? "member").trim().toLowerCase();

      if (!fullName) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${i + 1}: missing Full Name`);
        continue;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${i + 1}: invalid Email "${email}"`);
        continue;
      }
      if (existingEmails.has(email.toLowerCase())) {
        skipped++;
        if (errors.length < 20)
          errors.push(`Row ${i + 1}: email ${email} already a member — skipped`);
        continue;
      }

      const role = ["admin", "accountant", "loan_officer", "committee", "member", "audit", "groups"].includes(
        roleRaw,
      )
        ? (roleRaw as any)
        : "member";

      try {
        await FS.addMember(groupId, {
          groupId,
          fullName,
          email,
          phone,
          nationalId: nationalId || undefined,
          role,
          status: "pending",
          dateJoined: now,
          totalContributions: 0,
          totalSavings: 0,
          loanEarnings: 0,
        } as any);

        existingEmails.add(email.toLowerCase());
        created++;
      } catch (e: any) {
        skipped++;
        if (errors.length < 20)
          errors.push(`Row ${i + 1}: ${e?.message || "unknown error"}`);
      }
    }

    return { created, skipped, errors };
  },

  // ─────────────────────────────
});
