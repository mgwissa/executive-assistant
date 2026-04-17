import { useMemo } from 'react';
import { extractActionItems } from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';

/**
 * True when there is more than one open Critical / P0 item (standalone tasks + note checkboxes).
 * False while tasks or notes are still loading to avoid flashing the overlay.
 */
export function useCriticalOverload(): boolean {
  const tasks = useTasksStore((s) => s.tasks);
  const notes = useNotesStore((s) => s.notes);
  const tasksLoading = useTasksStore((s) => s.loading);
  const notesLoading = useNotesStore((s) => s.loading);

  return useMemo(() => {
    if (tasksLoading || notesLoading) return false;
    const criticalTasks = tasks.filter(
      (t) => !t.done && (t.priority as TaskPriority) === 'critical',
    ).length;
    const criticalFromNotes = extractActionItems(notes).filter((a) => a.priority === 'critical')
      .length;
    return criticalTasks + criticalFromNotes > 1;
  }, [tasks, notes, tasksLoading, notesLoading]);
}
