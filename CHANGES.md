# Complete changelog — full session

Every file below is a full replacement — copy it to the same path in
your project, overwriting what's there. Two are brand new
(`scripts/send-pending-emails.js`, `scripts/.env.send-emails.example`,
and the whole `worker-email/` folder).

## Loan approval flow

- **`stores/slices/loanSlice.ts`** — 2 approvals (loan_officer,
  committee) + accountant/admin disburse directly on `approved` status,
  no separate accountant "approval" gate. Notifications fire at every
  step, all with email queuing.
- **`app/(tabs)/loans.tsx`** — `canDisburseRole()` now includes admin
  (was accountant-only). Approval stepper trimmed to 2 real steps.
  Fixed a real bug: the status badge's text color was set to the
  status *label* (a string like "Ready to Disburse") instead of the
  intended *color* value.
- **`lib/firestore/loans.ts`** — disbursement now records `disbursedBy`.
- **`types/index.ts`** — added `Loan.disbursedBy`.

## Loan status + comments visible to the borrower

- **`app/(tabs)/loans.tsx`** — the comment-collection UI and storage
  already existed (`approveLoanStep` already accepted and saved a
  `comment`) — the gap was purely on the display side. Added a full
  approval-progress stepper with each step's reviewer comment to
  `LoanDetailModal`, which every viewer reaches (including the loan
  owner), not just the approver-only modal.

## Member deletion (root cause + fix)

