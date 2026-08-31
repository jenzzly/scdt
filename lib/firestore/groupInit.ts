// lib/firestore/groupInit.ts
//
// Group bootstrap + bulk-restore logic. initGroupData seeds default
// financial settings for a brand-new group — these defaults now come from
// the per-client BRAND config (see lib/brand.ts) instead of being
// hardcoded, so each white-labeled app seeds sensible client-specific
// defaults instead of always writing "SCDT Savings Group" / RWF.
import {
  doc, getDoc, getDocs, setDoc, updateDoc, query, where, limit, writeBatch,
  db, auth,
  membersCol, groupDoc, contribsCol, loansCol, investCol, walletCol, expensesCol, meetingsCol,
  getMembershipId, stripUndefined,
} from "./core";
import type { Group, Member, Loan, Contribution, Investment, WalletTransaction, Expense, Meeting } from "./core";
import { BRAND } from "../brand";

// ─────────────────────────────────────────────────────────────────────────────
// Group Initialization
// ─────────────────────────────────────────────────────────────────────────────
export async function initGroupData(
  groupId: string,
  userId: string,
  role: string = "member",
): Promise<boolean> {
  if (!groupId || !userId) return false;

  const currentUser = auth.currentUser;
  if (!currentUser) return false;

  const now = new Date().toISOString();
  const email = currentUser.email || "";

  const groupRef = doc(db, "groups", groupId);
  try {
      // Do not pre-read the group: a newly-created group deliberately has no
      // membership yet, so a protected read is denied. A merge write is safe
      // for a founder and preserves existing settings on a retry.
      await setDoc(groupRef, {
        id: groupId,
        name: BRAND.defaultGroupName,
        currency: BRAND.defaultCurrency,
        contributionAmount: BRAND.defaults.contributionAmount,
        contributionFrequency: BRAND.defaults.contributionFrequency,
        contributionDay: BRAND.defaults.contributionDay,
        loanInterestRate: BRAND.defaults.loanInterestRate,
        loanInterestMethod: BRAND.defaults.loanInterestMethod,
        latePenaltyRatePct: BRAND.defaults.latePenaltyRatePct,
        loanInterestRatePeriod: BRAND.defaults.loanInterestRatePeriod,
        absencePenaltyMemberRatePct: BRAND.defaults.absencePenaltyMemberRatePct,
        absencePenaltyOfficerRatePct: BRAND.defaults.absencePenaltyOfficerRatePct,
        createdBy: userId,
        inviteCode: "",
        totalSavings: 0,
        totalLoans: 0,
        availableBalance: 0,
        totalInvestments: 0,
        totalInterestEarned: 0,
        memberCount: 0,
        createdAt: now,
      }, { merge: true });
  } catch (error) {
    console.error("[initGroupData] Group error:", error);
    throw error;
  }

  const memberRef = doc(db, "groups", groupId, "members", userId);
  try {
      await setDoc(memberRef, {
        id: userId,
        groupId: groupId,
        userId: userId,
        fullName: currentUser.displayName || currentUser.email?.split('@')[0] || "Member",
        email: email.toLowerCase(),
        phone: "",
        role: role,
        status: "active",
        dateJoined: now,
        totalContributions: 0,
        totalSavings: 0,
        loanEarnings: 0,
        createdAt: now,
      }, { merge: true });
  } catch (error) {
    console.error("[initGroupData] Member profile error:", error);
    throw error;
  }

  const membershipId = getMembershipId(groupId, userId);
  const membershipRef = doc(db, "groupMemberships", membershipId);
  try {
      await setDoc(membershipRef, {
        id: membershipId,
        groupId: groupId,
        userId: userId,
        memberId: userId,
        role: role,
        status: "active",
        email: email.toLowerCase(),
        createdAt: now,
      }, { merge: true });
  } catch (error) {
    console.error("[initGroupData] Membership error:", error);
    throw error;
  }

  return true;
}

/** Creates a private first group for a newly registered user. */
export async function createFirstGroupForUser(userId: string, name?: string): Promise<string> {
  const groupId = doc(db, "groups").id;
  const created = await initGroupData(groupId, userId, "admin");
  if (!created) throw new Error("Unable to create your first group");
  if (name?.trim()) {
    await updateDoc(doc(db, "groups", groupId), { name: name.trim() });
  }
  return groupId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Restoration (Batched)
// ─────────────────────────────────────────────────────────────────────────────
export async function restoreGroupData(
  gId: string,
  data: {
    group?: Group;
    members?: Member[];
    loans?: Loan[];
    contributions?: Contribution[];
    investments?: Investment[];
    walletTransactions?: WalletTransaction[];
    expenses?: Expense[];
    meetings?: Meeting[];
  },
): Promise<void> {
  const batch = writeBatch(db);

  if (data.group) {
    batch.set(groupDoc(gId), stripUndefined(data.group as any));
  }
  (data.members        || []).forEach((m) => batch.set(doc(membersCol(gId),  m.id), stripUndefined(m as any)));
  (data.loans          || []).forEach((l) => batch.set(doc(loansCol(gId),    l.id), stripUndefined(l as any)));
  (data.contributions  || []).forEach((c) => batch.set(doc(contribsCol(gId), c.id), stripUndefined(c as any)));
  (data.investments    || []).forEach((i) => batch.set(doc(investCol(gId),   i.id), stripUndefined(i as any)));
  (data.walletTransactions || []).forEach((w) => batch.set(doc(walletCol(gId), w.id), stripUndefined(w as any)));
  (data.expenses       || []).forEach((e) => batch.set(doc(expensesCol(gId), e.id), stripUndefined(e as any)));
  (data.meetings       || []).forEach((m) => batch.set(doc(meetingsCol(gId), m.id), stripUndefined(m as any)));

  await batch.commit();
}
