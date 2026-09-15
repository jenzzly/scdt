// utils/linkedWalletSync.ts
//
// Keeps a wallet transaction's editable fields (description, amount, date)
// in sync with whatever parent record it's linked to (a Contribution, an
// Investment's disbursement, or a Loan's disbursement) — in BOTH
// directions:
//
//   parent → wallet  (findXWalletTx + buildLinkedTxPatch)
//   wallet → parent  (buildParentPatchFromWalletEdit* family)
//
// LOAN-SPECIFIC NOTE (fixed): for a disbursed loan, the wallet tx's
// `date` IS the disbursement date. Editing that date must move
// `loan.disbursementDate` and re-anchor `lastAccrualDate` — never
// `loan.applicationDate`, which was captured at submission time and has
// nothing to do with when the money moved. A previous version of this
// file wrote to applicationDate, which is why editing a disbursement
// tx's date silently re-anchored interest to the wrong day.

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

export function findContributionWalletTx(
  walletTransactions: WalletTransaction[],
  contributionId: string,
): WalletTransaction | undefined {
  return walletTransactions.find(
    (t) => t.contributionId === contributionId && t.type === "contribution",
  );
}

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

export function findLoanDisbursementWalletTx(
  walletTransactions: WalletTransaction[],
  loanId: string,
): WalletTransaction | undefined {
  return walletTransactions.find(
    (t) => t.loanId === loanId && t.type === "loan_disbursement",
  );
}

export function buildLinkedTxPatch(
  existingTx: WalletTransaction,
  changed: LinkedSyncPatch,
): Partial<WalletTransaction> {
  const patch: Partial<WalletTransaction> = {};

  if (changed.description !== undefined) patch.description = changed.description;
  if (changed.date !== undefined) patch.date = changed.date;

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

export function buildContributionPatchFromWalletEdit(
  changed: LinkedSyncPatch,
): Partial<Contribution> {
  const patch: Partial<Contribution> = {};
  if (changed.date !== undefined) patch.date = changed.date;
  if (changed.amount !== undefined) patch.amount = Math.abs(changed.amount);
  return patch;
}

export function buildInvestmentPatchFromWalletEdit(
  changed: LinkedSyncPatch,
): Partial<Investment> {
  const patch: Partial<Investment> = {};
  if (changed.date !== undefined) patch.startDate = changed.date;
  if (changed.amount !== undefined) patch.investmentAmount = Math.abs(changed.amount);
  return patch;
}

/**
 * Wallet-to-loan sync.
 *
 * Writes to `loan.disbursementDate` (not applicationDate) and re-anchors
 * `lastAccrualDate` to the new disbursement date. When a wallet tx's
 * date is corrected (e.g. the money actually left on the 5th, not the
 * 15th), the loan's own disbursement date must move with it so:
 *
 *   - `splitRepayment` (on the next repayment) accrues from the right day
 *   - `findOverdueInstallments` evaluates against the right period
 *   - the loan detail modal shows the same date the wallet shows
 *
 * Re-anchoring: compute what interest genuinely accrued from the OLD
 * anchor through the new date, store that in `accruedInterest`, then
 * move `lastAccrualDate` to the new date. Not a "reset" — a "recompute
 * what happened between the old day and the new day."
 *
 * Only reducing_balance loans accrue this way; `projectAccruedInterest`
 * returns `{ days: 0, accrued: 0 }` for any other method.
 */
export function buildLoanPatchFromWalletEdit(
  loan: Loan,
  changed: LinkedSyncPatch,
): Partial<Loan> {
  const patch: Partial<Loan> = {};

  if (changed.amount !== undefined) {
    patch.amount = Math.abs(changed.amount);
  }

  if (changed.date !== undefined) {
    const oldDisbursementDateRaw = (loan as any).disbursementDate as
      | string
      | undefined;

    const oldDisbursementDateOnly = oldDisbursementDateRaw
      ? String(oldDisbursementDateRaw).slice(0, 10)
      : undefined;

    if (changed.date !== oldDisbursementDateOnly) {
      // The wallet tx's date IS the loan's disbursement date.
      patch.disbursementDate = changed.date;

      if (loan.interestMethod === "reducing_balance") {
        // Anchor priority: lastAccrualDate → previous disbursementDate
        // → applicationDate → new date. Never simply skip the re-anchor.
        const anchorDate =
          (loan as any).lastAccrualDate ||
          oldDisbursementDateOnly ||
          loan.applicationDate ||
          changed.date;

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
  }

  return patch;
}