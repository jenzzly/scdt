#!/usr/bin/env node
/**
 * scripts/job-goal-compliance.js
 *
 * Applies contribution-goal compliance fees at each closed goal
 * period. Two fees per period, mirroring findGoalComplianceFees in
 * utils/lateFees.ts:
 *
 *   mid:  contributions in the first half fell short of
 *         (minPct × target). fee = rate × shortfall.
 *   full: total contributions fell short of target.
 *         fee = rate × (target − contributed).
 *
 * Idempotent via deterministic fee tx IDs:
 *   goal-fee-{memberId}-{periodStart}-mid
 *   goal-fee-{memberId}-{periodStart}-full
 *
 * Usage:
 *   node scripts/job-goal-compliance.js             # dry run
 *   node scripts/job-goal-compliance.js --apply     # write
 *
 * Cron (daily 03:00 UTC):
 *   0 3 * * * cd /path/to/project && node scripts/job-goal-compliance.js --apply >> /var/log/goal-compliance.log 2>&1
 *
 * Requires:
 *   npm i firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */
const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();
const DRY_RUN = !process.argv.includes("--apply");

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addMonths(d, n) { const out = new Date(d); out.setMonth(out.getMonth() + n); return out; }
function round2(n) { return Math.round(n * 100) / 100; }

async function computeOverdueGoalFees(groupId, group) {
  const periodMonths = group.contributionGoalPeriodMonths;
  const target = group.contributionGoalTargetAmount;
  const anchorYmd = group.contributionGoalAnchorDate;
  if (!periodMonths || periodMonths < 1) return [];
  if (!target || target <= 0) return [];
  if (!anchorYmd) return [];

  const minPct = Math.max(1, Math.min(100, group.contributionGoalMinPct ?? 50));
  const ratePct = Math.max(0, group.contributionGoalLateFeeRatePct ?? 2);
  if (ratePct <= 0) return [];

  const anchor = new Date(anchorYmd);
  if (Number.isNaN(anchor.getTime())) return [];

  const membersSnap = await db.collection("groups").doc(groupId)
    .collection("members").where("status", "==", "active").get();
  const contribsSnap = await db.collection("groups").doc(groupId)
    .collection("contributions").where("status", "==", "approved").get();
  const walletSnap = await db.collection("groups").doc(groupId)
    .collection("walletTransactions").get();

  const existingFeeIds = new Set(
    walletSnap.docs.map((d) => d.id).filter((id) => id.startsWith("goal-fee-"))
  );

  const now = new Date();
  const out = [];

  for (const memberDoc of membersSnap.docs) {
    const member = memberDoc.data();
    const memberId = memberDoc.id;
    const memberAlias = member.userId;

    const owned = contribsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (c) =>
          (c.memberId === memberId || (memberAlias && c.memberId === memberAlias)) &&
          c.contributionType === "regular"
      );

    let cursor = new Date(anchor);
    cursor.setHours(0, 0, 0, 0);
    let guard = 0;

    while (guard < 500) {
      guard++;
      const periodStart = new Date(cursor);
      const periodEnd = addMonths(periodStart, periodMonths);
      if (periodEnd > now) break;

      const midPoint = addMonths(periodStart, Math.floor(periodMonths / 2));

      const firstHalf = owned.filter((c) => {
        const d = new Date(c.date);
        return d >= periodStart && d < midPoint;
      }).reduce((s, c) => s + (c.amount || 0), 0);

      const whole = owned.filter((c) => {
        const d = new Date(c.date);
        return d >= periodStart && d < periodEnd;
      }).reduce((s, c) => s + (c.amount || 0), 0);

      const midTarget = round2(target * (minPct / 100));
      const midShortfall = round2(Math.max(0, midTarget - firstHalf));
      const fullShortfall = round2(Math.max(0, target - whole));

      const startYmd = ymd(periodStart);
      const endInclusive = new Date(periodEnd);
      endInclusive.setDate(endInclusive.getDate() - 1);
      const periodLabel = `${startYmd} → ${ymd(endInclusive)}`;

      if (midShortfall > 0) {
        const feeTxId = `goal-fee-${memberId}-${startYmd}-mid`;
        if (!existingFeeIds.has(feeTxId)) {
          out.push({
            groupId, memberId, memberName: member.fullName, kind: "mid",
            periodLabel, periodStart: startYmd, periodEnd: ymd(periodEnd),
            target: midTarget, contributed: round2(firstHalf),
            shortfall: midShortfall, ratePct,
            feeAmount: round2(midShortfall * (ratePct / 100)),
            feeTxId,
          });
        }
      }

      if (fullShortfall > 0) {
        const feeTxId = `goal-fee-${memberId}-${startYmd}-full`;
        if (!existingFeeIds.has(feeTxId)) {
          out.push({
            groupId, memberId, memberName: member.fullName, kind: "full",
            periodLabel, periodStart: startYmd, periodEnd: ymd(periodEnd),
            target, contributed: round2(whole),
            shortfall: fullShortfall, ratePct,
            feeAmount: round2(fullShortfall * (ratePct / 100)),
            feeTxId,
          });
        }
      }

      cursor = periodEnd;
    }
  }
  return out;
}

