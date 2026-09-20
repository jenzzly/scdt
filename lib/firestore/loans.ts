// lib/firestore/loans.ts

import {
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  setDoc,
  db,
  walletCol,
  loansCol,
  getCurrentUserInfo,
  logError,
  stripUndefined,
  fromSnap,
  round2,
} from "./core";

import type {
  Loan,
  WalletTransaction,
  NewRecord,
} from "./core";

import { writeAuditLog } from "./audit";

// Used by disburseLoanServer to rebuild the repayment schedule around
// the actual disbursement date. The schedule was originally generated
// at submission time with firstPaymentDate = applicationDate, which
// made every installment due 1/2/3... months after the APPLICATION
// rather than after the money actually moved. Re-anchoring here keeps
// installment due dates, interest accrual start, wallet tx date, and
// late-fee evaluation all keyed to the same day.
import { loanSchedule } from "../../utils/theme";

// ============================================================
// Helpers
// ============================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function normalizeDate(value?: unknown): string | undefined {
  if (!value) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, 10);
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as any).toDate === "function"
  ) {
    const date = (value as any).toDate();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      return undefined;
    }
    return date.toISOString().slice(0, 10);
  }

  return undefined;
}

function toAnnualRate(
  ratePercent: number,
  period?: "monthly" | "annual",
): number {
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (period === "monthly") return rate * 12;
  return rate;
}

function daysBetween(fromIso: string, toIso: string): number {
  const fromDate = normalizeDate(fromIso);
  const toDate = normalizeDate(toIso);
  if (!fromDate || !toDate) return 0;

  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;

  return Math.max(0, Math.floor((to - from) / 86400000));
}

// Resolve the date from which interest has been accruing.
//
// ORDER MATTERS: an explicit lastAccrualDate is authoritative (it's
// updated every time interest is capitalized during a repayment). The
// next-best anchor is the DISBURSEMENT date — the day the borrower
// actually received the money and the clock started running. The
// application date is only a last-resort fallback for data that predates
// the disbursement flow entirely; it must never win over
// disbursementDate, or interest silently accrues during the approval
// window when no money had moved yet.
function getAccrualStartDate(
  loan: {
    lastAccrualDate?: string;
    applicationDate?: string;
    disbursementDate?: string;
  },
  fallbackDate: string,
): string {
  return (
    normalizeDate(loan.lastAccrualDate) ??
    normalizeDate(loan.disbursementDate) ??
    normalizeDate(loan.applicationDate) ??
    normalizeDate(fallbackDate) ??
    fallbackDate.slice(0, 10)
  );
}

function safeNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number;
}

