import { useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useTasksStore } from '../store/useTasksStore';
import { CheckSquareIcon, SquareIcon, TrashIcon } from './icons';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';
import { Badge } from './ui/Badge';

export function Tasks() {
  const user = useAuthStore((s) => s.user);
  const { tasks, loading, error, createTask, toggleDone, deleteTask } = useTasksStore();

  const [title, setTitle] = useState('');

  const open = useMemo(() => tasks.filter((t) => !t.done), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.done), [tasks]);

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-3xl px-8 py-10">
        <header className="mb-8 flex items-center gap-3">
          <IconBadge tone="amber" size="md">
            <CheckSquareIcon className="h-5 w-5" />
          </IconBadge>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-text">Todos</h1>
            <p className="mt-1 text-sm text-text-muted">
              Fast capture, always available. Great for calendar sync later.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="blue">{open.length} open</Badge>
            <Badge variant="green">{done.length} done</Badge>
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
  const sectionIcon = title === 'Done' ? <CheckSquareIcon className="h-5 w-5" /> : <SquareIcon className="h-5 w-5" />;
  const accent = title === 'Done' ? 'green' : 'blue';
  return (
    <section>
      <SectionHeader title={title} count={tasks.length} accent={accent} />
      <Card padded="none">
        {loading ? (
          <EmptyState icon={sectionIcon} title="Loading…" message="Fetching your todos." />
        ) : tasks.length === 0 ? (
          <EmptyState icon={sectionIcon} title="Nothing here" message={empty} />
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                <button
                  onClick={() => onToggle(t.id, !t.done)}
                  className={[
                    'mt-0.5 text-text-subtle',
                    t.done ? 'hover:text-emerald-300' : 'hover:text-blue-300',
                  ].join(' ')}
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
                        ? 'text-text-muted line-through'
                        : 'text-text',
                    ].join(' ')}
                  >
                    {t.title}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(t.id)}
                  className="btn-ghost h-8 w-8 p-0"
                  aria-label="Delete todo"
                  title="Delete todo"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

