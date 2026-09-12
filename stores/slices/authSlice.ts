// stores/slices/authSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
export const createAuthSlice = (set: SetFn, get: GetFn): Pick<StoreState, "clearAuth" | "setAuth"> => ({
      setAuth: (uid, name, email) => set({
        authUid: uid,
        authName: name,
        authEmail: email,
        // Group access is resolved from the caller's own membership records
        // after login. Never restore a fixed/shared group for a new session.
        activeGroupId: null,
      }),

      clearAuth: () => set({ 
        authUid: null, 
        authName: null, 
        authEmail: null,
        currentMember: null, // Clear current member on logout
        activeGroupId: null, // Clear active group on logout
        members: [], // Clear all cached data on logout
        contributions: [],
        loans: [],
        investments: [],
        walletTransactions: [],
        expenses: [],
        meetings: [],
        notifications: [],
        auditLogs: [],
      }),


});
