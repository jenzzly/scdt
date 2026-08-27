#!/usr/bin/env node
// scripts/send-pending-emails.js
//
// Sends the notification emails the app queues in Firestore's
// `pendingEmails` collection (see lib/firestore/notifications.ts —
// every in-app notification also writes one of these docs).
//
// This is a standalone script, not a server: it runs once, sends
// whatever is currently pending, and exits. There is no Cloud
// Functions / paid-hosting dependency here — you (or a free scheduled
// job, e.g. a GitHub Actions cron) run this periodically. A run every
// few minutes is plenty for a savings-group app; nothing here needs
// to be instant.
//
// ── One-time setup ──────────────────────────────────────────────────
// 1. Firebase Console → Project Settings → Service Accounts →
//    "Generate new private key". Save the downloaded JSON as
//    scripts/serviceAccountKey.json (already gitignored — never commit
//    this file). This is what lets the script read Firestore directly,
//    bypassing the security rules (which deliberately block normal
//    users from reading pendingEmails — see firestore-rules).
// 2. Get a Resend API key (resend.com → API Keys) and an SMTP-verified
//    "from" address/domain.
// 3. Fill in scripts/.env.send-emails (copy the .example file next to
//    this script) with RESEND_API_KEY and RESEND_FROM_EMAIL.
// 4. npm install nodemailer firebase-admin dotenv --save-dev
//    (dev dependency — this script never ships in the app bundle)
//
// ── Running it ───────────────────────────────────────────────────────
//   node scripts/send-pending-emails.js
//
// ── Free scheduling (optional) ─────────────────────────────────────
// A GitHub Actions workflow on a `schedule:` cron (e.g. every 10
// minutes) can run this at no cost on a public repo, or within the
// free minutes allowance on a private one. Keep serviceAccountKey.json
// and the Resend key as repository secrets, never committed.
//
// ── Behavior ─────────────────────────────────────────────────────────
// - Only processes docs with status "pending" (skips anything already
//   sent or previously failed-and-marked, so re-running is safe).
// - Marks each doc "sent" (with sentAt) on success, or "failed" (with
//   the error message and a lastAttemptAt) so failures are visible in
//   Firestore instead of silently vanishing — this script does not
//   retry automatically; re-run it and failed docs are simply skipped
//   unless you flip them back to "pending" yourself.
// - Processes sequentially with a small delay between sends to stay
//   comfortably under Resend's rate limits on the free tier.

require("dotenv").config({ path: require("path").join(__dirname, ".env.send-emails") });
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || require("path").join(__dirname, "serviceAccountKey.json");
const BATCH_LIMIT = Number(process.env.EMAIL_BATCH_LIMIT || 50);
const DELAY_MS_BETWEEN_SENDS = Number(process.env.EMAIL_SEND_DELAY_MS || 250);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!RESEND_API_KEY) {
    console.error(
      "[send-pending-emails] Missing RESEND_API_KEY. Copy scripts/.env.send-emails.example " +
      "to scripts/.env.send-emails and fill it in."
    );
    process.exit(1);
  }

  let serviceAccount;
  try {
    serviceAccount = require(SERVICE_ACCOUNT_PATH);
  } catch (e) {
    console.error(
      `[send-pending-emails] Could not load service account key at ${SERVICE_ACCOUNT_PATH}. ` +
      "Download one from Firebase Console → Project Settings → Service Accounts, " +
      "save it as scripts/serviceAccountKey.json (gitignored), and try again."
    );
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  const db = admin.firestore();

  const transporter = nodemailer.createTransport({
    host: "smtp.resend.com",
    secure: true,
    port: 465,
    auth: { user: "resend", pass: RESEND_API_KEY },
  });

  const snap = await db
    .collection("pendingEmails")
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(BATCH_LIMIT)
    .get();

  if (snap.empty) {
    console.log("[send-pending-emails] Nothing pending.");
    return;
  }

  console.log(`[send-pending-emails] ${snap.size} pending email(s) to send.`);

  let sent = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const { to, subject, message } = data;

    if (!to) {
      // No email on file for this recipient — nothing to send, but
      // don't leave it stuck "pending" forever either.
      await doc.ref.update({
        status: "skipped",
        skippedReason: "No recipient email on file",
        lastAttemptAt: new Date().toISOString(),
      });
      continue;
    }

    try {
      await transporter.sendMail({
        from: RESEND_FROM_EMAIL,
        to,
        subject: subject || "New notification",
        html: `<h2>${escapeHtml(subject || "New notification")}</h2><p>${escapeHtml(message || "You have a new notification.")}</p>`,
      });
      await doc.ref.update({ status: "sent", sentAt: new Date().toISOString() });
      sent++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[send-pending-emails] Failed to send to ${to}:`, msg);
      await doc.ref.update({
        status: "failed",
        error: msg,
        lastAttemptAt: new Date().toISOString(),
      });
      failed++;
    }

    // Small delay between sends — keeps this comfortably under Resend's
    // per-second rate limit on the free tier without needing a queue
    // library for what is, in practice, a handful of emails per run.
    await sleep(DELAY_MS_BETWEEN_SENDS);
  }

  console.log(`[send-pending-emails] Done. Sent: ${sent}, Failed: ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[send-pending-emails] Fatal error:", error);
  process.exit(1);
});
