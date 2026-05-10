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
