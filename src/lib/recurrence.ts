import { addDays, addMonths, set, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Event } from '../types';

export type Occurrence = {
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  /** Copied from the parent event for UI (e.g. delete / badges). */
  source: string;
};

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000);
}

function addZonedDays(d: Date, days: number, timezone: string) {
  return fromZonedTime(addDays(toZonedTime(d, timezone), days), timezone);
}

function addZonedMonths(d: Date, months: number, timezone: string) {
  return fromZonedTime(addMonths(toZonedTime(d, timezone), months), timezone);
}

function isWeekday(d: Date, timezone: string) {
  const isoWeekday = Number(formatInTimeZone(d, timezone, 'i'));
  return isoWeekday >= 1 && isoWeekday <= 5;
}

function weekdayInTimeZone(d: Date, timezone: string) {
  return Number(formatInTimeZone(d, timezone, 'i')) % 7;
}

export function generateOccurrences(
  event: Event,
  rangeStart: Date,
  rangeEnd: Date,
  { limit = 500 }: { limit?: number } = {},
): Occurrence[] {
  const out: Occurrence[] = [];
  const start = new Date(event.start_at);
  const timezone = event.timezone || 'UTC';
  const zonedStart = toZonedTime(start, timezone);
  const duration = event.duration_minutes ?? 30;
  const until = event.until_at ? new Date(event.until_at) : null;
  const maxCount = event.count ?? null;

  const recurrence = (event.recurrence ?? 'none') as string;
  const interval = Math.max(1, event.interval ?? 1);
  const weeklyDays =
    event.by_weekday && event.by_weekday.length > 0
      ? event.by_weekday
      : [weekdayInTimeZone(start, timezone)];

  const pushIfInRange = (occStart: Date) => {
    const occEnd = addMinutes(occStart, duration);
    if (occEnd <= rangeStart) return;
    if (occStart >= rangeEnd) return;
    out.push({
      eventId: event.id,
      title: event.title,
      start: occStart,
      end: occEnd,
      source: event.source ?? 'manual',
    });
  };

  if (recurrence === 'none') {
    pushIfInRange(start);
    return out;
  }

  let cursor = start;
  let produced = 0;

  // Fast-forward for daily-ish recurrences based on days.
  // (Keeps the logic simple; good enough for v1 and single-timezone assumption.)
  const fastForwardDays = () => {
    if (cursor >= rangeStart) return;
    const daysDiff = Math.floor((rangeStart.getTime() - cursor.getTime()) / 86_400_000);
    if (daysDiff <= 0) return;
    const jumps = Math.floor(daysDiff / interval);
    if (jumps > 0) cursor = addZonedDays(cursor, jumps * interval, timezone);
  };

  if (recurrence === 'daily') fastForwardDays();
  if (recurrence === 'weekdays') fastForwardDays();
  if (recurrence === 'weekly') {
    // Jump weeks roughly.
    if (cursor < rangeStart) {
      const daysDiff = Math.floor((rangeStart.getTime() - cursor.getTime()) / 86_400_000);
      const weeks = Math.floor(daysDiff / 7);
      const jumps = Math.floor(weeks / interval);
      if (jumps > 0) cursor = addZonedDays(cursor, jumps * interval * 7, timezone);
    }
  }
  if (recurrence === 'monthly') {
    // Jump months roughly.
    if (cursor < rangeStart) {
      const monthsDiff =
        (rangeStart.getFullYear() - cursor.getFullYear()) * 12 +
        (rangeStart.getMonth() - cursor.getMonth());
      const jumps = Math.floor(monthsDiff / interval);
      if (jumps > 0) cursor = addZonedMonths(cursor, jumps * interval, timezone);
    }
  }

  while (out.length < limit) {
    if (until && cursor > until) break;
    if (maxCount != null && produced >= maxCount) break;
    if (cursor >= rangeEnd) break;

    if (recurrence === 'weekdays') {
      if (isWeekday(cursor, timezone)) {
        pushIfInRange(cursor);
        produced++;
      }
      cursor = addZonedDays(cursor, 1, timezone);
      continue;
    }

    if (recurrence === 'weekly') {
      // Generate occurrences for the week anchored at cursor's week.
      const weekStart = startOfWeek(toZonedTime(cursor, timezone), { weekStartsOn: 0 });
      for (const wd of weeklyDays) {
        const candidateDay = addDays(weekStart, wd);
        const candidate = fromZonedTime(
          set(candidateDay, {
            hours: zonedStart.getHours(),
            minutes: zonedStart.getMinutes(),
            seconds: zonedStart.getSeconds(),
            milliseconds: zonedStart.getMilliseconds(),
          }),
          timezone,
        );
        if (candidate < cursor) continue;
        if (until && candidate > until) continue;
        if (maxCount != null && produced >= maxCount) break;
        if (candidate >= rangeEnd) continue;
        pushIfInRange(candidate);
        produced++;
      }
      cursor = fromZonedTime(
        set(addDays(weekStart, interval * 7), {
          hours: zonedStart.getHours(),
          minutes: zonedStart.getMinutes(),
          seconds: zonedStart.getSeconds(),
          milliseconds: zonedStart.getMilliseconds(),
        }),
        timezone,
      );
      continue;
    }

    // daily/monthly (and any unknown fallback) are “step and emit”.
    pushIfInRange(cursor);
    produced++;

    if (recurrence === 'monthly') {
      cursor = addZonedMonths(cursor, interval, timezone);
    } else {
      cursor = addZonedDays(cursor, interval, timezone);
    }
  }

  // Sort by start time (weekly might append out-of-order).
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** Collapse duplicate slots (Outlook ICS often lists master + instance VEVENTs). */
export function dedupeOccurrences(occurrences: Occurrence[]): Occurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((o) => {
    const key = `${o.start.getTime()}|${o.title}|${o.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

