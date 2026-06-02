import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingInsight, BriefingReport } from '../lib/assistantBriefing';
import {
  highPriorityNoDueDateTasks,
  isHighPriorityNoDateInsight,
  isRescheduleOffenderInsight,
  listDecisionInsights,
  lowerPriorityOneLevel,
  raisePriorityOneLevel,
  taskRef,
} from '../lib/decisionQueue';
import { commitRefToFocusToday, tomorrowIsoFrom, type FocusQueuePrefs } from '../lib/focusQueue';
import type { TaskPriority } from '../lib/priority';
import { viewPath } from '../lib/routes';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import { ArrowRightIcon, BrainIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';

type ExecutiveDecisionQueueProps = {
  briefing: BriefingReport;
  todayIso: string;
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  dismissedIds: ReadonlySet<string>;
  onDismiss: (insightId: string) => void;
  onRefresh?: () => void;
};

function DecisionRow({
  insight,
  todayIso,
  focusPrefs,
  onFocusPrefsUpdate,
  onDismiss,
  onRefresh,
}: {
  insight: BriefingInsight;
  todayIso: string;
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  onDismiss: () => void;
  onRefresh?: () => void;
}) {
  const navigate = useNavigate();
  const setActiveNote = useNotesStore((s) => s.setActive);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setDueTime = useTasksStore((s) => s.setDueTime);
  const setTaskPriority = useTasksStore((s) => s.setTaskPriority);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const tasks = useTasksStore((s) => s.tasks);
  const [busy, setBusy] = useState(false);

  const taskId = insight.actionTarget?.kind === 'task' ? insight.actionTarget.id : null;
  const task = taskId ? tasks.find((t) => t.id === taskId) : null;
  const undatedHigh = isHighPriorityNoDateInsight(insight)
    ? highPriorityNoDueDateTasks(tasks).slice(0, 3)
    : [];

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const commitTaskToday = async (id: string, opts?: { raisePriority?: boolean }) => {
    onFocusPrefsUpdate(commitRefToFocusToday(focusPrefs, taskRef(id)));
    await setDueDate(id, todayIso);
    await setDueTime(id, null);
    if (opts?.raisePriority) {
      const t = tasks.find((x) => x.id === id);
      const raised = raisePriorityOneLevel((t?.priority as TaskPriority) ?? 'normal');
      if (raised) await setTaskPriority(id, raised);
    }
    onDismiss();
  };

  const openTask = () => navigate(viewPath('tasks'));
  const openNote = (noteId: string) => {
    setActiveNote(noteId);
    navigate(viewPath('notes'));
  };

  const actions: Array<{ label: string; primary?: boolean; onClick: () => void }> = [];

  if (taskId && task) {
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () =>
        void run(() =>
          commitTaskToday(taskId, {
            raisePriority: isRescheduleOffenderInsight(insight),
          }),
        ),
    });
    if (isRescheduleOffenderInsight(insight)) {
      actions.push({
        label: 'Tomorrow',
        onClick: () =>
          void run(async () => {
            const tomorrow = tomorrowIsoFrom(todayIso);
            await setDueDate(taskId, tomorrow);
            await setDueTime(taskId, null);
            onDismiss();
          }),
      });
      const lower = lowerPriorityOneLevel((task.priority as TaskPriority) ?? 'normal');
      if (lower) {
        actions.push({
          label: 'Lower priority',
          onClick: () =>
            void run(async () => {
              await setTaskPriority(taskId, lower);
              onDismiss();
            }),
        });
      }
      actions.push({
        label: 'Drop',
        onClick: () =>
          void run(async () => {
            const removed = await deleteTask(taskId);
            if (removed) onDismiss();
          }),
      });
    } else {
      actions.push({
        label: 'Open task',
        onClick: () => openTask(),
      });
      actions.push({
        label: 'Tomorrow',
        onClick: () =>
          void run(async () => {
            await setDueDate(taskId, tomorrowIsoFrom(todayIso));
            await setDueTime(taskId, null);
            onDismiss();
          }),
      });
    }
  } else if (undatedHigh.length > 0) {
    const first = undatedHigh[0]!;
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () => void run(() => commitTaskToday(first.id)),
    });
    actions.push({
      label: 'Tomorrow',
      onClick: () =>
        void run(async () => {
          await setDueDate(first.id, tomorrowIsoFrom(todayIso));
          if (undatedHigh.length <= 1) onDismiss();
        }),
    });
    const lower = lowerPriorityOneLevel((first.priority as TaskPriority) ?? 'normal');
    if (lower) {
      actions.push({
        label: 'Lower priority',
        onClick: () =>
          void run(async () => {
            await setTaskPriority(first.id, lower);
            if (undatedHigh.length <= 1) onDismiss();
          }),
      });
    }
  } else if (insight.headline.includes('note action item')) {
    actions.push({
      label: 'Review notes',
      primary: true,
      onClick: () => navigate(viewPath('notes')),
    });
  } else if (insight.actionTarget?.kind === 'task') {
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () => void run(() => commitTaskToday(insight.actionTarget!.id)),
    });
    actions.push({
      label: 'Open tasks',
      onClick: () => navigate(viewPath('tasks')),
    });
  } else {
    actions.push({
      label: 'Open tasks',
      primary: true,
      onClick: () => navigate(viewPath('tasks')),
    });
  }

  if (insight.actionTarget?.kind === 'note') {
    actions.unshift({
      label: 'Open note',
      onClick: () => openNote(insight.actionTarget!.id),
    });
  }

  return (
    <li className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2.5">
      <p className="text-sm font-medium leading-snug text-text">{insight.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{insight.detail}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={busy}
            className={a.primary ? 'btn-primary py-1 text-[11px]' : 'btn-ghost py-1 text-[11px]'}
            onClick={a.onClick}
            title={a.label === 'Do today' ? 'Due today, pin to #1 on focus stack' : undefined}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          className="btn-ghost py-1 text-[11px] text-text-muted"
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    </li>
  );
}

export function ExecutiveDecisionQueue({
  briefing,
  todayIso,
  focusPrefs,
  onFocusPrefsUpdate,
  dismissedIds,
  onDismiss,
  onRefresh,
}: ExecutiveDecisionQueueProps) {
  const navigate = useNavigate();
  const items = useMemo(
    () => listDecisionInsights(briefing, dismissedIds),
    [briefing, dismissedIds],
  );

  if (items.length === 0) {
    return (
      <Card padded="sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
            Decisions needed
          </p>
          <Badge variant="subtle">0</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Nothing waiting on a call from you.
        </p>
      </Card>
    );
  }

  return (
    <Card padded="sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
          Decisions needed
        </p>
        <Badge variant="brand">{items.length}</Badge>
      </div>
      <ul className="mt-3 space-y-2.5">
        {items.map((insight) => (
          <DecisionRow
            key={insight.id}
            insight={insight}
            todayIso={todayIso}
            focusPrefs={focusPrefs}
            onFocusPrefsUpdate={onFocusPrefsUpdate}
            onDismiss={() => onDismiss(insight.id)}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => navigate(viewPath('assistant'))}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
      >
        <BrainIcon className="h-3.5 w-3.5" />
        Full briefing
        <ArrowRightIcon className="h-3 w-3" />
      </button>
    </Card>
  );
}
