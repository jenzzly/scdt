// lib/firestore/wallet.ts

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
  db,
  walletCol,
  loansCol,
  getCurrentUserInfo,
  logError,
  stripUndefined,
  fromSnap,
} from "./core";

import type {
  WalletTransaction,
  Loan,
} from "./core";

import { writeAuditLog } from "./audit";
import { recordDeletion } from "./deletions";


// ============================================================
// Helpers
// ============================================================

function asRecord(
  value: unknown,
): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function normalizeDate(
  value?: unknown,
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed =
      value.trim();

    if (!trimmed) {
      return undefined;
    }

    return trimmed.slice(0, 10);
  }

  if (value instanceof Date) {
    if (
      !Number.isFinite(
        value.getTime(),
      )
    ) {
      return undefined;
    }

    return value
      .toISOString()
      .slice(0, 10);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as any).toDate ===
      "function"
  ) {
    const date =
      (value as any).toDate();

    if (
      !(date instanceof Date) ||
      !Number.isFinite(
        date.getTime(),
      )
    ) {
      return undefined;
    }

    return date
      .toISOString()
      .slice(0, 10);
  }

  return undefined;
}


// ============================================================
// Add wallet transaction
// ============================================================

export async function addWalletTx(
  gId: string,
  data: Partial<WalletTransaction>,
) {
  const userInfo =
    await getCurrentUserInfo();

  const now =
    new Date().toISOString();

  /*
   * If the caller already supplies an ID,
   * preserve it.
   *
   * Otherwise create a new Firestore
   * document ID.
   */
  const requestedId =
    typeof (data as any).id ===
      "string" &&
    (data as any).id.trim()
      ? (data as any).id.trim()
      : undefined;

  const ref =
    requestedId
      ? doc(
          walletCol(gId),
          requestedId,
        )
      : doc(walletCol(gId));

  const txData =
    stripUndefined({
      ...data,

      id:
        ref.id,

      createdAt:
        (data as any).createdAt ??
        now,

      createdBy:
        (data as any).createdBy ??
        userInfo?.userId,

      updatedAt:
        now,

      updatedBy:
        userInfo?.userId,
    });

  await setDoc(
    ref,
    txData,
  );

  if (userInfo) {
    await writeAuditLog(
      gId,
      {
        groupId:
          gId,

        action:
          "create",

        entityType:
          "wallet_transaction",

        entityId:
          ref.id,

        before:
          {},

        after:
          asRecord({
            ...txData,
            id: ref.id,
          }),

        userId:
          userInfo.userId,

        userName:
          userInfo.userName,
      },
    );
  }

  return ref.id;
}


// ============================================================
// Update wallet transaction
// ============================================================

