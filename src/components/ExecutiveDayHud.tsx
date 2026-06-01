import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingReport } from '../lib/assistantBriefing';
import { listChaseCandidates, snoozeChaseUntil } from '../lib/delegationChase';
import {
  computeDayHudMetrics,
  formatHudHours,
  gapKindLabel,
  type DayHudMetrics,
} from '../lib/dayHudMetrics';
import type { DirectiveReport } from '../lib/executiveDirective';
import { formatDayEndLabel } from '../lib/executiveDirective';
import { viewPath } from '../lib/routes';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';
import { ArrowRightIcon, CalendarIcon, CheckSquareIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';

type ExecutiveDayHudProps = {
  directive: DirectiveReport;
  briefing?: BriefingReport | null;
};

function scoreTone(score: number): { ring: string; text: string; bg: string } {
  if (score >= 80) {
    return {
      ring: 'border-emerald-500/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-600/10',
    };
  }
  if (score >= 60) {
    return {
      ring: 'border-brand-500/40',
      text: 'text-brand-700 dark:text-brand-300',
      bg: 'bg-brand-600/10',
    };
  }
  if (score >= 40) {
    return {
      ring: 'border-amber-500/40',
      text: 'text-amber-800 dark:text-amber-200',
      bg: 'bg-amber-600/10',
    };
  }
  return {
    ring: 'border-red-500/40',
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-600/10',
  };
}

function DayScoreCard({ metrics }: { metrics: DayHudMetrics }) {
  const tone = scoreTone(metrics.dayScore);
  return (
    <Card padded="sm" className={['border-2', tone.ring].join(' ')}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Day score</p>
      <div className="mt-2 flex items-end gap-2">
        <span className={['text-4xl font-semibold tabular-nums leading-none', tone.text].join(' ')}>
          {metrics.dayScore}
        </span>
        <Badge variant="subtle" className={['mb-0.5', tone.bg, tone.text].join(' ')}>
          {metrics.dayScoreLabel}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">
        {metrics.overcommitMinutes > 0
          ? `~${formatHudHours(metrics.overcommitMinutes)} over remaining capacity`
          : `${formatHudHours(metrics.remainingMinutes)} left until ${formatDayEndLabel()}`}
      </p>
    </Card>
  );
}

function CapacityCard({ metrics }: { metrics: DayHudMetrics }) {
  const pct = metrics.remainingMinutes > 0
    ? Math.min(100, Math.round((metrics.bookedMinutes / metrics.remainingMinutes) * 100))
    : metrics.bookedMinutes > 0
      ? 100
      : 0;
  const barTone =
    pct > 100 || metrics.capacityRatio > 1
      ? 'bg-red-500'
      : pct >= 85
        ? 'bg-amber-500'
        : 'bg-brand-500';

  return (
    <Card padded="sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Capacity</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-text">
        {formatHudHours(metrics.bookedMinutes)}
        <span className="text-sm font-normal text-text-muted"> / {formatHudHours(metrics.remainingMinutes)}</span>
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={['h-full rounded-full transition-all', barTone].join(' ')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <ul className="mt-2.5 space-y-0.5 text-[11px] text-text-muted">
        <li>{formatHudHours(metrics.meetingMinutes)} meetings</li>
        <li>{formatHudHours(metrics.workMinutes)} timed work</li>
        {metrics.unscheduledMinutes > 0 && (
          <li>{formatHudHours(metrics.unscheduledMinutes)} unscheduled work</li>
        )}
        {metrics.explicitEstimateCount > 0 && (
          <li className="text-text-subtle">{metrics.explicitEstimateCount} with your estimates</li>
        )}
      </ul>
    </Card>
  );
}

function AttentionCard({ directive, metrics }: { directive: DirectiveReport; metrics: DayHudMetrics }) {
  const topGaps = directive.gaps.slice(0, 3);
  return (
    <Card padded="sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Needs you</p>
      <p className="mt-2 text-lg font-semibold text-text">
        {metrics.gapCount}
        <span className="text-sm font-normal text-text-muted"> open loop{metrics.gapCount === 1 ? '' : 's'}</span>
      </p>
      {metrics.criticalGapCount > 0 && (
        <Badge variant="red" className="mt-2">
          {metrics.criticalGapCount} critical
        </Badge>
      )}
      {topGaps.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
          {topGaps.map((g) => (
            <li key={g.id} className="flex items-start gap-2 text-xs">
              <span
                className={[
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  g.severity === 'critical' ? 'bg-red-500' : g.severity === 'warning' ? 'bg-amber-500' : 'bg-brand-500',
                ].join(' ')}
              />
              <span className="min-w-0 flex-1 truncate text-text-muted" title={g.headline}>
                <span className="font-medium text-text-subtle">{gapKindLabel(g.kind)}:</span> {g.headline}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkloadCard({ metrics }: { metrics: DayHudMetrics }) {
  const navigate = useNavigate();
  return (
    <Card padded="sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Workload</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        {metrics.criticalTasks > 0 && (
          <div>
            <p className="text-lg font-semibold tabular-nums text-red-700 dark:text-red-300">{metrics.criticalTasks}</p>
            <p className="text-[11px] text-text-muted">Critical</p>
          </div>
        )}
        {metrics.dueTodayCount > 0 && (
          <div>
            <p className="text-lg font-semibold tabular-nums text-text">{metrics.dueTodayCount}</p>
            <p className="text-[11px] text-text-muted">Due today</p>
          </div>
        )}
        {metrics.overdueCount > 0 && (
          <div>
            <p className="text-lg font-semibold tabular-nums text-amber-800 dark:text-amber-200">{metrics.overdueCount}</p>
            <p className="text-[11px] text-text-muted">Overdue</p>
          </div>
        )}
        {metrics.owedCount > 0 && (
          <div>
            <p className="text-lg font-semibold tabular-nums text-text">{metrics.owedCount}</p>
            <p className="text-[11px] text-text-muted">Owed to you</p>
          </div>
        )}
      </div>
      {metrics.criticalTasks === 0 && metrics.dueTodayCount === 0 && metrics.overdueCount === 0 && (
        <p className="mt-2 text-xs text-text-muted">No urgent task pressure right now.</p>
      )}
      <button
        type="button"
        onClick={() => navigate(viewPath('tasks'))}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
      >
        Open tasks
        <ArrowRightIcon className="h-3 w-3" />
      </button>
    </Card>
  );
}

function MeetingsCard({ metrics }: { metrics: DayHudMetrics }) {
  const navigate = useNavigate();
  return (
    <Card padded="sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Calendar</p>
      <div className="mt-2 flex items-center gap-2">
        <CalendarIcon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <p className="text-lg font-semibold text-text">
          {metrics.meetingsToday}
          <span className="text-sm font-normal text-text-muted"> today</span>
        </p>
      </div>
      {metrics.backToBackCount > 0 && (
        <Badge variant="amber" className="mt-2">
          {metrics.backToBackCount} back-to-back
        </Badge>
      )}
      {metrics.overlapCount > 0 && (
        <Badge variant="red" className="mt-2 ml-1">
          {metrics.overlapCount} conflict{metrics.overlapCount > 1 ? 's' : ''}
        </Badge>
      )}
      <button
        type="button"
        onClick={() => navigate(viewPath('calendar'))}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
      >
        Open calendar
        <ArrowRightIcon className="h-3 w-3" />
      </button>
    </Card>
  );
}

function DelegationChaseCard({ tasks, onRefresh }: { tasks: Task[]; onRefresh?: () => void }) {
  const navigate = useNavigate();
  const snoozeChase = useTasksStore((s) => s.snoozeChase);
  const recordChase = useTasksStore((s) => s.recordChase);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const items = useMemo(() => listChaseCandidates(tasks), [tasks]);

  if (items.length === 0) {
    const owedOpen = tasks.filter((t) => !t.done && t.waiting_on?.trim()).length;
    return (
      <Card padded="sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Delegation chase</p>
        <p className="mt-2 text-sm text-text-muted">No stale follow-ups right now.</p>
        {owedOpen > 0 && (
          <button
            type="button"
            onClick={() => navigate(viewPath('owed'))}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
          >
            {owedOpen} open on Owed to me
            <ArrowRightIcon className="h-3 w-3" />
          </button>
        )}
      </Card>
    );
  }

  return (
    <Card padded="sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Delegation chase</p>
        <Badge variant="amber">{items.length}</Badge>
      </div>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.taskId} className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-text" title={item.title}>
              {item.title}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              Waiting on <span className="font-medium text-text-subtle">{item.waitingOn}</span>
              {' · '}
              {item.daysIdle}d idle
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn-primary py-1 text-[11px]"
                onClick={() => {
                  void recordChase(item.taskId).then(() => onRefresh?.());
                }}
              >
                Chase
              </button>
              <button
                type="button"
                className="btn-ghost py-1 text-[11px]"
                onClick={() => {
                  void snoozeChase(item.taskId, snoozeChaseUntil()).then(() => onRefresh?.());
                }}
              >
                Snooze
              </button>
              <button
                type="button"
                className="btn-ghost py-1 text-[11px]"
                onClick={() => {
                  void toggleDone(item.taskId, true).then(() => onRefresh?.());
                }}
              >
                Received
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => navigate(viewPath('owed'))}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
      >
        All owed items
        <ArrowRightIcon className="h-3 w-3" />
      </button>
    </Card>
  );
}

function ReservedSlot({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Card padded="sm" tone="sunken" className="border border-dashed border-border">
      <div className="flex items-start gap-3 opacity-70">
        <span className="mt-0.5 text-text-muted">{icon}</span>
        <div>
          <p className="text-sm font-medium text-text-muted">{title}</p>
          <p className="mt-0.5 text-xs text-text-subtle">{subtitle}</p>
        </div>
      </div>
    </Card>
  );
}

export function ExecutiveDayHud({ directive, briefing }: ExecutiveDayHudProps) {
  const metrics = useMemo(
    () => computeDayHudMetrics(directive, briefing),
    [directive, briefing],
  );

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5 xl:gap-4">
        <DayScoreCard metrics={metrics} />
        <CapacityCard metrics={metrics} />
        <AttentionCard directive={directive} metrics={metrics} />
        <MeetingsCard metrics={metrics} />
        <WorkloadCard metrics={metrics} />
      </div>
    </div>
  );
}

export function ExecutiveHudSidebar({
  tasks,
  onRefresh,
}: {
  tasks: Task[];
  onRefresh?: () => void;
}) {
  return (
    <div className="space-y-3">
      <DelegationChaseCard tasks={tasks} onRefresh={onRefresh} />
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-subtle">Later phases</p>
      <ReservedSlot
        icon={<CheckSquareIcon className="h-4 w-4" />}
        title="Decision queue"
        subtitle="Commit, delegate, or drop — expands on Focus stack"
      />
      <ReservedSlot
        icon={<CalendarIcon className="h-4 w-4" />}
        title="Evening close-out"
        subtitle="Done today, carry forward, tomorrow #1"
      />
    </div>
  );
}

export { computeDayHudMetrics, formatHudHours };