- **`firestore-rules/firestore.rules`** — `groupMemberships` no longer
  relies on a `list`/query rule. Firestore evaluates `list` rules
  against a query's entire potential result set, not per document
  (confirmed against Firestore's own docs on "rules are not filters"),
  so a rule scoped to "only this admin's group" was never actually
  possible for a `where("memberId", "==", ...)` query — it was being
  silently rejected outright, for everyone, including genuine admins.
- **`lib/firestore/members.ts`** — `deleteMember` no longer falls back
  to that query. It always resolves the exact `groupMemberships`
  document ID directly (`{groupId}_{userId}`), which is a plain
  single-document delete the rules already handle correctly. If a
  member has no linked `userId` at all, that specific cleanup step is
  skipped cleanly rather than attempting a doomed query — the member
  record itself (what drives the UI) is still deleted either way.

## Earnings page — redesigned, calculation fixed

- **`app/(tabs)/reports.tsx`** (`EarningsTab`) —
  - Real calculation bug fixed: `loan_disbursement` (money going OUT —
    a large negative number) and `loan_principal_recovery` (capital
    simply returning, not profit) were being counted as "earnings,"
    which could make the total wildly wrong. Real earnings now only
    includes interest, penalties/late fees, investment returns, bank
    fees, and other credits/debits — confirmed with you explicitly.
    Legacy combined `loan_repayment` records are handled correctly via
    proportional interest extraction (same math already used
    elsewhere in the app for old data).
  - Fixed a display bug: every transaction row was hardcoded with a
    `+` prefix even on debits, producing strings like
    `+-RWF 5,000.00`. Removed — `fmtCurrency` already handles the sign.
  - Removed the "Earnings by Member" list that repeated the exact same
    number for every member (since the split is always equal) —
    replaced with one clear headline number plus a breakdown by type.
  - Added responsive (`isWide`) layout for mobile vs. web.
  - Also moved "Group Financial Position" back onto the Dashboard (per
    an earlier request in this session) and correctly recomputed
    "Total Net Assets" as the full signed sum of the wallet ledger.

## Notification + email coverage — was very incomplete, now covers all major events

Every new notification call below also queues an email automatically
(via `lib/firestore/notifications.ts`'s existing `addNotification`,
which every call site already passes a `recipientEmail` to) — no
separate email wiring was needed per event; the `pendingEmails` queue
and the Cloudflare Worker that sends from it are generic.

- **`stores/slices/contributionSlice.ts`** — previously zero
  notifications anywhere. Added: submit (needs approval) → notifies
  admin/accountant/loan_officer; approve/reject/delete → notifies the
  submitting member.
- **`stores/slices/expenseSlice.ts`** — previously zero. Added: create
  and delete → notifies other admins/accountants (not the creator).
- **`stores/slices/investmentSlice.ts`** — previously only
  `closeInvestment` notified (admin only). Added: create → notifies
  committee; each approval step → notifies the next approver or the
  creator; delete → notifies the creator. Also fixed a real bug:
  `createInvestment` never actually set `createdBy`, so any
  creator-facing notification would have silently found nobody to
  notify.
- **`stores/slices/meetingSlice.ts`** — previously only
  `scheduleMeeting` notified. Added: cancel, delete, and reschedule
  (date/location change) → notify all active members. Also fixed a
  real, separate bug: a member marked **late** to a meeting had a
  penalty amount computed and shown in the UI, but the wallet
  transaction that actually charges it only fired for **absent**
  members — late penalties were displayed as owed but never actually
  collected. Both cases now correctly create the wallet transaction,
  and the affected member is notified either way.
- **`stores/slices/walletSlice.ts`** — added late-payment alerts for
  both `applyLoanLateFee` (loan installment overdue — distinct from
  meeting penalties, as requested) and `applyContributionLateFee`
  (contribution period overdue), notifying the affected member with
  the amount and how many days late.

## Dashboard / Reports split (from earlier in this session, included for completeness)

- **`app/(tabs)/dashboard.tsx`** — always the logged-in member's own
  data; Group Financial Position lives here now (moved back from
  Reports per your instruction), gated to admin/approver "review" view,
  computed from the full wallet ledger (not the narrower old formula).
- **`app/(tabs)/reports.tsx`** — Overview tab remains the group-wide
  view; Group Financial Position section removed from here since it
  moved back to Dashboard.

## Mobile layout fixes (from earlier in this session)

- **`app/_layout.tsx`** — wrapped the app in `SafeAreaProvider` (was
  completely unused despite being an installed dependency).
- **`app/(tabs)/_layout.tsx`** — the admin/review view toggle and
  offline banner now get the real, measured safe-area inset instead of
  rendering with no top padding at all (which likely put them under
  the status bar/notch, i.e. invisible, on some devices). Also fixed
  the bottom tab bar: removed a hardcoded `16.666%` width fighting with
  `flex: 1`, and switched the hidden Wallet tab from
  `tabBarButton: () => null` (which still reserves an empty layout
  slot on current React Navigation — a known issue) to `href: null`
  (which correctly excludes it).
- **`components/ui/ModalShell.tsx`** — the shared "Add ___" modal
  header's top padding now uses the real safe-area inset as a floor
  under the previous hardcoded guess, so it can't undershoot on devices
  where the guess was wrong.

## Email sending — two options, both wired to the same queue

- **`lib/firestore/notifications.ts`**, **`lib/firestore/core.ts`** —
  every `addNotification()` call optionally queues a `pendingEmails`
  doc when a recipient email is passed.
- **`scripts/send-pending-emails.js`** *(new)* — a Node script using
  your exact Resend/nodemailer SMTP snippet; run manually or via any
  scheduler you control.
- **`scripts/.env.send-emails.example`** *(new)* — template for the
  script's config.
- **`worker-email/`** *(new, whole standalone project)* — a Cloudflare
  Worker with its own Cron Trigger that does the same job automatically
  on a schedule, for free, using Firestore's REST API + Web Crypto
  (JWT signing) instead of `firebase-admin`, and Resend's HTTP API
  instead of nodemailer — neither of the Node-only libraries run in
  the Workers runtime. This is what you deployed at
  `scdt-send-pending-emails.jenzzly.workers.dev` — see
  `worker-email/README.md` for setup/redeploy instructions. It reads
  from the same `pendingEmails` collection, so every notification added
  in this changelog is covered automatically — no per-event wiring to
  the Worker was needed.
- **`firestore-rules/firestore.rules`** — `pendingEmails` collection:
  clients can only `create`, never read/update/delete (only the
  Worker/script, via a service account that bypasses rules, can process
  the queue).

## Security / cleanup

- **`.env`**, **`clients/scdt/.env`** — removed an exposed
  `EXPO_PUBLIC_RESEND` key (any `EXPO_PUBLIC_*` var ships inside the
  client bundle, publicly readable). If you haven't already, revoke
  that key in your Resend dashboard.
- **`lib/firebase.ts`**, **`lib/firestore/core.ts`**,
  **`lib/firestore/index.ts`**, **`utils/theme.ts`**,
  **`firebase.json`**, **`CLIENT_ONBOARDING.md`** — removed dead
  Cloud-Functions-era code/references (confirmed nothing in the app
  actually calls `httpsCallable` anywhere) so nobody chases a
  deploy step that doesn't apply to this project.
- **`package.json`** — added `nodemailer`, `firebase-admin`, `dotenv`
  as devDependencies (Node-only, used exclusively by
  `scripts/send-pending-emails.js` — never shipped in the app bundle),
  plus a `send-pending-emails` npm script.
- **`.gitignore`** — added `scripts/.env.send-emails`.

## Deploy checklist

1. Replace every file listed above at the same path.
2. `npm install` in the main project (picks up the three new
   devDependencies).
3. Deploy the updated Firestore rules:
   `firebase deploy --only firestore:rules` — the member-delete fix
   and every earlier rules change do nothing until this runs.
4. If you haven't already, revoke the exposed Resend key and generate
   a fresh one.
5. If you're using the Worker (already deployed per your message) — no
   action needed, it already covers all the new notification types
   automatically. If you're using the Node script instead, make sure
   `scripts/.env.send-emails` and `scripts/serviceAccountKey.json` are
   set up (see the script's own header comment).
6. Rebuild/redeploy the app (`npm run deploy` for web; EAS build for
   mobile) as usual.
