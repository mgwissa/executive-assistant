import { addDays, startOfDay, startOfWeek, subDays, subWeeks } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { entryDurationSeconds } from './timeTrackingFormat';

export type TimeChartSegment = {
  projectId: string | null;
  name: string;
  seconds: number;
};

export type TimeChartBucket = {
  key: string;
  label: string;
  seconds: number;
  segments: TimeChartSegment[];
};

type EntryWithProject = {
  started_at: string;
  ended_at: string;
  project_id: string | null;
};

/** First UTC instant on calendar day `ymd` in IANA zone `tz`. */
export function startOfZonedDayUtc(ymd: string, tz: string): Date {
  const [yStr, mStr, dStr] = ymd.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date(NaN);
  }
  let t = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  let guard = 0;
  for (;;) {
    const got = formatInTimeZone(new Date(t), tz, 'yyyy-MM-dd');
    if (got === ymd) break;
    if (got < ymd) t += 24 * 3_600_000;
    else t -= 24 * 3_600_000;
    if (++guard > 400) return new Date(NaN);
  }
  while (t > 0 && formatInTimeZone(new Date(t - 1), tz, 'yyyy-MM-dd') === ymd) {
    t -= 1;
  }
  return new Date(t);
}

function addCalendarDaysInTz(fromUtc: Date, tz: string, delta: number): Date {
  const z = toZonedTime(fromUtc, tz);
  const bumped = addDays(startOfDay(z), delta);
  return fromZonedTime(bumped, tz);
}

export function calendarYmdNow(tz: string): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

/** Inclusive range of the last `numDays` calendar days in `tz`, ending today there. */
export function rollingDayRangeInclusive(
  tz: string,
  numDays: number,
): { startYmd: string; endYmd: string } {
  const n = Math.max(1, Math.floor(numDays));
  const endYmd = calendarYmdNow(tz);
  let startUtc = startOfZonedDayUtc(endYmd, tz);
  if (Number.isNaN(startUtc.getTime())) return { startYmd: endYmd, endYmd };
  for (let i = 1; i < n; i++) {
    startUtc = addCalendarDaysInTz(startUtc, tz, -1);
  }
  const startYmd = formatInTimeZone(startUtc, tz, 'yyyy-MM-dd');
  return { startYmd, endYmd };
}

export function sumSecondsOnCalendarDay(
  entries: EntryWithProject[],
  tz: string,
  ymd: string,
): number {
  let sum = 0;
  for (const e of entries) {
    if (formatInTimeZone(new Date(e.started_at), tz, 'yyyy-MM-dd') === ymd) {
      sum += entryDurationSeconds(e);
    }
  }
  return sum;
}

/** Current ISO week (Monday start) in `tz`, by Monday’s yyyy-MM-dd in that zone. */
export function thisWeekMondayYmd(tz: string): string {
  const nowZ = toZonedTime(new Date(), tz);
  const monZ = startOfDay(startOfWeek(nowZ, { weekStartsOn: 1 }));
  const monUtc = fromZonedTime(monZ, tz);
  return formatInTimeZone(monUtc, tz, 'yyyy-MM-dd');
}

export function sumSecondsInWeekStartingMonday(
  entries: EntryWithProject[],
  tz: string,
  mondayYmd: string,
): number {
  let sum = 0;
  for (const e of entries) {
    if (mondayKeyForStartedAt(e.started_at, tz) === mondayYmd) {
      sum += entryDurationSeconds(e);
    }
  }
  return sum;
}

function mondayKeyForStartedAt(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz);
  const mondayZ = startOfDay(startOfWeek(z, { weekStartsOn: 1 }));
  const monUtc = fromZonedTime(mondayZ, tz);
  return formatInTimeZone(monUtc, tz, 'yyyy-MM-dd');
}

