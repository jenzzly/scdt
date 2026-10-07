#!/usr/bin/env node
/**
 * scripts/job-contribution-reminders.js
 *
 * For every group with contributionReminderDaysBefore > 0 and a
 * monthly contribution cadence, sends a reminder to every active
 * member N days before the next contribution due date.
 *
 * Idempotent: uses a deterministic pendingEmails doc ID per
 * (group, member, due date), so re-running the same day is a no-op.
 *
 * Usage:
 *   node scripts/job-contribution-reminders.js              # dry run
 *   node scripts/job-contribution-reminders.js --apply      # write
 *
 * Cron (daily at 08:00 UTC):
 *   0 8 * * * cd /path/to/project && node scripts/job-contribution-reminders.js --apply >> /var/log/reminders.log 2>&1
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

function nextDueDate(contributionDay) {
  const now = new Date();
  const rawDay = Number(contributionDay) || 31;
  const day = Math.max(1, Math.min(31, rawDay === 1 ? 31 : rawDay));
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDayThisMonth = new Date(y, m + 1, 0).getDate();
  const dueThisMonth = new Date(y, m, Math.min(day, lastDayThisMonth));
  const todayMid = new Date(y, m, now.getDate());
  if (dueThisMonth.getTime() >= todayMid.getTime()) return dueThisMonth;
  const nextMonth = new Date(y, m + 1, 1);
  const lastDayNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(day, lastDayNextMonth));
}

function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

async function main() {
  console.log(`[reminders] start ${new Date().toISOString()}${DRY_RUN ? " (dry run)" : ""}`);
  const groupsSnap = await db.collection("groups").get();
  let totalSent = 0;
  let totalSkipped = 0;
  let totalGroups = 0;

  for (const groupDoc of groupsSnap.docs) {
    const group = groupDoc.data();
    const groupId = groupDoc.id;

    const reminderDays = Number(group.contributionReminderDaysBefore ?? 0);
    if (!Number.isFinite(reminderDays) || reminderDays <= 0) continue;
    if ((group.contributionFrequency ?? "monthly") !== "monthly") {
      console.log(`[reminders] ${groupId}: skipping non-monthly cadence`);
      continue;
    }

    const due = nextDueDate(group.contributionDay);
    const daysUntil = daysBetween(new Date(), due);
    if (daysUntil !== reminderDays) {
      console.log(`[reminders] ${groupId}: due ${ymd(due)} in ${daysUntil}d, need ${reminderDays}d — skip`);
      continue;
    }

    totalGroups++;
    const dueYmd = ymd(due);
    const membersSnap = await db
      .collection("groups").doc(groupId)
      .collection("members").where("status", "==", "active").get();

    for (const memberDoc of membersSnap.docs) {
      const member = memberDoc.data();
      if (!member.email || !member.userId) continue;

      const reminderId = `contrib-reminder-${groupId}-${memberDoc.id}-${dueYmd}`;
      const emailRef = db.collection("pendingEmails").doc(reminderId);
      const existing = await emailRef.get();
      if (existing.exists) { totalSkipped++; continue; }

      const amount = group.contributionAmount ?? 0;
      const currency = group.currency ?? "RWF";
      const amountLabel = `${amount.toLocaleString()} ${currency}`;
      const subject = `Contribution reminder — due ${due.toLocaleDateString()}`;
      const message =
        `Hi ${member.fullName},\n\n` +
        `Your monthly contribution of ${amountLabel} is due on ` +
        `${due.toLocaleDateString()}. Please make sure it's recorded ` +
        `before the deadline to avoid a late fee.\n\n` +
        `— ${group.name ?? "Your savings group"}`;

      if (DRY_RUN) {
        console.log(`[reminders] would send to ${member.email} (${group.name})`);
        totalSent++;
        continue;
      }

      await emailRef.set({
        id: reminderId,
        to: member.email,
        subject,
        message,
        notificationId: null,
        userId: member.userId,
        groupId,
        status: "pending",
        kind: "contribution_reminder",
        createdAt: new Date().toISOString(),
        meta: { dueYmd, amount },
      });

      await db.collection("users").doc(member.userId).collection("notifications").add({
        userId: member.userId,
        groupId,
        type: "contribution_due",
        title: "Contribution Due Soon",
        message: `Your monthly contribution of ${amountLabel} is due on ${due.toLocaleDateString()}.`,
        read: false,
        metadata: { dueYmd, amount },
        createdAt: new Date().toISOString(),
      });
      totalSent++;
    }
  }

  console.log(`[reminders] groups hit today: ${totalGroups}`);
  console.log(`[reminders] done — ${totalSent} ${DRY_RUN ? "would send" : "sent"}, ${totalSkipped} skipped (already queued)`);
}

main().catch((e) => { console.error("[reminders] fatal:", e); process.exit(1); });
