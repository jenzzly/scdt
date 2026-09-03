// stores/slices/notificationSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { AppNotification } from "../../types";
import * as FS from "../../lib/firestore";

export const createNotificationSlice = (set: SetFn, get: GetFn): Pick<StoreState, "markNotifReadLocal" | "setNotifications" | "clearNotification" | "clearAllNotifications"> => ({
  setNotifications: (ns) => set({ notifications: ns }),
  markNotifReadLocal: (id) => {
    const { authUid } = get();
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
    if (authUid) {
      FS.markNotificationRead(authUid, id).catch(console.warn);
    }
  },
  clearNotification: async (id) => {
    const { authUid } = get();
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }));
    if (authUid) {
      await FS.deleteNotification(authUid, id).catch(console.warn);
    }
  },
  clearAllNotifications: async () => {
    const { authUid } = get();
    set({ notifications: [] });
    if (authUid) {
      await FS.clearAllUserNotifications(authUid).catch(console.warn);
    }
  },
});