async function applyFee(fee) {
  const now = new Date().toISOString();
  const walletRef = db.collection("groups").doc(fee.groupId)
    .collection("walletTransactions").doc(fee.feeTxId);

  const label = fee.kind === "mid" ? "Half-target" : "Full-target";

  await walletRef.set({
    id: fee.feeTxId,
    groupId: fee.groupId,
    type: "late_fee",
    sourceType: "manual",
    sourceId: fee.memberId,
    amount: fee.feeAmount,
    description: `Goal ${label} compliance fee — ${fee.periodLabel} (${fee.shortfall.toLocaleString()} shortfall)`,
    date: now,
    memberId: fee.memberId,
    createdAt: now,
    createdBy: "system",
    feePaid: false,
  });

  const memberSnap = await db.collection("groups").doc(fee.groupId)
    .collection("members").doc(fee.memberId).get();
  const member = memberSnap.data();
  if (member?.userId) {
    await db.collection("users").doc(member.userId).collection("notifications").add({
      userId: member.userId,
      groupId: fee.groupId,
      type: "contribution_late_fee",
      title: "Contribution Goal Missed",
      message: `${label} shortfall of ${fee.shortfall.toLocaleString()} for ${fee.periodLabel} — a fee of ${fee.feeAmount.toLocaleString()} has been applied.`,
      read: false,
      metadata: { goalFeeTxId: fee.feeTxId, kind: fee.kind },
      createdAt: now,
    });
  }
}

async function main() {
  console.log(`[goal-compliance] start ${new Date().toISOString()}${DRY_RUN ? " (dry run)" : ""}`);
  const groupsSnap = await db.collection("groups").get();
  let totalApplied = 0;
  let totalWouldApply = 0;

  for (const groupDoc of groupsSnap.docs) {
    const group = groupDoc.data();
    const groupId = groupDoc.id;
    if (!group.contributionGoalPeriodMonths) continue;

    const fees = await computeOverdueGoalFees(groupId, group);
    if (fees.length === 0) continue;

    console.log(`[goal-compliance] ${groupId}: ${fees.length} fee(s) due`);
    for (const fee of fees) {
      if (DRY_RUN) {
        console.log(`  would apply ${fee.feeTxId}: ${fee.memberName} — ${fee.feeAmount} (${fee.kind})`);
        totalWouldApply++;
      } else {
        try {
          await applyFee(fee);
          console.log(`  applied ${fee.feeTxId}: ${fee.memberName} — ${fee.feeAmount}`);
          totalApplied++;
        } catch (e) {
          console.error(`  ✗ failed ${fee.feeTxId}:`, e);
        }
      }
    }
  }
  console.log(`[goal-compliance] done — ${DRY_RUN ? `${totalWouldApply} would apply` : `${totalApplied} applied`}`);
}

main().catch((e) => { console.error("[goal-compliance] fatal:", e); process.exit(1); });