function normalizeDateTime(value?: string): string {
  if (!value) return new Date().toISOString();
  const trimmed = value.trim();
  if (!trimmed) return new Date().toISOString();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

// ============================================================
// Repayment calculation
// ============================================================

export function splitRepayment(
  loan: Pick<
    Loan,
    | "balance"
    | "interestRate"
    | "interestMethod"
    | "interestRatePeriod"
    | "accruedInterest"
    | "lastAccrualDate"
  > & {
    applicationDate?: string;
    disbursementDate?: string;
  },
  paymentAmount: number,
  paymentDate: string,
) {
  const payment = round2(Math.max(0, safeNumber(paymentAmount)));
  const balance = round2(Math.max(0, safeNumber(loan.balance)));
  const toDate =
    normalizeDate(paymentDate) ?? new Date().toISOString().slice(0, 10);
  const previousAccrued = round2(
    Math.max(0, safeNumber(loan.accruedInterest)),
  );

  if (loan.interestMethod !== "reducing_balance") {
    const principalPaid = round2(Math.min(payment, balance));
    const remainingBalance = round2(Math.max(0, balance - principalPaid));
    return {
      interest: 0,
      principal: principalPaid,
      remainingBalance,
      accruedInterest: previousAccrued,
      lastAccrualDate: toDate,
      days: 0,
      newlyAccruedInterest: 0,
    };
  }

  const fromDate = getAccrualStartDate(loan, toDate);
  const days = daysBetween(fromDate, toDate);

  const annualRate = toAnnualRate(
    safeNumber(loan.interestRate),
    loan.interestRatePeriod,
  );
  const dailyRate = annualRate / 100 / 365;

  const newInterest = round2(balance * dailyRate * days);
  const totalInterestDue = round2(previousAccrued + newInterest);

  const interestPaid = round2(Math.min(payment, totalInterestDue));
  const remainingPayment = round2(Math.max(0, payment - interestPaid));
  const principalPaid = round2(Math.min(remainingPayment, balance));
  const remainingBalance = round2(Math.max(0, balance - principalPaid));
  const remainingAccruedInterest = round2(
    Math.max(0, totalInterestDue - interestPaid),
  );

  return {
    interest: interestPaid,
    principal: principalPaid,
    remainingBalance,
    accruedInterest: remainingAccruedInterest,
    lastAccrualDate: toDate,
    days,
    newlyAccruedInterest: newInterest,
  };
}

// ============================================================
// Project accrued interest (pure)
// ============================================================

export function projectAccruedInterest(
  loan: {
    balance: number;
    interestRate: number;
    interestMethod?: string;
    interestRatePeriod?: "monthly" | "annual";
    accruedInterest?: number;
    lastAccrualDate?: string;
    applicationDate?: string;
    disbursementDate?: string;
  },
  asOfDate: string = new Date().toISOString(),
): { days: number; accrued: number; total: number } {
  const existingAccrued = round2(
    Math.max(0, safeNumber(loan.accruedInterest)),
  );

  if (loan.interestMethod !== "reducing_balance") {
    return { days: 0, accrued: 0, total: existingAccrued };
  }

  const asOf = normalizeDate(asOfDate);
  if (!asOf) return { days: 0, accrued: 0, total: existingAccrued };

  const fromDate = getAccrualStartDate(loan, asOf);
  const days = daysBetween(fromDate, asOf);

  const annualRate = toAnnualRate(
    safeNumber(loan.interestRate),
    loan.interestRatePeriod,
  );
  if (annualRate <= 0 || days <= 0) {
    return { days, accrued: 0, total: existingAccrued };
  }

  const dailyRate = annualRate / 100 / 365;
  const balance = round2(Math.max(0, safeNumber(loan.balance)));
  const projectedInterest = round2(balance * dailyRate * days);
  const total = round2(existingAccrued + projectedInterest);

  return { days, accrued: projectedInterest, total };
}

// ============================================================
// Add loan
// ============================================================

export async function addLoan(gId: string, data: NewRecord<Loan>) {
  const userInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();

  const applicationDate =
    normalizeDate((data as any).applicationDate) ?? now.slice(0, 10);

  const loanRef = doc(loansCol(gId));

  const loanData = stripUndefined({
    ...data,
    applicationDate,
    accruedInterest: 0,
    totalInterestPaid: 0,
    lastAccrualDate: applicationDate,
    createdAt: (data as any).createdAt ?? now,
    updatedAt: now,
    createdBy: (data as any).createdBy ?? userInfo?.userId,
    updatedBy: userInfo?.userId,
  });

  await setDoc(loanRef, loanData);

  if (userInfo) {
    await writeAuditLog(gId, {
      groupId: gId,
      action: "create",
      entityType: "loan",
      entityId: loanRef.id,
      before: {},
      after: asRecord({ ...loanData, id: loanRef.id }),
      userId: userInfo.userId,
      userName: userInfo.userName,
    });
  }

  return loanRef.id;
}

// ============================================================
// Get loan
// ============================================================

export async function getLoan(
  gId: string,
  loanId: string,
): Promise<Loan | null> {
  const snap = await getDoc(doc(loansCol(gId), loanId));
  if (!snap.exists()) return null;
  return fromSnap<Loan>(snap);
}

// ============================================================
// Update loan
// ============================================================

export async function updateLoan(
  gId: string,
  loanId: string,
  data: Partial<Loan>,
) {
  const userInfo = await getCurrentUserInfo();
  const now = new Date().toISOString();
  const ref = doc(loansCol(gId), loanId);

  const currentSnap = await getDoc(ref);
  if (!currentSnap.exists()) throw new Error("Loan not found.");

  const before = currentSnap.data() as Loan;

  const updateData = stripUndefined({
    ...data,
    updatedAt: now,
    updatedBy: userInfo?.userId,
  });

  await updateDoc(ref, updateData);

  if (userInfo) {
    await writeAuditLog(gId, {
      groupId: gId,
      action: "update",
      entityType: "loan",
      entityId: loanId,
      before: asRecord(before),
      after: asRecord({ ...before, ...updateData }),
      userId: userInfo.userId,
      userName: userInfo.userName,
    });
  }

  return { ...before, ...updateData, id: loanId } as Loan;
}

// ============================================================
// Subscribe loans
// ============================================================

export function subscribeLoans(
  gId: string,
  cb: (loans: Loan[]) => void,
  onError?: (error: unknown) => void,
  _memberId?: string,
): () => void {
  // No where("memberId", "==", ...) clause: the loans list rule in
  // firestore.rules already permits any active group member to read the
  // whole subcollection, so the client filter in loans.tsx's
  // `visibleLoans` is what scopes a personal view. Keeping the query
  // unconstrained also avoids requiring a composite index on
  // (memberId, createdAt), which is a common source of "the query
  // requires an index" failures when a new environment is first run.
  const q = query(loansCol(gId), orderBy("createdAt", "desc"));

  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((item) => fromSnap<Loan>(item))),
    (error) => {
      logError("subscribeLoans", "loans", error, { groupId: gId });
      onError?.(error);
    },
  );
}

