# What changed in this round

This builds on the previous `scdt-fixes.zip` delivery (Firestore rules,
report colors, dashboard/reports split, mobile tab bar, email queue).
This round fixes issues that only showed up after testing that delivery.
Replace each file below at the same path — some were already replaced
last round and are now updated further; a few are new.

## 1. Loan approval: 2 approvals + 1 disbursement (not 3 approvals)

Previously the accountant had a third "approve" step before a separate
disbursement action. Now: **loan_officer approves → committee approves
→ loan is `approved` → accountant (or admin) disburses directly.**
There is no accountant "approval" step anymore — their action on an
`approved` loan IS the disbursement.

- **`stores/slices/loanSlice.ts`** — `approveLoanStep`: committee's
  approval now sets status straight to `approved` (previously went to
  `pending_accountant` first). Removed the dead `step === "accountant"`
  branch. The "ready to disburse" notification now goes to **both**
  accountant and admin.
- **`lib/firestore/loans.ts`** — `disburseLoanServer` now also records
  `disbursedBy` on the loan (who actually disbursed it). Its core logic
  — require `status === "approved"`, produce `status: "disbursed"` —
  was already correct and needed no other changes.
- **`types/index.ts`** — added `disbursedBy?: ID` to `Loan`. Left
  `"pending_accountant"` in the `LoanStatus` union (commented as
  legacy) so any old records with that status still type-check; it's
  simply never produced going forward.

## 2. Accountant couldn't disburse; admin couldn't disburse either

**Root cause:** `app/(tabs)/loans.tsx` had `canDisburse={role ===
"accountant"}` hardcoded at both places the disburse button is
decided — admin was never included, contradicting "admin can disburse
as well."

- **`app/(tabs)/loans.tsx`** — new `canDisburseRole(role)` helper
  (`accountant || admin`), used at both call sites. Also trimmed
  `PENDING_STATUSES` / `APPROVAL_STEPS` / `getActableStep` to the 2
  real approval steps (the stepper UI on the loan detail modal already
  reads its step count dynamically from `APPROVAL_STEPS`, so it now
  renders as a 2-step progress bar with no other changes needed).
  `approved` status label changed to "Ready to Disburse" for clarity.

## 3. "Review view" showed nothing for accountant

**Root cause:** `app/(tabs)/dashboard.tsx`'s `reviewLoans` filtered
*any* `pending_*` status for *any* approver role, with no mapping from
"this role" → "the specific status this role acts on." An accountant
would only ever see something if a loan happened to be sitting at the
now-retired `pending_accountant` status — otherwise nothing, even with
loans genuinely waiting to be disbursed.

- **`app/(tabs)/dashboard.tsx`** — added an explicit `ROLE_LOAN_STATUS`
  map: `loan_officer → pending_loan_officer`, `committee →
  pending_committee`, `accountant → approved` (their "review" work is
  disbursement). The pending-actions card now shows "Ready to
  disburse" / a "Disburse" button label for the accountant's entries
  specifically, instead of generic "Awaiting ___" / "Review" text.

## 4. Wallet didn't show all transactions for financial roles

**Root cause:** `app/(tabs)/wallet.tsx` only showed the full group
ledger when `useIsAdminView()` was true (admin-only). Accountant,
committee, and loan_officer — even while toggled to their "review"
view — only ever saw their own personal transactions, not the group's.

- **`app/(tabs)/wallet.tsx`** — now shows everyone in the group's
  transactions when EITHER `useIsAdminView()` OR `useIsApproverView()`
  is true, matching the same visibility rule used elsewhere.

## 5. Group Financial Position: back on Dashboard, Total Net Assets fixed

- **`app/(tabs)/dashboard.tsx`** — the section is back here (previously
  moved to Reports in the last round; now reverted per your request).
  Visible to the same roles as the Wallet fix above (admin, or an
  approver role in review mode) — not admin-only.
  - **Total Net Assets** now sums **every wallet transaction, signed**
    — savings, interest, penalties/late fees, other credits/debits,
    everything — matching the same formula `group.availableBalance`
    already uses internally (see `stores/recalcGroupTotals.ts`, which
    was not changed — it was already correct). Previously this figure
    was `group.totalSavings + group.totalInterestEarned` only, which
    silently excluded late fees, penalties, and any other/misc entries.
  - New breakdown rows: **Contributions**, **Interest Earned**,
    **Penalties & Late Fees**, and **Other** (bank fees / misc
    credits-debits), each derived directly from the wallet ledger by
    transaction type.

No changes were needed to `app/(tabs)/reports.tsx` — it was reverted
back to its original (pre-previous-round) state, since the section
that had been moved there is now gone from it entirely.

## 6. Mobile: admin/review view toggle invisible after login

**Root cause:** the app has zero safe-area handling anywhere —
`react-native-safe-area-context` was already an installed dependency
but never actually used. Every screen hardcodes its own top padding
(`Platform.OS === "ios" ? 56 : 36`) as a guess, and the one place that
had NO such padding at all was the `offlineBanner`/`viewModeSwitch`
strip in the mobile tab layout — it rendered flush at the very top of
the screen, meaning on notch/status-bar devices it was likely rendered
partially or fully underneath the OS status bar, i.e. invisible.

- **`app/_layout.tsx`** — wrapped the whole app in `SafeAreaProvider`
  (required once, at the root, for the hook below to work anywhere).
- **`app/(tabs)/_layout.tsx`** — the `offlineBanner`/`viewModeSwitch`
  strip now gets `paddingTop: insets.top` from `useSafeAreaInsets()` —
  the real, measured notch/status-bar height for the actual device,
  not a guessed constant. This is scoped to just that strip, not the
  whole mobile layout, so it doesn't stack with (double up) each
  screen's own existing hardcoded padding underneath it.

## 7. Mobile: "double" add-contribution button / misaligned layout

I checked every place `add-contribution` is referenced
(Dashboard's quick action, the Contributions tab's own button, Wallet's
button) and found no literal duplicate button in the code — each is a
single, correctly-gated button on its own screen. Given the same
missing-safe-area-handling root cause as #6, my best-supported fix is
that `components/ui/ModalShell.tsx` (the shared wrapper every "Add
___" modal uses, including add-contribution) had the same hardcoded
`paddingTop: 56/40` guess for its header. On a native modal
presentation specifically (`presentation: "modal"` in expo-router),
that guess can undershoot the real inset, letting the header — with
its close button — render partially behind the status bar, which can
look like a second, misaligned header/button bleeding through.

- **`components/ui/ModalShell.tsx`** — the header's top padding is now
  `Math.max(insets.top + 8, existing hardcoded value)` — the real
  device inset as a floor under the previous guess, so it never
  undershoots.

**If this doesn't fully resolve what you're seeing**, I wasn't able to
reproduce the exact visual on a device — the safe-area fix is a strong,
well-evidenced first fix, but if it persists please send a screenshot
or screen recording next round and I'll narrow it down precisely
instead of continuing to infer from code alone.

## Deploy checklist (same as last round, repeated for convenience)

1. Replace the files listed above (and the ones from the previous
   round, if you haven't already).
2. `npm install` (no new dependencies this round —
   `react-native-safe-area-context` was already present, just unused).
3. Redeploy Firestore rules if you haven't since the last round:
   `firebase deploy --only firestore:rules`.
4. Rebuild/redeploy the app.
