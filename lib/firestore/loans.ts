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

// ============================================================
// Helpers
// ============================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function normalizeDate(value?: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return undefined;
    }

    return trimmed.slice(0, 10);
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return undefined;
    }

    return value.toISOString().slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as any).toDate === "function"
  ) {
    const date = (value as any).toDate();

    if (
      !(date instanceof Date) ||
      !Number.isFinite(date.getTime())
    ) {
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

  if (!Number.isFinite(rate) || rate <= 0) {
    return 0;
  }

  if (period === "monthly") {
    return rate * 12;
  }

  return rate;
}

function daysBetween(
  fromIso: string,
  toIso: string,
): number {
  const fromDate = normalizeDate(fromIso);
  const toDate = normalizeDate(toIso);

  if (!fromDate || !toDate) {
    return 0;
  }

  const from = new Date(
    `${fromDate}T00:00:00.000Z`,
  ).getTime();

  const to = new Date(
    `${toDate}T00:00:00.000Z`,
  ).getTime();

  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (to - from) / 86400000,
    ),
  );
}

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
    normalizeDate(loan.applicationDate) ??
    normalizeDate(loan.disbursementDate) ??
    normalizeDate(fallbackDate) ??
    fallbackDate.slice(0, 10)
  );
}

function safeNumber(
  value: unknown,
  fallback = 0,
): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

function normalizeDateTime(
  value?: string,
): string {
  if (!value) {
    return new Date().toISOString();
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return new Date().toISOString();
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  ) {
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);

  if (!Number.isFinite(parsed.getTime())) {
    return new Date().toISOString();
  }

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
  const payment = round2(
    Math.max(
      0,
      safeNumber(paymentAmount),
    ),
  );

  const balance = round2(
    Math.max(
      0,
      safeNumber(loan.balance),
    ),
  );

  const toDate =
    normalizeDate(paymentDate) ??
    new Date()
      .toISOString()
      .slice(0, 10);

  const previousAccrued = round2(
    Math.max(
      0,
      safeNumber(loan.accruedInterest),
    ),
  );

  // ----------------------------------------------------------
  // Non-reducing balance
  // ----------------------------------------------------------

  if (
    loan.interestMethod !==
    "reducing_balance"
  ) {
    const principalPaid = round2(
      Math.min(
        payment,
        balance,
      ),
    );

    const remainingBalance = round2(
      Math.max(
        0,
        balance - principalPaid,
      ),
    );

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

  // ----------------------------------------------------------
  // Accrual period
  // ----------------------------------------------------------

  const fromDate =
    getAccrualStartDate(
      loan,
      toDate,
    );

  const days =
    daysBetween(
      fromDate,
      toDate,
    );

  // ----------------------------------------------------------
  // Interest rate
  // ----------------------------------------------------------

  const annualRate =
    toAnnualRate(
      safeNumber(
        loan.interestRate,
      ),
      loan.interestRatePeriod,
    );

  const dailyRate =
    annualRate / 100 / 365;

  // ----------------------------------------------------------
  // New interest
  // ----------------------------------------------------------

  const newInterest = round2(
    balance *
      dailyRate *
      days,
  );

  // ----------------------------------------------------------
  // Total interest due
  // ----------------------------------------------------------

  const totalInterestDue = round2(
    previousAccrued +
      newInterest,
  );

  // ----------------------------------------------------------
  // Interest is paid first
  // ----------------------------------------------------------

  const interestPaid = round2(
    Math.min(
      payment,
      totalInterestDue,
    ),
  );

  const remainingPayment = round2(
    Math.max(
      0,
      payment - interestPaid,
    ),
  );

  // ----------------------------------------------------------
  // Remaining payment goes to principal
  // ----------------------------------------------------------

  const principalPaid = round2(
    Math.min(
      remainingPayment,
      balance,
    ),
  );

  // ----------------------------------------------------------
  // Remaining balance
  // ----------------------------------------------------------

  const remainingBalance = round2(
    Math.max(
      0,
      balance - principalPaid,
    ),
  );

  // ----------------------------------------------------------
  // Remaining accrued interest
  // ----------------------------------------------------------

  const remainingAccruedInterest =
    round2(
      Math.max(
        0,
        totalInterestDue -
          interestPaid,
      ),
    );

  return {
    interest: interestPaid,
    principal: principalPaid,
    remainingBalance,
    accruedInterest:
      remainingAccruedInterest,
    lastAccrualDate: toDate,
    days,
    newlyAccruedInterest:
      newInterest,
  };
}

// ============================================================
// Project accrued interest
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
  asOfDate: string =
    new Date().toISOString(),
): {
  days: number;
  accrued: number;
  total: number;
} {
  const existingAccrued =
    round2(
      Math.max(
        0,
        safeNumber(
          loan.accruedInterest,
        ),
      ),
    );

  if (
    loan.interestMethod !==
    "reducing_balance"
  ) {
    return {
      days: 0,
      accrued: 0,
      total: existingAccrued,
    };
  }

  const asOf =
    normalizeDate(asOfDate);

  if (!asOf) {
    return {
      days: 0,
      accrued: 0,
      total: existingAccrued,
    };
  }

  const fromDate =
    getAccrualStartDate(
      loan,
      asOf,
    );

  const days =
    daysBetween(
      fromDate,
      asOf,
    );

  const annualRate =
    toAnnualRate(
      safeNumber(
        loan.interestRate,
      ),
      loan.interestRatePeriod,
    );

  if (
    annualRate <= 0 ||
    days <= 0
  ) {
    return {
      days,
      accrued: 0,
      total: existingAccrued,
    };
  }

  const dailyRate =
    annualRate / 100 / 365;

  const balance =
    round2(
      Math.max(
        0,
        safeNumber(
          loan.balance,
        ),
      ),
    );

  const projectedInterest =
    round2(
      balance *
        dailyRate *
        days,
    );

  const total =
    round2(
      existingAccrued +
        projectedInterest,
    );

  return {
    days,
    accrued: projectedInterest,
    total,
  };
}

