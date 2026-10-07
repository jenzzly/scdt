#!/usr/bin/env node
/**
 * scripts/dedupe-waivers.js
 *
 * One-off cleanup: scans every member in a group and removes duplicate
 * late-fee exemptions from both `lateFeeExemptions` (active) and
 * `pendingExemptions` (pending review).
 *
 * A duplicate is defined as: same scope + same periodStart + same
 * periodEnd. When two entries match on all three keys, the FIRST one
 * is kept; if a later one carries an `amount` and the kept one does
 * not, the amount is copied over.
 *
 * Safe to run multiple times — after the first successful run there
 * will be nothing left to remove.
 *
 * USAGE
 *   npm i firebase-admin                            # once
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   node scripts/dedupe-waivers.js                  # dry run
 *   node scripts/dedupe-waivers.js --apply          # write changes
 *   node scripts/dedupe-waivers.js --group=other-id # custom group
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

const DRY_RUN = !process.argv.includes("--apply");
const GROUP_ID =
  (process.argv.find((a) => a.startsWith("--group=")) || "").slice(8) ||
  "scdt-main-group";

function dedupe(list) {
  const seen = new Map();
  const out = [];
  for (const ex of list) {
    if (!ex || typeof ex !== "object") continue;
    const key = `${ex.scope || ""}||${ex.periodStart || ""}||${ex.periodEnd || ""}`;
    if (seen.has(key)) {
      const idx = seen.get(key);
      // Merge amount if only the duplicate carries one
      if (!out[idx].amount && ex.amount) {
        out[idx] = { ...out[idx], amount: ex.amount };
      }
      continue;
    }
    seen.set(key, out.length);
    out.push(ex);
  }
  return out;
}

async function main() {
  console.log(
    `[dedupe-waivers] group=${GROUP_ID} dry=${DRY_RUN}`,
  );

  const membersSnap = await db
    .collection("groups")
    .doc(GROUP_ID)
    .collection("members")
    .get();

  let scanned = 0;
  let changed = 0;
  let removedActive = 0;
  let removedPending = 0;

  for (const doc of membersSnap.docs) {
    scanned++;
    const m = doc.data();
    const active = Array.isArray(m.lateFeeExemptions)
      ? m.lateFeeExemptions
      : [];
    const pending = Array.isArray(m.pendingExemptions)
      ? m.pendingExemptions
      : [];

    const dedupedActive = dedupe(active);
    const dedupedPending = dedupe(pending);

    const dActive = active.length - dedupedActive.length;
    const dPending = pending.length - dedupedPending.length;

    if (dActive + dPending === 0) continue;

    changed++;
    removedActive += dActive;
    removedPending += dPending;

    console.log(
      `  ${m.fullName || doc.id}: ` +
        `-${dActive} active, -${dPending} pending`,
    );

    if (!DRY_RUN) {
      await doc.ref.update({
        lateFeeExemptions: dedupedActive,
        pendingExemptions: dedupedPending,
      });
    }
  }

  console.log("");
  console.log(`[dedupe-waivers] scanned ${scanned} members`);
  console.log(
    `[dedupe-waivers] ${changed} member(s) affected — ` +
      `${removedActive} active + ${removedPending} pending duplicates removed`,
  );
  if (DRY_RUN && changed > 0) {
    console.log(
      "[dedupe-waivers] DRY RUN — re-run with --apply to write changes",
    );
  }
}

main().catch((e) => {
  console.error("[dedupe-waivers] fatal:", e);
  process.exit(1);
});
