# PROJECT_STATE.md — handoff context

Last updated: 2026-09-29.

Paste this whole file at the start of a new chat with Claude. It captures
everything needed to pick up where we left off — architecture, cleanup
history, pending work, and codebase conventions.

---

## 1. What this project is

A savings-group management app built with:

- **Expo / React Native** + **expo-router** (file-based routing)
- **TypeScript** (strict mode; `jsx: "react-jsx"` automatic runtime)
- **Firebase** — Auth + Firestore (no Cloud Functions — all business
  logic runs client-side as direct, rules-gated Firestore writes)
- **Zustand** store with the "slices" pattern (see `stores/slices/*`)
- **React Native SVG** for charts
- **xlsx / expo-print / expo-sharing** for exports
- **White-label**: per-client brand config loaded from
  `clients/<id>/brand.json` at build time (see `lib/brand.ts`)

Single-group deployment. Group ID from
`EXPO_PUBLIC_FIXED_GROUP_ID` (default `"scdt-main-group"`).

### Key domain concepts

- **Members** belong to a **Group**. Each group has contribution
  settings, loan settings, and (optionally) a periodic **contribution
  goal**.
- **Contributions** are regular savings, loan repayments, loan
  interest, investment funding/returns, late fees, penalties.
- **Loans** go through a **3-step approval**: loan_officer → committee
  → (accountant disburses).
- **Investments** go through committee → accountant approval.
- **Late fees** apply to overdue contributions AND overdue loan
  installments. Managed by `utils/lateFees.ts`.
- **Meetings** have attendance records with absence/late penalties.
- **Wallet transactions** are the ledger — the source of truth for
  balance calculations.
- **Two `memberId` conventions exist in data** — some records use the
  member-doc id, older ones use the Firebase auth uid. Always filter
  with `useMyMemberIds()` / `recordIsMine` from `stores/selectors.ts`
  to handle both.

### Critical permission/role quirks

- Firestore rules read role from `groupMemberships/{groupId}_{uid}`
  BUT the UI reads role from the member doc. `lib/firestore/
  reconcileMemberships.ts` handles the drift case.
- The wallet collection is admin/accountant only under rules. Plain
  members get a synthesized view from contributions + loans.

---

## 2. Cleanup work completed (2026-09-29)

### Unused imports

Applied via `scripts/fix_unused_imports.py` — **130 imports removed
across 46 files**. Verified via `npx tsc --noEmit`.

Notable removal: `import React from "react"` stripped from ~20 files
that don't reference `React.` as a namespace (safe because tsconfig
uses the automatic JSX runtime).

### Pre-existing tsc errors

The app had **48 pre-existing TypeScript errors** (the app ran because
Babel strips types without checking). Fixed in three passes via
targeted scripts:

| Pass | Scope | Errors cleared |
|---|---|---|
| 1 | Mechanical fixes across 10 files | 48 → 35 |
| 2 | More mechanical + regression fix | 35 → 21 |
| 3 | Final mechanical (CRLF-aware) + design fixes | 21 → 12 |
| 4 | Recovery + Card API + Toast import | 12 → 2 |
| 5 | StyleProp + Toast import | 2 → 0 |

Final state: **`npx tsc --noEmit` returns 0 errors.**

### Duplicate-consolidation (component pairs)

| Pair | Action | Status |
|---|---|---|
| `ModalShell` | Deleted `components/ModalShell.tsx` (0 importers) | ✅ |
| `showConfirm` | Already clean in `reports.tsx` | ✅ |
| `LateFeeWaiverModal` | Deleted local copy from `contributions.tsx`; use shared | ✅ |
| `Input` + `BottomModal` | Deleted standalone files; use barrel exports | ✅ |
| `KpiCard` | Deleted local copy from `dashboard.tsx`; use shared | ✅ |
| `reports.tsx` local `KpiCard` | Deleted (was dead code — zero call sites) | ✅ |

### Dead code / cleanup

- **Deleted `utils/nav.ts`** — dead file (nothing imported it).
- **Deleted `stores/slices/lateFeeExemptionSlice.ts`'s duplicate
  methods from `memberSlice.ts`** (or vice versa — see scripts).

### Reports screen fixes

- "Late Fees Owed" cell now shows **loan late fees** (applied-unpaid
  + accrued-unapplied), matching the Loans screen total.
