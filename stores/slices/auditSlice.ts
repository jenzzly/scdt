// stores/slices/auditSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";

export const createAuditSlice = (set: SetFn, get: GetFn): Pick<StoreState, "setAuditLogs" | "setDeletionRecords"> => ({
      setDeletionRecords: (records) => set({ deletionRecords: records }),
      setAuditLogs: (logs) => set({ auditLogs: logs }),


});
