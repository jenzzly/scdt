// lib/firestore/contributionGoals.ts
//
// Contribution goal management and period calculations

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  collection,
  limit,
  db,
  groupsCol,
  contribsCol,
  fromSnap,
  round2,
  stripUndefined,
} from "./core";

import type {
  ContributionGoalConfig,
  ContributionGoalPeriod,
  ContributionGoalPeriodStatus,
  Group,
} from "../../types";

import { writeAuditLog } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the contribution-goal configuration from the fields already stored
 * directly on Group.
 *
 * A goal is considered configured when:
 *   - periodMonths >= 1
 *   - targetAmount > 0
 *   - anchorDate exists
 */
function getContributionGoalConfig(
  group: Group
): ContributionGoalConfig | null {
  const periodMonths = group.contributionGoalPeriodMonths;
  const targetAmount = group.contributionGoalTargetAmount;
  const anchorDate = group.contributionGoalAnchorDate;

  if (
    !periodMonths ||
    periodMonths < 1 ||
    !Number.isInteger(periodMonths)
  ) {
    return null;
  }

  if (!targetAmount || targetAmount <= 0) {
    return null;
  }

  if (!anchorDate) {
    return null;
  }

  const anchor = new Date(anchorDate);

  if (Number.isNaN(anchor.getTime())) {
    return null;
  }

  return {
    periodMonths,
    targetAmount,
    anchorDate,
  };
}

/**
 * Calculate which goal period contains the supplied date.
 *
 * Periods are anchored to contributionGoalAnchorDate and tile forward
 * indefinitely in blocks of contributionGoalPeriodMonths.
 *
 * Example:
 *   anchorDate = 2026-01-01
 *   periodMonths = 6
 *
 *   Period 1 = Jan 1 2026 → Jun 30 2026
 *   Period 2 = Jul 1 2026 → Dec 31 2026
 */