- "Penalties & Late Fees" cell now shows **contribution + meeting
  fees only**.
- "Interest Earned" in personal view now shows the member's **1/N
  share** of group interest.
- "Profits by source" donut in personal view now shows the member's
  **1/N share** of each profit category.
- Orphaned `st.kpi*` styles remain in `dashboard.tsx` (cosmetic only).

---

## 3. Pending work

### 3.1 Business-logic consolidation (the real remaining cleanup)

These are **duplicate implementations of the same math in different
files**. Highest value because drift risk is real — a fix in one file
silently misses the other.

| Pair | Files | Notes |
|---|---|---|
| `splitRepayment` vs `computeSplit` | `lib/firestore/loans.ts` + `app/modals/record-repayment.tsx` | ~100 lines of daily-accrual interest math. **High value, medium risk.** The firestore version is the authoritative one (better overpayment handling) |
| `resolveAccrualAnchor` vs `getAccrualStartDate` | `utils/accrual.ts` + `lib/firestore/loans.ts` | Same priority chain (lastAccrualDate → disbursementDate → applicationDate). `utils/accrual.ts` should own it; firestore module should import |
| Goal-period math | `lib/firestore/contributionGoals.ts` + `utils/contributionGoals.ts` | Two parallel implementations of "tile periods forward from anchor". The `utils/` version is cleaner (pure functions) |
| Meeting-penalty math | `stores/slices/meetingSlice.ts` + `app/modals/meeting-attendance.tsx` | Duplicated `absencePenaltyFor` + `latePenaltyFor` logic |

### 3.2 Cosmetic cleanups

- Orphaned `st.kpi*` styles in `app/(tabs)/dashboard.tsx` — leftovers
  after KpiCard consolidation. Cause no TS errors.
- Dead `header`/`title`/`cancel` styles in `app/modals/add-expense.tsx`
  and `app/modals/add-meeting.tsx` — leftovers from a pre-`ModalShell`
  era.
- `Colors` (legacy token system) → `C` (current design system)
  migration for: `login.tsx`, `register.tsx`, `welcome.tsx`,
  `onboarding.tsx`, `notifications.tsx`, and the modal files that
  still import `Colors`.

### 3.3 Deprecated aliases to audit

- `useIsAdminView` in `stores/useStore.ts` — `@deprecated`, but has
  ~3 callers. Migrate them to `useIsGroupView` and remove.
- `hasAdminViewToggle` in `lib/auth/permissions.ts` — `@deprecated`,
  **0 external callers**. Safe to delete.
- `MemberPermissions.updateMeetings` — `@deprecated` in favor of
  `manageMeetings`. Check callers.
- Legacy fixed-amount penalty fields on Group (`latePenaltyAmount`,
  `absencePenaltyMember`, `absencePenaltyOfficer`) — deprecated but
  still read by fallback paths.

---

## 4. Scripts written (all under `scripts/`)

| Script | Purpose | Idempotent |
|---|---|---|
| `audit_cleanup.py` | Audit unused imports, strays, duplicate defs, deprecated aliases, dead slices | — |
| `audit_cleanup_v2.py` | Same as v1 but with improved duplicate detection | — |
| `fix_unused_imports.py` | Remove unused imports (bracket-checked) | ✅ |
| `fix_tsc_mechanical.py` | Pass 1: 10 mechanical tsc fixes | ✅ |
| `fix_tsc_mechanical_2.py` | Pass 2 | ✅ |
| `fix_tsc_mechanical_3.py` | Pass 3 (CRLF-aware) | ✅ |
| `fix_tsc_mechanical_4.py` | Pass 4 (recovery) | ✅ |
| `fix_two_imports.py` | Pass 5 (StyleProp, Toast) | ✅ |
| `consolidate_duplicates.py` | Audit duplicate pairs | — |
| `consolidate_duplicates_safe.py` | ModalShell + showConfirm | ✅ |
| `consolidate_latefeewaiver_v3.py` | Local → shared LateFeeWaiverModal | ✅ |
| `consolidate_input_bottommodal.py` | Standalone → barrel Input/BottomModal | ✅ |
| `consolidate_kpicard_dashboard.py` | Local → shared KpiCard | ✅ |
| `audit_and_fix_dead_slice.py` | Remove duplicate late-fee-exemption methods | ✅ |
| `fix_reports_kpi_and_latefees.py` | Split late-fee buckets in reports | ✅ |
| `fix_reports_loan_fees_match_loans.py` | Match Loans screen total | ✅ |
| `fix_reports_interest_earned.py` | Personal-view interest = 1/N share | ✅ |
| `fix_reports_active_member_count_recovery.py` | Recovery for missing memos | ✅ |
| `fix_reports_profit_donut_personal.py` | Personal-view donut = 1/N share | ✅ |

