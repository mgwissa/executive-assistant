/** Task duration estimates for executive capacity (Phase D). */

import type { DirectiveGap, TimelineEntry, WorkItemRef } from './executiveDirective';
import type { Task } from '../types';

export const DEFAULT_TASK_MINUTES = 30;

export const ESTIMATE_PRESETS = [15, 30, 45, 60, 90, 120] as const;

export type CapacitySnapshot = {
  remainingMinutes: number;
  meetingMinutes: number;
  scheduledWorkMinutes: number;
  /** Due-today / overdue work not yet on the timeline with a time. */
  unscheduledWorkMinutes: number;
  bookedMinutes: number;
  capacityRatio: number;
  overcommitMinutes: number;
  /** Tasks using explicit estimates in today's capacity math. */
  explicitEstimateCount: number;
};

export function resolveTaskMinutes(estimatedMinutes: number | null | undefined): number {
  if (estimatedMinutes != null && estimatedMinutes > 0) return estimatedMinutes;
  return DEFAULT_TASK_MINUTES;
}

export function hasExplicitEstimate(estimatedMinutes: number | null | undefined): boolean {
  return estimatedMinutes != null && estimatedMinutes > 0;
}

export function formatEstimateMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function entryMinutes(e: TimelineEntry, from: Date, to: Date): number {
  const start = e.start < from ? from : e.start;
  const end = e.end > to ? to : e.end;
  return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
}

function estimateForRef(
  ref: WorkItemRef | undefined,
  tasks: Task[],
): number {
  if (!ref || ref.kind !== 'task') return DEFAULT_TASK_MINUTES;
  const task = tasks.find((t) => t.id === ref.taskId);
  return resolveTaskMinutes(task?.estimated_minutes);
}

export function workMinutesForItem(
  kind: 'task' | 'action',
  taskId: string | undefined,
  tasks: Task[],
): number {
  if (kind === 'action' || !taskId) return DEFAULT_TASK_MINUTES;
  const task = tasks.find((t) => t.id === taskId);
  return resolveTaskMinutes(task?.estimated_minutes);
}

export function computeCapacitySnapshot(params: {
  now: Date;
  dayEnd: Date;
  timeline: TimelineEntry[];
  gaps: DirectiveGap[];
  tasks: Task[];
}): CapacitySnapshot {
  const { now, dayEnd, timeline, gaps, tasks } = params;
  const remainingMinutes = Math.max(0, (dayEnd.getTime() - now.getTime()) / 60_000);

  let meetingMinutes = 0;
  let scheduledWorkMinutes = 0;
  const meetings = timeline.filter((e) => e.kind === 'meeting' && e.end > now)
    .map((e) => ({ start: Math.max(e.start.getTime(), now.getTime()), end: Math.min(e.end.getTime(), dayEnd.getTime()) }))
    .filter((e) => e.end > e.start).sort((a, b) => a.start - b.start);
  let coveredUntil = now.getTime();
  for (const meeting of meetings) {
    meetingMinutes += Math.max(0, meeting.end - Math.max(meeting.start, coveredUntil)) / 60_000;
    coveredUntil = Math.max(coveredUntil, meeting.end);
  }
  const scheduledRefs = new Set<string>();
  const refKey = (ref: WorkItemRef) => ref.kind === 'task' ? `task:${ref.taskId}` : `action:${ref.noteId}:${ref.line}`;

  for (const e of timeline) {
    if (e.end <= now) continue;
    const mins = entryMinutes(e, now, dayEnd);
    if (mins === 0) continue;
    if (e.kind === 'task' || e.kind === 'action' || e.kind === 'suggested') {
      if (e.ref) {
        const key = refKey(e.ref);
        if (scheduledRefs.has(key)) continue;
        scheduledRefs.add(key);
      }
      scheduledWorkMinutes += mins;
    }
  }

  let unscheduledWorkMinutes = 0;
  let explicitEstimateCount = 0;

  for (const g of gaps) {
    if (g.kind !== 'untimed_today') continue;
    if (g.ref && scheduledRefs.has(refKey(g.ref))) continue;
    if (g.ref) scheduledRefs.add(refKey(g.ref));
    const mins = estimateForRef(g.ref, tasks);
    unscheduledWorkMinutes += mins;
    if (g.ref?.kind === 'task') {
      const taskId = g.ref.taskId;
      const task = tasks.find((t) => t.id === taskId);
      if (hasExplicitEstimate(task?.estimated_minutes)) explicitEstimateCount += 1;
    }
  }

  for (const e of timeline) {
    if (e.end <= now) continue;
    if (e.kind !== 'task') continue;
    const ref = e.ref;
    if (!ref || ref.kind !== 'task') continue;
    const task = tasks.find((t) => t.id === ref.taskId);
    if (hasExplicitEstimate(task?.estimated_minutes)) explicitEstimateCount += 1;
  }

  const bookedMinutes = meetingMinutes + scheduledWorkMinutes + unscheduledWorkMinutes;
  const capacityRatio =
    remainingMinutes > 0 ? bookedMinutes / remainingMinutes : bookedMinutes > 0 ? 2 : 0;
  const overcommitMinutes = Math.max(0, bookedMinutes - remainingMinutes);

  const round = (n: number) => Math.round(n);

  return {
    remainingMinutes: round(remainingMinutes),
    meetingMinutes: round(meetingMinutes),
    scheduledWorkMinutes: round(scheduledWorkMinutes),
    unscheduledWorkMinutes: round(unscheduledWorkMinutes),
    bookedMinutes: round(bookedMinutes),
    capacityRatio,
    overcommitMinutes: round(overcommitMinutes),
    explicitEstimateCount,
  };
}
