import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingInsight } from '../lib/assistantBriefing';
import type { ActionItem } from '../lib/format';
import {
  commitActionToToday,
  commitTaskToToday,
  scheduleActionForTomorrow,
  scheduleTaskForTomorrow,
  type CommitWorkContext,
} from '../lib/commitWorkToday';
import {
  highPriorityNoDueDateTasks,
  insightActionRef,
  insightTaskId,
  isHighPriorityNoDateInsight,
  isRescheduleOffenderInsight,
  isStaleActionItemInsight,
  lowerPriorityOneLevel,
} from '../lib/decisionQueue';
import type { FocusQueuePrefs } from '../lib/focusQueue';
import type { TaskPriority } from '../lib/priority';
import { viewPath } from '../lib/routes';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import type { Note, Task } from '../types';

const SEVERITY_STYLE: Record<BriefingInsight['severity'], {
  border: string;
  bg: string;
  badge: string;
  dot: string;
}> = {
  critical: {
    border: 'border-l-red-500',
    bg: 'bg-red-50 dark:bg-red-950/20',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    dot: 'bg-red-500',
  },
  warning: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  decision: {
    border: 'border-l-brand-500',
    bg: 'bg-brand-50 dark:bg-brand-950/20',
    badge: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  info: {
    border: 'border-l-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    dot: 'bg-blue-400',
  },
};

type DecisionInsightCardProps = {
  insight: BriefingInsight;
  todayIso: string;
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  tasks: Task[];
  notes: Note[];
  actionItems: ActionItem[];
  onDismiss?: () => void;
  onRefresh?: () => void;
  variant?: 'compact' | 'card';
};

export function DecisionInsightCard({
  insight,
  todayIso,
  focusPrefs,
  onFocusPrefsUpdate,
  tasks,
  notes,
  actionItems,
  onDismiss,
  onRefresh,
  variant = 'compact',
}: DecisionInsightCardProps) {
  const navigate = useNavigate();
  const setActiveNote = useNotesStore((s) => s.setActive);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setDueTime = useTasksStore((s) => s.setDueTime);
  const setTaskPriority = useTasksStore((s) => s.setTaskPriority);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const updateNote = useNotesStore((s) => s.updateNote);
  const [busy, setBusy] = useState(false);

  const taskId = insightTaskId(insight);
  const actionRef = insightActionRef(insight);
  const task = taskId ? tasks.find((t) => t.id === taskId) : null;
  const undatedHigh = isHighPriorityNoDateInsight(insight)
    ? highPriorityNoDueDateTasks(tasks).slice(0, 3)
    : [];

  const ctx: CommitWorkContext = useMemo(
    () => ({
      todayIso,
      focusPrefs,
      onFocusPrefsUpdate,
      tasks,
      notes,
      actionItems,
      setDueDate,
      setDueTime,
      setTaskPriority,
      updateNote,
    }),
    [
      todayIso,
      focusPrefs,
      onFocusPrefsUpdate,
      tasks,
      notes,
      actionItems,
      setDueDate,
      setDueTime,
      setTaskPriority,
      updateNote,
    ],
  );

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const actions: Array<{ label: string; primary?: boolean; onClick: () => void }> = [];

  if (taskId && task) {
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () =>
        void run(async () => {
          await commitTaskToToday(taskId, ctx, {
            raisePriority: isRescheduleOffenderInsight(insight),
          });
          onDismiss?.();
        }),
    });
    if (isRescheduleOffenderInsight(insight)) {
      actions.push({
        label: 'Tomorrow',
        onClick: () =>
          void run(async () => {
            await scheduleTaskForTomorrow(taskId, ctx);
            onDismiss?.();
          }),
      });
      const lower = lowerPriorityOneLevel((task.priority as TaskPriority) ?? 'normal');
      if (lower) {
        actions.push({
          label: 'Lower priority',
          onClick: () =>
            void run(async () => {
              await setTaskPriority(taskId, lower);
              onDismiss?.();
            }),
        });
      }
      actions.push({
        label: 'Drop',
        onClick: () =>
          void run(async () => {
            const removed = await deleteTask(taskId);
            if (removed) onDismiss?.();
          }),
      });
    } else {
      actions.push({
        label: 'Open task',
        onClick: () => navigate(viewPath('tasks')),
      });
      actions.push({
        label: 'Tomorrow',
        onClick: () =>
          void run(async () => {
            await scheduleTaskForTomorrow(taskId, ctx);
            onDismiss?.();
          }),
      });
    }
  } else if (actionRef) {
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () =>
        void run(async () => {
          await commitActionToToday(actionRef.noteId, actionRef.line, ctx);
          onDismiss?.();
        }),
    });
    actions.push({
      label: 'Tomorrow',
      onClick: () =>
        void run(async () => {
          await scheduleActionForTomorrow(actionRef.noteId, actionRef.line, ctx);
          onDismiss?.();
        }),
    });
    actions.push({
      label: 'Open note',
      onClick: () => {
        setActiveNote(actionRef.noteId);
        navigate(viewPath('notes'));
      },
    });
  } else if (undatedHigh.length > 0) {
    const first = undatedHigh[0]!;
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () =>
        void run(async () => {
          await commitTaskToToday(first.id, ctx);
          if (undatedHigh.length <= 1) onDismiss?.();
        }),
    });
    actions.push({
      label: 'Tomorrow',
      onClick: () =>
        void run(async () => {
          await scheduleTaskForTomorrow(first.id, ctx);
          if (undatedHigh.length <= 1) onDismiss?.();
        }),
    });
    const lower = lowerPriorityOneLevel((first.priority as TaskPriority) ?? 'normal');
    if (lower) {
      actions.push({
        label: 'Lower priority',
        onClick: () =>
          void run(async () => {
            await setTaskPriority(first.id, lower);
            if (undatedHigh.length <= 1) onDismiss?.();
          }),
      });
    }
  } else if (isStaleActionItemInsight(insight)) {
    actions.push({
      label: 'Review notes',
      primary: true,
      onClick: () => navigate(viewPath('notes')),
    });
  } else if (insight.actionTarget?.kind === 'task') {
    const id = insight.actionTarget.id;
    actions.push({
      label: 'Do today',
      primary: true,
      onClick: () =>
        void run(async () => {
          await commitTaskToToday(id, ctx);
          onDismiss?.();
        }),
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

  const noteTarget = insight.actionTarget?.kind === 'note' ? insight.actionTarget : null;
  if (noteTarget) {
    actions.unshift({
      label: 'Open note',
      onClick: () => {
        setActiveNote(noteTarget.id);
        navigate(viewPath('notes'));
      },
    });
  }

  const actionButtons = (
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
      {onDismiss ? (
        <button
          type="button"
          disabled={busy}
          className="btn-ghost py-1 text-[11px] text-text-muted"
          onClick={onDismiss}
        >
          Not now
        </button>
      ) : null}
    </div>
  );

  if (variant === 'card') {
    const style = SEVERITY_STYLE[insight.severity];
    const severityLabel =
      insight.severity === 'decision'
        ? 'Decision'
        : insight.severity === 'critical'
          ? 'Critical'
          : insight.severity === 'warning'
            ? 'Watch'
            : 'Info';
    return (
      <div className={['rounded-xl border border-border border-l-4 p-4', style.border, style.bg].join(' ')}>
        <div className="flex items-start gap-3">
          <div className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot].join(' ')} />
          <div className="min-w-0 flex-1">
            <span className={['rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', style.badge].join(' ')}>
              {severityLabel}
            </span>
            <p className="mt-1.5 text-sm font-semibold text-text">{insight.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{insight.detail}</p>
            {actionButtons}
          </div>
        </div>
      </div>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2.5">
      <p className="text-sm font-medium leading-snug text-text">{insight.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{insight.detail}</p>
      {actionButtons}
    </li>
  );
}