export async function updateWalletTx(
  gId: string,
  id: string,
  data: Partial<WalletTransaction>,
) {
  const userInfo =
    await getCurrentUserInfo();

  const now =
    new Date().toISOString();

  const walletRef =
    doc(
      walletCol(gId),
      id,
    );

  const currentSnap =
    await getDoc(
      walletRef,
    );

  if (!currentSnap.exists()) {
    throw new Error(
      "Wallet transaction not found.",
    );
  }

  const before =
    {
      id,
      ...currentSnap.data(),
    } as WalletTransaction;

  const walletUpdate =
    stripUndefined({
      ...data,

      updatedAt:
        now,

      updatedBy:
        userInfo?.userId,
    });


  // ==========================================================
  // Detect linked loan disbursement
  // ==========================================================

  const isLoanDisbursement =
    before.type ===
      "loan_disbursement" &&
    !!before.loanId;


  let loanRef:
    | ReturnType<typeof doc>
    | null = null;

  let loanBefore:
    | Loan
    | null = null;

  let loanUpdate:
    | Record<string, unknown>
    | null = null;


  // ==========================================================
  // Update linked loan
  // ==========================================================

  if (
    isLoanDisbursement &&
    before.loanId &&
    data.date !== undefined
  ) {
    loanRef =
      doc(
        loansCol(gId),
        before.loanId,
      );

    const loanSnap =
      await getDoc(
        loanRef,
      );

    if (loanSnap.exists()) {
      loanBefore =
        {
          id:
            before.loanId,

          ...loanSnap.data(),
        } as Loan;

      const newDisbursementDate =
        normalizeDate(
          data.date,
        );

      if (newDisbursementDate) {
        loanUpdate = {
          /*
           * Keep the loan's disbursement
           * date synchronized with the
           * wallet transaction.
           */
          disbursementDate:
            newDisbursementDate,

          updatedAt:
            now,

          updatedBy:
            userInfo?.userId,
        };


        // ======================================================
        // FIX: interest starts from the DISBURSEMENT date, not
        // application date — the borrower doesn't have the money
        // (and interest can't be accruing on it) until it's actually
        // disbursed. This used to re-anchor lastAccrualDate to
        // loanBefore.applicationDate whenever the disbursement date
        // was edited, which is the same "phantom interest before the
        // money moved" bug as disburseLoanServer's original default —
        // just triggered by a later date-correction instead of the
        // initial disbursement. Anchoring to newDisbursementDate here
        // keeps this path consistent with disburseLoanServer.
        // ======================================================

        const amountRepaid =
          Number(
            (loanBefore as any)
              .amountRepaid ?? 0,
          );

        /*
         * For loans with no repayment yet,
         * re-anchor accrual to the corrected
         * disbursement date.
         */
        if (
          amountRepaid <= 0
        ) {
          loanUpdate.lastAccrualDate =
            newDisbursementDate;
        }
      }
    }
  }


  // ==========================================================
  // Atomic batch
  // ==========================================================

  const batch =
    writeBatch(db);

  batch.update(
    walletRef,
    walletUpdate,
  );

  if (
    loanRef &&
    loanUpdate
  ) {
    batch.update(
      loanRef,
      stripUndefined(
        loanUpdate,
      ),
    );
  }

  await batch.commit();


  // ==========================================================
  // Audit
  // ==========================================================

  if (userInfo) {
    await writeAuditLog(
      gId,
      {
        groupId:
          gId,

        action:
          "update",

        entityType:
          "wallet_transaction",

        entityId:
          id,

        before:
          asRecord(
            before,
          ),

        after:
          asRecord({
            ...before,
            ...walletUpdate,
          }),

        userId:
          userInfo.userId,

        userName:
          userInfo.userName,
      },
    );


    if (
      loanRef &&
      loanBefore &&
      loanUpdate &&
      before.loanId
    ) {
      await writeAuditLog(
        gId,
        {
          groupId:
            gId,

          action:
            "update",

          entityType:
            "loan",

          entityId:
            before.loanId,

          before:
            asRecord(
              loanBefore,
            ),

          after:
            asRecord({
              ...loanBefore,
              ...loanUpdate,
            }),

          userId:
            userInfo.userId,

          userName:
            userInfo.userName,
        },
      );
    }
  }


  return {
    ...before,
    ...walletUpdate,
    id,
  } as WalletTransaction;
}


// ============================================================
// Delete wallet transaction permanently
// ============================================================

export async function deleteWalletTxPermanently(
  gId: string,
  id: string,
) {
  const userInfo =
    await getCurrentUserInfo();

  const walletRef =
    doc(
      walletCol(gId),
      id,
    );

  const currentSnap =
    await getDoc(
      walletRef,
    );

  if (!currentSnap.exists()) {
    throw new Error(
      "Wallet transaction not found.",
    );
  }

  const before =
    {
      id,
      ...currentSnap.data(),
    } as WalletTransaction;


  // ==========================================================
  // Delete wallet transaction
  // ==========================================================

  await deleteDoc(
    walletRef,
  );


  // ==========================================================
  // Record deletion + audit
  // ==========================================================

  if (userInfo) {
    await recordDeletion(
      gId,
      "wallet_transaction",
      id,
      asRecord(
        before,
      ),
      "Wallet transaction permanently deleted",
    );

    await writeAuditLog(
      gId,
      {
        groupId:
          gId,

        action:
          "delete",

        entityType:
          "wallet_transaction",

        entityId:
          id,

        before:
          asRecord(
            before,
          ),

        after:
          {},

        userId:
          userInfo.userId,

        userName:
          userInfo.userName,
      },
    );
  }
}


// ============================================================
// Backward-compatible delete
// ============================================================

export async function deleteWalletTx(
  gId: string,
  id: string,
) {
  return deleteWalletTxPermanently(
    gId,
    id,
  );
}


// ============================================================
// Subscribe wallet transactions
// ============================================================

export function subscribeWalletTxs(
  gId: string,
  cb: (
    txs: WalletTransaction[],
  ) => void,
) {
  const q =
    query(
      walletCol(gId),
      orderBy(
        "date",
        "desc",
      ),
    );

  return onSnapshot(
    q,

    (snap) => {
      const txs =
        snap.docs.map(
          (s) =>
            fromSnap<WalletTransaction>(
              s,
            ),
        );

      console.log(
        "[WALLET SNAPSHOT]",
        {
          groupId:
            gId,

          count:
            txs.length,
        },
      );

      cb(txs);
    },

    (error) => {
      logError(
        "subscribeWalletTxs",
        "wallet",
        error,
        {
          groupId:
            gId,
        },
      );

      cb([]);
    },
  );
}