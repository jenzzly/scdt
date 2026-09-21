// stores/slices/contributionSlice.ts
import type { SetFn, GetFn, StoreState } from "../storeTypes";
import type {
  ID,
  Contribution,
  ContributionType,
  ContributionStatus,
  WalletTransaction,
  Member,
} from "../../types";
import * as FS from "../../lib/firestore";
import { uid } from "../../utils/theme";
import { recalcGroupTotals } from "../recalcGroupTotals";
import {
  findContributionWalletTx,
  buildLinkedTxPatch,
} from "../../utils/linkedWalletSync";

// ─────────────────────────────────────────────────────────────────────────
// Bulk-import parsing helpers
//
// All at module scope so they're created once and can't hold onto stale
// state. None of them touch the store.
// ─────────────────────────────────────────────────────────────────────────

// Reverse of the export-side TYPE_LABELS map in contributions.tsx. Keys
// are whitespace-normalized lowercase versions of the export labels, so
// a spreadsheet that capitalizes differently still matches.
const TYPE_KEY_FROM_LABEL: Record<string, ContributionType> = {
  "regular": "regular",
  "loan repayment": "loan_repayment",
  "loan interest": "loan_interest",
  "late fee": "late_fee",
  "investment funding": "investment_funding",
  "investment return": "investment_return",
  "penalty": "penalty",
  "other": "other",
};

// Also accept the raw enum values themselves, in case a user hand-edits
// the file and types "loan_repayment" instead of "Loan Repayment".
const RAW_TYPE_KEYS: ContributionType[] = [
  "regular",
  "loan_repayment",
  "loan_interest",
  "late_fee",
  "investment_funding",
  "investment_return",
  "penalty",
  "other",
];

const VALID_STATUSES: ContributionStatus[] = ["approved", "pending", "rejected"];

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseType(raw: string): ContributionType | null {
  if (!raw) return null;
  const normalized = normalizeKey(raw);
  const asEnum = raw.trim().toLowerCase() as ContributionType;
  if (RAW_TYPE_KEYS.includes(asEnum)) return asEnum;
  return TYPE_KEY_FROM_LABEL[normalized] ?? null;
}

function parseStatus(raw: string): ContributionStatus {
  const s = raw.trim().toLowerCase();
  return (VALID_STATUSES as string[]).includes(s)
    ? (s as ContributionStatus)
    : "pending";
}

function parseAmount(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Tolerant of the shapes Excel and users throw at us: ISO
// (2026-09-15 or 2026-09-15T00:00:00Z), en-GB (15 Sep 2026),
// US (9/15/2026), and JavaScript Date objects.
function parseDate(raw: any): string | null {
  if (raw == null || raw === "") return null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Fast-path ISO date or datetime
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) {
    const [, y, mo, d] = isoMatch;
    const yNum = Number(y);
    const moNum = Number(mo) - 1;
    const dNum = Number(d);
    const dt = new Date(yNum, moNum, dNum);
    if (
      dt.getFullYear() === yNum &&
      dt.getMonth() === moNum &&
      dt.getDate() === dNum
    ) {
      return `${y}-${mo}-${d}`;
    }
  }

  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }

  return null;
}

// Match a member from the text produced by the export (full name) or
// hand-typed by the user (name, email, member id, or Firebase userId).
function findMember(raw: string, members: Member[]): Member | null {
  if (!raw) return null;
  const needle = raw.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();

  return (
    members.find((x) => x.fullName === needle) ||
    members.find((x) => x.fullName?.toLowerCase() === lower) ||
    members.find((x) => x.email?.toLowerCase() === lower) ||
    members.find((x) => x.id === needle) ||
    members.find((x) => x.userId === needle) ||
    null
  );
}