// ============================================================
// Add loan
// ============================================================

export async function addLoan(
  gId: string,
  data: NewRecord<Loan>,
) {
  const userInfo =
    await getCurrentUserInfo();

  const now =
    new Date().toISOString();

  const applicationDate =
    normalizeDate(
      (data as any)
        .applicationDate,
    ) ??
    now.slice(0, 10);

  const loanRef =
    doc(
      loansCol(gId),
    );

  const loanData =
    stripUndefined({
      ...data,

      applicationDate,

      accruedInterest: 0,

      totalInterestPaid: 0,

      lastAccrualDate:
        applicationDate,

      createdAt:
        (data as any).createdAt ??
        now,

      updatedAt: now,

      createdBy:
        (data as any).createdBy ??
        userInfo?.userId,

      updatedBy:
        userInfo?.userId,
    });

  await setDoc(
    loanRef,
    loanData,
  );

  if (userInfo) {
    await writeAuditLog(
      gId,
      {
        groupId: gId,
        action: "create",
        entityType: "loan",
        entityId: loanRef.id,
        before: {},
        after: asRecord({
          ...loanData,
          id: loanRef.id,
        }),
        userId: userInfo.userId,
        userName: userInfo.userName,
      },
    );
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
  const snap =
    await getDoc(
      doc(
        loansCol(gId),
        loanId,
      ),
    );

  if (!snap.exists()) {
    return null;
  }

  return fromSnap<Loan>(
    snap,
  );
}

// ============================================================
// Update loan
// ============================================================

export async function updateLoan(
  gId: string,
  loanId: string,
  data: Partial<Loan>,
) {
  const userInfo =
    await getCurrentUserInfo();

  const now =
    new Date().toISOString();

  const ref =
    doc(
      loansCol(gId),
      loanId,
    );

  const currentSnap =
    await getDoc(ref);

  if (!currentSnap.exists()) {
    throw new Error(
      "Loan not found.",
    );
  }

  const before =
    currentSnap.data() as Loan;

  const updateData =
    stripUndefined({
      ...data,

      updatedAt: now,

      updatedBy:
        userInfo?.userId,
    });

  await updateDoc(
    ref,
    updateData,
  );

  if (userInfo) {
    await writeAuditLog(
      gId,
      {
        groupId: gId,
        action: "update",
        entityType: "loan",
        entityId: loanId,
        before: asRecord(before),
        after: asRecord({
          ...before,
          ...updateData,
        }),
        userId: userInfo.userId,
        userName: userInfo.userName,
      },
    );
  }

  return {
    ...before,
    ...updateData,
    id: loanId,
  } as Loan;
}

// ============================================================
// Subscribe loans
// ============================================================

export function subscribeLoans(
  gId: string,
  cb: (loans: Loan[]) => void,
) {
  const q =
    query(
      loansCol(gId),
      orderBy(
        "createdAt",
        "desc",
      ),
    );

  return onSnapshot(
    q,

    (snap) => {
      const loans =
        snap.docs.map(
          (item) =>
            fromSnap<Loan>(
              item,
            ),
        );

      cb(loans);
    },

    (error) => {
      logError(
        "subscribeLoans",
        "loans",
        error,
        {
          groupId: gId,
        },
      );

      cb([]);
    },
  );
}

// ============================================================
// Disburse loan
// ============================================================

export async function disburseLoanServer(
  gId: string,
  loanId: string,
) {
  const userInfo =
    await getCurrentUserInfo();

  if (!userInfo?.userId) {
    throw new Error(
      "You must be logged in.",
    );
  }

  const loanRef =
    doc(
      loansCol(gId),
      loanId,
    );

  const loanSnap =
    await getDoc(
      loanRef,
    );

  if (!loanSnap.exists()) {
    throw new Error(
      "Loan not found.",
    );
  }

  const loan =
    fromSnap<Loan>(
      loanSnap,
    );

  if (
    loan.status !==
    "approved"
  ) {
    throw new Error(
      "Only approved loans can be disbursed.",
    );
  }

  const now =
    new Date().toISOString();

  const applicationDate =
    normalizeDate(
      loan.applicationDate,
    ) ??
    now.slice(0, 10);

  const amount =
    round2(
      Math.max(
        0,
        safeNumber(
          loan.amount,
        ),
      ),
    );

  if (amount <= 0) {
    throw new Error(
      "Loan amount must be greater than zero.",
    );
  }

  const walletRef =
    doc(
      walletCol(gId),
    );

  // IMPORTANT:
  // WalletTransaction requires groupId.
  const walletTx: WalletTransaction =
    {
      id: walletRef.id,

      groupId: gId,

      type:
        "loan_disbursement",

      amount:
        -Math.abs(amount),

      date: now,

      loanId,

      memberId:
        loan.memberId,

      description:
        "Loan disbursement",

      sourceType:
        "loan",

      sourceId:
        loanId,

      createdAt:
        now,

      createdBy:
        userInfo.userId,
    };

  const loanUpdate =
    stripUndefined({
      status:
        "disbursed",

      disbursementDate:
        now,

      disbursedBy:
        userInfo.userId,

      accruedInterest:
        0,

      lastAccrualDate:
        applicationDate,

      totalInterestPaid:
        0,

      updatedAt:
        now,

      updatedBy:
        userInfo.userId,
    });

  const batch =
    writeBatch(db);

  batch.set(
    walletRef,
    stripUndefined(
      walletTx as any,
    ),
  );

  batch.update(
    loanRef,
    loanUpdate,
  );

  await batch.commit();

  const updatedLoan: Loan =
    {
      ...loan,
      ...loanUpdate,
      id: loanId,
    } as Loan;

  await writeAuditLog(
    gId,
    {
      groupId: gId,
      action: "update",
      entityType: "loan",
      entityId: loanId,
      before:
        asRecord(loan),
      after:
        asRecord(updatedLoan),
      userId:
        userInfo.userId,
      userName:
        userInfo.userName,
    },
  );

  return {
    loan: updatedLoan,
    walletTx,
  };
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
  const userInfo =
    await getCurrentUserInfo();

  if (!userInfo?.userId) {
    throw new Error(
      "You must be logged in.",
    );
  }

  const loanRef =
    doc(
      loansCol(gId),
      loanId,
    );

  const loanSnap =
    await getDoc(
      loanRef,
    );

  if (!loanSnap.exists()) {
    throw new Error(
      "Loan not found.",
    );
  }

  const loan =
    fromSnap<Loan>(
      loanSnap,
    );

  if (
    loan.status !==
    "disbursed"
  ) {
    throw new Error(
      "Only disbursed loans can receive repayments.",
    );
  }

  // ----------------------------------------------------------
  // Validate payment
  // ----------------------------------------------------------

  const paymentAmount =
    round2(
      safeNumber(
        amount,
      ),
    );

  if (
    !Number.isFinite(
      paymentAmount,
    ) ||
    paymentAmount <= 0
  ) {
    throw new Error(
      "Repayment amount must be greater than zero.",
    );
  }

  // ----------------------------------------------------------
  // Payment date
  // ----------------------------------------------------------

  const paymentDate =
    normalizeDate(date) ??
    new Date()
      .toISOString()
      .slice(0, 10);

  const transactionDate =
    normalizeDateTime(
      date,
    );

  // ----------------------------------------------------------
  // Calculate repayment
  // ----------------------------------------------------------

  const result =
    splitRepayment(
      {
        balance:
          safeNumber(
            loan.balance,
          ),

        interestRate:
          safeNumber(
            loan.interestRate,
          ),

        interestMethod:
          loan.interestMethod,

        interestRatePeriod:
          loan.interestRatePeriod,

        accruedInterest:
          safeNumber(
            loan.accruedInterest,
          ),

        lastAccrualDate:
          normalizeDate(
            loan.lastAccrualDate,
          ) ??
          normalizeDate(
            loan.applicationDate,
          ) ??
          normalizeDate(
            loan.disbursementDate,
          ) ??
          paymentDate,

        applicationDate:
          normalizeDate(
            loan.applicationDate,
          ),

        disbursementDate:
          normalizeDate(
            loan.disbursementDate,
          ),
      },

      paymentAmount,

      paymentDate,
    );

  // ----------------------------------------------------------
  // Transaction objects
  //
  // These are returned to the Zustand slice.
  // Therefore they MUST contain their Firestore IDs
  // and every required WalletTransaction field.
  // ----------------------------------------------------------

  let interestTx:
    | WalletTransaction
    | undefined;

  let principalTx:
    | WalletTransaction
    | undefined;

  // ----------------------------------------------------------
  // Create atomic batch
  // ----------------------------------------------------------

  const batch =
    writeBatch(db);

  // ----------------------------------------------------------
  // Interest payment
  // ----------------------------------------------------------

  if (
    result.interest > 0
  ) {
    const interestRef =
      doc(
        walletCol(gId),
      );

    interestTx =
      {
        id:
          interestRef.id,

        groupId:
          gId,

        // FIX: this used to be "loan_repayment" — the same generic type
        // as the principal-side transaction below, and the OLD
        // (pre-split) combined-payment shape. Every downstream reader
        // that computes interest income (recalcGroupTotals.ts's
        // group.totalInterestEarned, useReportData.ts, reports.tsx's
        // Profits tab) already expects THIS transaction — the one whose
        // `amount` is already the exact interest slice computed by
        // splitRepayment() above — to carry the modern, unambiguous
        // "loan_interest_income" type. Leaving it as "loan_repayment"
        // silently routed every real repayment through those readers'
        // LEGACY fallback path instead, which re-derives an interest
        // estimate via loan.totalInterest / loan.totalRepayable — a
        // fixed-schedule ratio that has nothing to do with the actual
        // day-by-day accrued interest this function just calculated,
        // and is wrong for both flat and reducing_balance loans.
        type:
          "loan_interest_income",

        amount:
          result.interest,

        date:
          transactionDate,

        loanId,

        memberId:
          loan.memberId,

        description:
          "Loan interest repayment",

        sourceType:
          "loan",

        sourceId:
          loanId,

        createdAt:
          transactionDate,

        createdBy:
          userInfo.userId,
      };

    batch.set(
      interestRef,
      stripUndefined(
        interestTx as any,
      ),
    );
  }

  // ----------------------------------------------------------
  // Principal repayment
  // ----------------------------------------------------------

  if (
    result.principal > 0
  ) {
    const principalRef =
      doc(
        walletCol(gId),
      );

    principalTx =
      {
        id:
          principalRef.id,

        groupId:
          gId,

        // FIX: same class of bug as interestTx above, mirrored — this
        // was also "loan_repayment", which reports.tsx's
        // groupOtherOnly/EARNING_TYPES logic already anticipated a
        // dedicated "loan_principal_recovery" type for (it's explicitly
        // named in that "known, not-earnings" list) but never actually
        // received, because this is the only place such a transaction
        // gets created. Principal coming back is a return of capital,
        // never earnings — giving it its own type makes that
        // unambiguous everywhere downstream, instead of relying on every
        // reader to know to exclude "loan_repayment" specifically.
        type:
          "loan_principal_recovery",

        amount:
          result.principal,

        date:
          transactionDate,

        loanId,

        memberId:
          loan.memberId,

        description:
          "Loan principal repayment",

        sourceType:
          "loan",

        sourceId:
          loanId,

        createdAt:
          transactionDate,

        createdBy:
          userInfo.userId,
      };

    batch.set(
      principalRef,
      stripUndefined(
        principalTx as any,
      ),
    );
  }

  // ----------------------------------------------------------
  // Loan totals
  // ----------------------------------------------------------

  const previousAmountRepaid =
    round2(
      Math.max(
        0,
        safeNumber(
          loan.amountRepaid,
        ),
      ),
    );

  const newAmountRepaid =
    round2(
      previousAmountRepaid +
        paymentAmount,
    );

  const newStatus =
    result.remainingBalance <= 0
      ? "repaid"
      : "disbursed";

  const previousTotalInterestPaid =
    round2(
      Math.max(
        0,
        safeNumber(
          loan.totalInterestPaid,
        ),
      ),
    );

  const newTotalInterestPaid =
    round2(
      previousTotalInterestPaid +
        result.interest,
    );

  const loanUpdate =
    stripUndefined({
      amountRepaid:
        newAmountRepaid,

      balance:
        result.remainingBalance,

      accruedInterest:
        result.accruedInterest,

      lastAccrualDate:
        result.lastAccrualDate,

      totalInterestPaid:
        newTotalInterestPaid,

      status:
        newStatus,

      completionDate:
        newStatus === "repaid"
          ? paymentDate
          : undefined,

      updatedAt:
        transactionDate,

      updatedBy:
        userInfo.userId,
    });

  batch.update(
    loanRef,
    loanUpdate,
  );

  // ----------------------------------------------------------
  // Commit
  // ----------------------------------------------------------

  await batch.commit();

  // ----------------------------------------------------------
  // Audit
  // ----------------------------------------------------------

  await writeAuditLog(
    gId,
    {
      groupId: gId,

      action:
        "update",

      entityType:
        "loan",

      entityId:
        loanId,

      before:
        asRecord(loan),

      after:
        asRecord({
          ...loan,
          ...loanUpdate,
        }),

      userId:
        userInfo.userId,

      userName:
        userInfo.userName,
    },
  );

  // ----------------------------------------------------------
  // Return exactly what loanSlice expects.
  //
  // loanSlice:
  //
  // result.loan
  // result.interestTx
  // result.principalTx
  // result.creditTx
  //
  // The transaction objects already contain their IDs.
  // ----------------------------------------------------------

  const updatedLoan: Loan =
    {
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