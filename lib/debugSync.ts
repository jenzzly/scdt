/**
 * debugSync.ts — run this once, temporarily, to get a definitive answer
 * for why useFirebaseSync's subscriptions are failing with
 * "permission denied" for this signed-in user.
 *
 * HOW TO USE:
 * 1. Drop this file anywhere in your app (e.g. lib/debugSync.ts).
 * 2. Import and call it from somewhere that already runs after login,
 *    e.g. temporarily at the top of app/(tabs)/more.tsx's component body:
 *
 *      import { debugSync } from "../../lib/debugSync";
 *      useEffect(() => { debugSync(); }, []);
 *
 * 3. Open it, reload, and paste the full console output back. Every
 *    line is prefixed [DEBUG] so it's easy to find.
 * 4. Delete this file (and the debugSync() call) once done — it's a
 *    one-time diagnostic, not meant to ship.
 *
 * WHAT IT DOES:
 * Reads your own groupMemberships/{groupId}_{uid} doc and your
 * groups/{groupId}/members/{memberId} doc side by side (the two
 * places "role" is stored — see stores/useStore.ts useCurrentUserRole
 * vs firestore.rules memberRole()), then attempts a read against each
 * rules-protected collection individually and reports pass/fail with
 * the real Firestore error code for each — instead of useFirebaseSync's
 * handleAuthError, which collapses every denial into one generic
 * message and doesn't tell you WHICH collection failed.
 */
import {
  doc, getDoc, getDocs, collection, query, limit,
} from "firebase/firestore";
import { db, auth } from "./firestore/core";

export async function debugSync() {
  const user = auth.currentUser;
  if (!user) {
    console.log("[DEBUG] No signed-in user — nothing to check.");
    return;
  }

  const uid = user.uid;
  console.log(`[DEBUG] uid = ${uid}`);
  console.log(`[DEBUG] email = ${user.email}`);

  // ── Find activeGroupId the same way the app does: via useStore's
  // persisted state isn't importable standalone here without pulling in
  // the whole store, so ask for it directly if you know it, or read it
  // out of localStorage on web.
  let groupId: string | null = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem("scdt-v2");
      if (raw) {
        const parsed = JSON.parse(raw);
        groupId = parsed?.state?.activeGroupId ?? null;
      }
    }
  } catch (e) {
    console.log("[DEBUG] Could not read activeGroupId from localStorage:", e);
  }

  if (!groupId) {
    console.log("[DEBUG] No activeGroupId found automatically.");
    console.log("[DEBUG] Edit this file and hardcode: const groupId = 'YOUR_GROUP_ID';");
    return;
  }

  console.log(`[DEBUG] groupId = ${groupId}`);
  const membershipId = `${groupId}_${uid}`;
  console.log(`[DEBUG] expected groupMemberships doc id = ${membershipId}`);

  // ── 1. groupMemberships doc ────────────────────────────────────────────
  try {
    const mSnap = await getDoc(doc(db, "groupMemberships", membershipId));
    if (mSnap.exists()) {
      const d = mSnap.data();
      console.log(`[DEBUG] groupMemberships doc FOUND:`, JSON.stringify(d, null, 2));
      console.log(`[DEBUG]   -> role = "${d.role}", status = "${d.status}", memberId = "${d.memberId}"`);
    } else {
      console.log(`[DEBUG] groupMemberships doc DOES NOT EXIST at id ${membershipId}. This alone would explain every denial — isMember()/isActiveMember() in firestore.rules depend on this exact doc existing.`);
    }
  } catch (e: any) {
    console.log(`[DEBUG] groupMemberships read FAILED: code=${e?.code} message=${e?.message}`);
  }

  // ── 2. members doc (need memberId — try uid first, then scan) ──────────
  try {
    let memberData: any = null;
    const byUidSnap = await getDoc(doc(db, "groups", groupId, "members", uid));
    if (byUidSnap.exists()) {
      memberData = byUidSnap.data();
      console.log(`[DEBUG] members doc FOUND at members/${uid}:`, JSON.stringify(memberData, null, 2));
    } else {
      console.log(`[DEBUG] No members doc at members/${uid} (memberId may differ from uid — check groupMemberships.memberId above and getDoc that id manually if needed).`);
    }
    if (memberData) {
      console.log(`[DEBUG]   -> role = "${memberData.role}", status = "${memberData.status}", permissions = ${JSON.stringify(memberData.permissions)}`);
    }
  } catch (e: any) {
    console.log(`[DEBUG] members doc read FAILED: code=${e?.code} message=${e?.message}`);
  }

  // ── 3. group doc — check rolePermissions presence ──────────────────────
  try {
    const gSnap = await getDoc(doc(db, "groups", groupId));
    if (gSnap.exists()) {
      const g = gSnap.data();
      console.log(`[DEBUG] group doc found. has rolePermissions field: ${"rolePermissions" in g}`);
      console.log(`[DEBUG] group doc found. has customRolePermissions field: ${"customRolePermissions" in g}`);
      if ("rolePermissions" in g) {
        console.log(`[DEBUG]   rolePermissions = ${JSON.stringify(g.rolePermissions)}`);
      }
    } else {
      console.log(`[DEBUG] group doc DOES NOT EXIST at groups/${groupId}`);
    }
  } catch (e: any) {
    console.log(`[DEBUG] group doc read FAILED: code=${e?.code} message=${e?.message}`);
  }

  // ── 4. Try each protected collection individually ──────────────────────
  const collectionsToTest = [
    "members", "contributions", "loans", "investments",
    "walletTransactions", "expenses", "meetings", "auditLogs", "deletions",
  ];

  for (const col of collectionsToTest) {
    try {
      const snap = await getDocs(query(collection(db, "groups", groupId, col), limit(1)));
      console.log(`[DEBUG] READ OK  groups/${groupId}/${col} (${snap.size} doc(s) in test query)`);
    } catch (e: any) {
      console.log(`[DEBUG] READ FAIL groups/${groupId}/${col} — code=${e?.code} message=${e?.message}`);
    }
  }

  console.log("[DEBUG] Done. Paste everything above starting from '[DEBUG] uid =' back into the chat.");
}