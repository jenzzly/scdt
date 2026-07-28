// stores/slices/syncSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";

export const createSyncSlice = (set: SetFn, get: GetFn): Pick<StoreState, "setLoading" | "setSyncStatus" | "triggerForceSync"> => ({
      setSyncStatus: (s, error = null) => set(() => ({
        syncStatus: s,
        syncError: error,
        ...(s === "synced" ? { lastSyncTimestamp: Date.now() } : {}),
      })),
      triggerForceSync: () => set((s: StoreState) => ({ forceSyncTrigger: s.forceSyncTrigger + 1 })),
      setLoading: (b) => set({ isLoading: b }),

});
