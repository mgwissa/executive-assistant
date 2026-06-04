import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { MeetingDebriefState } from '../types';

export const DEBRIEF_WINDOW_MS = 15 * 60 * 1000;
export const DEBRIEF_SNOOZE_MS = 24 * 60 * 60 * 1000;

export type DebriefSnoozeMode = 'fixed' | 'until_free';

export function occurrenceStartKey(start: Date | string): string {
  const ms = new Date(start).getTime();
  if (Number.isNaN(ms)) {
    return typeof start === 'string' ? start : start.toISOString();
  }
  return new Date(ms).toISOString();
}

export function findDebriefState(
  states: MeetingDebriefState[],
  eventId: string,
  occurrenceStart: Date | string,
): MeetingDebriefState | undefined {
  const key = occurrenceStartKey(occurrenceStart);
  return states.find(
    (s) => s.event_id === eventId && occurrenceStartKey(s.occurrence_start_at) === key,
  );
}

export function debriefSnoozeMode(
  state: MeetingDebriefState | undefined,
): DebriefSnoozeMode | null {
  if (!state || state.status !== 'snoozed') return null;
  const mode = state.snooze_mode;
  if (mode === 'until_free' || mode === 'fixed') return mode;
  return 'fixed';
}

/** True when debrief gap should be suppressed for this occurrence. */
export function isDebriefSuppressed(
  state: MeetingDebriefState | undefined,
  now: Date,
  options?: { isInFreeGap?: boolean },
): boolean {
  if (!state) return false;
  if (state.status === 'done' || state.status === 'skipped') return true;
  if (state.status === 'snoozed' && state.snoozed_until) {
    if (new Date(state.snoozed_until).getTime() > now.getTime()) return true;
    if (debriefSnoozeMode(state) === 'until_free' && options?.isInFreeGap === false) {
      return true;
    }
  }
  return false;
}

/** Meeting ended and we are still inside the debrief capture window. */
export function isInDebriefWindow(now: Date, meetingEnd: Date): boolean {
  const elapsed = now.getTime() - meetingEnd.getTime();
  return elapsed >= 0 && elapsed <= DEBRIEF_WINDOW_MS;
}

export function shouldPromptDebrief(
  meetingEnd: Date,
  now: Date,
  state: MeetingDebriefState | undefined,
  isInFreeGap: boolean,
): boolean {
  if (state?.status === 'done' || state?.status === 'skipped') return false;
  if (isDebriefSuppressed(state, now, { isInFreeGap })) return false;
  if (isInDebriefWindow(now, meetingEnd)) return true;
  if (state?.status === 'snoozed' && state.snoozed_until) {
    const expired = new Date(state.snoozed_until).getTime() <= now.getTime();
    if (!expired) return false;
    if (debriefSnoozeMode(state) === 'until_free') return isInFreeGap;
    return true;
  }
  return false;
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
