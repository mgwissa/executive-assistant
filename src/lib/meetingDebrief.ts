import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { MeetingDebriefState } from '../types';

export const DEBRIEF_WINDOW_MS = 15 * 60 * 1000;
export const DEBRIEF_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function occurrenceStartKey(start: Date): string {
  return start.toISOString();
}

export function findDebriefState(
  states: MeetingDebriefState[],
  eventId: string,
  occurrenceStart: Date,
): MeetingDebriefState | undefined {
  const key = occurrenceStartKey(occurrenceStart);
  return states.find((s) => s.event_id === eventId && s.occurrence_start_at === key);
}

/** True when debrief gap should be suppressed for this occurrence. */
export function isDebriefSuppressed(
  state: MeetingDebriefState | undefined,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.status === 'done' || state.status === 'skipped') return true;
  if (state.status === 'snoozed' && state.snoozed_until) {
    return new Date(state.snoozed_until).getTime() > now.getTime();
  }
  return false;
}

/** Meeting ended and we are still inside the debrief capture window. */
export function isInDebriefWindow(now: Date, meetingEnd: Date): boolean {
  const elapsed = now.getTime() - meetingEnd.getTime();
  return elapsed >= 0 && elapsed <= DEBRIEF_WINDOW_MS;
}

export function snoozeUntil(now: Date): string {
  return new Date(now.getTime() + DEBRIEF_SNOOZE_MS).toISOString();
}

export function debriefFetchRangeForDay(now: Date, tz: string): { fromIso: string; toIso: string } {
  const todayIso = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  return {
    fromIso: fromZonedTime(`${todayIso}T00:00:00`, tz).toISOString(),
    toIso: fromZonedTime(`${todayIso}T23:59:59`, tz).toISOString(),
  };
}
