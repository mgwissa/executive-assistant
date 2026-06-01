import { useNavigate } from 'react-router-dom';
import { prepTaskTitle } from '../lib/meetingLifecycle';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';
import { CheckSquareIcon } from './icons';
import { Badge } from './ui/Badge';

type EventLinkedTasksProps = {
  eventId: string;
  eventTitle: string;
};

export function EventLinkedTasks({ eventId, eventTitle }: EventLinkedTasksProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const toggleDone = useTasksStore((s) => s.toggleDone);

  const linked = tasks.filter((t) => t.linked_event_id === eventId);
  const open = linked.filter((t) => !t.done);
  const done = linked.filter((t) => t.done);

  const addPrepTask = async () => {
    if (!user) return;
    await createTask(user.id, prepTaskTitle(eventTitle), { linkedEventId: eventId });
  };

  const row = (t: Task) => (
    <li key={t.id} className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => void toggleDone(t.id, !t.done)}
        className="shrink-0 text-text-muted hover:text-brand-600"
        aria-label={t.done ? 'Mark open' : 'Mark done'}
      >
        <CheckSquareIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => navigate(viewPath('tasks'))}
        className={[
          'min-w-0 flex-1 truncate text-left',
          t.done ? 'text-text-subtle line-through' : 'text-text hover:text-brand-700',
        ].join(' ')}
      >
        {t.title}
      </button>
      {t.due_date && (
        <span className="shrink-0 text-[10px] text-text-muted">{t.due_date}</span>
      )}
    </li>
  );

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-sunken/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Linked tasks
        </p>
        <Badge variant="subtle" className="text-[10px]">
          {open.length} open
        </Badge>
      </div>
      {linked.length === 0 ? (
        <p className="text-xs text-text-muted">No tasks linked to this event yet.</p>
      ) : (
        <ul className="space-y-1">
          {open.map(row)}
          {done.map(row)}
        </ul>
      )}
      <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => void addPrepTask()}>
        + Add prep task
      </button>
    </div>
  );
}
