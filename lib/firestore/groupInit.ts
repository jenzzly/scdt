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
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) {
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
  } catch (error) {
    console.error("[initGroupData] Group error:", error);
  }

  const memberRef = doc(db, "groups", groupId, "members", userId);
  try {
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      const membersQuery = query(
        membersCol(groupId),
        where("email", "==", email.toLowerCase()),
        limit(1)
      );
      const existingMemberSnap = await getDocs(membersQuery);
      
      if (!existingMemberSnap.empty) {
        const existingDoc = existingMemberSnap.docs[0];
        await updateDoc(doc(membersCol(groupId), existingDoc.id), {
          userId: userId,
          updatedAt: now,
        });
      } else {
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

