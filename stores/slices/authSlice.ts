// stores/slices/authSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import { FIXED_GROUP_ID } from "../fixedGroup";

export const createAuthSlice = (set: SetFn, get: GetFn): Pick<StoreState, "clearAuth" | "setAuth"> => ({
      setAuth: (uid, name, email) => set({
        authUid: uid,
        authName: name,
        authEmail: email,
        activeGroupId: FIXED_GROUP_ID,
      }),

      clearAuth: () => set({ authUid: null, authName: null, authEmail: null }),


});
