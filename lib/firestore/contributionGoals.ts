// lib/firestore/contributionGoals.ts
//
// Contribution goal management and period calculations
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, writeBatch, collection, limit,
  db, auth,
  groupsCol, contribsCol, auditCol,
  getCurrentUserInfo, logError, stripUndefined, fromSnap, round2, getMembershipId,
} from "./core";
import type { ContributionGoalConfig, ContributionGoalPeriod, Contribution, Group } from "../../types";
import { writeAuditLog } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Contribution Goal Period Management
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentGoalPeriod(groupId: string): Promise<ContributionGoalPeriod | null> {
  try {
    const groupRef = doc(groupsCol, groupId);
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) return null;

    const group = fromSnap<Group>(groupSnap);
    if (!group.contributionGoal?.enabled) return null;

    const now = new Date();
    const goalConfig = group.contributionGoal;

    // Find the current active period
    const periodsCol = collection(db, "groups", groupId, "contributionGoalPeriods");
    const activePeriodQuery = query(
      periodsCol,
      where("status", "==", "active"),
      orderBy("periodStart", "desc"),
      limit(1)
    );
    const activePeriodSnap = await getDocs(activePeriodQuery);

    if (!activePeriodSnap.empty) {
      const period = activePeriodSnap.docs[0].data() as ContributionGoalPeriod;
      // Check if the period is still valid
      const endDate = new Date(period.periodEnd);
      if (now <= endDate) {
        return { ...period, id: activePeriodSnap.docs[0].id };
      }
      // Period has expired, mark it as completed
      await updateGoalPeriodStatus(groupId, period.id, "completed");
    }

    // Create a new period if needed
    return await createNewGoalPeriod(groupId, goalConfig);
  } catch (error) {
    console.error("[getCurrentGoalPeriod] Error:", error);
    return null;
  }
}

export async function createNewGoalPeriod(
  groupId: string,
  config: ContributionGoalConfig
): Promise<ContributionGoalPeriod | null> {
  try {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1); // Start of current month
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + config.periodMonths);
    periodEnd.setDate(periodEnd.getDate() - 1); // End of the period

    const periodsCol = collection(db, "groups", groupId, "contributionGoalPeriods");
    const newPeriodRef = doc(periodsCol);
    const periodId = newPeriodRef.id;

    const newPeriod: ContributionGoalPeriod = {
      id: periodId,
      groupId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      targetAmount: config.targetAmount,
      minimumContribution: config.minimumContribution,
      status: "active",
      createdAt: now.toISOString(),
    };

    await setDoc(newPeriodRef, newPeriod);

    return newPeriod;
  } catch (error) {
    console.error("[createNewGoalPeriod] Error:", error);
    return null;
  }
}

export async function updateGoalPeriodStatus(
  groupId: string,
  periodId: string,
  status: "active" | "completed" | "expired"
): Promise<void> {
  try {
    const periodRef = doc(db, "groups", groupId, "contributionGoalPeriods", periodId);
    const updateData: Partial<ContributionGoalPeriod> = {
      status,
    };
    if (status === "completed") {
      updateData.completedAt = new Date().toISOString();
    }
    await updateDoc(periodRef, stripUndefined(updateData as any));
  } catch (error) {
    console.error("[updateGoalPeriodStatus] Error:", error);
    throw error;
  }
}

export async function getMemberGoalProgress(
  groupId: string,
  memberId: string,
  periodId?: string
): Promise<{
  targetAmount: number;
  contributedAmount: number;
  remainingAmount: number;
  percentage: number;
  isAchieved: boolean;
  period: ContributionGoalPeriod | null;
}> {
  try {
    const period = periodId 
      ? await getGoalPeriodById(groupId, periodId)
      : await getCurrentGoalPeriod(groupId);

    if (!period) {
      return {
        targetAmount: 0,
        contributedAmount: 0,
        remainingAmount: 0,
        percentage: 0,
        isAchieved: false,
        period: null,
      };
    }

    // Get contributions for this member within the period
    const contribsQuery = query(
      contribsCol(groupId),
      where("memberId", "==", memberId),
      where("status", "==", "approved"),
      where("date", ">=", period.periodStart),
      where("date", "<=", period.periodEnd)
    );
    const contribsSnap = await getDocs(contribsQuery);

    const contributedAmount = contribsSnap.docs.reduce((sum, doc) => {
      return sum + (doc.data().amount || 0);
    }, 0);

    const remainingAmount = Math.max(0, period.targetAmount - contributedAmount);
    const percentage = period.targetAmount > 0 
      ? round2((contributedAmount / period.targetAmount) * 100) 
      : 0;
    const isAchieved = contributedAmount >= period.targetAmount;

    return {
      targetAmount: period.targetAmount,
      contributedAmount,
      remainingAmount,
      percentage,
      isAchieved,
      period,
    };
  } catch (error) {
    console.error("[getMemberGoalProgress] Error:", error);
    throw error;
  }
}

export async function getGoalPeriodById(
  groupId: string,
  periodId: string
): Promise<ContributionGoalPeriod | null> {
  try {
    const periodRef = doc(db, "groups", groupId, "contributionGoalPeriods", periodId);
    const periodSnap = await getDoc(periodRef);
    if (!periodSnap.exists()) return null;
    return { ...periodSnap.data(), id: periodSnap.id } as ContributionGoalPeriod;
  } catch (error) {
    console.error("[getGoalPeriodById] Error:", error);
    return null;
  }
}

export async function getGoalPeriods(groupId: string): Promise<ContributionGoalPeriod[]> {
  try {
    const periodsCol = collection(db, "groups", groupId, "contributionGoalPeriods");
    const periodsQuery = query(periodsCol, orderBy("periodStart", "desc"));
    const periodsSnap = await getDocs(periodsQuery);
    return periodsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as ContributionGoalPeriod));
  } catch (error) {
    console.error("[getGoalPeriods] Error:", error);
    return [];
  }
}

export async function updateGroupContributionGoal(
  groupId: string,
  config: Partial<ContributionGoalConfig>,
  adminUserId: string,
  adminUserName: string
): Promise<void> {
  try {
    const groupRef = doc(groupsCol, groupId);
    const groupSnap = await getDoc(groupRef);
    if (!groupSnap.exists()) throw new Error("Group not found");

    const currentConfig = groupSnap.data().contributionGoal || { enabled: false };
    const updatedConfig = { ...currentConfig, ...config };

    await updateDoc(groupRef, { contributionGoal: updatedConfig });

    await writeAuditLog(groupId, {
      userId: adminUserId,
      userName: adminUserName,
      groupId,
      action: "updated",
      entityType: "group",
      entityId: groupId,
      before: { contributionGoal: currentConfig },
      after: { contributionGoal: updatedConfig },
      reason: "Updated contribution goal configuration",
    });
  } catch (error) {
    console.error("[updateGroupContributionGoal] Error:", error);
    throw error;
  }
}