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
// Creates the group document with client-specific (BRAND) defaults if it
// doesn't already exist. Split out from initGroupData below so
// members.ts's ensureMemberExists (the actual registration/login
// bootstrap path — initGroupData itself is not currently called from
// there) can create the group on first-ever signup without duplicating
// this field list a third time. `allow create: if isAuth()` on
// `groups/{groupId}` authorizes this for any signed-in user, which is
// what a genuinely first-ever user needs.
export async function ensureGroupExists(groupId: string, userId: string): Promise<void> {
  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (groupSnap.exists()) return;

  const now = new Date().toISOString();
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
  });
}

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
    await ensureGroupExists(groupId, userId);
  } catch (error) {
    console.error("[initGroupData] Group error:", error);
  }

  const memberRef = doc(db, "groups", groupId, "members", userId);
  try {
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      // No pre-membership email-lookup query here — same reasoning as
      // ensureMemberExists in members.ts: a `list` query against
      // members/{groupId} is rejected by the rules for a user with no
      // membership yet ("rules are not filters; queries are all or
      // nothing" — Firestore evaluates a list rule against the whole
      // potential result set up front, not per document). This
      // function isn't currently called anywhere in the app (the real
      // bootstrap path is ensureMemberExists), but keeping it correct
      // avoids leaving the same landmine here for whoever wires it up
      // later. Admin-invited-member merge is a separate flow, not
      // handled on this path.
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
      });
    }
  } catch (error) {
    console.error("[initGroupData] Member profile error:", error);
  }

  const membershipId = getMembershipId(groupId, userId);
  const membershipRef = doc(db, "groupMemberships", membershipId);
  try {
    const membershipSnap = await getDoc(membershipRef);
    if (!membershipSnap.exists()) {
      await setDoc(membershipRef, {
        id: membershipId,
        groupId: groupId,
        userId: userId,
        memberId: userId,
        role: role,
        status: "active",
        email: email.toLowerCase(),
        createdAt: now,
      });
    }
  } catch (error) {
    console.error("[initGroupData] Membership error:", error);
    throw error;
  }

  return true;
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

