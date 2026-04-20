import { useMemo } from 'react';
import { extractActionItems } from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';

export type EmergencyReason = {
  active: boolean;
  hasCriticalOverload: boolean;
  hasOverdue: boolean;
  overdueTasks: Task[];
};

function isOverdue(dueDate: string): boolean {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

/**
 * Returns emergency-mode state.
 * Active when there are 2+ critical/P0 items OR any task is past its due date.
 * Returns false while data is still loading to avoid flashing the overlay.
 */
export function useCriticalOverload(): EmergencyReason {
  const tasks = useTasksStore((s) => s.tasks);
  const notes = useNotesStore((s) => s.notes);
  const tasksLoading = useTasksStore((s) => s.loading);
  const notesLoading = useNotesStore((s) => s.loading);

  return useMemo(() => {
    const none: EmergencyReason = { active: false, hasCriticalOverload: false, hasOverdue: false, overdueTasks: [] };
    if (tasksLoading || notesLoading) return none;

    const criticalTasks = tasks.filter(
      (t) => !t.done && (t.priority as TaskPriority) === 'critical',
    ).length;
    const criticalFromNotes = extractActionItems(notes).filter((a) => a.priority === 'critical')
      .length;
    const hasCriticalOverload = criticalTasks + criticalFromNotes > 1;

    const overdueTasks = tasks.filter((t) => !t.done && t.due_date && isOverdue(t.due_date));
    const hasOverdue = overdueTasks.length > 0;

    return {
      active: hasCriticalOverload || hasOverdue,
      hasCriticalOverload,
      hasOverdue,
      overdueTasks,
    };
  }, [tasks, notes, tasksLoading, notesLoading]);
}
