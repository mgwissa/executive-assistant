import type { Task } from '../types';

/** Client timestamps can be optimistic. Compare visible content before taking
 * the freshly read DB version into the atomic lifecycle RPC. */
export function sameTaskForTrash(visible: Task, stored: Task): boolean {
  const columns = ['id', 'user_id', 'title', 'done', 'priority', 'due_date', 'review_date',
    'description', 'waiting_on', 'estimated_minutes', 'linked_event_id', 'reschedule_count'] as const;
  if (!columns.every((column) => visible[column] === stored[column])) return false;
  if ((visible.due_time ?? '').slice(0, 5) !== (stored.due_time ?? '').slice(0, 5)) return false;
  if (JSON.stringify(visible.tags) !== JSON.stringify(stored.tags)) return false;
  for (const column of ['priority_set_at', 'reminder_sent_at', 'last_chased_at',
    'chase_snoozed_until', 'deleted_at', 'restored_at'] as const) {
    const a = visible[column];
    const b = stored[column];
    if (a == null && b == null) continue;
    if (a == null || b == null || Date.parse(a) !== Date.parse(b)) return false;
  }
  return true;
}
