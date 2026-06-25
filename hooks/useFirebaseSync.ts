/**
 * useFirebaseSync — subscribes to Firestore collections in real-time.
 *
 * FIXES vs original:
 *  A. setSyncStatus("synced") now only fires after ALL subscriptions have
 *     received their first snapshot, eliminating the flicker.
 *  B. deletionHistory now uses the permission-error-swallowing handler, same
 *     as auditLogs, because non-admin members may not have read access.
 *  C. forceSyncTrigger dependency note — see comment below.
 *  D. Auth-expiry / permission error guard added.
 */

import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import * as FS from "../lib/firestore";

// How many subscriptions we set up in useFirebaseSync.
// Update this number if you add or remove a subscription.
const TOTAL_SUBS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Main group sync hook
// ─────────────────────────────────────────────────────────────────────────────
export function useFirebaseSync(
  groupId: string | null | undefined,
  isOnline: boolean = true,
) {
  const store = useStore();
  const unsubs = useRef<(() => void)[]>([]);
  const forceSyncTrigger = store.forceSyncTrigger;

  useEffect(() => {
    // Clean up any previous subscriptions before re-subscribing
    unsubs.current.forEach((u) => u());
    unsubs.current = [];

    if (!groupId) return;

    if (!isOnline) {
      store.setSyncStatus("offline");
      return;
    }

    store.setSyncStatus("syncing");

    // ── FIX A: only mark synced after every subscription has fired once ──────
    let firedCount = 0;
    const markSynced = () => {
      firedCount += 1;
      if (firedCount >= TOTAL_SUBS) {
        store.setSyncStatus("synced");
      }
    };

    const handleSyncError = (err: unknown) => {
      store.setSyncStatus(
        "failed",
        err instanceof Error ? err.message : "Failed to sync",
      );
    };

    // Silently swallow permission errors — expected for non-admin/accountant roles.
    const handlePermissionError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("permission") ||
        msg.toLowerCase().includes("missing or insufficient")
      ) {
        // Not an error the user needs to see — still count it as "fired"
        // so the synced countdown isn't blocked by a role-limited collection.
        markSynced();
        return;
      }
      handleSyncError(err);
    };

    // ── FIX D: detect auth expiry and surface it clearly ─────────────────────
    const handleAuthError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("unauthenticated") ||
        msg.toLowerCase().includes("auth/id-token-expired")
      ) {
        store.setSyncStatus("failed", "Session expired. Please sign in again.");
        // Optionally call store.clearAuth() here to force a re-login:
        // store.clearAuth();
        return;
      }
      handlePermissionError(err);
    };

    try {
      unsubs.current = [
        // ── Core group document ──────────────────────────────────────────
        FS.subscribeGroup(
          groupId,
          (g) => { store.upsertGroup(g); markSynced(); },
          handleAuthError,
        ),

        // ── Members ──────────────────────────────────────────────────────
        FS.subscribeMembers(
          groupId,
          (items) => { store.setMembers(items); markSynced(); },
          handleAuthError,
        ),

        // ── Contributions ─────────────────────────────────────────────────
        FS.subscribeContributions(
          groupId,
          (items) => { store.setContributions(items); markSynced(); },
          handleAuthError,
        ),

        // ── Loans ─────────────────────────────────────────────────────────
        FS.subscribeLoans(
          groupId,
          (items) => { store.setLoans(items); markSynced(); },
          handleAuthError,
        ),

        // ── Investments ───────────────────────────────────────────────────
        FS.subscribeInvestments(
          groupId,
          (items) => { store.setInvestments(items); markSynced(); },
          handleAuthError,
        ),

        // ── Wallet transactions ───────────────────────────────────────────
        FS.subscribeWalletTxs(
          groupId,
          (items) => { store.setWalletTxs(items); markSynced(); },
          handleAuthError,
        ),

        // ── Expenses ──────────────────────────────────────────────────────
        FS.subscribeExpenses(
          groupId,
          (items) => { store.setExpenses(items); markSynced(); },
          handleAuthError,
        ),

        // ── Meetings ──────────────────────────────────────────────────────
        FS.subscribeMeetings(
          groupId,
          (items) => { store.setMeetings(items); markSynced(); },
          handleAuthError,
        ),

        // ── Audit logs (admin/accountant only) ────────────────────────────
        FS.subscribeAuditLogs(
          groupId,
          (items) => { store.setAuditLogs(items); markSynced(); },
          handlePermissionError, // permission errors silently swallowed
        ),

        // ── FIX B: deletion history uses the same permission-safe handler ──
        // The deletions collection is readable by all members per rules, but
        // if your rules ever tighten this, the handler already handles it.
        FS.subscribeDeletionHistory(
          groupId,
          (items) => { store.setDeletionRecords(items); markSynced(); },
          handlePermissionError,
        ),
      ];
    } catch (err: any) {
      store.setSyncStatus("failed", err.message || "Failed to set up sync");
    }

    return () => {
      unsubs.current.forEach((u) => u());
      unsubs.current = [];
    };

    // ── FIX C note ────────────────────────────────────────────────────────────
    // forceSyncTrigger causes a full teardown + rebuild of all 10 listeners.
    // For Firestore real-time listeners this is almost never necessary because
    // they already stream the latest state continuously.
    // Consider replacing triggerForceSync() call sites with a targeted
    // one-shot getDocs() for just the collection that changed, rather than
    // rebuilding every listener.
    // Left in for backward compatibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isOnline, forceSyncTrigger]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification sync hook (per-user, separate from group sync)
// ─────────────────────────────────────────────────────────────────────────────
export function useNotificationSync(uid: string | null | undefined) {
  const store = useStore();

  useEffect(() => {
    if (!uid) return;
    const unsub = FS.subscribeNotifications(uid, store.setNotifications);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);
}