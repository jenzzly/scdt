# What's in this delivery

12 files — replace each at the same path in your project.

## New feature: contribution goals
- **types/index.ts** — `contributionGoalPeriodMonths`/`TargetAmount`/`AnchorDate` on `Group`.
- **utils/contributionGoals.ts** (new file) — period math: given a group's
  goal config, computes every period from the anchor date forward,
  which period "now" falls in, and a member's progress in any period.
  Verified against your exact example (6-month period → exactly 2
  periods/year).
- **app/group-settings.tsx** — new "Contribution Goal" section (toggle,
  target amount, period length, start date). Fixes a real bug found
  while building this: turning the goal off and saving wouldn't have
  actually disabled it, because the generic save path silently drops
  `undefined` fields instead of deleting them in Firestore. Added
  `clearContributionGoal()` (uses Firestore's `deleteField()`) for this
  specific case.
- **lib/firestore/groups.ts**, **lib/firestore/core.ts** — support for
  the above (`deleteField` import/re-export, the new function).

Not yet built: actually *displaying* goal progress on Dashboard/Reports.
The math and settings are ready; the display screens are the next step.

## New feature: loan rate/penalty history
- **types/index.ts** — `Loan.lateFeeRatePct`/`lateFeeGraceDays`, snapshotting
  the group's penalty settings at loan creation (same pattern
  `interestRate` already used correctly).
- **app/modals/add-loan.tsx**, **stores/slices/loanSlice.ts** — capture
  these two fields when a loan is submitted.
- **utils/lateFees.ts** — late-fee calculation now uses the *loan's own*
  snapshotted rate, falling back to the group's current rate only for
  older loans created before this field existed.
- **app/(tabs)/loans.tsx** — loan detail view now shows the penalty
  rate/grace period alongside the interest rate.

## Bug fix: registration/login permission-denied error
- **lib/firestore/members.ts** — `ensureMemberExists` no longer runs a
  Firestore query that Firestore's own rules model can never authorize
  for a brand-new user (a `list`/`where` query is evaluated against its
  entire potential result set up front, not per document — "rules are
  not filters"). Rewritten to create the user's own member + membership
  documents directly, and to determine "first member → admin" from
  `group.memberCount` (a single field any signed-in user can read)
  instead of scanning the whole members collection.
  - Per your decision, this also means the app **no longer
    auto-merges** a self-registering user with a member an admin
    pre-created by email — that always failed via query too. A
    registering user now always gets a fresh member record; an admin
    can manually reassign later if someone was pre-invited.
  - Found and fixed two more bugs while rebuilding this: `memberCount`
    wasn't being incremented on this path at all (would have caused
    every subsequent self-registering user to also become "admin"),
    and the group document itself had no code path that actually
    created it (the function that would have — `initGroupData` — was
    never called from anywhere).
- **lib/firestore/groupInit.ts** — added `ensureGroupExists()` (creates
  the group with your BRAND defaults if missing — a no-op after the
  first user ever registers) and fixed the same unsafe-query bug in
  `initGroupData` itself, even though it isn't currently called
  anywhere, so it doesn't sit there as a landmine for later.
- **app/(auth)/login.tsx** — fixed a real account-enumeration leak: the
  "forgot password" flow was telling the person outright when no
  account existed for an email, which lets someone probe which emails
  are registered. Now shows the same generic message either way.

## Verification note
I ran the project's own `tsc --noEmit` against the whole repo as a
sanity check. Every error it reported falls into one of two buckets
that predate this session and aren't things I can fix from here:
missing `node_modules` (never installed in this sandbox — `Cannot find
module 'react'`, `'firebase/firestore'`, etc.) and pre-existing
implicit-`any` warnings scattered across files I didn't touch
(`meetingSlice.ts`, `useStore.ts`, `walletSlice.ts`...). None of the 12
files above show a structural error once those two categories are set
aside. Still — run `npm install && npx tsc --noEmit` yourself after
applying these before deploying, since I couldn't do a real build here.

## Not done yet (per our staged plan)
Admin user creation with a secondary Firebase app instance, the
`audit`/`groups` roles, role-based navigation, web-only member
navigation, and the audit log expansion — everything else in the
master prompt. Next stage whenever you're ready.