// One row (excluding a possible header) → a Contribution payload + its
// resolved status, or an error string. Column order:
//   [0] Date  [1] Member  [2] Type  [3] Amount  [4] Status  [5] Description
// Extra columns beyond index 5 are ignored.
function parseContributionRow(
  row: any[],
  members: Member[],
  groupId: ID,
): { contribution: Omit<Contribution, "id" | "createdAt">; status: ContributionStatus } | { error: string } {
  if (!Array.isArray(row)) return { error: "Row is not an array" };

  const dateRaw = row[0];
  const memberRaw = row[1];
  const typeRaw = row[2];
  const amountRaw = row[3];
  const statusRaw = row[4];
  const descRaw = row[5];

  const date = parseDate(dateRaw);
  if (!date) return { error: `Unreadable date: "${String(dateRaw ?? "")}"` };

  const member = findMember(String(memberRaw ?? ""), members);
  if (!member) return { error: `Unknown member: "${String(memberRaw ?? "")}"` };

  const type = parseType(String(typeRaw ?? ""));
  if (!type) return { error: `Unknown type: "${String(typeRaw ?? "")}"` };

  const amount = parseAmount(amountRaw);
  if (amount == null) return { error: `Invalid amount: "${String(amountRaw ?? "")}"` };

  const status = parseStatus(String(statusRaw ?? "pending"));

  return {
    contribution: {
      groupId,
      memberId: member.id,
      amount,
      date,
      status,
      contributionType: type,
      description:
        typeof descRaw === "string" && descRaw.trim()
          ? descRaw.trim()
          : undefined,
    } as any,
    status,
  };
}

// Skip a leading header row — the export produces one and users often
// re-import the file straight from the export without deleting it.
function looksLikeHeader(row: any[]): boolean {
  if (!Array.isArray(row) || row.length === 0) return false;
  return String(row[0] ?? "").trim().toLowerCase() === "date";
}

// ─────────────────────────────────────────────────────────────────────────

