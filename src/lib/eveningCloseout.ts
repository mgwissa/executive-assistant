import { formatInTimeZone } from 'date-fns-tz';
import { buildFocusStack, tomorrowIsoFrom } from './focusQueue';
import { buildPrioritizedWork, type FocusWorkItem } from './executiveDirective';
import type { ActionItem } from './format';
import type { FocusQueuePrefs } from './focusQueue';
import type { Task } from '../types';

export function countCompletedToday(tasks: Task[], todayIso: string, tz: string): number {
  return tasks.filter(
    (t) =>
      t.done &&
      formatInTimeZone(new Date(t.updated_at), tz, 'yyyy-MM-dd') === todayIso,
  ).length;
}

export function carryForwardWork(
  tasks: Task[],
  actionItems: ActionItem[],
  todayIso: string,
  limit = 5,
): FocusWorkItem[] {
  return buildPrioritizedWork(tasks, actionItems, todayIso).slice(0, limit);
}

export function tomorrowFocusTop(
  tasks: Task[],
  actionItems: ActionItem[],
  todayIso: string,
  prefs: FocusQueuePrefs,
): FocusWorkItem | null {
  const tomorrow = tomorrowIsoFrom(todayIso);
  const stack = buildFocusStack(tasks, actionItems, tomorrow, prefs);
  return stack[0] ?? null;
}
