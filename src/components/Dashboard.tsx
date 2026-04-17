import { useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
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
import type { Note } from '../types';
import {
  ArrowRightIcon,
  CheckSquareIcon,
  ClockIcon,
  NoteIcon,
  SparklesIcon,
  SquareIcon,
} from './icons';

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
    <div className="h-full overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-5xl px-8 py-10">
        <header className="mb-10">
          <p className="text-sm font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">
            {dateLabel}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {greeting}, {name}.
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Here's your workspace at a glance.
            {!profile?.first_name?.trim() && (
              <>
                {' '}
                <button
                  onClick={() => setView('profile')}
                  className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
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
            <SectionHeader icon={<SparklesIcon className="h-4 w-4" />} title="Your day" />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                  <ClockIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                    Start a daily note
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Capture priorities and notes for today in one place. We'll
                    title it{' '}
                    <code className="rounded bg-slate-200 px-1 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
            </div>
          </section>

          <section className="lg:col-span-2">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="At a glance"
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
              action={
                <button
                  onClick={() => setView('tasks')}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                >
                  Manage
                  <ArrowRightIcon className="h-3 w-3" />
                </button>
              }
            />
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
              <QuickAddTodo
                disabled={!user}
                onAdd={async (title) => {
                  if (!user) return;
                  await createTask(user.id, title);
                }}
              />

              {openTasks.length === 0 && actionItems.length === 0 ? (
                <EmptyState
                  title="No open tasks"
                  message="Add a todo above, or write `- [ ] ...` in any note."
                />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {openTasks.slice(0, ACTION_ITEM_LIMIT).map((t) => (
                    <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                      <button
                        onClick={() => toggleTaskDone(t.id, true)}
                        className="mt-0.5 text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
                        aria-label="Mark done"
                        title="Mark done"
                      >
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800 dark:text-slate-100">
                          {t.title}
                        </p>
                        <button
                          onClick={() => setView('tasks')}
                          className="mt-0.5 truncate text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
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
                        className="mt-0.5 text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
                        aria-label="Mark done"
                        title="Mark done"
                      >
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800 dark:text-slate-100">
                          {item.text}
                        </p>
                        <button
                          onClick={() => openNote(item.noteId)}
                          className="mt-0.5 truncate text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
                          title="Open note"
                        >
                          {item.noteTitle}
                        </button>
                      </div>
                    </li>
                  ))}
                  {actionItems.length + openTasks.length > ACTION_ITEM_LIMIT && (
                    <li className="px-4 py-2 text-center text-xs text-slate-500 dark:text-slate-400">
                      +{actionItems.length + openTasks.length - ACTION_ITEM_LIMIT} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          </section>

          <section className="lg:col-span-2">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="Recent notes"
              action={
                notes.length > 0 ? (
                  <button
                    onClick={() => setView('notes')}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
                  >
                    View all
                    <ArrowRightIcon className="h-3 w-3" />
                  </button>
                ) : null
              }
            />
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
              {loading && notes.length === 0 ? (
                <EmptyState title="Loading…" message="Fetching your notes." />
              ) : recent.length === 0 ? (
                <EmptyState
                  title="No notes yet"
                  message="Create your first note to see it here."
                />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recent.map((note) => (
                    <RecentNoteRow
                      key={note.id}
                      note={note}
                      onOpen={() => openNote(note.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  count,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          {title}
        </h2>
        {typeof count === 'number' && count > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {title}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}

function RecentNoteRow({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = extractPreview(note.content);
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
            {note.title || 'Untitled'}
          </p>
          {preview && (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
              {preview}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {formatRelative(note.updated_at)}
        </span>
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
      className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800"
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