export const createContributionSlice = (set: SetFn, get: GetFn): Pick<StoreState, "addContributionLocal" | "approveContribution" | "bulkImportContributions" | "deleteContribution" | "deleteContributionLocal" | "recordContribution" | "rejectContribution" | "setContributions" | "updateContribution" | "updateContributionAndSync" | "updateContributionLocal"> => ({
      setContributions: (cs) => set({ contributions: cs }),
      addContributionLocal: (c) => set((s) => ({ contributions: [c, ...s.contributions] })),
      updateContributionLocal: (id, data) => set((s) => ({
        contributions: s.contributions.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })),
      deleteContributionLocal: (id) => set((s) => ({ contributions: s.contributions.filter((c) => c.id !== id) })),

      deleteContribution: async (contributionId: ID, reason: string) => {
        const { activeGroupId, contributions, walletTransactions, members, authName } = get();
        if (!activeGroupId) throw new Error("No active group");

        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");

        const previousContributions = [...contributions];
        const previousWalletTxs = [...walletTransactions];

        get().deleteContributionLocal(contributionId);

        const associatedTxs = walletTransactions.filter(tx => tx.contributionId === contributionId);
        associatedTxs.forEach(tx => {
          get().deleteWalletTxLocal(tx.id);
        });

        try {
          get().setSyncStatus("pending");
          await FS.deleteContributionWithRelations(activeGroupId, contributionId, reason);
          get().recalcTotals();
          get().setSyncStatus("synced");

          const submitter = members.find((m) => m.id === contribution.memberId);
          if (submitter?.userId) {
            FS.addNotification(submitter.userId, {
              userId: submitter.userId,
              groupId: activeGroupId,
              type: "contribution_deleted",
              title: "Contribution Removed",
              message: `Your contribution of ${contribution.amount} RWF was removed by ${authName || "an admin"}${reason ? `: ${reason}` : ""}`,
              read: false,
              metadata: { contributionId, reason },
              createdAt: new Date().toISOString(),
            }, submitter.email).catch(console.warn);
          }
        } catch (e) {
          set((s) => ({
            contributions: previousContributions,
            walletTransactions: previousWalletTxs,
            ...recalcGroupTotals({ ...s, contributions: previousContributions, walletTransactions: previousWalletTxs })
          }));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to delete contribution");
          throw e;
        }
      },

      // ── Wallet Actions ───────────────────────────────────────────────────────
      recordContribution: async (data, autoApprove = true) => {
        const { activeGroupId, members } = get();
        if (!activeGroupId) throw new Error("No active group");
        const now = new Date().toISOString();
        const status = autoApprove ? "approved" : "pending";
        const contribution: Contribution = { ...data, id: uid(), status, createdAt: now };

        get().addContributionLocal(contribution);
        set((s) => recalcGroupTotals(s));

        try {
          get().setSyncStatus("pending");
          await FS.addContribution(activeGroupId, { ...data, id: contribution.id, status, createdAt: now });

          if (autoApprove) {
            const tx: WalletTransaction = {
              id: uid(),
              groupId: activeGroupId,
              type: "contribution",
              sourceType: "contribution" as const,
              sourceId: contribution.id,
              amount: data.amount,
              description: data.description || "Contribution",
              date: data.date,
              memberId: data.memberId,
              contributionId: contribution.id,
              createdAt: now,
            };
            get().addWalletTxLocal(tx);
            FS.addWalletTx(activeGroupId, tx).catch(console.warn);
          } else {
            // Needs approval — notify whoever can approve contributions:
            // admin, accountant, and loan_officer always can (see
            // firestore rules canApproveContributions); committee only
            // with an explicit permission, which isn't checked here
            // since it's a per-member flag rather than a role — the
            // small risk of notifying a committee member who then
            // can't actually act is preferable to silently notifying
            // no one when a committee member DOES have the permission.
            const submitter = members.find((m) => m.id === data.memberId);
            const approvers = members.filter(
              (m) =>
                m.groupId === activeGroupId &&
                m.status === "active" &&
                ["admin", "accountant", "loan_officer"].includes(m.role) &&
                !!m.userId
            );
            for (const approver of approvers) {
              FS.addNotification(approver.userId!, {
                userId: approver.userId!,
                groupId: activeGroupId,
                type: "contribution_pending",
                title: "New Contribution Awaiting Approval",
                message: `${submitter?.fullName ?? "A member"} submitted a contribution of ${data.amount} RWF`,
                read: false,
                metadata: { contributionId: contribution.id },
                createdAt: now,
              }, approver.email).catch(console.warn);
            }
          }

          get().setSyncStatus("synced");
        } catch (e) {
          get().updateContributionLocal(contribution.id, { status: "pending" });
          set((s) => recalcGroupTotals(s));
          get().setSyncStatus("failed", e instanceof Error ? e.message : "Failed to record contribution");
          throw e;
        }

        return contribution.id;
      },

      approveContribution: async (contributionId) => {
        const { activeGroupId, contributions, members } = get();
        if (!activeGroupId) return;
        const c = contributions.find((x) => x.id === contributionId);
        if (!c) return;
        get().updateContributionLocal(contributionId, { status: "approved" });
        const tx: WalletTransaction = {
          id: uid(),
          groupId: activeGroupId,
          type: "contribution",
          amount: c.amount,
          description: c.description || "Contribution",
          date: c.date,
          memberId: c.memberId,
          contributionId: c.id,
          createdAt: new Date().toISOString(),
        };
        get().addWalletTxLocal(tx);
        set((s) => recalcGroupTotals(s));
        FS.updateContribution(activeGroupId, contributionId, { status: "approved" }).catch(console.warn);
        FS.addWalletTx(activeGroupId, tx).catch(console.warn);

        const submitter = members.find((m) => m.id === c.memberId);
        if (submitter?.userId) {
          FS.addNotification(submitter.userId, {
            userId: submitter.userId,
            groupId: activeGroupId,
            type: "contribution_approved",
            title: "Contribution Approved",
            message: `Your contribution of ${c.amount} RWF has been approved`,
            read: false,
            metadata: { contributionId },
            createdAt: new Date().toISOString(),
          }, submitter.email).catch(console.warn);
        }
      },

      rejectContribution: async (contributionId, reason) => {
        const { activeGroupId, contributions, members } = get();
        get().updateContributionLocal(contributionId, { status: "rejected", rejectionReason: reason });
        if (activeGroupId) {
          FS.updateContribution(activeGroupId, contributionId, {
            status: "rejected",
            rejectionReason: reason,
          }).catch(console.warn);
        }

        const c = contributions.find((x) => x.id === contributionId);
        const submitter = c ? members.find((m) => m.id === c.memberId) : undefined;
        if (activeGroupId && submitter?.userId && c) {
          FS.addNotification(submitter.userId, {
            userId: submitter.userId,
            groupId: activeGroupId,
            type: "contribution_rejected",
            title: "Contribution Rejected",
            message: `Your contribution of ${c.amount} RWF was rejected${reason ? `: ${reason}` : ""}`,
            read: false,
            metadata: { contributionId, rejectionReason: reason },
            createdAt: new Date().toISOString(),
          }, submitter.email).catch(console.warn);
        }
      },

      updateContribution: async (contributionId, data) => {
        const { activeGroupId, contributions } = get();
        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");
        const prevStatus = contribution.status;
        get().updateContributionLocal(contributionId, data);
        if (activeGroupId) {
          await FS.updateContribution(activeGroupId, contributionId, data).catch(console.warn);
        }
        if (data.status === "approved" && prevStatus !== "approved") {
          const tx: WalletTransaction = {
            id: uid(),
            groupId: activeGroupId!,
            type: "contribution",
            amount: contribution.amount,
            description: contribution.description || "Contribution",
            date: contribution.date,
            memberId: contribution.memberId,
            contributionId: contribution.id,
            createdAt: new Date().toISOString(),
          };
          get().addWalletTxLocal(tx);
          if (activeGroupId) {
            FS.addWalletTx(activeGroupId, tx).catch(console.warn);
          }
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // EDIT CONTRIBUTION + SYNC LINKED WALLET TX
      // ═══════════════════════════════════════════════════════════════════════
      //
      // Distinct from `updateContribution` above (which is a general-purpose
      // patch used for status transitions and doesn't touch amount/date of
      // an existing linked tx). This is specifically the "user edited the
      // contribution's amount/date/description in a form" path — it:
      //
      //   1. Updates the Contribution record itself.
      //   2. If an approved contribution has a linked wallet tx
      //      (type: "contribution", contributionId match), patches that
      //      tx's amount/date/description to match.
      //   3. Rolls back BOTH writes if either Firestore call fails, so the
      //      contribution and its wallet tx never drift out of sync.
      //
      // Only amount / date / description are accepted here — matches the
      // same restriction edit-transaction.tsx enforces for direct wallet
      // edits, and avoids the more complex status-transition logic that
      // `updateContribution` already owns.
      updateContributionAndSync: async (contributionId, data) => {
        const { activeGroupId, contributions, walletTransactions } = get();
        if (!activeGroupId) throw new Error("No active group");

        const contribution = contributions.find((c) => c.id === contributionId);
        if (!contribution) throw new Error("Contribution not found");

        const allowed: Partial<Pick<Contribution, "amount" | "date" | "description">> = {};
        if (data.amount !== undefined) allowed.amount = data.amount;
        if (data.date !== undefined) allowed.date = data.date;
        if (data.description !== undefined) allowed.description = data.description;

        const previousContribution = { ...contribution };
        const linkedTx = findContributionWalletTx(walletTransactions, contributionId);
        const previousTx = linkedTx ? { ...linkedTx } : null;

        // Optimistic local updates.
        get().updateContributionLocal(contributionId, allowed);

        if (linkedTx) {
          const txPatch = buildLinkedTxPatch(linkedTx, allowed);
          get().updateWalletTxLocal(linkedTx.id, txPatch);
        }

        set((s) => recalcGroupTotals(s));

        try {
          get().setSyncStatus("pending");

          await FS.updateContribution(activeGroupId, contributionId, allowed);

          if (linkedTx) {
            const txPatch = buildLinkedTxPatch(linkedTx, allowed);
            await FS.updateWalletTx(activeGroupId, linkedTx.id, txPatch);
          }

          get().recalcTotals();
          get().setSyncStatus("synced");
        } catch (e) {
          // Roll back both records together.
          get().updateContributionLocal(contributionId, previousContribution);
          if (linkedTx && previousTx) {
            get().updateWalletTxLocal(linkedTx.id, previousTx);
          }
          set((s) => recalcGroupTotals(s));

          get().setSyncStatus(
            "failed",
            e instanceof Error ? e.message : "Failed to update contribution"
          );
          throw e;
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // BULK IMPORT CONTRIBUTIONS FROM .XLSX / .CSV
      // ═══════════════════════════════════════════════════════════════════════
      //
      // Expected columns (in order):
      //   Date | Member | Type | Amount | Status | Description
      //
      // Row-level errors are collected and returned rather than aborting
      // the whole import. Approved rows also create the linked wallet
      // transaction so the ledger stays in sync with the contributions
      // list, exactly the way recordContribution / approveContribution
      // maintain the pairing for single rows.
      //
      //   • All contributions are added to the local store in a single
      //     batch, then recalcGroupTotals runs once. Doing this per row
      //     would trigger hundreds of recomputations on a large file.
      //
      //   • Firestore writes happen in parallel via Promise.allSettled,
      //     not sequentially, so a 200-row import doesn't take minutes.
      //
      //   • Any row whose Firestore write fails gets rolled back locally;
      //     the rest of the batch proceeds. A partial import that mostly
      //     succeeds is more useful than an all-or-nothing failure.
      //
      //   • Does NOT notify anyone per row. Importing 500 contributions
      //     would otherwise mean 500 notifications to every approver.
      bulkImportContributions: async (rows, groupId) => {
        const { members } = get();

        if (!groupId) throw new Error("No group id");
        if (!Array.isArray(rows) || rows.length === 0) {
          return { count: 0, skipped: 0, errors: ["File is empty"] };
        }

        const now = new Date().toISOString();

        // ── 1. Parse every row ─────────────────────────────────────────
        const startIndex = looksLikeHeader(rows[0]) ? 1 : 0;
        const errors: string[] = [];
        const toInsert: Array<{
          contribution: Contribution;
          walletTx: WalletTransaction | null;
        }> = [];

        let skipped = 0;

        for (let i = startIndex; i < rows.length; i++) {
          const row = rows[i];

          // Blank row — skip silently, don't count as an error.
          if (
            !Array.isArray(row) ||
            row.every((cell) => cell === "" || cell == null)
          ) {
            continue;
          }

          const parsed = parseContributionRow(row, members, groupId);
          if ("error" in parsed) {
            skipped++;
            if (errors.length < 20) {
              errors.push(`Row ${i + 1}: ${parsed.error}`);
            }
            continue;
          }

          const contribution: Contribution = {
            ...parsed.contribution,
            id: uid(),
            status: parsed.status,
            createdAt: now,
          } as Contribution;

          const walletTx: WalletTransaction | null =
            parsed.status === "approved"
              ? {
                  id: uid(),
                  groupId,
                  type: "contribution",
                  sourceType: "contribution",
                  sourceId: contribution.id,
                  amount: contribution.amount,
                  description: contribution.description || "Contribution",
                  date: contribution.date,
                  memberId: contribution.memberId,
                  contributionId: contribution.id,
                  createdAt: now,
                }
              : null;

          toInsert.push({ contribution, walletTx });
        }

        if (toInsert.length === 0) {
          return {
            count: 0,
            skipped,
            errors: errors.length > 0 ? errors : ["No valid rows found"],
          };
        }

        // ── 2. Apply locally in one shot ───────────────────────────────
        for (const { contribution } of toInsert) {
          get().addContributionLocal(contribution);
        }
        for (const { walletTx } of toInsert) {
          if (walletTx) get().addWalletTxLocal(walletTx);
        }
        set((s) => recalcGroupTotals(s));

        // ── 3. Push to Firestore in parallel ───────────────────────────
        get().setSyncStatus("pending");

        const results = await Promise.allSettled(
          toInsert.map(({ contribution, walletTx }) =>
            (async () => {
              await FS.addContribution(groupId, {
                ...contribution,
                id: contribution.id,
                status: contribution.status,
                createdAt: contribution.createdAt,
              } as any);

              if (walletTx) {
                await FS.addWalletTx(groupId, walletTx as any);
              }
            })(),
          ),
        );

        // ── 4. Roll back individual failures ──────────────────────────
        let count = 0;
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const { contribution, walletTx } = toInsert[i];

          if (r.status === "fulfilled") {
            count++;
            continue;
          }

          get().deleteContributionLocal(contribution.id);
          if (walletTx) {
            get().deleteWalletTxLocal(walletTx.id);
          }

          skipped++;
          if (errors.length < 20) {
            const msg =
              r.reason instanceof Error
                ? r.reason.message
                : String(r.reason ?? "Unknown error");
            errors.push(`Row for ${contribution.date}: ${msg}`);
          }
        }

        set((s) => recalcGroupTotals(s));
        get().recalcTotals();

        if (skipped > 0 && count === 0) {
          get().setSyncStatus("failed", "All rows failed to import");
        } else {
          get().setSyncStatus("synced");
        }

        return { count, skipped, errors };
      },
});