**All scripts write `.bak.YYYYMMDD_HHMMSS` alongside modified files and
refuse to write if bracket balance changes.**

---

## 5. Conventions in this codebase

### Non-negotiable

1. **Never return `null` from root `_layout.tsx`** — Expo Router needs
   the Navigator on the first render. The `modals/*` files use
   `ModalShell` for this reason.
2. **Filter member records using `useMyMemberIds()`** — never compare
   `record.memberId === currentMember.id` directly. Two ID conventions
   coexist in data.
3. **Late fees for a member must pause when `member.status !== "active"`**
   — see `findOverdueInstallments` guard.
4. **Deleting a wallet tx cascades to its parent** (loan, contribution,
   investment, meeting, expense) — see `lib/firestore/deletions.ts`.
5. **Approved contributions create a matching wallet tx** — the two
   must stay in sync (see `recordContribution`, `approveContribution`,
   and `bulkImportContributions` in `stores/slices/contributionSlice.ts`).
6. **`RecalcGroupTotals` (`stores/recalcGroupTotals.ts`) is the single
   source of derived totals.** Don't compute `group.availableBalance`,
   `group.totalSavings`, etc. independently anywhere.

### Style

- **Zustand slice pattern**: each domain owns a slice file exporting
  `createXSlice(set, get)`. Slices have access to the full store via
  `get()`.
- **Store methods are both sync-locally + async-firestore**. Always
  update local state optimistically first, roll back on Firestore
  failure. Every write brackets with `setSyncStatus("pending")` and
  `setSyncStatus("synced"/"failed")`.
- **Notifications are side-channel**: after a Firestore write succeeds,
  `FS.addNotification(userId, {...}, userEmail)` fires. The
  `pendingEmails` collection is picked up by a separate Node script
  for actual email delivery.
- **Styles use `C` (from `utils/theme.ts`)**, not `Colors` — `Colors`
  is legacy and kept only for unmigrated screens.
- **`T` is the text-style sheet** (label, amount, h2, body, small,
  mono, bold).
- **Web vs native branches use `Platform.OS`** and often get their
  own `<style>` — see `DatePicker.tsx` for the pattern.

### Common pitfalls to avoid

- **Bracket/brace matching in Python fix scripts** fails on
  destructuring. Prefer section banners (`// ------\n// Name`) for
  range identification when deleting a block.
- **Regex with `\n` won't match CRLF files.** Normalize on read.
- **`.replace(..., 1)` on a string that appears multiple times** — if
  a fix script has identical anchors for two distinct locations, only
  the first fires. Use global replace when the intent is "all".
- **`React.ReactNode` requires the React default import.** The unused
  import check tolerates this via `\bReact\s*[.<]` heuristic — not
  perfect but conservative.

---

## 6. Known state as of this handoff

- **`npx tsc --noEmit`** → 0 errors
- **App runs** — verified end-to-end
- **Late-fee waiver modal** — works from both contributions and loans
- **Reports screen** — all cells render, personal-view shares
  calculated correctly
- **Unused imports** — cleaned
- **Duplicate components** — consolidated

---

## 7. Pick-up suggestions

If starting a new chat, the highest-value next moves are:

1. **Consolidate `splitRepayment` into `utils/accrual.ts`** — the
   firestore module and the modal both have copies of the same daily-
   accrual math. Move it to `utils/accrual.ts`, have both import it.
   Test with `record-repayment.tsx` preview + actual repayment.
2. **Consolidate `resolveAccrualAnchor`** — same idea, fewer lines.
3. **Cosmetic pass** — orphaned styles + `Colors` → `C` migration.

Ask for the specific file content of `lib/firestore/loans.ts`,
`utils/accrual.ts`, and `app/modals/record-repayment.tsx` to start #1.
