/** Postgres `time` and HTML `type="time"` helpers for task due scheduling. */

export function normalizeDueTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function formatDueTimeDisplay(value: string | null | undefined): string {
  const t = normalizeDueTime(value);
  if (!t) return '';
  const [h, min] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Timed tasks first (earliest first); untimed tasks after; nulls last within each group. */
export function compareDueTime(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeDueTime(a ?? null);
  const nb = normalizeDueTime(b ?? null);
  if (na === nb) return 0;
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na < nb ? -1 : 1;
}

export function dueDateStatus(dueDate: string | null): 'none' | 'overdue' | 'today' | 'upcoming' {
  if (!dueDate) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  return 'upcoming';
}

export function dueDateLabel(dueDate: string): string {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 7) return `Due in ${diffDays}d`;
  return `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function taskDueLabel(dueDate: string, dueTime: string | null | undefined): string {
  const timeStr = formatDueTimeDisplay(dueTime);
  if (!timeStr) return dueDateLabel(dueDate);
  const status = dueDateStatus(dueDate);
  if (status === 'today') return `Today · ${timeStr}`;
  return `${dueDateLabel(dueDate)} · ${timeStr}`;
}

export const DUE_DATE_STYLE: Record<ReturnType<typeof dueDateStatus>, string> = {
  none: '',
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-600 dark:text-amber-400',
  upcoming: 'text-text-muted',
};
