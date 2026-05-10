import { useCallback, useMemo, useState } from 'react';
import {
  computeDailyBuckets,
  computeWeeklyBuckets,
  type TimeChartBucket,
} from '../lib/timeTrackingCharts';
import { formatDurationSeconds, formatDurationShort } from '../lib/timeTrackingFormat';
import type { TimeProject } from '../types';
import { Card } from './ui/Card';

const DAILY_COUNT = 14;
const WEEKLY_COUNT = 8;

/** Distinct fill colors for project segments (Tailwind, full opacity for contrast on sunken cards). */
const PROJECT_FILL_CLASSES = [
  'bg-brand-600 dark:bg-brand-500',
  'bg-emerald-600 dark:bg-emerald-500',
  'bg-amber-600 dark:bg-amber-500',
  'bg-violet-600 dark:bg-violet-500',
  'bg-rose-600 dark:bg-rose-500',
  'bg-cyan-600 dark:bg-cyan-500',
  'bg-orange-600 dark:bg-orange-500',
  'bg-fuchsia-600 dark:bg-fuchsia-500',
];

/** Neutral bucket for unassigned time — readable on light/dark surfaces (not text-muted translucency). */
const NO_PROJECT_FILL = 'bg-zinc-500 dark:bg-zinc-500';

export function TimeTrackingBarChart({
  completed,
  tz,
  projects,
}: {
  completed: { started_at: string; ended_at: string; project_id: string | null }[];
  tz: string;
  projects: TimeProject[];
}) {
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');

  const resolveProjectName = useCallback(
    (id: string | null) => {
      if (!id) return 'No project';
      return projects.find((p) => p.id === id)?.name ?? 'Removed project';
    },
    [projects],
  );

  const dailyBuckets = useMemo(
    () => computeDailyBuckets(completed, tz, DAILY_COUNT, resolveProjectName),
    [completed, tz, resolveProjectName],
  );
  const weeklyBuckets = useMemo(
    () => computeWeeklyBuckets(completed, tz, WEEKLY_COUNT, resolveProjectName),
    [completed, tz, resolveProjectName],
  );

  const buckets: TimeChartBucket[] = mode === 'daily' ? dailyBuckets : weeklyBuckets;
  const maxSec = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.seconds)),
    [buckets],
  );
  const totalPeriod = useMemo(() => buckets.reduce((s, b) => s + b.seconds, 0), [buckets]);
  const hasAny = totalPeriod > 0;

  const projectOrder = useMemo(() => {
    const seen = new Set<string | null>();
    const order: (string | null)[] = [];
    for (const b of buckets) {
      for (const s of b.segments) {
        const id = s.projectId;
        if (seen.has(id)) continue;
        seen.add(id);
        order.push(id);
      }
    }
    order.sort((a, b) => {
      if (a === null && b !== null) return -1;
      if (a !== null && b === null) return 1;
      return resolveProjectName(a).localeCompare(resolveProjectName(b), undefined, {
        sensitivity: 'base',
      });
    });
    return order;
  }, [buckets, resolveProjectName]);

  const fillClassForProject = useCallback(
    (projectId: string | null) => {
      if (projectId === null) return NO_PROJECT_FILL;
      const namedOrder = projectOrder.filter((id): id is string => id !== null);
      const colorIdx = namedOrder.indexOf(projectId);
      if (colorIdx < 0) return PROJECT_FILL_CLASSES[0] ?? NO_PROJECT_FILL;
      return (
        PROJECT_FILL_CLASSES[colorIdx % PROJECT_FILL_CLASSES.length] ?? NO_PROJECT_FILL
      );
    },
    [projectOrder],
  );

  const projectTotals = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const b of buckets) {
      for (const s of b.segments) {
        m.set(s.projectId, (m.get(s.projectId) ?? 0) + s.seconds);
      }
    }
    return projectOrder
      .filter((id) => (m.get(id) ?? 0) > 0)
      .map((id) => ({
        projectId: id,
        name: resolveProjectName(id),
        seconds: m.get(id) ?? 0,
        fillClass: fillClassForProject(id),
      }));
  }, [buckets, projectOrder, resolveProjectName, fillClassForProject]);

  return (
    <Card tone="sunken">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">Activity</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Tracked time by{' '}
            {mode === 'daily' ? `day (last ${DAILY_COUNT} days)` : `week (last ${WEEKLY_COUNT} weeks)`}{' '}
            in your profile timezone. Bars stack by project; sessions count on the day they started.
          </p>
        </div>
        <div
          className="flex rounded-lg bg-surface-raised p-0.5 ring-1 ring-border"
          role="tablist"
          aria-label="Chart range"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'daily'}
            className={[
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'daily'
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
            onClick={() => setMode('daily')}
          >
            Daily
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'weekly'}
            className={[
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              mode === 'weekly'
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
            onClick={() => setMode('weekly')}
          >
            Weekly
          </button>
        </div>
      </div>

      {hasAny ? (
        <p className="mt-3 text-xs text-text-muted">
          Total in view:{' '}
          <span className="font-mono font-medium text-text">{formatDurationSeconds(totalPeriod)}</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-text-muted">No completed sessions in this window yet.</p>
      )}

      <div
        className="mt-4"
        role="img"
        aria-label={`Tracked time ${mode} chart by project, ${formatDurationShort(totalPeriod)} total`}
      >
        <div className="flex h-[7.5rem] gap-1 sm:h-36 sm:gap-1.5">
          {buckets.map((b) => {
            const pctRaw = maxSec > 0 ? (b.seconds / maxSec) * 100 : 0;
            const pct = b.seconds > 0 ? Math.max(pctRaw, 6) : 0;
            const tip = `${b.label}: ${formatDurationShort(b.seconds)} (${formatDurationSeconds(b.seconds)})`;
            return (
              <div key={`${mode}-${b.key}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col justify-end">
                  {b.seconds > 0 && b.segments.length > 0 ? (
                    <div
                      title={tip}
                      className="flex w-full min-h-[4px] flex-col justify-end divide-y divide-black/[0.12] overflow-hidden rounded-t-md ring-1 ring-border/60 dark:divide-white/[0.14]"
                      style={{ height: `${pct}%` }}
                    >
                      {[...b.segments].reverse().map((s) => (
                        <div
                          key={`${b.key}-${s.projectId ?? 'none'}`}
                          title={`${s.name}: ${formatDurationShort(s.seconds)}`}
                          className={[
                            'min-h-[2px] w-full shrink-0',
                            fillClassForProject(s.projectId),
                          ].join(' ')}
                          style={{ flexGrow: s.seconds, flexBasis: 0 }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      title={tip}
                      className="h-0.5 w-full shrink-0 rounded-sm bg-border/70"
                      aria-hidden
                    />
                  )}
                </div>
                <span
                  className="mt-1 block h-7 max-w-full truncate text-center text-[10px] font-medium leading-tight text-text-subtle sm:text-[11px]"
                  title={b.label}
                >
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {hasAny && projectTotals.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
            Total by project (this view)
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {projectTotals.map((row) => (
              <li
                key={row.projectId ?? 'none'}
                className="flex min-w-0 max-w-full items-center gap-2 text-xs text-text-muted"
              >
                <span
                  className={[
                    'h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/15 dark:ring-white/20',
                    row.fillClass,
                  ].join(' ')}
                  aria-hidden
                />
                <span className="min-w-0 truncate font-medium text-text" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-text">
                  {formatDurationSeconds(row.seconds)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
