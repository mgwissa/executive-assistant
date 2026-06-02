import { formatInTimeZone } from 'date-fns-tz';
import { normalizeDueTime } from './taskSchedule';
import type { Task } from '../types';

export const NUDGE_SNOOZE_MS = 15 * 60 * 1000;
export const NUDGE_POLL_MS = 30_000;

export function nudgeShownKey(taskId: string, todayIso: string): string {
  return `work-nudge-shown:${taskId}:${todayIso}`;
}

export function nudgeSnoozeKey(taskId: string): string {
  return `work-nudge-snooze:${taskId}`;
}

export function markNudgeShown(taskId: string, todayIso: string): void {
  sessionStorage.setItem(nudgeShownKey(taskId, todayIso), '1');
}

export function isNudgeShown(taskId: string, todayIso: string): boolean {
  return sessionStorage.getItem(nudgeShownKey(taskId, todayIso)) === '1';
}

export function snoozeNudge(taskId: string, untilMs: number): void {
  sessionStorage.setItem(nudgeSnoozeKey(taskId), String(untilMs));
}

export function isNudgeSnoozed(taskId: string, nowMs: number = Date.now()): boolean {
  const raw = sessionStorage.getItem(nudgeSnoozeKey(taskId));
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until) || until <= nowMs) {
    sessionStorage.removeItem(nudgeSnoozeKey(taskId));
    return false;
  }
  return true;
}

export function todayIsoInTz(now: Date, tz: string): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

export function currentLocalHm(now: Date, tz: string): string {
  return formatInTimeZone(now, tz, 'HH:mm');
}

/** Open tasks due today whose scheduled time has arrived (profile-local). */
export function tasksDueForNudge(
  tasks: Task[],
  todayIso: string,
  localTimeHm: string,
  nowMs: number = Date.now(),
): Task[] {
  return tasks
    .filter((t) => {
      if (t.done) return false;
      if (!t.due_date || t.due_date !== todayIso) return false;
      const dueTime = normalizeDueTime(t.due_time);
      if (!dueTime) return false;
      if (dueTime > localTimeHm) return false;
      if (isNudgeShown(t.id, todayIso)) return false;
      if (isNudgeSnoozed(t.id, nowMs)) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = normalizeDueTime(a.due_time) ?? '';
      const tb = normalizeDueTime(b.due_time) ?? '';
      return ta.localeCompare(tb);
    });
}
