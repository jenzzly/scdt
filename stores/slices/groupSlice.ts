// stores/slices/groupSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { Group } from "../../types";
import * as FS from "../../lib/firestore";
import { recalcGroupTotals } from "../recalcGroupTotals";
import { BRAND } from "../../lib/brand";

export const createGroupSlice = (set: SetFn, get: GetFn): Pick<StoreState, "forceRefresh" | "recalcTotals" | "setActiveGroup" | "setGroups" | "updateGroup" | "upsertGroup"> => ({
      setGroups: (groups) => set({ groups }),
      setActiveGroup: (id) => set({ activeGroupId: id }),

      upsertGroup: (group) => set((s) => ({
        groups: s.groups.some((g) => g.id === group.id)
          ? s.groups.map((g) => (g.id === group.id ? group : g))
          : [...s.groups, group],
      })),

      recalcTotals: () => {
        const state = get();
        const updates = recalcGroupTotals(state);
        set(updates);
      },

      forceRefresh: () => {
        const state = get();
        const updates = recalcGroupTotals(state);
        set(updates);
      },

      updateGroup: async (groupId, data) => {
        let group = get().groups.find((g) => g.id === groupId);
        let previous = group ? { ...group } : null;
        let groupExistsInFirestore = true;

        if (!group) {
          const fetchedGroup = await FS.getGroup(groupId);
          if (!fetchedGroup) {
            const defaultGroup: Group = {
              id: groupId,
              name: BRAND.defaultGroupName,
              currency: BRAND.defaultCurrency,
              contributionAmount: BRAND.defaults.contributionAmount,
              contributionFrequency: BRAND.defaults.contributionFrequency,
              contributionDay: BRAND.defaults.contributionDay,
              loanInterestRate: BRAND.defaults.loanInterestRate,
        loanInterestMethod: BRAND.defaults.loanInterestMethod,
              latePenaltyRatePct: BRAND.defaults.latePenaltyRatePct,
              loanInterestRatePeriod: BRAND.defaults.loanInterestRatePeriod,
              absencePenaltyMemberRatePct: BRAND.defaults.absencePenaltyMemberRatePct,
              absencePenaltyOfficerRatePct: BRAND.defaults.absencePenaltyOfficerRatePct,
              createdBy: "",
              createdAt: new Date().toISOString(),
              inviteCode: "",
              totalSavings: 0,
              totalLoans: 0,
              availableBalance: 0,
              totalInvestments: 0,
              totalInterestEarned: 0,
              memberCount: 0,
            };
            group = defaultGroup;
            previous = { ...group };
            groupExistsInFirestore = false;
            set((s) => ({ groups: [...s.groups, group as Group] }));
          } else {
            group = fetchedGroup;
            previous = { ...group };
            set((s) => ({ groups: [...s.groups, group as Group] }));
          }
        }

        set((s) => ({
          groups: s.groups.map((g) => (g.id === groupId ? { ...g, ...data } : g)),
        }));

        try {
          get().setSyncStatus("pending");
          if (groupExistsInFirestore) {
            await FS.updateGroup(groupId, data);
          } else {
            const updatedGroup = { ...group, ...data };
            await FS.createGroup(updatedGroup);
          }
          get().setSyncStatus("synced");
        } catch (e) {
          if (previous) {
            set((s) => ({
              groups: s.groups.map((g) => (g.id === groupId ? previous : g)),
            }));
          }
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to update group settings");
          throw e;
        }
      },


});
