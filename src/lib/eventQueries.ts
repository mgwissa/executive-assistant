import { getCurrentWeekScope, resolveCalendarTimeZone } from './calendarWeek';

/** DB fetch window: this week Monday 00:00 through following Monday 00:00 (exclusive), in the user’s calendar TZ. */
export function eventsFetchIsoRange(profileTz?: string | null): {
  fromIso: string;
  toIso: string;
  timeZone: string;
} {
  const timeZone = resolveCalendarTimeZone(profileTz);
  const s = getCurrentWeekScope(timeZone);
  return { fromIso: s.fromIso, toIso: s.toIsoExclusive, timeZone };
}
