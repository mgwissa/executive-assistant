import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActionItem } from '../lib/format';
import {
  buildFocusStack,
  deferFromFocusStack,
  focusStackHint,
  pinToTopOfFocusStack,
  reorderFocusStack,
  type FocusQueuePrefs,
} from '../lib/focusQueue';
import type { DirectiveReport, FocusWorkItem, WorkItemRef } from '../lib/executiveDirective';
import { formatDueTimeDisplay } from '../lib/taskSchedule';
import { PRIORITY_PILL } from '../lib/priority';
import { priorityInlineLabelClass, priorityRowClass, priorityTitleClass } from '../lib/priorityUiClasses';
import { viewPath } from '../lib/routes';
import { useNotesStore } from '../store/useNotesStore';
import type { Task } from '../types';
import { ChevronDownIcon, PinIcon, SquareIcon, TargetIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionHeader } from './ui/SectionHeader';

type ExecutiveFocusStackProps = {
  directive: DirectiveReport;
  tasks: Task[];
  actionItems: ActionItem[];
  prefs: FocusQueuePrefs;
  disabled?: boolean;
  onUpdatePrefs: (next: FocusQueuePrefs) => void;
  onToggleTask: (id: string, done: boolean) => void;
  onToggleAction: (noteId: string, line: number) => void;
};

function rowRef(item: FocusWorkItem): WorkItemRef {
  if (item.kind === 'task' && item.taskId) {
    return { kind: 'task', taskId: item.taskId };
  }
  return { kind: 'action', noteId: item.noteId!, line: item.line! };
}

export function ExecutiveFocusStack({
  directive,
  tasks,
  actionItems,
  prefs,
  disabled = false,
  onUpdatePrefs,
  onToggleTask,
  onToggleAction,
}: ExecutiveFocusStackProps) {
  const navigate = useNavigate();
  const setActiveNote = useNotesStore((s) => s.setActive);
  const items = useMemo(
    () => buildFocusStack(tasks, actionItems, directive.todayIso, prefs),
    [tasks, actionItems, directive.todayIso, prefs],
  );

  const hint = focusStackHint(
    directive.now.kind,
    directive.now.kind === 'in_meeting',
  );

  const openItem = (item: FocusWorkItem) => {
    if (item.kind === 'task' && item.taskId) {
      navigate(viewPath('tasks'));
      return;
    }
    if (item.noteId) {
      setActiveNote(item.noteId);
      navigate(viewPath('notes'));
    }
  };

  return (
    <section>
      <SectionHeader
        icon={<TargetIcon className="h-4 w-4" />}
        title="Focus stack"
        count={items.length}
        accent="brand"
      />
      <Card padded="none" className="mt-3 overflow-hidden">
        <div className="border-b border-border bg-surface-raised/40 px-4 py-2.5">
          <p className="text-xs leading-relaxed text-text-subtle">{hint}</p>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={<TargetIcon className="h-5 w-5" />}
            title="Stack is clear"
            message="No critical or due-today work right now. Capture something above or check back after your meeting."
          />
        ) : (
          <ol className="divide-y divide-border">
            {items.map((item, index) => {
              const ref = rowRef(item);
              const rank = index + 1;
              const isTop = index === 0;
              const pinToTop = () => onUpdatePrefs(pinToTopOfFocusStack(prefs, items, ref));
              return (
                <li
                  key={item.id}
                  className={[
                    priorityRowClass(item.priority),
                    isTop ? 'ring-1 ring-inset ring-brand-500/25' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    disabled={disabled || isTop}
                    onClick={pinToTop}
                    className={[
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-colors',
                      isTop
                        ? 'cursor-default bg-brand-600 text-white dark:bg-brand-500'
                        : 'bg-surface-sunken text-text-muted ring-1 ring-border hover:bg-brand-600/15 hover:text-brand-700 hover:ring-brand-500/40 disabled:hover:bg-surface-sunken disabled:hover:text-text-muted',
                    ].join(' ')}
                    aria-label={isTop ? 'Current focus (#1)' : `Pin to #1: ${item.title}`}
                    title={isTop ? 'Current focus' : 'Pin to #1'}
                  >
                    {rank}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      item.kind === 'task' && item.taskId
                        ? void onToggleTask(item.taskId, true)
                        : void onToggleAction(item.noteId!, item.line!)
                    }
                    className="mt-0.5 shrink-0 text-text-subtle hover:text-brand-700 disabled:opacity-50"
                    aria-label="Mark done"
                    title="Mark done"
                  >
                    <SquareIcon className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={priorityInlineLabelClass(item.priority)}>
                        {PRIORITY_PILL[item.priority]}
                      </span>
                      {item.dueTime ? (
                        <Badge variant="subtle" className="text-[10px]">
                          {formatDueTimeDisplay(item.dueTime)}
                        </Badge>
                      ) : null}
                      {item.estimatedMinutes != null && item.estimatedMinutes > 0 ? (
                        <Badge variant="subtle" className="text-[10px]">
                          {item.estimatedMinutes < 60
                            ? `${item.estimatedMinutes}m`
                            : `${(item.estimatedMinutes / 60).toFixed(1)}h`}
                        </Badge>
                      ) : null}
                      {item.kind === 'action' ? (
                        <Badge variant="purple" className="text-[10px]">
                          Note
                        </Badge>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={[
                        'mt-0.5 block w-full text-left leading-snug hover:text-brand-700',
                        priorityTitleClass(item.priority),
                      ].join(' ')}
                    >
                      {item.title}
                    </button>
                    {item.waitingOn?.trim() ? (
                      <p className="mt-1 text-xs text-text-muted">
                        Waiting on {item.waitingOn.trim()}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={disabled || isTop}
                      onClick={pinToTop}
                      className="btn-ghost h-7 w-7 p-0 disabled:opacity-30"
                      aria-label="Pin to top"
                      title="Pin to #1"
                    >
                      <PinIcon className="mx-auto h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      onClick={() =>
                        onUpdatePrefs(reorderFocusStack(prefs, items, ref, 'up'))
                      }
                      className="btn-ghost h-7 w-7 p-0 disabled:opacity-30"
                      aria-label="Move up"
                      title="Move up"
                    >
                      <ChevronDownIcon className="mx-auto h-4 w-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === items.length - 1}
                      onClick={() =>
                        onUpdatePrefs(reorderFocusStack(prefs, items, ref, 'down'))
                      }
                      className="btn-ghost h-7 w-7 p-0 disabled:opacity-30"
                      aria-label="Move down"
                      title="Move down"
                    >
                      <ChevronDownIcon className="mx-auto h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        onUpdatePrefs(deferFromFocusStack(prefs, ref, directive.todayIso))
                      }
                      className="btn-ghost px-1 py-0.5 text-[10px] font-medium text-text-muted hover:text-text"
                      title="Not today"
                    >
                      Later
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </section>
  );
}
