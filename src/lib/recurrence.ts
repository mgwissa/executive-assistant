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

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonthsKeepDay(d: Date, months: number) {
  const next = new Date(d);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  // JS Date will roll into next month if the day doesn't exist; clamp back.
  if (next.getDate() !== day) {
    next.setDate(0);
  }
  return next;
}

function isWeekday(d: Date) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function generateOccurrences(
  event: Event,
  rangeStart: Date,
  rangeEnd: Date,
  { limit = 500 }: { limit?: number } = {},
): Occurrence[] {
  const out: Occurrence[] = [];
  const start = new Date(event.start_at);
  const duration = event.duration_minutes ?? 30;
  const until = event.until_at ? new Date(event.until_at) : null;
  const maxCount = event.count ?? null;

  const recurrence = (event.recurrence ?? 'none') as string;
  const interval = Math.max(1, event.interval ?? 1);

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
    if (jumps > 0) cursor = addDays(cursor, jumps * interval);
  };

  if (recurrence === 'daily') fastForwardDays();
  if (recurrence === 'weekdays') fastForwardDays();
  if (recurrence === 'weekly') {
    // Jump weeks roughly.
    if (cursor < rangeStart) {
      const daysDiff = Math.floor((rangeStart.getTime() - cursor.getTime()) / 86_400_000);
      const weeks = Math.floor(daysDiff / 7);
      const jumps = Math.floor(weeks / interval);
      if (jumps > 0) cursor = addDays(cursor, jumps * interval * 7);
    }
  }
  if (recurrence === 'monthly') {
    // Jump months roughly.
    if (cursor < rangeStart) {
      const monthsDiff =
        (rangeStart.getFullYear() - cursor.getFullYear()) * 12 +
        (rangeStart.getMonth() - cursor.getMonth());
      const jumps = Math.floor(monthsDiff / interval);
      if (jumps > 0) cursor = addMonthsKeepDay(cursor, jumps * interval);
    }
  }

  while (out.length < limit) {
    if (until && cursor > until) break;
    if (maxCount != null && produced >= maxCount) break;
    if (cursor >= rangeEnd) break;

    if (recurrence === 'weekdays') {
      if (isWeekday(cursor)) {
        pushIfInRange(cursor);
        produced++;
      }
      cursor = addDays(cursor, 1);
      continue;
    }

    if (recurrence === 'weekly') {
      const by = event.by_weekday && event.by_weekday.length > 0 ? event.by_weekday : [cursor.getDay()];
      // Generate occurrences for the week anchored at cursor's week.
      const anchor = startOfDay(cursor);
      const weekStart = addDays(anchor, -anchor.getDay()); // Sunday start
      for (const wd of by) {
        const candidateDay = addDays(weekStart, wd);
        const candidate = new Date(candidateDay);
        candidate.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
        if (candidate < cursor) continue;
        if (until && candidate > until) continue;
        if (maxCount != null && produced >= maxCount) break;
        if (candidate >= rangeEnd) continue;
        pushIfInRange(candidate);
        produced++;
      }
      cursor = addDays(weekStart, interval * 7);
      cursor.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
      continue;
    }

    // daily/monthly (and any unknown fallback) are “step and emit”.
    pushIfInRange(cursor);
    produced++;

    if (recurrence === 'monthly') {
      cursor = addMonthsKeepDay(cursor, interval);
    } else {
      cursor = addDays(cursor, interval);
    }
  }

  // Sort by start time (weekly might append out-of-order).
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