// ============================================================
// Disburse loan
// ============================================================
//
// `disbursementDate` is the date the money ACTUALLY left the group
// wallet — which can be any day the accountant chooses, not necessarily
// "now". This is the anchor for:
//
//   - the wallet transaction's `date`
//   - loan.disbursementDate
//   - loan.lastAccrualDate (reducing-balance interest start)
//   - the repayment schedule's firstPaymentDate (and every subsequent
//     installment due date derived from it)
//
// `loan.applicationDate` is NOT touched here. It was captured at
// submission time and reflects when the borrower filed the request,
// which has nothing to do with when the money moved.
//
// FIX HISTORY:
//
//   (1) Previously this parameter was named `applicationDate` and the
//       function overwrote `loan.applicationDate` with it, while
//       separately stamping disbursementDate / lastAccrualDate /
//       walletTx.date with `now`. That produced three disagreeing
//       dates on the same loan and made reducing-balance interest
//       start from whenever the disburse button happened to be tapped.
//       All four fields now derive from the one date the caller passes.
//
//   (2) The repayment schedule was generated at SUBMISSION time
//       (firstPaymentDate = applicationDate), so installment due dates
//       were anchored to the application, not the disbursement. That
//       meant a loan applied on the 1st but disbursed on the 5th had
//       its first installment due 5 days too early, which also made
//       findOverdueInstallments start the late-fee window too early.
//       The schedule is now regenerated here, anchored to the
//       disbursement date.
export async function disburseLoanServer(
  gId: string,
  loanId: string,
  disbursementDate?: string,
) {
  const userInfo = await getCurrentUserInfo();
  if (!userInfo?.userId) throw new Error("You must be logged in.");

  const loanRef = doc(loansCol(gId), loanId);
  const loanSnap = await getDoc(loanRef);
  if (!loanSnap.exists()) throw new Error("Loan not found.");

  const loan = fromSnap<Loan>(loanSnap);

  if (loan.status !== "approved") {
    throw new Error("Only approved loans can be disbursed.");
  }

  const now = new Date().toISOString();

  const resolvedDisbursementDate =
    normalizeDate(disbursementDate) ??
    normalizeDate((loan as any).disbursementDate) ??
    now.slice(0, 10);

  const disbursementIso = normalizeDateTime(resolvedDisbursementDate);

  const amount = round2(Math.max(0, safeNumber(loan.amount)));
  if (amount <= 0) throw new Error("Loan amount must be greater than zero.");

  // ── Rebuild the schedule anchored to the disbursement date ──────
  //
  // Guards: only rebuild when we have a positive principal and a
  // positive term. If anything is off, we fall back to writing the
  // loan patch WITHOUT a schedule change — matching pre-fix behavior
  // rather than risk corrupting the schedule with bad inputs.
  //
  // interestRatePeriod is stored on the loan at submission time
  // (see submitLoan in loanSlice.ts). If it's missing for a legacy
  // record, default to "monthly" — same default the group settings
  // use when unset.
  const repaymentMonths = safeNumber(loan.repaymentMonths);
  const canRebuildSchedule = repaymentMonths > 0;

  const scheduleRebuild = canRebuildSchedule
    ? loanSchedule(
        {
          amount,
          interestRate: safeNumber(loan.interestRate),
          repaymentMonths,
          firstPaymentDate: disbursementIso,
        },
        loan.interestMethod ?? "flat",
        (loan as any).interestRatePeriod ?? "monthly",
      )
    : null;

  const walletRef = doc(walletCol(gId));

  const walletTx: WalletTransaction = {
    id: walletRef.id,
    groupId: gId,
    type: "loan_disbursement",
    amount: -Math.abs(amount),
    date: disbursementIso,
    loanId,
    memberId: loan.memberId,
    description: "Loan disbursement",
    sourceType: "loan",
    sourceId: loanId,
    createdAt: now,
    createdBy: userInfo.userId,
  };

  const loanUpdate = stripUndefined({
    status: "disbursed",

    // applicationDate is intentionally NOT in this patch — it was set
    // at submission and should stay there.

    disbursementDate: disbursementIso,
    disbursedBy: userInfo.userId,

    // Schedule (and everything derived from it) re-anchored to the
    // disbursement date. When the rebuild guard fails, these fields
    // are undefined and stripUndefined drops them from the write —
    // the stored schedule stays as-is.
    schedule: scheduleRebuild?.schedule,
    monthlyPayment: scheduleRebuild?.monthlyPayment,
    totalInterest:
      scheduleRebuild !== null
        ? round2(scheduleRebuild.totalInterest)
        : undefined,
    totalRepayable:
      scheduleRebuild !== null
        ? round2(scheduleRebuild.totalRepayable)
        : undefined,

    accruedInterest: 0,
    lastAccrualDate: resolvedDisbursementDate,
    totalInterestPaid: 0,

    updatedAt: now,
    updatedBy: userInfo.userId,
  });

  const batch = writeBatch(db);
  batch.set(walletRef, stripUndefined(walletTx as any));
  batch.update(loanRef, loanUpdate);
  await batch.commit();

  const updatedLoan: Loan = { ...loan, ...loanUpdate, id: loanId } as Loan;

  await writeAuditLog(gId, {
    groupId: gId,
    action: "update",
    entityType: "loan",
    entityId: loanId,
    before: asRecord(loan),
    after: asRecord(updatedLoan),
    userId: userInfo.userId,
    userName: userInfo.userName,
  });

  return { loan: updatedLoan, walletTx };
}

