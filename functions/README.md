# Cloud Functions — loan ledger authority

`disburseLoan` and `recordRepayment` are the only two operations that move
money on a loan. They used to be computed entirely on the client
(`stores/slices/loanSlice.ts`) and written straight to Firestore — meaning
a modified client, or a client-side bug, could write an incorrect balance,
skip the approval-status check, or have someone without the right role
disburse/repay a loan. These functions close that gap:

- **Role check**: looks up the caller's membership doc for the specific
  group and rejects unless their role is allowed to disburse
  (`accountant`) or record a repayment
  (`admin`/`accountant`).
- **Status check**: `disburseLoan` requires `status === "approved"`;
  `recordRepayment` requires `status === "disbursed"`. A client can no
  longer disburse a loan that's still pending approval.
- **Single source of truth for the math**: `loanMath.ts`'s
  `splitRepayment()` is the only place principal/interest allocation and
  the resulting balance get computed. The client-side equivalents in
  `utils/theme.ts` are explicitly preview-only now (see the comment
  there) — they're for showing an applicant an estimate, not for writing
  anything.
- **Atomic**: every write (loan update, wallet transaction, audit log) for
  one call happens in a single Firestore transaction, so you can't end up
  with a wallet transaction that exists without a matching balance update,
  or vice versa.

## Local development

```bash
cd functions
npm install
npm run build:watch     # in one terminal
firebase emulators:start --only functions,firestore   # in another
```

## Deploying — once per client

Each client has their own Firebase project, so these functions need to be
deployed to each one separately:

```bash
cd functions
firebase use --add                  # first time: register the client's project
firebase use <client-id>            # subsequent times: switch to it
firebase deploy --only functions
```

There's nothing client-specific inside `functions/src/` — the same code
deploys everywhere. Per-client behavior (currency formatting, role names)
comes from each group's own Firestore data, not from config baked into the
function.

## Extending this pattern

If you later want the same server-side-authority treatment for other
ledger-affecting flows (e.g. investment payouts, bulk contribution
imports), follow the same shape: a `requireRole` check, a single
`runTransaction`, and a pure function in its own `*Math.ts` file for the
actual calculation so it stays unit-testable and independent of Firestore.
