import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { viewPath } from '../lib/routes';
import type { TaskPriority } from '../lib/priority';
import { priorityRank } from '../lib/priority';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';
import { ArrowRightIcon, InboxIcon, SquareIcon } from './icons';
import { TaskDetailModal } from './TaskDetailModal';
import { OpenTaskRow } from './Tasks';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';

function isOwedTask(t: Task): boolean {
  return !t.done && Boolean(t.waiting_on?.trim());
}

export function OwedToMePage() {
  const navigate = useNavigate();
  const tasks = useTasksStore((s) => s.tasks);
  const loading = useTasksStore((s) => s.loading);
  const error = useTasksStore((s) => s.error);
  const setTaskPriority = useTasksStore((s) => s.setTaskPriority);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const renameTask = useTasksStore((s) => s.renameTask);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const deleteTask = useTasksStore((s) => s.deleteTask);

  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null;

  const owedTasks = useMemo(() => {
    const list = tasks.filter(isOwedTask);
    list.sort((a, b) => {
      const pa = priorityRank((a.priority as TaskPriority) ?? 'normal');
      const pb = priorityRank((b.priority as TaskPriority) ?? 'normal');
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [tasks]);

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconBadge tone="green" size="md" className="shrink-0">
                <InboxIcon className="h-5 w-5" />
              </IconBadge>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-text">Owed to me</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  Open tasks you marked with <span className="font-medium text-text">Waiting on someone</span>.
                  When they deliver, mark the task done on this list or from{' '}
                  <button
                    type="button"
                    onClick={() => navigate(viewPath('tasks'))}
                    className="font-medium text-brand-700 hover:text-brand-600"
                  >
                    Tasks
                  </button>
                  .
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <Badge variant="green">{owedTasks.length} open</Badge>
            </div>
          </div>
        </header>

        {error ? (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <section>
          <SectionHeader
            title="Waiting on others"
            count={owedTasks.length}
            accent="green"
            action={
              <button
                type="button"
                onClick={() => navigate(viewPath('tasks'))}
                className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
              >
                All tasks
                <ArrowRightIcon className="h-3 w-3" />
              </button>
            }
          />
          <Card padded="none">
            {loading && owedTasks.length === 0 ? (
              <EmptyState
                icon={<SquareIcon className="h-5 w-5" />}
                title="Loading…"
                message="Fetching your tasks."
              />
            ) : owedTasks.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="h-5 w-5" />}
                title="Nothing owed right now"
                message="When you add or edit a task and set “Waiting on someone,” it will show up here."
                action={
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => navigate(viewPath('tasks'))}
                  >
                    Go to Tasks
                  </button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {owedTasks.map((t) => (
                  <OpenTaskRow
                    key={t.id}
                    task={t}
                    priority={(t.priority as TaskPriority) ?? 'normal'}
                    onToggle={() => void toggleDone(t.id, true)}
                    onDelete={() => void deleteTask(t.id)}
                    onRename={renameTask}
                    onPriorityChange={(p) => void setTaskPriority(t.id, p)}
                    onDueDateChange={(d) => void setDueDate(t.id, d)}
                    onOpen={() => setDetailTaskId(t.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {detailTask ? (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTaskId(null)} />
      ) : null}
    </div>
  );
}
