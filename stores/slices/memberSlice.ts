// stores/slices/memberSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { Member } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";

export const createMemberSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addMemberLocal" | "approveMember" | "createMember" | "deleteMember" | "deleteMemberLocal" | "setMembers" | "updateMember" | "updateMemberLocal" | "updateOwnProfile"> => ({
      setMembers: (members) => set({ members }),
      addMemberLocal: (member) => set((s: StoreState) => ({ members: [...s.members, member] })),
      updateMemberLocal: (id, data) => set((s) => ({
        members: s.members.map((m: Member) => (m.id === id ? { ...m, ...data } : m)),
      })),
      deleteMemberLocal: (id) => set((s: StoreState) => ({ members: s.members.filter((m: Member) => m.id !== id) })),

      createMember: async (data) => {
        const { activeGroupId, members } = get();
        if (!activeGroupId) throw new Error("No active group");
        const member: Member = {
          ...data,
          id: uid(),
          totalContributions: 0,
          totalSavings: 0,
          loanEarnings: 0,
        };
        get().addMemberLocal(member);
        try {
          get().setSyncStatus("pending");
          const result = await FS.addMember(activeGroupId, member);
          members
            .filter((m: Member) => m.groupId === activeGroupId && m.role === "admin" && m.status === "active" && m.userId)
            .forEach((admin) => {
              FS.addNotification(admin.userId!, {
                userId: admin.userId!,
                groupId: activeGroupId,
                type: "member_request",
                title: "New member request",
                message: `${member.fullName} has requested access to the group`,
                read: false,
                metadata: { memberId: member.id },
                createdAt: new Date().toISOString(),
              }).catch(console.warn);
            });
          get().setSyncStatus("synced");
          return result;
        } catch (e) {
          get().deleteMemberLocal(member.id);
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to create member");
          throw e;
        }
      },

      updateMember: async (memberId, data) => {
        const { activeGroupId, members } = get();
        const member = members.find((m: Member) => m.id === memberId);
        const previous = member ? { ...member } : null;

        get().updateMemberLocal(memberId, data);

        if (activeGroupId) {
          try {
            get().setSyncStatus("pending");
            const docId: string = (member as any)?._docId ?? memberId;
            const userId: string | undefined = data.userId ?? member?.userId ?? undefined;
            await FS.updateMember(activeGroupId, docId, {
              ...data,
              ...(userId ? { userId } : {}),
            });
            get().setSyncStatus("synced");
          } catch (e) {
            if (previous) get().updateMemberLocal(memberId, previous);
            get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to update member");
            throw e;
          }
        }
      },

      approveMember: async (memberId) => {
        const { activeGroupId, members, authUid, authName } = get();
        const member = members.find((m: Member) => m.id === memberId);
        const previous = member ? { ...member } : null;

        get().updateMemberLocal(memberId, { status: "active" });

        if (activeGroupId) {
          try {
            get().setSyncStatus("pending");
            const docId: string = (member as any)?._docId ?? memberId;
            await FS.updateMember(activeGroupId, docId, {
              status: "active",
              userId: member?.userId,
            });
            await FS.writeAuditLog(activeGroupId, {
              userId: authUid || "",
              groupId: activeGroupId,
              userName: authName || "Unknown",
              action: "APPROVE_MEMBER",
              entityType: "member",
              entityId: memberId,
              before: { status: previous?.status },
              after: { status: "active" },
              reason: `Member ${member?.fullName} approved`,
            });
            get().setSyncStatus("synced");
          } catch (e) {
            if (previous) get().updateMemberLocal(memberId, previous);
            get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to approve member");
            throw e;
          }

          if (member?.userId) {
            FS.addNotification(member.userId, {
              userId: member.userId,
              groupId: activeGroupId,
              type: "member_approved",
              title: "Membership approved",
              message: "Your membership request has been approved",
              read: false,
              metadata: { memberId },
              createdAt: new Date().toISOString(),
            }).catch(console.warn);
          }
        }
      },

      deleteMember: async (memberId) => {
        const { activeGroupId, members } = get();
        const member = members.find((m: Member) => m.id === memberId);
        const previous = member ? { ...member } : null;

        get().deleteMemberLocal(memberId);

        if (activeGroupId) {
          try {
            get().setSyncStatus("pending");
            const docId: string = (member as any)?._docId ?? memberId;
            await FS.deleteMember(activeGroupId, docId, member?.userId);
            get().setSyncStatus("synced");
          } catch (e) {
            if (previous) get().addMemberLocal(previous);
            get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete member");
            throw e;
          }
        }
      },

      updateOwnProfile: async (memberId, data) => {
        const { activeGroupId, authUid, members } = get();
        const member = members.find((m: Member) => m.id === memberId);
        if (!member) throw new Error("Member not found");
        if (member.userId !== authUid) throw new Error("You can only update your own profile");

        const safeData: Partial<Member> = {};
        if (data.fullName !== undefined) safeData.fullName = data.fullName;
        if (data.phone !== undefined) safeData.phone = data.phone;
        if (data.languagePreference !== undefined) safeData.languagePreference = data.languagePreference;
        if (data.nationalId !== undefined) safeData.nationalId = data.nationalId;
        if (data.physicalAddress !== undefined) safeData.physicalAddress = data.physicalAddress;

        const previous = { ...member };
        get().updateMemberLocal(memberId, safeData);

        if (activeGroupId) {
          try {
            get().setSyncStatus("pending");
            const docId: string = (member as any)?._docId ?? memberId;
            await FS.updateMember(activeGroupId, docId, safeData);
            get().setSyncStatus("synced");
          } catch (e) {
            get().updateMemberLocal(memberId, previous);
            get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to update profile");
            throw e;
          }
        }
      },


});
