// hooks/useLoanLateFees.ts
//
// Late fees owed on a SPECIFIC loan, combining:
//
//   1. Applied — `late_fee` wallet txs already on the ledger for this
//      loan that haven't been marked as paid (feePaid = false). These
//      are fees an officer has already "charged" via
//      walletSlice.applyLoanLateFee.
//
//   2. Accrued — fees computed live from findOverdueInstallments that
//      haven't been applied to the ledger yet. These represent days of
//      lateness that have passed but no officer has run the "apply fee"
//      action for.
//
// Both lists are scoped to a single loanId so the loan detail modal and
// the record-repayment screen can show exactly what that one loan owes,
// without pulling in other loans' fees.

import { useMemo } from "react";
import {
  useActiveGroup,
  useGroupMembers,
  useGroupLoans,
  useGroupWallet,
} from "../stores/useStore";
import { findOverdueInstallments, isLateFeeExempt } from "../utils/lateFees";
import { fmtCurrency, round2 } from "../utils/theme";

export interface LoanLateFeeRow {
  kind: "applied" | "accrued";
  label: string;
  sublabel?: string;
  amount: number;
  /** Monthly interest base used in the fee formula (accrued rows only) */
  monthlyInterestBase?: number;
  /** The overdue installment index (accrued rows only, for apply actions) */
  installmentIndex?: number;
  /** The full accrued fee amount before any partial payment (accrued rows only) */
  fullFeeAmount?: number;
  /** The feeTxId for applying this fee (accrued rows only) */
  feeTxId?: string;
  unappliedFeeAmount?: number;
  /** The raw overdue installment (accrued rows only) */
  overdueInstallment?: any;
}

export interface LoanLateFees {
  rows: LoanLateFeeRow[];
  totalApplied: number;
  totalAccrued: number;
  total: number;
  count: number;
}

export function useLoanLateFees(loanId?: string): LoanLateFees {
  const group = useActiveGroup();
  const members = useGroupMembers();
  const loans = useGroupLoans();
  const wallet = useGroupWallet();

  return useMemo<LoanLateFees>(() => {
    if (!loanId) {
      return {
        rows: [],
        totalApplied: 0,
        totalAccrued: 0,
        total: 0,
        count: 0,
      };
    }

    // ── 1. Applied late fees already in the ledger ────────────────────
    //
    // Excludes:
    //   • feePaid = true        — already cleared
    //   • deletedAt             — soft-deleted
    //   • dates within an active member late-fee exemption — a waived
    //     period silences fees regardless of whether the individual tx
    //     was later marked paid
    //
    // Meeting penalties are keyed `meeting-penalty-...` — not per-loan,
    // so they never appear here.
    const loan = loans.find((l: any) => l.id === loanId);
    const member = loan
      ? members.find((m: any) => m.id === loan.memberId)
      : null;
    // Delegate the exemption check to the shared isLateFeeExempt
    // helper in utils/lateFees.ts so the loan and contribution
    // fee engines cannot drift apart. Any scope/date comparison
    // change happens in one place.
    const dateInExemption = (dateStr: string | undefined): boolean => {
      if (!dateStr) return false;
      return isLateFeeExempt(member, "loan", new Date(dateStr));
    };

    const appliedTxs = wallet.filter(
      (t) =>
        t.loanId === loanId &&
        t.type === "late_fee" &&
        !(t as any).feePaid &&
        !(t as any).deletedAt &&
        !dateInExemption(t.date),
    );

    const appliedRows: LoanLateFeeRow[] = appliedTxs.map((t) => ({
      kind: "applied",
      label: t.description || "Late repayment fee",
      sublabel: `Applied ${new Date(t.date).toLocaleDateString()}`,
      amount: round2(Math.abs(t.amount || 0)),
      feeTxId: t.id,
    }));

    // ── 2. Accrued but not-yet-applied late fees ──────────────────────
    let accruedRows: LoanLateFeeRow[] = [];
    if (group) {
      try {
        const all =
          findOverdueInstallments(group, members, loans, wallet) || [];

        accruedRows = all
          .filter((o) => o.loanId === loanId)
          .map((o) => {
            const lateDays = o.daysLate;
            const label = `Installment #${o.installmentIndex + 1} · ${lateDays} day${
              lateDays !== 1 ? "s" : ""
            } late`;

            const parts: string[] = [
              `Due ${new Date(o.dueDate).toLocaleDateString()}`,
            ];
            if (o.ratePct != null && o.monthlyInterestBase != null) {
              parts.push(
                `${fmtCurrency(o.monthlyInterestBase)} × ${o.ratePct}% × ${lateDays} day${
                  lateDays !== 1 ? "s" : ""
                }`,
              );
            }
            if (o.daysNewlyOwed > 0 && o.daysNewlyOwed !== lateDays) {
              parts.push(
                `${o.daysNewlyOwed} new day${
                  o.daysNewlyOwed !== 1 ? "s" : ""
                } still to record`,
              );
            }

            return {
              kind: "accrued" as const,
              label,
              sublabel: parts.join(" · "),
              amount: round2(o.feeAmount || 0),
              monthlyInterestBase: o.monthlyInterestBase,
              installmentIndex: o.installmentIndex,
              fullFeeAmount: round2(o.totalFeeAmount || o.feeAmount || 0),
              unappliedFeeAmount: round2(o.feeAmount || 0),
              feeTxId: o.feeTxId,
              overdueInstallment: o,
            };
          });
      } catch (e) {
        console.error("[useLoanLateFees] findOverdueInstallments failed:", e);
      }
    }

    const totalApplied = round2(
      appliedRows.reduce((s, r) => s + r.amount, 0),
    );
    const totalAccrued = round2(
      accruedRows.reduce((s, r) => s + r.amount, 0),
    );

    return {
      rows: [...appliedRows, ...accruedRows],
      totalApplied,
      totalAccrued,
      total: round2(totalApplied + totalAccrued),
      count: appliedRows.length + accruedRows.length,
    };
  }, [loanId, group, members, loans, wallet]);
}