/**
 * Calendar free-gap detection — shared by the directive engine and snooze-until-free.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { dedupeOccurrences, generateOccurrences } from './recurrence';
import { workMinutesForItem } from './taskCapacity';
import { normalizeDueTime } from './taskSchedule';
import { DEBRIEF_SNOOZE_MS } from './meetingDebrief';
import type { Event, Task } from '../types';
import type { MeetingRule } from './meetingTemperament';

export const SCHEDULE_MIN_GAP_MS = 20 * 60 * 1000;
export const EXECUTIVE_DAY_END_HOUR = 17;
const SNOOZE_UNTIL_FREE_MIN_MS = 60 * 1000;

export type BusyInterval = { start: Date; end: Date };

export type ScheduleAvailabilityInput = {
  now?: Date;
  timezone: string;
  events: Event[];
  tasks: Task[];
  meetingRules?: MeetingRule[];
};

export function executiveDayBounds(
  now: Date,
  tz: string,
): { start: Date; end: Date; todayIso: string } {
  const todayIso = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const start = fromZonedTime(`${todayIso}T00:00:00`, tz);
  const end = fromZonedTime(
    `${todayIso}T${String(EXECUTIVE_DAY_END_HOUR).padStart(2, '0')}:00:00`,
    tz,
  );
  return { start, end, todayIso };
}

export function findFreeGaps(
  now: Date,
  dayEnd: Date,
  busy: BusyInterval[],
): BusyInterval[] {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const gaps: BusyInterval[] = [];
  let cursor = now.getTime() < dayEnd.getTime() ? now : dayEnd;

  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) {
      const gapEnd = b.start.getTime() < dayEnd.getTime() ? b.start : dayEnd;
      if (gapEnd.getTime() - cursor.getTime() >= SCHEDULE_MIN_GAP_MS) {
        gaps.push({ start: new Date(cursor), end: gapEnd });
      }
    }
    if (b.end > cursor) cursor = b.end;
  }
  if (dayEnd.getTime() - cursor.getTime() >= SCHEDULE_MIN_GAP_MS) {
    gaps.push({ start: new Date(cursor), end: dayEnd });
  }
  return gaps;
}

export function isInFreeGap(now: Date, dayEnd: Date, busy: BusyInterval[]): boolean {
  return findFreeGaps(now, dayEnd, busy).some((g) => now >= g.start && now < g.end);
}

function zonedInstant(isoDate: string, time: string, tz: string): Date {
  const t = normalizeDueTime(time) ?? '09:00';
  return fromZonedTime(`${isoDate}T${t}:00`, tz);
}

function isDueTodayOrOverdue(dueDate: string | null, todayIso: string): boolean {
  if (!dueDate) return false;
  return dueDate <= todayIso;
}

/** Meetings + timed tasks due today — same busy picture as the directive timeline. */
export function buildDayBusyIntervals(input: ScheduleAvailabilityInput): BusyInterval[] {
  const now = input.now ?? new Date();
  const tz = input.timezone;
  const { start: dayStart, todayIso } = executiveDayBounds(now, tz);
  const dayEndExclusive = new Date(dayStart);
  dayEndExclusive.setDate(dayEndExclusive.getDate() + 1);

  const meetings = dedupeOccurrences(
    input.events.flatMap((e) => generateOccurrences(e, dayStart, dayEndExclusive, { limit: 50 })),
  );

  const busy: BusyInterval[] = meetings.map((o) => ({ start: o.start, end: o.end }));

  for (const t of input.tasks) {
    if (t.done || !t.due_date || !t.due_time) continue;
    if (t.due_date !== todayIso && !isDueTodayOrOverdue(t.due_date, todayIso)) continue;
    const start = zonedInstant(t.due_date, t.due_time, tz);
    const blockMins = workMinutesForItem('task', t.id, input.tasks);
    busy.push({ start, end: new Date(start.getTime() + blockMins * 60_000) });
  }

  return busy;
}

/** ISO timestamp for the next open calendar block (≥20 min), or +24h if none left today. */
export function snoozeUntilFreeIso(input: ScheduleAvailabilityInput): string {
  const now = input.now ?? new Date();
  const { end: dayEnd } = executiveDayBounds(now, input.timezone);
  const busy = buildDayBusyIntervals(input);
  const gaps = findFreeGaps(now, dayEnd, busy);
  const minFutureMs = now.getTime() + SNOOZE_UNTIL_FREE_MIN_MS;

  for (const gap of gaps) {
    const startMs = Math.max(gap.start.getTime(), minFutureMs);
    const remaining = gap.end.getTime() - startMs;
    if (remaining >= SCHEDULE_MIN_GAP_MS) {
      return new Date(startMs).toISOString();
    }
  }

  return new Date(now.getTime() + DEBRIEF_SNOOZE_MS).toISOString();
}

export function scheduleContext(input: ScheduleAvailabilityInput): {
  dayEnd: Date;
  busy: BusyInterval[];
  inFreeGap: boolean;
} {
  const now = input.now ?? new Date();
  const { end: dayEnd } = executiveDayBounds(now, input.timezone);
  const busy = buildDayBusyIntervals(input);
  return {
    dayEnd,
    busy,
    inFreeGap: isInFreeGap(now, dayEnd, busy),
  };
}
