// utils/linkedWalletSync.ts
//
// Keeps a wallet transaction's editable fields (description, amount, date)
// in sync with whatever parent record it's linked to (a Contribution, an
// Investment's disbursement, or a Loan's disbursement) — in BOTH
// directions:
//
//   parent → wallet  (findXWalletTx + buildLinkedTxPatch, unchanged)
//   wallet → parent  (buildParentPatchFromWalletEdit, new)
//
// WHY THIS EXISTS:
//
//   wallet.tsx / edit-transaction.tsx already let you edit a wallet tx
//   directly, and every screen that shows financial data (contributions.tsx,
//   loans.tsx, investments.tsx, wallet.tsx) reads from the SAME Zustand
//   slice (`walletTransactions`). So editing a wallet tx already propagates
//   everywhere for free — there was never a second copy of the data.
//
//   What was missing is the OTHER direction: editing a Contribution, Loan,
//   or Investment's amount/date did not touch its linked wallet
//   transaction, so the wallet screen would silently show stale numbers.
//   That's `findXWalletTx` + `buildLinkedTxPatch`, called from each domain
//   slice's `updateXAndSync` action.
//
//   Editing a wallet transaction DIRECTLY (via edit-transaction.tsx) also
//   needs its linked parent record kept in sync the same way, in reverse —
//   that's `buildParentPatchFromWalletEdit`, called from
//   walletSlice.ts's `updateWalletTransaction`. A previous version of
//   walletSlice.ts implemented this inline, separately, for each of
//   loan/contribution/investment/meeting, rather than sharing this file's
//   logic — which both duplicated the "which field maps to which" rules
//   AND let the loan branch drift out of sync with how loans.ts's own
//   `projectAccruedInterest` actually works. Consolidating here means
//   there is exactly one place that knows "a wallet tx's `amount` maps to
//   a contribution's `amount` but an investment's `investmentAmount`."
//
// SCOPE (per explicit decision — see conversation):
//   - Only description / amount / date are synced this way.
//   - Loan due-date rescheduling is handled separately (see
//     rescheduleLoanInstallment in loanSlice.ts) because schedule items
//     don't have wallet transactions until a repayment actually happens —
//     there's nothing to sync until then.
//   - This does NOT change tx.type, sourceType, or any cascade/relation
//     field. Those stay under the wallet slice's own editing rules
//     (see MANUAL_TYPES in edit-transaction.tsx — only standalone/manual
//     transactions may have their type reassigned).
//
// CONFIRMED against your actual codebase (lib/firestore/loans.ts,
// lib/firestore/wallet.ts):
//   1. A Contribution's linked wallet tx is found via `contributionId` +
//      `type === "contribution"`.
//   2. An Investment's linked wallet tx is found via `investmentId` +
//      `type === "investment_disbursement"`.
//   3. A Loan's DISBURSEMENT wallet tx is found via `loanId` +
//      `type === "loan_disbursement"`. Repayment txs (interest/principal)
//      are intentionally NOT covered here — recordRepaymentServer
//      generates those from the repayment amount itself, so "editing the
//      loan" has no single obvious repayment tx to target. Correcting a
//      specific repayment is still an edit-transaction.tsx job (edit that
//      wallet tx directly), and doesn't reach back into the loan.

import type { WalletTransaction, Loan, Contribution, Investment } from "../types";
import { projectAccruedInterest } from "../lib/firestore/loans";

export interface LinkedSyncPatch {
  description?: string;
  amount?: number;
  date?: string;
}

// -----------------------------------------------------------------------
// Direction 1: parent record edited → patch its linked wallet tx
// -----------------------------------------------------------------------

/**
 * Finds the wallet transaction linked to a contribution.
 */
export function findContributionWalletTx(
  walletTransactions: WalletTransaction[],
  contributionId: string,
): WalletTransaction | undefined {
  return walletTransactions.find(
    (t) =>
      t.contributionId === contributionId &&
      t.type === "contribution",
  );
}

/**
 * Finds the wallet transaction linked to an investment's disbursement.
 */
export function findInvestmentWalletTx(
  walletTransactions: WalletTransaction[],
  investmentId: string,
): WalletTransaction | undefined {
  return walletTransactions.find(
    (t) =>
      t.investmentId === investmentId &&
      t.type === "investment_disbursement",
  );
}

/**
 * Finds the wallet transaction linked to a loan's disbursement.
 * (Repayment txs are not covered — see the module header above.)
 */
export function findLoanDisbursementWalletTx(
  walletTransactions: WalletTransaction[],
  loanId: string,
): WalletTransaction | undefined {
  return walletTransactions.find(
    (t) =>
      t.loanId === loanId &&
      t.type === "loan_disbursement",
  );
}

/**
 * Builds the patch to apply to a linked wallet tx, given the fields that
 * changed on its parent record. Preserves the tx's existing sign
 * (credit/debit) — only the magnitude changes, exactly like
 * edit-transaction.tsx does for direct wallet edits.
 */
