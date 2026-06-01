/**
 * Day HUD metrics — capacity + day score for the executive dashboard.
 * Capacity numbers come from directive.capacity (Phase D estimates).
 */

import type { BriefingReport } from './assistantBriefing';
import type { DirectiveGap, DirectiveReport } from './executiveDirective';

export type { CapacitySnapshot } from './taskCapacity';

export type DayHudMetrics = {
  dayScore: number;
  dayScoreLabel: 'On track' | 'Busy' | 'Tight' | 'Overloaded';
  /** Minutes from now until profile day-end (18:00). */
  remainingMinutes: number;
  meetingMinutes: number;
  workMinutes: number;
  /** Untimed-today work debt (sum of task estimates). */
  unscheduledMinutes: number;
  bookedMinutes: number;
  capacityRatio: number;
  /** Positive when overcommitted (minutes). */
  overcommitMinutes: number;
  explicitEstimateCount: number;
  gapCount: number;
  criticalGapCount: number;
  warningGapCount: number;
  overlapCount: number;
  meetingsToday: number;
  backToBackCount: number;
  criticalTasks: number;
  dueTodayCount: number;
  overdueCount: number;
  owedCount: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function computeDayHudMetrics(
  directive: DirectiveReport,
  briefing: BriefingReport | null | undefined,
): DayHudMetrics {
  const cap = directive.capacity;
  const gaps = directive.gaps;
  const criticalGapCount = gaps.filter((g) => g.severity === 'critical').length;
  const warningGapCount = gaps.filter((g) => g.severity === 'warning').length;
  const overlapCount = gaps.filter((g) => g.kind === 'overlap').length;

  const nuts = briefing?.nuts;
  const overdueCount = nuts?.overdueCount ?? 0;
  const dueTodayCount = nuts?.dueTodayCount ?? 0;
  const criticalTasks = nuts?.criticalTasks ?? 0;
  const meetingsToday = nuts?.todayEventCount ?? 0;
  const backToBackCount = nuts?.backToBackCount ?? 0;
  const owedCount = nuts?.owedToMeCount ?? 0;

  let dayScore = 100;
  dayScore -= Math.min(36, criticalGapCount * 12);
  dayScore -= Math.min(25, warningGapCount * 5);
  dayScore -= Math.min(15, overdueCount * 5);
  dayScore -= Math.min(20, criticalTasks * 4);
  if (cap.capacityRatio > 1) dayScore -= Math.min(30, Math.round((cap.capacityRatio - 1) * 35));
  if (gaps.some((g) => g.kind === 'pick_focus')) dayScore -= 12;
  if (gaps.some((g) => g.kind === 'capacity_overcommit')) dayScore -= 8;
  dayScore = clamp(Math.round(dayScore), 0, 100);

  let dayScoreLabel: DayHudMetrics['dayScoreLabel'] = 'On track';
  if (dayScore < 40) dayScoreLabel = 'Overloaded';
  else if (dayScore < 60) dayScoreLabel = 'Tight';
  else if (dayScore < 80) dayScoreLabel = 'Busy';

  return {
    dayScore,
    dayScoreLabel,
    remainingMinutes: cap.remainingMinutes,
    meetingMinutes: cap.meetingMinutes,
    workMinutes: cap.scheduledWorkMinutes,
    unscheduledMinutes: cap.unscheduledWorkMinutes,
    bookedMinutes: cap.bookedMinutes,
    capacityRatio: cap.capacityRatio,
    overcommitMinutes: cap.overcommitMinutes,
    explicitEstimateCount: cap.explicitEstimateCount,
    gapCount: gaps.length,
    criticalGapCount,
    warningGapCount,
    overlapCount,
    meetingsToday,
    backToBackCount,
    criticalTasks,
    dueTodayCount,
    overdueCount,
    owedCount,
  };
}

export function formatHudHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

export function gapKindLabel(kind: DirectiveGap['kind']): string {
  const map: Record<DirectiveGap['kind'], string> = {
    untimed_today: 'Untimed',
    prep_needed: 'Prep',
    back_to_back: 'Back-to-back',
    meeting_debrief: 'Debrief',
    overlap: 'Conflict',
    no_calendar: 'Calendar',
    pick_focus: 'Focus',
    orphan_followup: 'Follow-up',
    delegation_chase: 'Chase',
    missing_estimate: 'Estimate',
    capacity_overcommit: 'Capacity',
  };
  return map[kind] ?? kind;
}
