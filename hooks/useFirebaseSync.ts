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
 *  E. Role-based data filtering - members only see their own contributions
 *     and loans, while staff roles see all data. Wallet only loaded for
 *     admin/accountant roles.
 */

import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import { useCurrentUserRole, useCurrentMember } from "../stores/useStore";
import { canViewAllContributions, canViewAllLoans, canViewWallet, canViewInvestments } from "../lib/auth/permissions";
import * as FS from "../lib/firestore";

// How many subscriptions we set up in useFirebaseSync.
// This is dynamic now - calculated at runtime based on permissions.
// Base subscriptions: group, members, contributions, loans, expenses, meetings, auditLogs, deletionHistory = 8
// Plus wallet and investments conditionally = 2 (total 10 max)
const BASE_SUBS = 8;

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
  const currentUserRole = useCurrentUserRole();
  const currentMember = useCurrentMember();

  // Determine if user should see all data or just their own
  const viewAllContributions = canViewAllContributions(currentUserRole, currentMember?.permissions);
  const viewAllLoans = canViewAllLoans(currentUserRole, currentMember?.permissions);
  const viewWallet = canViewWallet(currentUserRole, currentMember?.permissions);
  const viewInvestments = canViewInvestments(currentUserRole, currentMember?.permissions);
  const memberId = currentMember?.id;

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
    // Calculate total subscriptions based on permissions
    const totalSubs = BASE_SUBS + (viewWallet ? 1 : 0) + (viewInvestments ? 1 : 0);
    let firedCount = 0;
    const markSynced = () => {
      firedCount += 1;
      if (firedCount >= totalSubs) {
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
    // IMPORTANT: this handler is used for the core, membership-gated
    // collections (group, members, contributions, loans, investments,
    // wallet, expenses, meetings). Per firestore.rules, every one of those
    // is readable by `isMember(groupId)` — just having a
    // `groupMemberships/{groupId}_{uid}` doc, regardless of role or status.
    // A permission error here is NOT an expected, role-based restriction
    // the way it is for auditLogs/deletionHistory below — it almost always
    // means this user's groupMemberships doc was never created (see the
    // ensureMemberExists / member-linking flow). Silently swallowing it
    // previously left every total derived from these collections sitting
    // at 0 with no indication anything had gone wrong — the dashboard
    // just looked empty, not broken. Surface it as a real sync failure
    // instead so the existing "failed" state (see components/ui/
    // SyncStatusBar.tsx and the banner in (tabs)/_layout.tsx) shows up.
    const handleAuthError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("unauthenticated") ||
        msg.toLowerCase().includes("auth/id-token-expired")
      ) {
        store.setSyncStatus("failed", "Session expired. Please sign in again.");
        return;
      }
      if (
        msg.toLowerCase().includes("permission") ||
        msg.toLowerCase().includes("missing or insufficient")
      ) {
        store.setSyncStatus(
          "failed",
          "Couldn't load your group's data (permission denied). Your account may not be fully linked to this group yet — try signing out and back in, or contact your group admin.",
        );
        return;
      }
      handleSyncError(err);
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
          viewAllContributions ? undefined : memberId,
        ),

        // ── Loans ─────────────────────────────────────────────────────────
        FS.subscribeLoans(
          groupId,
          (items) => { store.setLoans(items); markSynced(); },
          handleAuthError,
          viewAllLoans ? undefined : memberId,
        ),

        // ── Investments ───────────────────────────────────────────────────
        // Only fetch investments if user has permission
        ...(viewInvestments ? [
          FS.subscribeInvestments(
            groupId,
            (items) => { store.setInvestments(items); markSynced(); },
            handleAuthError,
          ),
        ] : []),

        // ── Wallet transactions ───────────────────────────────────────────
        // Only fetch wallet if user has permission
        ...(viewWallet ? [
          FS.subscribeWalletTxs(
            groupId,
            (items) => { store.setWalletTxs(items); markSynced(); },
            handleAuthError,
          ),
        ] : []),

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
    // forceSyncTrigger causes a full teardown + rebuild of all listeners.
    // For Firestore real-time listeners this is almost never necessary because
    // they already stream the latest state continuously.
    // Consider replacing triggerForceSync() call sites with a targeted
    // one-shot getDocs() for just the collection that changed, rather than
    // rebuilding every listener.
    // Left in for backward compatibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isOnline, forceSyncTrigger, currentUserRole, currentMember?.id, currentMember?.permissions]);
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