import type { BriefingInsight, BriefingReport } from './assistantBriefing';
import type { WorkItemRef } from './executiveDirective';
import { bumpPriorityOneLevel } from './delegationChase';
import type { TaskPriority } from './priority';
import { PRIORITY_ORDER } from './priority';
import type { Task } from '../types';

export const DECISION_QUEUE_LIMIT = 4;

const DISMISS_STORAGE_PREFIX = 'decision-dismiss:';

export function lowerPriorityOneLevel(p: TaskPriority): TaskPriority | null {
  const i = PRIORITY_ORDER.indexOf(p);
  if (i < 0 || i >= PRIORITY_ORDER.length - 1) return null;
  return PRIORITY_ORDER[i + 1]!;
}

/** Bump one step toward critical; alias for chase/defer reversal. */
export function raisePriorityOneLevel(p: TaskPriority): TaskPriority | null {
  return bumpPriorityOneLevel(p);
}

export function taskRef(taskId: string): WorkItemRef {
  return { kind: 'task', taskId };
}

export function listDecisionInsights(
  report: BriefingReport,
  dismissedIds: ReadonlySet<string>,
): BriefingInsight[] {
  return report.insights
    .filter((i) => i.section === 'decisions' && !dismissedIds.has(i.id))
    .slice(0, DECISION_QUEUE_LIMIT);
}

export function highPriorityNoDueDateTasks(tasks: Task[]): Task[] {
  return tasks.filter(
    (t) => !t.done && (t.priority === 'critical' || t.priority === 'urgent') && !t.due_date,
  );
}

export function loadDismissedDecisionIds(todayIso: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`${DISMISS_STORAGE_PREFIX}${todayIso}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

export function persistDismissedDecisionIds(todayIso: string, ids: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(`${DISMISS_STORAGE_PREFIX}${todayIso}`, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode */
  }
}

export function isRescheduleOffenderInsight(insight: BriefingInsight): boolean {
  return (
    insight.actionTarget?.kind === 'task' &&
    insight.headline.includes('rescheduled')
  );
}

export function isHighPriorityNoDateInsight(insight: BriefingInsight): boolean {
  return insight.headline.includes('no due date');
}
