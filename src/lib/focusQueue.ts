import type { ActionItem } from './format';
import { addDays, format, parseISO } from 'date-fns';
import { buildPrioritizedWork, type FocusWorkItem, type WorkItemRef } from './executiveDirective';
import type { Task } from '../types';

export const FOCUS_STACK_LIMIT = 6;

export type FocusQueuePrefs = {
  /** User-preferred order (top first). Front of the merged focus stack. */
  stack: WorkItemRef[];
  /** refKey → yyyy-mm-dd — hide from focus stack until this date (inclusive re-show). */
  snoozedUntil: Record<string, string>;
};

export function emptyFocusQueuePrefs(): FocusQueuePrefs {
  return { stack: [], snoozedUntil: {} };
}

export function tomorrowIsoFrom(todayIso: string): string {
  return format(addDays(parseISO(todayIso), 1), 'yyyy-MM-dd');
}

function isHiddenFromFocus(key: string, todayIso: string, prefs: FocusQueuePrefs): boolean {
  const until = prefs.snoozedUntil[key];
  if (!until) return false;
  return todayIso < until;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseWorkItemRef(raw: unknown): WorkItemRef | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null;
  if (raw.kind === 'task' && typeof raw.taskId === 'string') {
    return { kind: 'task', taskId: raw.taskId };
  }
  if (
    raw.kind === 'action' &&
    typeof raw.noteId === 'string' &&
    typeof raw.line === 'number'
  ) {
    return { kind: 'action', noteId: raw.noteId, line: raw.line };
  }
  return null;
}

export function parseFocusQueue(raw: unknown): FocusQueuePrefs {
  if (!isRecord(raw)) return emptyFocusQueuePrefs();
  const stack: WorkItemRef[] = [];
  if (Array.isArray(raw.stack)) {
    for (const entry of raw.stack) {
      const ref = parseWorkItemRef(entry);
      if (ref) stack.push(ref);
    }
  }
  const snoozedUntil: Record<string, string> = {};
  if (isRecord(raw.snoozedUntil)) {
    for (const [key, value] of Object.entries(raw.snoozedUntil)) {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        snoozedUntil[key] = value;
      }
    }
  }
  // Legacy `deferred` (hide for one day) → snoozed until the next day
  if (isRecord(raw.deferred)) {
    for (const [key, value] of Object.entries(raw.deferred)) {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !snoozedUntil[key]) {
        snoozedUntil[key] = tomorrowIsoFrom(value);
      }
    }
  }
  return { stack, snoozedUntil };
}

export function refKey(ref: WorkItemRef): string {
  return ref.kind === 'task'
    ? `task:${ref.taskId}`
    : `action:${ref.noteId}:${ref.line}`;
}

export function workItemToRef(item: FocusWorkItem): WorkItemRef {
  if (item.kind === 'task' && item.taskId) {
    return { kind: 'task', taskId: item.taskId };
  }
  return { kind: 'action', noteId: item.noteId!, line: item.line! };
}

export function refsEqual(a: WorkItemRef, b: WorkItemRef): boolean {
  return refKey(a) === refKey(b);
}

export function buildFocusStack(
  tasks: Task[],
  actionItems: ActionItem[],
  todayIso: string,
  prefs: FocusQueuePrefs,
): FocusWorkItem[] {
  const pool = buildPrioritizedWork(tasks, actionItems, todayIso).filter(
    (item) => !isHiddenFromFocus(refKey(workItemToRef(item)), todayIso, prefs),
  );
  const byKey = new Map(pool.map((item) => [refKey(workItemToRef(item)), item]));

  const ordered: FocusWorkItem[] = [];
  const seen = new Set<string>();

  for (const ref of prefs.stack) {
    const key = refKey(ref);
    const item = byKey.get(key);
    if (item && !seen.has(key)) {
      ordered.push(item);
      seen.add(key);
    }
  }

  for (const item of pool) {
    const key = refKey(workItemToRef(item));
    if (!seen.has(key)) {
      ordered.push(item);
      seen.add(key);
    }
  }

  return ordered.slice(0, FOCUS_STACK_LIMIT);
}

export function reorderFocusStack(
  prefs: FocusQueuePrefs,
  items: FocusWorkItem[],
  ref: WorkItemRef,
  direction: 'up' | 'down',
): FocusQueuePrefs {
  const refs = items.map(workItemToRef);
  const idx = refs.findIndex((r) => refsEqual(r, ref));
  if (idx < 0) return prefs;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= refs.length) return prefs;
  const next = [...refs];
  [next[idx], next[swap]] = [next[swap]!, next[idx]!];
  return { ...prefs, stack: next };
}

export function pinToTopOfFocusStack(
  prefs: FocusQueuePrefs,
  items: FocusWorkItem[],
  ref: WorkItemRef,
): FocusQueuePrefs {
  const refs = items.map(workItemToRef);
  const idx = refs.findIndex((r) => refsEqual(r, ref));
  if (idx <= 0) return prefs;
  const next = [...refs];
  const [removed] = next.splice(idx, 1);
  next.unshift(removed!);
  return { ...prefs, stack: next };
}

export function scheduleFocusForTomorrow(
  prefs: FocusQueuePrefs,
  ref: WorkItemRef,
  todayIso: string,
): FocusQueuePrefs {
  const key = refKey(ref);
  const tomorrow = tomorrowIsoFrom(todayIso);
  return {
    stack: prefs.stack.filter((r) => refKey(r) !== key),
    snoozedUntil: { ...prefs.snoozedUntil, [key]: tomorrow },
  };
}

/** @deprecated Use scheduleFocusForTomorrow */
export function deferFromFocusStack(
  prefs: FocusQueuePrefs,
  ref: WorkItemRef,
  todayIso: string,
): FocusQueuePrefs {
  return scheduleFocusForTomorrow(prefs, ref, todayIso);
}

/** One-line context above the focus stack — plain, not pep-talk. */
export function focusStackHint(nowKind: string, inMeeting: boolean): string {
  if (inMeeting) {
    return "You're in a meeting. When you're free, start with #1.";
  }
  if (nowKind === 'prep') {
    return 'Prep is in the banner above. Stack picks up here after.';
  }
  if (nowKind === 'debrief') {
    return 'Handle the debrief first, then come back to the stack.';
  }
  if (nowKind === 'wind_down') {
    return 'Past 5pm. Wrap up or push the rest to tomorrow.';
  }
  return '#1 first, then work down. Pin, reorder, or push to tomorrow when blocked.';
}
