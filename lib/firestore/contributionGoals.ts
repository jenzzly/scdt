// lib/firestore/contributionGoals.ts
//
// Goal period computation — CLIENT-SIDE.
//
// Historical context: this module used to read and write a Firestore
// subcollection (groups/{id}/contributionGoalPeriods), creating a
// "current period" doc lazily on first read. That approach had three
// problems:
//
//   1. Every getCurrentGoalPeriod call fired a read, and sometimes a
//      write — a "read" endpoint with a side effect.
//   2. Two devices reading at the same time could both create a
//      period doc, producing duplicates.
//   3. The doc could disagree with the group's own goal config if the
//      admin changed the anchor date mid-period, because the doc was
//      never reconciled against the new config.
//
// Goal periods are entirely determined by (anchorDate, periodMonths),
// so they can be computed deterministically from the group doc without
// any persistence at all. This module does exactly that.

import { getDoc, groupDoc, fromSnap } from "./core";
import type { ContributionGoalPeriod, Group } from "../../types";

export function computeCurrentGoalPeriod(
  group: Group | null | undefined,
  asOf: Date = new Date(),
): ContributionGoalPeriod | null {
  if (!group) return null;

  const periodMonths = group.contributionGoalPeriodMonths;
  const targetAmount = group.contributionGoalTargetAmount;
  const anchorYmd =
    group.contributionGoalAnchorDate || group.financialYearStartDate;

  if (!periodMonths || periodMonths < 1) return null;
  if (!targetAmount || targetAmount <= 0) return null;
  if (!anchorYmd) return null;

  const anchor = new Date(anchorYmd);
  if (Number.isNaN(anchor.getTime())) return null;
  anchor.setHours(0, 0, 0, 0);

  const now = new Date(asOf);
  now.setHours(0, 0, 0, 0);

  const monthsSinceAnchor =
    (now.getFullYear() - anchor.getFullYear()) * 12 +
    (now.getMonth() - anchor.getMonth());

  const periodIndex = Math.max(
    0,
    Math.floor(monthsSinceAnchor / periodMonths),
  );

  const periodStart = new Date(anchor);
  periodStart.setMonth(periodStart.getMonth() + periodIndex * periodMonths);
  periodStart.setHours(0, 0, 0, 0);

  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
  periodEnd.setDate(periodEnd.getDate() - 1);
  periodEnd.setHours(23, 59, 59, 999);

  return {
    id: `computed-${group.id}-${periodStart.toISOString().slice(0, 10)}`,
    groupId: group.id,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    targetAmount,
    minimumContribution: group.contributionAmount ?? 0,
    status: "active",
    createdAt: periodStart.toISOString(),
  };
}

export async function getCurrentGoalPeriod(
  groupId: string,
): Promise<ContributionGoalPeriod | null> {
  const snap = await getDoc(groupDoc(groupId));
  if (!snap.exists()) return null;
  return computeCurrentGoalPeriod(fromSnap<Group>(snap));
}
