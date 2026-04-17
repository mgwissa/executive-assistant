import type { TaskPriority } from '../../lib/priority';
import { PRIORITY_PILL } from '../../lib/priority';

type Props = { priority: TaskPriority; className?: string };

export function PriorityBadge({ priority: p, className = '' }: Props) {
  const ring: Record<TaskPriority, string> = {
    critical:
      'border border-red-500/90 bg-red-700 text-white shadow-md dark:border-red-400/80 dark:bg-red-600 dark:text-white dark:shadow-md',
    urgent:
      'border border-amber-800/35 bg-amber-600 text-white shadow-sm dark:border-amber-300/40 dark:bg-amber-500 dark:text-white',
    high: 'border border-emerald-800/25 bg-emerald-600 text-white shadow-sm dark:border-emerald-300/25 dark:bg-emerald-500',
    normal:
      'border border-indigo-800/25 bg-indigo-600 text-white dark:border-indigo-300/30 dark:bg-indigo-500 dark:text-white',
    low: 'border border-dashed border-text-muted/55 bg-surface-raised text-text-muted dark:bg-surface-sunken',
  };
  return (
    <span
      className={[
        'inline-flex shrink-0 select-none items-center justify-center rounded-full px-2.5 py-1',
        'max-w-full whitespace-nowrap text-center text-[11px] font-semibold leading-none tracking-tight',
        ring[p],
        className,
      ].join(' ')}
    >
      {PRIORITY_PILL[p]}
    </span>
  );
}
