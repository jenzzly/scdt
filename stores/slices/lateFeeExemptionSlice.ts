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
import { LateFeeExemption } from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";

export const createLateFeeExemptionSlice = (
  set: SetFn,
  get: GetFn,
): Pick<
  StoreState,
  | "addLateFeeExemption"
  | "approveLateFeeExemption"
  | "rejectLateFeeExemption"
  | "removeLateFeeExemption"
> => ({
  // ═══════════════════════════════════════════════════════════════
  // ADD LATE FEE EXEMPTION — now a REQUEST, not an approval.
  // ═══════════════════════════════════════════════════════════════
  //
  // Writes to `pendingExemptions` on the member doc. Nothing about
  // the ledger changes until an approver runs
  // `approveLateFeeExemption`. Signature unchanged from the previous
  // version — `feeTxIdToClear` is now remembered on the pending
  // entry and applied on approval, not here.
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

    // Duplicate prevention: reject if an exemption with the same
    // scope AND period already exists — in EITHER the pending or
    // the active list. Prevents the "save twice → two identical
    // entries" bug and the "re-request an already-approved
    // period" case. The admin should remove the existing entry
    // first if they genuinely want to change it.
    const duplicate = [
      ...((member as any).pendingExemptions ?? []),
      ...(member.lateFeeExemptions ?? []),
    ].find(
      (e: any) =>
        e.scope === data.scope &&
        e.periodStart === data.periodStart &&
        e.periodEnd === data.periodEnd,
    );
    if (duplicate) {
      throw new Error(
        "A waiver for this scope and period already exists. Remove the existing one first if you need to change it.",
      );
    }

    const exemption: LateFeeExemption = {
      id: uid(),
      scope: data.scope,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      reason: data.reason,
      createdBy: authUid,
      createdByName: authName ?? "Admin",
      createdAt: new Date().toISOString(),
      amount: (data as any).amount,
    };

    // Remember which fee tx (if any) this request is meant to
    // clear, so the approver action can finish the job.
    (exemption as any).feeTxIdToClear = feeTxIdToClear ?? null;

    const updatedPending = [
      ...(member.pendingExemptions ?? []),
      exemption,
    ];

    try {
      get().setSyncStatus("pending");

      await FS.updateMember(activeGroupId, memberId, {
        pendingExemptions: updatedPending,
      });

      get().updateMemberLocal(memberId, {
        pendingExemptions: updatedPending,
      });

      // Notify every eligible approver. Eligible =
      // admin / accountant / loan_officer, or anyone whose
      // `permissions.waiveLateFees` is true.
      const approvers = members.filter(
        (m) =>
          m.groupId === activeGroupId &&
          m.status === "active" &&
          !!m.userId &&
          m.id !== memberId &&
          (
            ["admin", "accountant", "loan_officer"].includes(m.role) ||
            m.permissions?.waiveLateFees === true
          ),
      );
      const now = new Date().toISOString();
      for (const approver of approvers) {
        FS.addNotification(
          approver.userId!,
          {
            userId: approver.userId!,
            groupId: activeGroupId,
            type: "waiver_pending",
            title: "Late Fee Waiver Awaiting Approval",
            message: `${authName || "A member"} requested a ${data.scope} waiver for ${member.fullName} (${data.periodStart} → ${data.periodEnd}).`,
            read: false,
            metadata: { memberId, exemptionId: exemption.id },
            createdAt: now,
          },
          approver.email,
        ).catch(console.warn);
      }

      get().setSyncStatus("synced");
      return exemption.id;
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to request exemption",
      );
      throw e;
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // APPROVE LATE FEE EXEMPTION
  // ═══════════════════════════════════════════════════════════════
  //
  // Moves one entry from `pendingExemptions` to `lateFeeExemptions`
  // and, when the pending entry carries a `feeTxIdToClear`, marks
  // that wallet tx as paid. Notifies the requester.
  approveLateFeeExemption: async (
    memberId,
    exemptionId,
    feeTxIdToClear,
  ) => {
    const { activeGroupId, members, authName } = get();
    if (!activeGroupId) throw new Error("No active group");

    const member = members.find((m) => m.id === memberId);
    if (!member) throw new Error("Member not found");

    const pending = member.pendingExemptions ?? [];
    const entry = pending.find((e) => e.id === exemptionId);
    if (!entry) throw new Error("Pending exemption not found");

    const updatedPending = pending.filter(
      (e) => e.id !== exemptionId,
    );
    const updatedActive = [
      ...(member.lateFeeExemptions ?? []),
      entry,
    ];

    // Prefer the explicit argument; fall back to whatever the
    // requester stashed on the entry.
    const txId =
      feeTxIdToClear ?? ((entry as any).feeTxIdToClear as string | undefined);

    try {
      get().setSyncStatus("pending");

      await FS.updateMember(activeGroupId, memberId, {
        pendingExemptions: updatedPending,
        lateFeeExemptions: updatedActive,
      });

      if (txId) {
        const tx = get().walletTransactions.find((t) => t.id === txId);
        if (tx && !(tx as any).feePaid) {
          await FS.updateWalletTx(activeGroupId, txId, {
            feePaid: true,
          });
          get().updateWalletTxLocal(txId, { feePaid: true });
        }
      }

      get().updateMemberLocal(memberId, {
        pendingExemptions: updatedPending,
        lateFeeExemptions: updatedActive,
      });

      // Notify the requester.
      if (entry.createdBy) {
        const requester = members.find((m) => m.userId === entry.createdBy);
        if (requester?.userId) {
          FS.addNotification(
            requester.userId,
            {
              userId: requester.userId,
              groupId: activeGroupId,
              type: "waiver_approved",
              title: "Waiver Approved",
              message: `Your ${entry.scope} waiver for ${member.fullName} (${entry.periodStart} → ${entry.periodEnd}) was approved by ${authName || "an approver"}.`,
              read: false,
              metadata: { memberId, exemptionId },
              createdAt: new Date().toISOString(),
            },
            requester.email,
          ).catch(console.warn);
        }
      }

      get().setSyncStatus("synced");
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to approve exemption",
      );
      throw e;
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // REJECT LATE FEE EXEMPTION
  // ═══════════════════════════════════════════════════════════════
  rejectLateFeeExemption: async (memberId, exemptionId, reason) => {
    const { activeGroupId, members, authName } = get();
    if (!activeGroupId) throw new Error("No active group");

    const member = members.find((m) => m.id === memberId);
    if (!member) throw new Error("Member not found");

    const entry = (member.pendingExemptions ?? []).find(
      (e) => e.id === exemptionId,
    );
    if (!entry) throw new Error("Pending exemption not found");

    const updatedPending = (member.pendingExemptions ?? []).filter(
      (e) => e.id !== exemptionId,
    );

    try {
      get().setSyncStatus("pending");
      await FS.updateMember(activeGroupId, memberId, {
        pendingExemptions: updatedPending,
      });
      get().updateMemberLocal(memberId, {
        pendingExemptions: updatedPending,
      });

      if (entry.createdBy) {
        const requester = members.find((m) => m.userId === entry.createdBy);
        if (requester?.userId) {
          FS.addNotification(
            requester.userId,
            {
              userId: requester.userId,
              groupId: activeGroupId,
              type: "waiver_rejected",
              title: "Waiver Rejected",
              message: `Your ${entry.scope} waiver for ${member.fullName} (${entry.periodStart} → ${entry.periodEnd}) was rejected by ${authName || "an approver"}${reason ? `: ${reason}` : ""}.`,
              read: false,
              metadata: { memberId, exemptionId, reason },
              createdAt: new Date().toISOString(),
            },
            requester.email,
          ).catch(console.warn);
        }
      }

      get().setSyncStatus("synced");
    } catch (e) {
      get().setSyncStatus(
        "failed",
        e instanceof Error ? e.message : "Failed to reject exemption",
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