// ============================================================
// Record repayment
// ============================================================

export async function recordRepaymentServer(
  gId: string,
  loanId: string,
  amount: number,
  date?: string,
) {
  const userInfo = await getCurrentUserInfo();
  if (!userInfo?.userId) throw new Error("You must be logged in.");

  const loanRef = doc(loansCol(gId), loanId);
  const loanSnap = await getDoc(loanRef);
  if (!loanSnap.exists()) throw new Error("Loan not found.");

  const loan = fromSnap<Loan>(loanSnap);

  if (loan.status !== "disbursed") {
    throw new Error("Only disbursed loans can receive repayments.");
  }

  const paymentAmount = round2(safeNumber(amount));
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error("Repayment amount must be greater than zero.");
  }

  const paymentDate =
    normalizeDate(date) ?? new Date().toISOString().slice(0, 10);
  const transactionDate = normalizeDateTime(date);

  const result = splitRepayment(
    {
      balance: safeNumber(loan.balance),
      interestRate: safeNumber(loan.interestRate),
      interestMethod: loan.interestMethod,
      interestRatePeriod: loan.interestRatePeriod,
      accruedInterest: safeNumber(loan.accruedInterest),
      lastAccrualDate:
        normalizeDate(loan.lastAccrualDate) ??
        normalizeDate((loan as any).disbursementDate) ??
        normalizeDate(loan.applicationDate) ??
        paymentDate,
      applicationDate: normalizeDate(loan.applicationDate),
      disbursementDate: normalizeDate((loan as any).disbursementDate),
    },
    paymentAmount,
    paymentDate,
  );

  let interestTx: WalletTransaction | undefined;
  let principalTx: WalletTransaction | undefined;

  const batch = writeBatch(db);

  if (result.interest > 0) {
    const interestRef = doc(walletCol(gId));
    interestTx = {
      id: interestRef.id,
      groupId: gId,
      type: "loan_interest_income",
      amount: result.interest,
      date: transactionDate,
      loanId,
      memberId: loan.memberId,
      description: "Loan interest repayment",
      sourceType: "loan",
      sourceId: loanId,
      createdAt: transactionDate,
      createdBy: userInfo.userId,
    };
    batch.set(interestRef, stripUndefined(interestTx as any));
  }

  if (result.principal > 0) {
    const principalRef = doc(walletCol(gId));
    principalTx = {
      id: principalRef.id,
      groupId: gId,
      type: "loan_principal_recovery",
      amount: result.principal,
      date: transactionDate,
      loanId,
      memberId: loan.memberId,
      description: "Loan principal repayment",
      sourceType: "loan",
      sourceId: loanId,
      createdAt: transactionDate,
      createdBy: userInfo.userId,
    };
    batch.set(principalRef, stripUndefined(principalTx as any));
  }

  const previousAmountRepaid = round2(
    Math.max(0, safeNumber(loan.amountRepaid)),
  );
  const newAmountRepaid = round2(previousAmountRepaid + paymentAmount);

  const newStatus =
    result.remainingBalance <= 0 ? "repaid" : "disbursed";

  const previousTotalInterestPaid = round2(
    Math.max(0, safeNumber(loan.totalInterestPaid)),
  );
  const newTotalInterestPaid = round2(
    previousTotalInterestPaid + result.interest,
  );

  const loanUpdate = stripUndefined({
    amountRepaid: newAmountRepaid,
    balance: result.remainingBalance,
    accruedInterest: result.accruedInterest,
    lastAccrualDate: result.lastAccrualDate,
    totalInterestPaid: newTotalInterestPaid,
    status: newStatus,
    completionDate: newStatus === "repaid" ? paymentDate : undefined,
    updatedAt: transactionDate,
    updatedBy: userInfo.userId,
  });

  batch.update(loanRef, loanUpdate);
  await batch.commit();

  await writeAuditLog(gId, {
    groupId: gId,
    action: "update",
    entityType: "loan",
    entityId: loanId,
    before: asRecord(loan),
    after: asRecord({ ...loan, ...loanUpdate }),
    userId: userInfo.userId,
    userName: userInfo.userName,
  });

  const updatedLoan: Loan = {
    ...loan,
    ...loanUpdate,
    id: loanId,
  } as Loan;

  return {
    loan: updatedLoan,
    interestTx,
    principalTx,
    creditTx: undefined,
  };
}