export function buildLinkedTxPatch(
  existingTx: WalletTransaction,
  changed: LinkedSyncPatch,
): Partial<WalletTransaction> {
  const patch: Partial<WalletTransaction> = {};

  if (changed.description !== undefined) {
    patch.description = changed.description;
  }

  if (changed.date !== undefined) {
    patch.date = changed.date;
  }

  if (changed.amount !== undefined) {
    const wasCredit = (existingTx.amount ?? 0) >= 0;
    patch.amount = wasCredit
      ? Math.abs(changed.amount)
      : -Math.abs(changed.amount);
  }

  return patch;
}

// -----------------------------------------------------------------------
// Direction 2: wallet tx edited directly → patch its linked parent record
// -----------------------------------------------------------------------

export type LinkedParentKind = "loan" | "contribution" | "investment" | null;

/**
 * Identifies which kind of parent record (if any) a wallet transaction is
 * linked to, and its id. Centralizes the same detection logic
 * walletSlice.ts needs before it can decide what else to patch.
 */
export function identifyLinkedParent(
  tx: WalletTransaction,
): { kind: LinkedParentKind; id: string | undefined } {
  if (tx.type === "loan_disbursement" && tx.loanId) {
    return { kind: "loan", id: tx.loanId };
  }
  if (tx.contributionId || (tx.sourceType === "contribution" && tx.sourceId)) {
    return { kind: "contribution", id: tx.contributionId || tx.sourceId };
  }
  if (tx.investmentId || (tx.sourceType === "investment" && tx.sourceId)) {
    return { kind: "investment", id: tx.investmentId || tx.sourceId };
  }
  return { kind: null, id: undefined };
}

/**
 * Given a wallet-tx edit (description/amount/date changed directly, e.g.
 * via edit-transaction.tsx), returns the patch to apply to a linked
 * Contribution. `contribution.amount` and `.date` map 1:1 to the wallet
 * tx's fields — sign is not a concern here since Contribution.amount is
 * unsigned.
 */
export function buildContributionPatchFromWalletEdit(
  changed: LinkedSyncPatch,
): Partial<Contribution> {
  const patch: Partial<Contribution> = {};
  if (changed.date !== undefined) patch.date = changed.date;
  if (changed.amount !== undefined) patch.amount = Math.abs(changed.amount);
  return patch;
}

/**
 * Same, for an Investment — note the field name difference
 * (`investmentAmount` / `startDate`, not `amount` / `date`).
 */
export function buildInvestmentPatchFromWalletEdit(
  changed: LinkedSyncPatch,
): Partial<Investment> {
  const patch: Partial<Investment> = {};
  if (changed.date !== undefined) patch.startDate = changed.date;
  if (changed.amount !== undefined) patch.investmentAmount = Math.abs(changed.amount);
  return patch;
}

/**
 * Same, for a Loan's disbursement — the most involved case, because a
 * reducing_balance loan's accrued interest depends on the accrual anchor
 * date (`lastAccrualDate`), and moving the disbursement date means that
 * anchor needs to move with it.
 *
 * CONFIRMED against lib/firestore/loans.ts:
 *   - `getAccrualStartDate` resolves the anchor as
 *     `lastAccrualDate ?? applicationDate ?? disbursementDate ?? fallback`.
 *   - `projectAccruedInterest(loan, asOfDate)` is a PURE function (no
 *     Firestore writes) that returns `{ days, accrued, total }` — `total`
 *     is `existingAccrued + newly-computed-interest-for-the-gap`.
 *
 * Only reducing_balance loans accrue this way — flat-rate loans have
 * nothing to project (projectAccruedInterest itself returns
 * `{ days: 0, accrued: 0, total: existingAccrued }` for any other
 * method), so this only touches accruedInterest/lastAccrualDate when
 * `loan.interestMethod === "reducing_balance"`.
 *
 * Re-anchoring logic: when the disbursement date moves, the OLD anchor
 * (`loan.lastAccrualDate` if already set, else the loan's current
 * `applicationDate`) is used to project accrued interest THROUGH the new
 * date — capturing whatever interest had genuinely accrued up to now —
 * and then `lastAccrualDate` itself is moved to the new date, so future
 * projections start counting from there. This means correcting a
 * disbursement date to be earlier or later shifts how much interest has
 * accrued (since balance × dailyRate × days depends on how many days
 * have elapsed), which is the financially correct behavior — it is NOT
 * simply zeroed out.
 */
export function buildLoanPatchFromWalletEdit(
  loan: Loan,
  changed: LinkedSyncPatch,
): Partial<Loan> {
  const patch: Partial<Loan> = {};

  if (changed.date !== undefined && changed.date !== loan.applicationDate) {
    patch.applicationDate = changed.date;

    if (loan.interestMethod === "reducing_balance") {
      const anchorDate =
        (loan as any).lastAccrualDate || loan.applicationDate || changed.date;

      const projection = projectAccruedInterest(
        {
          balance: loan.balance,
          interestRate: loan.interestRate,
          interestMethod: loan.interestMethod,
          interestRatePeriod: (loan as any).interestRatePeriod,
          accruedInterest: (loan as any).accruedInterest || 0,
          lastAccrualDate: anchorDate,
        },
        `${changed.date}T00:00:00.000Z`,
      );

      patch.accruedInterest = projection.total;
      patch.lastAccrualDate = changed.date;
    }
  }

  if (changed.amount !== undefined) {
    patch.amount = Math.abs(changed.amount);
  }

  return patch;
}