// stores/slices/notificationSlice.ts

import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { AppNotification } from "../../types";
import * as FS from "../../lib/firestore";

export const createNotificationSlice = (
  set: SetFn,
  get: GetFn
): Pick<
  StoreState,
  | "markNotifReadLocal"
  | "setNotifications"
  | "clearNotification"
  | "clearAllNotifications"
> => ({
  setNotifications: (ns) => set({ notifications: ns }),

  markNotifReadLocal: (id) => {
    const { authUid } = get();

    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));

    if (authUid) {
      FS.markNotificationRead(authUid, id).catch((error) => {
        console.warn(
          "[notificationSlice] Failed to mark notification as read:",
          error
        );
      });
    }
  },

  clearNotification: async (id) => {
    const { authUid } = get();

    if (!authUid) {
      console.warn(
        "[notificationSlice] Cannot clear notification: no authUid"
      );
      return;
    }

    try {
      // Delete from Firestore first.
      await FS.deleteNotification(authUid, id);

      // Then update local state.
      set((s) => ({
        notifications: s.notifications.filter(
          (n) => n.id !== id
        ),
      }));
    } catch (error) {
      console.error(
        "[notificationSlice] Failed to clear notification:",
        {
          id,
          authUid,
          error,
        }
      );

      throw error;
    }
  },

  clearAllNotifications: async () => {
    const { authUid } = get();

    if (!authUid) {
      console.warn(
        "[notificationSlice] Cannot clear all notifications: no authUid"
      );
      return;
    }

    try {
      // Delete from Firestore first.
      await FS.clearAllUserNotifications(authUid);

      // Then update local state.
      set({ notifications: [] });
    } catch (error) {
      console.error(
        "[notificationSlice] Failed to clear all notifications:",
        {
          authUid,
          error,
        }
      );

      throw error;
    }
  },
});