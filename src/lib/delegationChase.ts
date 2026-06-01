/** Delegation chase helpers (Phase C) — tasks with waiting_on. */

import type { TaskPriority } from './priority';
import { PRIORITY_ORDER, priorityRank } from './priority';
import type { Task } from '../types';

export const CHASE_THRESHOLD_DAYS = 5;
export const CHASE_CRITICAL_DAYS = 14;
export const CHASE_SNOOZE_DAYS = 7;

export type ChaseItem = {
  taskId: string;
  title: string;
  waitingOn: string;
  daysIdle: number;
  priority: TaskPriority;
  severity: 'warning' | 'critical';
};

export function chaseReferenceAt(task: Pick<Task, 'updated_at' | 'last_chased_at'>): Date {
  if (task.last_chased_at) return new Date(task.last_chased_at);
  return new Date(task.updated_at);
}

export function daysIdle(task: Pick<Task, 'updated_at' | 'last_chased_at'>, now: Date = new Date()): number {
  return Math.floor((now.getTime() - chaseReferenceAt(task).getTime()) / 86_400_000);
}

export function isChaseSnoozed(task: Pick<Task, 'chase_snoozed_until'>, now: Date = new Date()): boolean {
  if (!task.chase_snoozed_until) return false;
  return new Date(task.chase_snoozed_until) > now;
}

export function chaseSeverity(days: number): 'warning' | 'critical' {
  return days >= CHASE_CRITICAL_DAYS ? 'critical' : 'warning';
}

export function snoozeChaseUntil(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + CHASE_SNOOZE_DAYS);
  return d.toISOString();
}

/** Bump one step toward critical; returns null if already critical. */
export function bumpPriorityOneLevel(p: TaskPriority): TaskPriority | null {
  const i = PRIORITY_ORDER.indexOf(p);
  if (i <= 0) return null;
  return PRIORITY_ORDER[i - 1]!;
}

export function listChaseCandidates(tasks: Task[], now: Date = new Date(), limit = 5): ChaseItem[] {
  const items: ChaseItem[] = [];
  for (const t of tasks) {
    if (t.done || !t.waiting_on?.trim()) continue;
    if (isChaseSnoozed(t, now)) continue;
    const days = daysIdle(t, now);
    if (days < CHASE_THRESHOLD_DAYS) continue;
    items.push({
      taskId: t.id,
      title: t.title,
      waitingOn: t.waiting_on.trim(),
      daysIdle: days,
      priority: (t.priority as TaskPriority) ?? 'normal',
      severity: chaseSeverity(days),
    });
  }
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    if (b.daysIdle !== a.daysIdle) return b.daysIdle - a.daysIdle;
    return priorityRank(a.priority) - priorityRank(b.priority);
  });
  return items.slice(0, limit);
}
