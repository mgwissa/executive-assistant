import { useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useViewStore } from '../store/useViewStore';
import {
  extractActionItems,
  extractPreview,
  formatDailyNoteTitle,
  formatLongDate,
  formatRelative,
  getGreeting,
} from '../lib/format';
import { generateOccurrences } from '../lib/recurrence';
import type { Note } from '../types';
import {
  ArrowRightIcon,
  CheckSquareIcon,
  ClockIcon,
  NoteIcon,
  SparklesIcon,
  SquareIcon,
} from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';

const RECENT_LIMIT = 5;
const ACTION_ITEM_LIMIT = 8;

function firstNameFromEmail(email: string | undefined | null): string {
  if (!email) return 'there';
  const local = email.split('@')[0];
  const token = local.split(/[._-]/)[0];
  if (!token) return 'there';
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function resolveName(
  profileName: string | null | undefined,
  email: string | undefined | null,
): string {
  const trimmed = profileName?.trim();
  if (trimmed) return trimmed;
  return firstNameFromEmail(email);
}

function toggleActionItemLine(content: string, line: number): string {
  const lines = content.split('\n');
  const src = lines[line];
  if (src == null) return content;
  const replaced = src.replace(
    /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)/,
    (_m, pre: string, state: string, post: string) =>
      `${pre}${state === ' ' ? 'x' : ' '}${post}`,
  );
  if (replaced === src) return content;
  lines[line] = replaced;
  return lines.join('\n');
}

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const events = useEventsStore((s) => s.events);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const toggleTaskDone = useTasksStore((s) => s.toggleDone);
  const createNote = useNotesStore((s) => s.createNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActive = useNotesStore((s) => s.setActive);
  const setView = useViewStore((s) => s.setView);

  const today = useMemo(() => new Date(), []);
  const greeting = getGreeting(today);
  const dateLabel = formatLongDate(today);
  const name = resolveName(profile?.first_name, user?.email);

  const recent = useMemo(() => notes.slice(0, RECENT_LIMIT), [notes]);
  const actionItems = useMemo(() => extractActionItems(notes), [notes]);
  const visibleActions = actionItems.slice(0, ACTION_ITEM_LIMIT);
  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);

  const todaysSchedule = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const all = events.flatMap((e) => generateOccurrences(e, start, end, { limit: 50 }));
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    return all;
  }, [events, today]);

  const openNote = (id: string) => {
    setActive(id);
    setView('notes');
  };

  const openTodaysNote = async () => {
    if (!user) return;
    const title = formatDailyNoteTitle(today);
    const existing = notes.find((n) => n.title === title);
    if (existing) {
      openNote(existing.id);
      return;
    }
    const created = await createNote(user.id);
    if (!created) return;
    await updateNote(created.id, {
      title,
      content: `# ${dateLabel}\n\n## Focus\n\n- \n\n## Notes\n\n`,
    });
    setView('notes');
  };

  const toggleAction = (noteId: string, line: number) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    updateNote(noteId, { content: toggleActionItemLine(note.content, line) });
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        <header className="mb-10">
          <Badge variant="subtle" className="uppercase tracking-wider">
            {dateLabel}
          </Badge>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-text">
            {greeting}, {name}.
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Here's your workspace at a glance.
            {!profile?.first_name?.trim() && (
              <>
                {' '}
                <button
                  onClick={() => setView('profile')}
                  className="font-medium text-brand-700 hover:text-brand-600"
                >
                  Set your name
                </button>{' '}
                to personalize this greeting.
              </>
            )}
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <SectionHeader
              icon={<SparklesIcon className="h-4 w-4" />}
              title="Your day"
              accent="purple"
            />
            <Card tone="sunken" className="card-pop card-pop-purple">
              <div className="flex items-start gap-4">
                <IconBadge size="lg" tone="purple">
                  <ClockIcon className="h-6 w-6" />
                </IconBadge>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-text">Start a daily note</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    Capture priorities and notes for today in one place. We'll title it{' '}
                    <code className="rounded bg-surface-raised px-1 py-0.5 text-xs text-text-muted ring-1 ring-border">
                      {formatDailyNoteTitle(today)}
                    </code>
                    .
                  </p>
                  <button onClick={openTodaysNote} className="btn-primary mt-4">
                    Open today's note
                    <ArrowRightIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          </section>

          <section className="lg:col-span-2">
            <SectionHeader
              icon={<ClockIcon className="h-4 w-4" />}
              title="Today's schedule"
              accent="blue"
              action={
                <button
                  onClick={() => setView('calendar')}
                  className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
                >
                  Calendar
                  <ArrowRightIcon className="h-3 w-3" />
                </button>
              }
            />
            <Card padded="sm" className="card-pop card-pop-blue">
              {todaysSchedule.length === 0 ? (
                <p className="text-sm text-text-muted">No events today.</p>
              ) : (
                <ul className="space-y-2">
                  {todaysSchedule.slice(0, 8).map((o) => (
                    <li
                      key={`${o.eventId}:${o.start.toISOString()}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">
                          {o.title}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {o.start.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {o.end.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <Badge variant="blue" className="shrink-0">
                        {o.start.toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </Badge>
                    </li>
                  ))}
                  {todaysSchedule.length > 8 && (
                    <li className="text-xs text-text-muted">
                      +{todaysSchedule.length - 8} more
                    </li>
                  )}
                </ul>
              )}
            </Card>
          </section>

          <section className="lg:col-span-2">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="At a glance"
              accent="green"
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Notes" value={notes.length} />
              <StatCard label="Open tasks" value={openTasks.length + actionItems.length} />
            </div>
          </section>

          <section className="lg:col-span-3">
            <SectionHeader
              icon={<CheckSquareIcon className="h-4 w-4" />}
              title="Action items"
              count={openTasks.length + actionItems.length}
              accent="amber"
              action={
                <button
                  onClick={() => setView('tasks')}
                  className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
                >
                  Manage
                  <ArrowRightIcon className="h-3 w-3" />
                </button>
              }
            />
            <Card padded="none" className="card-pop card-pop-amber">
              <QuickAddTodo
                disabled={!user}
                onAdd={async (title) => {
                  if (!user) return;
                  await createTask(user.id, title);
                }}
              />

              {openTasks.length === 0 && actionItems.length === 0 ? (
                <EmptyState
                  icon={<CheckSquareIcon className="h-5 w-5" />}
                  title="No open tasks"
                  message="Add a todo above, or write `- [ ] ...` in any note."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {openTasks.slice(0, ACTION_ITEM_LIMIT).map((t) => (
                    <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                      <button
                        onClick={() => toggleTaskDone(t.id, true)}
                        className="mt-0.5 text-text-subtle hover:text-brand-700"
                        aria-label="Mark done"
                        title="Mark done"
                      >
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text">
                          {t.title}
                        </p>
                        <button
                          onClick={() => setView('tasks')}
                          className="mt-0.5 truncate text-xs text-text-muted hover:text-brand-700"
                          title="Open todos"
                        >
                          Todos
                        </button>
                      </div>
                    </li>
                  ))}
                  {visibleActions.map((item) => (
                    <li
                      key={`${item.noteId}:${item.line}`}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <button
                        onClick={() => toggleAction(item.noteId, item.line)}
                        className="mt-0.5 text-text-subtle hover:text-brand-700"
                        aria-label="Mark done"
                        title="Mark done"
                      >
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text">
                          {item.text}
                        </p>
                        <button
                          onClick={() => openNote(item.noteId)}
                          className="mt-0.5 truncate text-xs text-text-muted hover:text-brand-700"
                          title="Open note"
                        >
                          {item.noteTitle}
                        </button>
                      </div>
                    </li>
                  ))}
                  {actionItems.length + openTasks.length > ACTION_ITEM_LIMIT && (
                    <li className="px-4 py-2 text-center text-xs text-text-muted">
                      +{actionItems.length + openTasks.length - ACTION_ITEM_LIMIT} more
                    </li>
                  )}
                </ul>
              )}
            </Card>
          </section>

          <section className="lg:col-span-2">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="Recent notes"
              accent="brand"
              action={
                notes.length > 0 ? (
                  <button
                    onClick={() => setView('notes')}
                    className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
                  >
                    View all
                    <ArrowRightIcon className="h-3 w-3" />
                  </button>
                ) : null
              }
            />
            <Card padded="none" className="card-pop card-pop-purple">
              {loading && notes.length === 0 ? (
                <EmptyState
                  icon={<NoteIcon className="h-5 w-5" />}
                  title="Loading…"
                  message="Fetching your notes."
                />
              ) : recent.length === 0 ? (
                <EmptyState
                  icon={<NoteIcon className="h-5 w-5" />}
                  title="No notes yet"
                  message="Create your first note to see it here."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((note) => (
                    <RecentNoteRow
                      key={note.id}
                      note={note}
                      onOpen={() => openNote(note.id)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card padded="sm">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-text">
        {value}
      </p>
    </Card>
  );
}

function RecentNoteRow({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = extractPreview(note.content);
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-sunken"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">
            {note.title || 'Untitled'}
          </p>
          {preview && (
            <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
              {preview}
            </p>
          )}
        </div>
        <Badge variant="purple" className="shrink-0">
          {formatRelative(note.updated_at)}
        </Badge>
      </button>
    </li>
  );
}

function QuickAddTodo({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        await onAdd(trimmed);
        setTitle('');
      }}
      className="flex items-center gap-2 border-b border-border px-4 py-3"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input"
        placeholder="Add a todo…"
        maxLength={200}
        disabled={disabled}
      />
      <button type="submit" className="btn-primary whitespace-nowrap" disabled={disabled}>
        Add
      </button>
    </form>
  );
}