function calculateGoalPeriod(
  date: Date,
  config: ContributionGoalConfig
): {
  periodStart: Date;
  periodEnd: Date;
} {
  const anchor = new Date(config.anchorDate);

  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Invalid contribution goal anchor date");
  }

  // Normalize anchor to the beginning of its calendar day.
  anchor.setHours(0, 0, 0, 0);

  // If the requested date is before the anchor, return the first period.
  if (date < anchor) {
    const periodEnd = new Date(anchor);
    periodEnd.setMonth(periodEnd.getMonth() + config.periodMonths);
    periodEnd.setDate(periodEnd.getDate() - 1);
    periodEnd.setHours(23, 59, 59, 999);

    return {
      periodStart: anchor,
      periodEnd,
    };
  }

  // Calculate how many whole months have passed since the anchor.
  const monthsSinceAnchor =
    (date.getFullYear() - anchor.getFullYear()) * 12 +
    (date.getMonth() - anchor.getMonth());

  const periodIndex = Math.floor(
    monthsSinceAnchor / config.periodMonths
  );

  const periodStart = new Date(anchor);
  periodStart.setMonth(
    periodStart.getMonth() + periodIndex * config.periodMonths
  );
  periodStart.setHours(0, 0, 0, 0);

  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(
    periodEnd.getMonth() + config.periodMonths
  );
  periodEnd.setDate(periodEnd.getDate() - 1);
  periodEnd.setHours(23, 59, 59, 999);

  return {
    periodStart,
    periodEnd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contribution Goal Period Management
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentGoalPeriod(
  groupId: string
): Promise<ContributionGoalPeriod | null> {
  try {
    const groupRef = doc(groupsCol, groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      return null;
    }

    const group = fromSnap<Group>(groupSnap);
    const goalConfig = getContributionGoalConfig(group);

    if (!goalConfig) {
      return null;
    }

    const now = new Date();

    const {
      periodStart,
      periodEnd,
    } = calculateGoalPeriod(now, goalConfig);

    const periodsCol = collection(
      db,
      "groups",
      groupId,
      "contributionGoalPeriods"
    );

    // First try to find an already-created period for these exact dates.
    const existingQuery = query(
      periodsCol,
      where("periodStart", "==", periodStart.toISOString()),
      where("periodEnd", "==", periodEnd.toISOString()),
      limit(1)
    );

    const existingSnap = await getDocs(existingQuery);

    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];

      const period = {
        ...existing.data(),
        id: existing.id,
      } as ContributionGoalPeriod;

      // If the period was previously completed/expired, don't recreate it.
      if (period.status !== "active") {
        return period;
      }

      // Make sure an active period hasn't passed its end date.
      if (now <= periodEnd) {
        return period;
      }

      await updateGoalPeriodStatus(
        groupId,
        period.id,
        "completed"
      );

      return {
        ...period,
        status: "completed",
        completedAt: new Date().toISOString(),
      };
    }

    // Create the period if it doesn't exist.
    return await createNewGoalPeriod(
      groupId,
      goalConfig,
      group.contributionAmount,
      periodStart,
      periodEnd
    );
  } catch (error) {
    console.error(
      "[getCurrentGoalPeriod] Error:",
      error
    );

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function createNewGoalPeriod(
  groupId: string,
  config: ContributionGoalConfig,
  minimumContribution: number,
  providedPeriodStart?: Date,
  providedPeriodEnd?: Date
): Promise<ContributionGoalPeriod | null> {
  try {
    const now = new Date();

    const {
      periodStart,
      periodEnd,
    } = providedPeriodStart && providedPeriodEnd
      ? {
          periodStart: providedPeriodStart,
          periodEnd: providedPeriodEnd,
        }
      : calculateGoalPeriod(now, config);

    const periodsCol = collection(
      db,
      "groups",
      groupId,
      "contributionGoalPeriods"
    );

    const newPeriodRef = doc(periodsCol);

    const newPeriod: ContributionGoalPeriod = {
      id: newPeriodRef.id,
      groupId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      targetAmount: config.targetAmount,
      minimumContribution,
      status: "active",
      createdAt: now.toISOString(),
    };

    await setDoc(newPeriodRef, newPeriod);

    return newPeriod;
  } catch (error) {
    console.error(
      "[createNewGoalPeriod] Error:",
      error
    );

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function updateGoalPeriodStatus(
  groupId: string,
  periodId: string,
  status: ContributionGoalPeriodStatus
): Promise<void> {
  try {
    const periodRef = doc(
      db,
      "groups",
      groupId,
      "contributionGoalPeriods",
      periodId
    );

    const updateData: Partial<ContributionGoalPeriod> = {
      status,
    };

    if (status === "completed") {
      updateData.completedAt = new Date().toISOString();
    }

    await updateDoc(
      periodRef,
      stripUndefined(updateData as any)
    );
  } catch (error) {
    console.error(
      "[updateGoalPeriodStatus] Error:",
      error
    );

    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

    const contribsQuery = query(
      contribsCol(groupId),
      where("memberId", "==", memberId),
      where("status", "==", "approved"),
      where("date", ">=", period.periodStart),
      where("date", "<=", period.periodEnd)
    );

    const contribsSnap = await getDocs(contribsQuery);

    const contributedAmount = contribsSnap.docs.reduce(
      (sum, contributionDoc) => {
        return sum + (contributionDoc.data().amount || 0);
      },
      0
    );

    const remainingAmount = Math.max(
      0,
      period.targetAmount - contributedAmount
    );

    const percentage =
      period.targetAmount > 0
        ? round2(
            (contributedAmount / period.targetAmount) * 100
          )
        : 0;

    const isAchieved =
      contributedAmount >= period.targetAmount;

    return {
      targetAmount: period.targetAmount,
      contributedAmount,
      remainingAmount,
      percentage,
      isAchieved,
      period,
    };
  } catch (error) {
    console.error(
      "[getMemberGoalProgress] Error:",
      error
    );

    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getGoalPeriodById(
  groupId: string,
  periodId: string
): Promise<ContributionGoalPeriod | null> {
  try {
    const periodRef = doc(
      db,
      "groups",
      groupId,
      "contributionGoalPeriods",
      periodId
    );

    const periodSnap = await getDoc(periodRef);

    if (!periodSnap.exists()) {
      return null;
    }

    return {
      ...periodSnap.data(),
      id: periodSnap.id,
    } as ContributionGoalPeriod;
  } catch (error) {
    console.error(
      "[getGoalPeriodById] Error:",
      error
    );

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getGoalPeriods(
  groupId: string
): Promise<ContributionGoalPeriod[]> {
  try {
    const periodsCol = collection(
      db,
      "groups",
      groupId,
      "contributionGoalPeriods"
    );

    const periodsQuery = query(
      periodsCol,
      orderBy("periodStart", "desc")
    );

    const periodsSnap = await getDocs(periodsQuery);

    return periodsSnap.docs.map((periodDoc) => ({
      ...periodDoc.data(),
      id: periodDoc.id,
    })) as ContributionGoalPeriod[];
  } catch (error) {
    console.error(
      "[getGoalPeriods] Error:",
      error
    );

    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group Contribution Goal Configuration
// ─────────────────────────────────────────────────────────────────────────────

export async function updateGroupContributionGoal(
  groupId: string,
  config: Partial<ContributionGoalConfig>,
  adminUserId: string,
  adminUserName: string
): Promise<void> {
  try {
    const groupRef = doc(groupsCol, groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      throw new Error("Group not found");
    }

    const group = fromSnap<Group>(groupSnap);

    const before = {
      periodMonths:
        group.contributionGoalPeriodMonths,
      targetAmount:
        group.contributionGoalTargetAmount,
      anchorDate:
        group.contributionGoalAnchorDate,
    };

    const updatedPeriodMonths =
      config.periodMonths ??
      group.contributionGoalPeriodMonths;

    const updatedTargetAmount =
      config.targetAmount ??
      group.contributionGoalTargetAmount;

    const updatedAnchorDate =
      config.anchorDate ??
      group.contributionGoalAnchorDate;

    /*
     * If any of the three goal fields are intentionally being cleared,
     * remove the entire goal configuration.
     */
    const isClearingGoal =
      config.periodMonths === undefined &&
      config.targetAmount === undefined &&
      config.anchorDate === undefined;

    if (isClearingGoal) {
      await updateDoc(groupRef, {
        contributionGoalPeriodMonths: null,
        contributionGoalTargetAmount: null,
        contributionGoalAnchorDate: null,
      });
    } else {
      if (
        updatedPeriodMonths !== undefined &&
        (
          !Number.isInteger(updatedPeriodMonths) ||
          updatedPeriodMonths < 1
        )
      ) {
        throw new Error(
          "Contribution goal period must be a whole number greater than or equal to 1."
        );
      }

      if (
        updatedTargetAmount !== undefined &&
        updatedTargetAmount <= 0
      ) {
        throw new Error(
          "Contribution goal target amount must be greater than 0."
        );
      }

      if (updatedAnchorDate !== undefined) {
        const anchor = new Date(updatedAnchorDate);

        if (Number.isNaN(anchor.getTime())) {
          throw new Error(
            "Contribution goal anchor date is invalid."
          );
        }
      }

      await updateDoc(groupRef, {
        contributionGoalPeriodMonths:
          updatedPeriodMonths ?? null,

        contributionGoalTargetAmount:
          updatedTargetAmount ?? null,

        contributionGoalAnchorDate:
          updatedAnchorDate ?? null,
      });
    }

    const after = {
      periodMonths: isClearingGoal
        ? undefined
        : updatedPeriodMonths,

      targetAmount: isClearingGoal
        ? undefined
        : updatedTargetAmount,

      anchorDate: isClearingGoal
        ? undefined
        : updatedAnchorDate,
    };

    await writeAuditLog(groupId, {
      userId: adminUserId,
      userName: adminUserName,
      groupId,
      action: "updated",
      entityType: "group",
      entityId: groupId,
      before: {
        contributionGoal: before,
      },
      after: {
        contributionGoal: after,
      },
      reason:
        isClearingGoal
          ? "Disabled contribution goal configuration"
          : "Updated contribution goal configuration",
    });
  } catch (error) {
    console.error(
      "[updateGroupContributionGoal] Error:",
      error
    );

    throw error;
  }
}