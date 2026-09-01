// utils/contributionGoals.ts
//
// Periodic contribution goals — a higher-level savings TARGET a member
// should reach every N months (e.g. 600,000 every 6 months), separate
// from Group.contributionAmount/contributionFrequency (the minimum
// recurring payment, e.g. 50,000/month). A member could reach the goal
// through exactly the minimum × the number of payments in the period, or
// through lump sums, or any mix — this only checks the total reached by
// the end of each period, not how they got there.
//
// Entirely group-configurable (Group.contributionGoalPeriodMonths /
// contributionGoalTargetAmount / contributionGoalAnchorDate) and entirely
// optional — a group that hasn't set these up is simply unaffected;
// nothing here assumes every group wants this feature.
//
// Periods tile forward indefinitely from the anchor date, each exactly
// periodMonths long: [anchor, anchor+N), [anchor+N, anchor+2N), etc. This
// means "how many goals has a member completed this year" falls out of
// simple period math rather than needing a separately-maintained counter
// that could drift out of sync.

import { round2 } from "./theme";
import type { Group, Contribution } from "../types";

export interface ContributionGoalConfig {
  periodMonths: number;
  targetAmount: number;
  anchorDate: string; // ISO date
}

export interface GoalPeriod {
  index: number;        // 0-based, counting forward from the anchor
  start: Date;
  end: Date;             // exclusive
  label: string;         // e.g. "Jan – Jun 2026"
}

export interface GoalPeriodProgress extends GoalPeriod {
  contributed: number;
  target: number;
  met: boolean;
  pctComplete: number;   // 0-100, capped at 100 for display
}

/** Returns the group's goal config if fully set up, otherwise null — the
 *  single place that decides "is this feature configured for this group
 *  at all," so every caller can just check for null once. */
export function getGoalConfig(group: Group | null | undefined): ContributionGoalConfig | null {
  if (!group) return null;
  const { contributionGoalPeriodMonths: periodMonths, contributionGoalTargetAmount: targetAmount, contributionGoalAnchorDate: anchorDate } = group;
  if (!periodMonths || periodMonths < 1) return null;
  if (!targetAmount || targetAmount <= 0) return null;
  if (!anchorDate) return null;
  return { periodMonths, targetAmount, anchorDate };
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatPeriodLabel(start: Date, end: Date): string {
  const endInclusive = new Date(end);
  endInclusive.setDate(endInclusive.getDate() - 1);
  const sameYear = start.getFullYear() === endInclusive.getFullYear();
  const startFmt = start.toLocaleDateString("en-GB", { month: "short", year: sameYear ? undefined : "numeric" });
  const endFmt = endInclusive.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return `${startFmt} – ${endFmt}`;
}

/** Every period from the anchor date up through (and including) the
 *  period containing `asOf`. Index 0 is the very first period. */
export function getGoalPeriods(config: ContributionGoalConfig, asOf: Date = new Date()): GoalPeriod[] {
  const anchor = new Date(config.anchorDate);
  const periods: GoalPeriod[] = [];
  let index = 0;
  let start = anchor;

  // Guard against a misconfigured future anchor date or a runaway loop —
  // this is UI-triggered, on-demand math, not a background job, so a
  // sane upper bound (100 years of periods) is plenty and cheap to check.
  while (start <= asOf && index < 1200) {
    const end = addMonths(start, config.periodMonths);
    periods.push({ index, start, end, label: formatPeriodLabel(start, end) });
    if (end > asOf) break;
    start = end;
    index++;
  }

  return periods;
}

/** The single period `asOf` currently falls inside, or null if `asOf` is
 *  before the anchor date (goal not active yet). */
export function getCurrentGoalPeriod(config: ContributionGoalConfig, asOf: Date = new Date()): GoalPeriod | null {
  const periods = getGoalPeriods(config, asOf);
  return periods.length > 0 ? periods[periods.length - 1] : null;
}

/** Sums a member's APPROVED regular contributions falling within
 *  [period.start, period.end) — matches the same "approved" gate used
 *  everywhere else contribution totals are computed. Only
 *  contributionType "regular" counts toward the goal — loan repayments,
 *  investment funding, and penalty/late-fee entries that flow through
 *  the same Contribution collection are a different kind of money and
 *  shouldn't count as "savings toward the goal." */
export function sumContributionsInPeriod(
  contributions: Contribution[],
  memberId: string,
  period: { start: Date; end: Date },
): number {
  return round2(
    contributions
      .filter((c) =>
        c.memberId === memberId &&
        c.status === "approved" &&
        c.contributionType === "regular" &&
        new Date(c.date) >= period.start &&
        new Date(c.date) < period.end
      )
      .reduce((sum, c) => sum + c.amount, 0)
  );
}

/** Full progress picture for one member across every period so far,
 *  most recent first. Use periods[0] for "current period status," and
 *  periods.filter(p => p.met).length for "goals completed" (e.g. "2
 *  goals completed this year" falls out of filtering by calendar year
 *  on top of this). */
export function getMemberGoalProgress(
  group: Group | null | undefined,
  contributions: Contribution[],
  memberId: string,
  asOf: Date = new Date(),
): GoalPeriodProgress[] {
  const config = getGoalConfig(group);
  if (!config) return [];

  const periods = getGoalPeriods(config, asOf);
  return periods
    .map((period) => {
      const contributed = sumContributionsInPeriod(contributions, memberId, period);
      const pctComplete = config.targetAmount > 0 ? Math.min(100, round2((contributed / config.targetAmount) * 100)) : 0;
      return {
        ...period,
        contributed,
        target: config.targetAmount,
        met: contributed >= config.targetAmount,
        pctComplete,
      };
    })
    .reverse(); // most recent period first
}
