/**
 * Day HUD metrics — capacity + day score for the executive dashboard.
 * Pure TS; uses directive timeline + briefing counts (no task duration estimates yet).
 */

import { fromZonedTime } from 'date-fns-tz';
import type { BriefingReport } from './assistantBriefing';
import type { DirectiveGap, DirectiveReport, TimelineEntry } from './executiveDirective';

const TASK_BLOCK_MINUTES = 30;
const DAY_END_HOUR = 18;

export type DayHudMetrics = {
  dayScore: number;
  dayScoreLabel: 'On track' | 'Busy' | 'Tight' | 'Overloaded';
  /** Minutes from now until profile day-end (18:00). */
  remainingMinutes: number;
  meetingMinutes: number;
  workMinutes: number;
  /** Untimed-today gaps × 30 min — unscheduled work debt. */
  unscheduledMinutes: number;
  bookedMinutes: number;
  capacityRatio: number;
  /** Positive when overcommitted (minutes). */
  overcommitMinutes: number;
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

function entryMinutes(e: TimelineEntry, from: Date, to: Date): number {
  const start = e.start < from ? from : e.start;
  const end = e.end > to ? to : e.end;
  return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
}

function dayEndFromDirective(directive: DirectiveReport): Date {
  return fromZonedTime(
    `${directive.todayIso}T${String(DAY_END_HOUR).padStart(2, '0')}:00:00`,
    directive.timezone,
  );
}

export function computeDayHudMetrics(
  directive: DirectiveReport,
  briefing: BriefingReport | null | undefined,
  now: Date = new Date(),
): DayHudMetrics {
  const dayEnd = dayEndFromDirective(directive);
  const remainingMinutes = Math.max(0, (dayEnd.getTime() - now.getTime()) / 60_000);

  const scheduleEntries = [...directive.timeline];
  let meetingMinutes = 0;
  let workMinutes = 0;

  for (const e of scheduleEntries) {
    if (e.end <= now) continue;
    const mins = entryMinutes(e, now, dayEnd);
    if (e.kind === 'meeting') meetingMinutes += mins;
    else if (e.kind === 'task' || e.kind === 'action' || e.kind === 'suggested') workMinutes += mins;
  }

  const untimedGaps = directive.gaps.filter((g) => g.kind === 'untimed_today');
  const unscheduledMinutes = untimedGaps.length * TASK_BLOCK_MINUTES;
  const bookedMinutes = meetingMinutes + workMinutes + unscheduledMinutes;
  const capacityRatio = remainingMinutes > 0 ? bookedMinutes / remainingMinutes : bookedMinutes > 0 ? 2 : 0;
  const overcommitMinutes = Math.max(0, bookedMinutes - remainingMinutes);

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
  if (capacityRatio > 1) dayScore -= Math.min(30, Math.round((capacityRatio - 1) * 35));
  if (gaps.some((g) => g.kind === 'pick_focus')) dayScore -= 12;
  dayScore = clamp(Math.round(dayScore), 0, 100);

  let dayScoreLabel: DayHudMetrics['dayScoreLabel'] = 'On track';
  if (dayScore < 40) dayScoreLabel = 'Overloaded';
  else if (dayScore < 60) dayScoreLabel = 'Tight';
  else if (dayScore < 80) dayScoreLabel = 'Busy';

  return {
    dayScore,
    dayScoreLabel,
    remainingMinutes,
    meetingMinutes,
    workMinutes,
    unscheduledMinutes,
    bookedMinutes,
    capacityRatio,
    overcommitMinutes,
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
    stale_waiting: 'Waiting',
  };
  return map[kind] ?? kind;
}
