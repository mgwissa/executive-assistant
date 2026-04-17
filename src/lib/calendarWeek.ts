import { addDays, addWeeks, startOfDay, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export function resolveCalendarTimeZone(profileTz: string | null | undefined): string {
  const t = profileTz?.trim();
  if (t) return t;
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

export type WeekScope = {
  /** Start of this week’s Monday 00:00 in `timeZone` (UTC instant). */
  rangeStartUtc: Date;
  /** Start of the following Monday 00:00 in `timeZone` (exclusive upper bound). */
  rangeEndExclusiveUtc: Date;
  fromIso: string;
  toIsoExclusive: string;
  timeZone: string;
  /** e.g. "Mon, Apr 14 – Sun, Apr 20, 2026" */
  labelShort: string;
};

/**
 * Current calendar week: **Monday 00:00 → Sunday end** in `timeZone` (ISO week with Monday as first day).
 */
export function getCurrentWeekScope(
  timeZone: string,
  refUtc: Date = new Date(),
): WeekScope {
  const z = toZonedTime(refUtc, timeZone);
  const thisMondayZ = startOfDay(startOfWeek(z, { weekStartsOn: 1 }));
  const nextMondayZ = addWeeks(thisMondayZ, 1);
  const sundayZ = addDays(thisMondayZ, 6);

  const rangeStartUtc = fromZonedTime(thisMondayZ, timeZone);
  const rangeEndExclusiveUtc = fromZonedTime(nextMondayZ, timeZone);

  const sundayUtc = fromZonedTime(startOfDay(sundayZ), timeZone);
  const labelShort = `${formatInTimeZone(rangeStartUtc, timeZone, 'EEE, MMM d')} – ${formatInTimeZone(sundayUtc, timeZone, 'EEE, MMM d, yyyy')}`;

  return {
    rangeStartUtc,
    rangeEndExclusiveUtc,
    fromIso: rangeStartUtc.toISOString(),
    toIsoExclusive: rangeEndExclusiveUtc.toISOString(),
    timeZone,
    labelShort,
  };
}
