// stores/slices/lateFeeExemptionSlice.ts
//
// Implements the two late-fee-exemption actions declared on StoreState
// in stores/storeTypes.ts but not provided by any other slice.
//
// `addLateFeeExemption` records a [periodStart, periodEnd] window on a
// member's `lateFeeExemptions` array — see utils/lateFees.ts's
// isLateFeeExempt, which skips any contribution/loan period or
// installment whose date falls inside an applicable exemption. Optionally
// also marks a specific late-fee wallet tx as paid in the same call
// (that's what the per-fee "Waive" action from the loan detail modal
// uses — otherwise the fee already on the ledger would keep showing up).
//
// `removeLateFeeExemption` drops the exemption. It does NOT restore any
// fee that was cleared when the exemption was created — clearing fees is
// a ledger operation, and the exemption is only about future accrual.
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type { ID, LateFeeExemption } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";

export const createLateFeeExemptionSlice = (
  set: SetFn,
  get: GetFn,
): Pick<StoreState, "addLateFeeExemption" | "removeLateFeeExemption"> => ({
  addLateFeeExemption: async (
    memberId,
    data,
    feeTxIdToClear,
  ) => {
    const { activeGroupId, members, authUid, authName } = get();
    if (!activeGroupId) throw new Error("No active group");
    if (!authUid) throw new Error("You must be logged in");

    const member = members.find((m) => m.id === memberId);
    if (!member) throw new Error("Member not found");

    const exemption: LateFeeExemption = {
      id: uid(),
      scope: data.scope,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      reason: data.reason,
      createdBy: authUid,
      createdByName: authName ?? "Admin",
      createdAt: new Date().toISOString(),
    };

    const updatedExemptions = [
      ...(member.lateFeeExemptions ?? []),
      exemption,
    ];

    try {
      get().setSyncStatus("pending");

      // 1. Persist the exemption on the member doc.
      await FS.updateMember(activeGroupId, memberId, {
        lateFeeExemptions: updatedExemptions,
      });

      // 2. Optionally mark the specific fee tx as paid.
      if (feeTxIdToClear) {
        const tx = get().walletTransactions.find(
          (t) => t.id === feeTxIdToClear,
        );
        if (tx && !tx.feePaid) {
          await FS.updateWalletTx(activeGroupId, feeTxIdToClear, {
            feePaid: true,
          });
          get().updateWalletTxLocal(feeTxIdToClear, { feePaid: true });
        }
      }

      // 3. Local state.
      get().updateMemberLocal(memberId, {
        lateFeeExemptions: updatedExemptions,
      });

      get().setSyncStatus("synced");
      return exemption.id;
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to add exemption",
      );
      throw e;
    }
  },

  removeLateFeeExemption: async (memberId, exemptionId) => {
    const { activeGroupId, members } = get();
    if (!activeGroupId) throw new Error("No active group");

    const member = members.find((m) => m.id === memberId);
    if (!member) throw new Error("Member not found");

    const updatedExemptions = (member.lateFeeExemptions ?? []).filter(
      (e) => e.id !== exemptionId,
    );

    try {
      get().setSyncStatus("pending");
      await FS.updateMember(activeGroupId, memberId, {
        lateFeeExemptions: updatedExemptions,
      });
      get().updateMemberLocal(memberId, {
        lateFeeExemptions: updatedExemptions,
      });
      get().setSyncStatus("synced");
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to remove exemption",
      );
      throw e;
    }
  },
});
