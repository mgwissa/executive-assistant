import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useTasksStore } from '../store/useTasksStore';
import { CheckSquareIcon, SquareIcon, TrashIcon } from './icons';

export function Tasks() {
  const user = useAuthStore((s) => s.user);
  const { tasks, loading, error, createTask, toggleDone, deleteTask } = useTasksStore();

  const [title, setTitle] = useState('');

  const open = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.done), [tasks]);

  useEffect(() => {
    setTitle('');
  }, [user?.id]);

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            <CheckSquareIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Todos
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Fast capture, always available. Great for calendar sync later.
            </p>
          </div>
        </header>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!user) return;
            const created = await createTask(user.id, title);
            if (created) setTitle('');
          }}
          className="mb-6 flex items-center gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            placeholder="Add a todo…"
            maxLength={200}
          />
          <button type="submit" className="btn-primary whitespace-nowrap">
            Add
          </button>
        </form>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-6">
          <TaskSection
            title="Open"
            loading={loading}
            tasks={open}
            onToggle={(id, next) => toggleDone(id, next)}
            onDelete={(id) => deleteTask(id)}
            empty="No open todos. Add one above."
          />
          <TaskSection
            title="Done"
            loading={false}
            tasks={done}
            onToggle={(id, next) => toggleDone(id, next)}
            onDelete={(id) => deleteTask(id)}
            empty="Nothing completed yet."
          />
        </div>
      </div>
    </div>
  );
}

function TaskSection({
  title,
  loading,
  tasks,
  onToggle,
  onDelete,
  empty,
}: {
  title: string;
  loading: boolean;
  tasks: { id: string; title: string; done: boolean }[];
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  empty: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {tasks.length}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
        {loading ? (
          <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading…
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {empty}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  onClick={() => onToggle(t.id, !t.done)}
                  className="mt-0.5 text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
                  aria-label={t.done ? 'Mark not done' : 'Mark done'}
                  title={t.done ? 'Mark not done' : 'Mark done'}
                >
                  {t.done ? (
                    <CheckSquareIcon className="h-4 w-4" />
                  ) : (
                    <SquareIcon className="h-4 w-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={[
                      'text-sm',
                      t.done
                        ? 'text-slate-500 line-through dark:text-slate-400'
                        : 'text-slate-900 dark:text-slate-100',
                    ].join(' ')}
                  >
                    {t.title}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(t.id)}
                  className="btn-ghost h-8 w-8 p-0 text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
                  aria-label="Delete todo"
                  title="Delete todo"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