function segmentsFromProjectMap(
  byProject: Map<string | null, number>,
  resolveProjectName: (id: string | null) => string,
): TimeChartSegment[] {
  const list: TimeChartSegment[] = [];
  for (const [projectId, seconds] of byProject) {
    if (seconds <= 0) continue;
    list.push({
      projectId,
      name: resolveProjectName(projectId),
      seconds,
    });
  }
  list.sort((a, b) => {
    if (a.projectId === null && b.projectId !== null) return -1;
    if (a.projectId !== null && b.projectId === null) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return list;
}

/** Last `numDays` calendar days in `tz` (ending today), oldest first. Time attributed to session start day. */
export function computeDailyBuckets(
  entries: EntryWithProject[],
  tz: string,
  numDays: number,
  resolveProjectName: (id: string | null) => string,
): TimeChartBucket[] {
  const days: { key: string; label: string }[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const d = subDays(new Date(), i);
    days.push({
      key: formatInTimeZone(d, tz, 'yyyy-MM-dd'),
      label: formatInTimeZone(d, tz, 'EEE M/d'),
    });
  }

  const byBucket = new Map<string, Map<string | null, number>>();
  for (const { key } of days) {
    byBucket.set(key, new Map());
  }

  for (const e of entries) {
    const key = formatInTimeZone(new Date(e.started_at), tz, 'yyyy-MM-dd');
    if (!byBucket.has(key)) continue;
    const m = byBucket.get(key)!;
    const pid = e.project_id;
    const dur = entryDurationSeconds(e);
    m.set(pid, (m.get(pid) ?? 0) + dur);
  }

  return days.map(({ key, label }) => {
    const m = byBucket.get(key)!;
    let total = 0;
    for (const v of m.values()) total += v;
    return {
      key,
      label,
      seconds: total,
      segments: segmentsFromProjectMap(m, resolveProjectName),
    };
  });
}

/** Inclusive calendar-day range in `tz`; `startYmd` and `endYmd` are `yyyy-MM-dd` (dates in profile TZ). Oldest first. */
export function computeDailyBucketsForYmdRange(
  entries: EntryWithProject[],
  tz: string,
  startYmd: string,
  endYmd: string,
  resolveProjectName: (id: string | null) => string,
): TimeChartBucket[] {
  if (!startYmd || !endYmd || startYmd > endYmd) return [];

  const days: { key: string; label: string }[] = [];
  let cursor = startOfZonedDayUtc(startYmd, tz);
  const endStart = startOfZonedDayUtc(endYmd, tz);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(endStart.getTime())) return [];

  while (cursor.getTime() <= endStart.getTime()) {
    days.push({
      key: formatInTimeZone(cursor, tz, 'yyyy-MM-dd'),
      label: formatInTimeZone(cursor, tz, 'EEE M/d'),
    });
    cursor = addCalendarDaysInTz(cursor, tz, 1);
  }

  const byBucket = new Map<string, Map<string | null, number>>();
  for (const { key } of days) {
    byBucket.set(key, new Map());
  }

  for (const e of entries) {
    const key = formatInTimeZone(new Date(e.started_at), tz, 'yyyy-MM-dd');
    if (!byBucket.has(key)) continue;
    const m = byBucket.get(key)!;
    const pid = e.project_id;
    const dur = entryDurationSeconds(e);
    m.set(pid, (m.get(pid) ?? 0) + dur);
  }

  return days.map(({ key, label }) => {
    const m = byBucket.get(key)!;
    let total = 0;
    for (const v of m.values()) total += v;
    return {
      key,
      label,
      seconds: total,
      segments: segmentsFromProjectMap(m, resolveProjectName),
    };
  });
}

/** Last `numWeeks` Monday–Sunday weeks in `tz` (ending current week), oldest first. Weeks start Monday. */
export function computeWeeklyBuckets(
  entries: EntryWithProject[],
  tz: string,
  numWeeks: number,
  resolveProjectName: (id: string | null) => string,
): TimeChartBucket[] {
  const nowZ = toZonedTime(new Date(), tz);
  const thisMondayZ = startOfDay(startOfWeek(nowZ, { weekStartsOn: 1 }));

  const weeks: { key: string; label: string }[] = [];
  for (let w = numWeeks - 1; w >= 0; w--) {
    const monZ = subWeeks(thisMondayZ, w);
    const monUtc = fromZonedTime(monZ, tz);
    const sunZ = startOfDay(addDays(monZ, 6));
    const sunUtc = fromZonedTime(sunZ, tz);
    const key = formatInTimeZone(monUtc, tz, 'yyyy-MM-dd');
    const sameMonth =
      formatInTimeZone(monUtc, tz, 'yyyy-MM') === formatInTimeZone(sunUtc, tz, 'yyyy-MM');
    const label = sameMonth
      ? `${formatInTimeZone(monUtc, tz, 'MMM d')}–${formatInTimeZone(sunUtc, tz, 'd')}`
      : `${formatInTimeZone(monUtc, tz, 'MMM d')} – ${formatInTimeZone(sunUtc, tz, 'MMM d')}`;
    weeks.push({ key, label });
  }

  const byBucket = new Map<string, Map<string | null, number>>();
  for (const { key } of weeks) {
    byBucket.set(key, new Map());
  }

  for (const e of entries) {
    const k = mondayKeyForStartedAt(e.started_at, tz);
    if (!byBucket.has(k)) continue;
    const m = byBucket.get(k)!;
    const pid = e.project_id;
    const dur = entryDurationSeconds(e);
    m.set(pid, (m.get(pid) ?? 0) + dur);
  }

  return weeks.map(({ key, label }) => {
    const m = byBucket.get(key)!;
    let total = 0;
    for (const v of m.values()) total += v;
    return {
      key,
      label,
      seconds: total,
      segments: segmentsFromProjectMap(m, resolveProjectName),
    };
  });
}
