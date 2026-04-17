import type { TaskPriority } from './priority';

/**
 * Horizontal tint that always fades into the theme panel (`surface-raised`).
 * One shared curve (from → via → to) so every tier matches the “priority → surface” feel.
 */
const fadeToSurface = 'bg-gradient-to-r to-surface-raised';

/**
 * Critical: Tailwind `from-red/… to-surface-raised` can look like a flat slab in **dark** mode
 * because translucent red mixes with charcoal into one muddy tone. This gradient fades by
 * alpha into the actual theme surface token so light + dark both show a clear left → right wash.
 */
/** red-700 family — reads as true “alarm” red on white, not rose/pink */
const CRITICAL_ROW_BG =
  'bg-[linear-gradient(90deg,rgba(185,28,28,0.16)_0%,rgba(185,28,28,0.055)_34%,rgba(185,28,28,0.018)_52%,rgb(var(--surface-raised))_100%)]';

const CRITICAL_ROW_BORDER = 'border-l-8 border-solid border-red-600 dark:border-red-500';

/** Left/mid stops tuned per hue so light mode reads like a wash (not a flat slab). */
const ROW_TINT: Record<Exclude<TaskPriority, 'critical'>, { fromVia: string; border: string }> = {
  urgent: {
    fromVia:
      'from-amber-400/15 via-amber-300/5 dark:from-amber-400/14 dark:via-amber-400/5',
    border: 'border-l-[6px] border-solid border-amber-500 dark:border-amber-400',
  },
  high: {
    fromVia:
      'from-emerald-400/15 via-emerald-500/5 dark:from-emerald-400/15 dark:via-emerald-400/5',
    border: 'border-l-[5px] border-emerald-500 py-[0.9rem] dark:border-emerald-400',
  },
  normal: {
    fromVia:
      'from-indigo-400/15 via-indigo-500/5 dark:from-indigo-400/15 dark:via-indigo-400/5',
    border: 'border-l-[3px] border-indigo-500 dark:border-indigo-400',
  },
  low: {
    fromVia:
      'from-neutral-400/12 via-neutral-500/4 dark:from-neutral-400/10 dark:via-neutral-400/4',
    border: 'border-l-2 border-dashed border-text-muted/50 dark:border-text-muted/40',
  },
};

const ROW_PY: Record<TaskPriority, string> = {
  critical: 'py-4',
  urgent: 'py-4',
  high: 'py-[0.9rem]',
  normal: 'py-3',
  low: 'py-2.5',
};

/** Row shell: priority tint fades left → right into theme surface (same pattern for all tiers). */
export function priorityRowClass(p: TaskPriority): string {
  const base =
    'relative flex items-start gap-3 px-4 transition-[background-color,border-color,opacity] duration-150';
  if (p === 'critical') {
    return [base, CRITICAL_ROW_BG, CRITICAL_ROW_BORDER, ROW_PY.critical].join(' ');
  }
  const spec = ROW_TINT[p];
  return [base, fadeToSurface, spec.fromVia, spec.border, ROW_PY[p]].join(' ');
}

/**
 * Tier name as plain text (no pill) — same hues as the row edge so color ↔ label is obvious.
 */
export function priorityInlineLabelClass(p: TaskPriority): string {
  const base = 'text-[11px] font-semibold leading-none tracking-tight';
  switch (p) {
    case 'critical':
      return `${base} text-red-700 dark:text-red-400`;
    case 'urgent':
      return `${base} text-amber-800 dark:text-amber-300`;
    case 'high':
      return `${base} text-emerald-700 dark:text-emerald-400`;
    case 'normal':
      return `${base} text-indigo-700 dark:text-indigo-300`;
    case 'low':
      return `${base} text-text-muted`;
  }
}

export function priorityTitleClass(p: TaskPriority): string {
  switch (p) {
    case 'critical':
      return 'text-[15px] font-extrabold leading-snug tracking-tight text-red-950 dark:text-red-50';
    case 'urgent':
      return 'text-[15px] font-bold leading-snug tracking-tight text-amber-950 dark:text-amber-50';
    case 'high':
      return 'text-sm font-semibold leading-snug text-emerald-950 dark:text-emerald-50';
    case 'normal':
      return 'text-sm font-medium leading-snug text-text';
    case 'low':
      return 'text-sm font-normal leading-snug text-text-muted';
  }
}

export function prioritySelectClass(p: TaskPriority): string {
  switch (p) {
    case 'critical':
      return 'border-red-300/90 bg-red-50 text-red-950 dark:border-red-500/55 dark:bg-red-950/65 dark:text-red-50';
    case 'urgent':
      return 'border-amber-400/90 bg-amber-50 text-amber-950 dark:border-amber-500/55 dark:bg-amber-950/50 dark:text-amber-100';
    case 'high':
      return 'border-emerald-300/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-600/45 dark:bg-emerald-950/35 dark:text-emerald-50';
    case 'normal':
      return 'border-indigo-200/80 bg-indigo-50/50 text-text dark:border-indigo-500/40 dark:bg-indigo-950/35 dark:text-indigo-100';
    case 'low':
      return 'border-border bg-surface text-text-muted';
  }
}
