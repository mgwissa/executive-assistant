import { useCallback, useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useViewStore } from '../store/useViewStore';
import type { ActionItem } from '../lib/format';
import {
  extractActionItems,
  extractPreview,
  formatLongDate,
  formatRelative,
  getGreeting,
  toggleActionItemLine,
} from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_ORDER, PRIORITY_PILL, priorityRank } from '../lib/priority';
import { priorityInlineLabelClass, priorityRowClass, priorityTitleClass } from '../lib/priorityUiClasses';
import type { Task } from '../types';
import { generateOccurrences } from '../lib/recurrence';
import type { Note } from '../types';
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  NoteIcon,
  SquareIcon,
  TrashIcon,
} from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionHeader } from './ui/SectionHeader';

const RECENT_LIMIT = 5;
const ACTION_ITEM_LIMIT = 8;

type DashboardWorkRow =
  | {
      kind: 'task';
      id: string;
      priority: TaskPriority;
      title: string;
      subtitle: string;
      onSubtitleClick: () => void;
      task: Task;
    }
  | {
      kind: 'action';
      id: string;
      priority: TaskPriority;
      title: string;
      subtitle: string;
      onSubtitleClick: () => void;
      item: ActionItem;
    };

type WorkRowCtx = { openNote: (id: string) => void; openTasksView: () => void };

function workRowStamp(row: DashboardWorkRow): number {
  return row.kind === 'task'
    ? new Date(row.task.updated_at).getTime()
    : new Date(row.item.noteUpdatedAt).getTime();
}

function buildWorkRows(
  openTasks: Task[],
  actionItems: ActionItem[],
  ctx: WorkRowCtx,
): DashboardWorkRow[] {
  const rows: DashboardWorkRow[] = [];
  for (const t of openTasks) {
    const priority = (t.priority as TaskPriority) ?? 'normal';
    rows.push({
      kind: 'task',
      id: `task:${t.id}`,
      priority,
      title: t.title,
      subtitle: 'Tasks',
      onSubtitleClick: ctx.openTasksView,
      task: t,
    });
  }
  for (const a of actionItems) {
    rows.push({
      kind: 'action',
      id: `action:${a.noteId}:${a.line}`,
      priority: a.priority,
      title: a.displayText,
      subtitle: a.noteTitle,
      onSubtitleClick: () => ctx.openNote(a.noteId),
      item: a,
    });
  }
  rows.sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return workRowStamp(b) - workRowStamp(a);
  });
  return rows;
}

function CriticalBlocker({ rows }: { rows: DashboardWorkRow[] }) {
  const critical = rows.filter((r) => r.priority === 'critical');
  if (critical.length === 0) return null;

  return (
    <div
      className="mb-8 rounded-xl border-2 border-red-500/90 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5 text-red-50 shadow-xl ring-1 ring-red-400/30 dark:border-red-500/75 dark:from-red-950/40 dark:via-zinc-950 dark:to-zinc-950 dark:ring-red-500/30"
      role="region"
      aria-label="Highest priority"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-red-400/95 dark:text-red-300">
        Critical priority
      </p>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-white dark:text-red-50">
        Do nothing else until this is handled.
      </h2>
      <ul className="mt-4 space-y-3">
        {critical.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 rounded-lg bg-black/35 px-3 py-2.5 ring-1 ring-white/10 dark:bg-black/25 dark:ring-white/15"
          >
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold leading-snug text-white dark:text-red-50">
                {row.title}
              </p>
              <button
                type="button"
                onClick={row.onSubtitleClick}
                className="mt-1 text-left text-xs text-red-200/85 underline-offset-2 hover:text-red-50 hover:underline dark:text-red-200/90 dark:hover:text-white"
              >
                {row.subtitle}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

export function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const events = useEventsStore((s) => s.events);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const toggleTaskDone = useTasksStore((s) => s.toggleDone);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActive = useNotesStore((s) => s.setActive);
  const setView = useViewStore((s) => s.setView);

  const today = useMemo(() => new Date(), []);
  const greeting = getGreeting(today);
  const dateLabel = formatLongDate(today);
  const name = resolveName(profile?.first_name, user?.email);

  const recent = useMemo(() => notes.slice(0, RECENT_LIMIT), [notes]);
  const actionItems = useMemo(() => extractActionItems(notes), [notes]);
  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);

  const todaysSchedule = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const all = events.flatMap((e) => generateOccurrences(e, start, end, { limit: 50 }));
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    return all;
  }, [events, today]);

  const openNote = useCallback(
    (id: string) => {
      setActive(id);
      setView('notes');
    },
    [setActive, setView],
  );

  const workRows = useMemo(
    () =>
      buildWorkRows(openTasks, actionItems, {
        openNote,
        openTasksView: () => setView('tasks'),
      }),
    [openTasks, actionItems, openNote, setView],
  );
  const visibleWork = workRows.slice(0, ACTION_ITEM_LIMIT);

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

        <CriticalBlocker rows={workRows} />

        <section className="mb-6 flex min-h-0 min-w-0 flex-col lg:mb-8">
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
          <Card
            padded="none"
            className="card-pop card-pop-amber flex max-h-[min(50vh,30rem)] min-h-0 flex-col"
          >
            {/* Inner clips scroll; outer stays overflow-visible so card-pop ::after glow isn’t clipped */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card">
            <QuickAddTodo
              disabled={!user}
              onAdd={async (title) => {
                if (!user) return;
                await createTask(user.id, title);
              }}
            />
            <div className="shrink-0 space-y-2 border-b border-border bg-surface-raised/35 px-4 py-2.5">
              <p className="text-[11px] leading-relaxed text-text-muted">
                Sorted top to bottom. The left edge and label use the same color; change levels on{' '}
                <button
                  type="button"
                  onClick={() => setView('tasks')}
                  className="font-medium text-brand-700 hover:text-brand-600"
                >
                  Tasks
                </button>
                . In notes:{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono ring-1 ring-border">[P0]</code>
                –
                <code className="rounded bg-surface px-1 py-0.5 font-mono ring-1 ring-border">[P4]</code>
                .
              </p>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {PRIORITY_ORDER.map((p, i) => (
                  <span key={p} className="inline-flex items-center gap-1.5">
                    {i > 0 ? (
                      <span className="text-text-muted/50" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    <span className={priorityInlineLabelClass(p)}>{PRIORITY_PILL[p]}</span>
                  </span>
                ))}
              </div>
            </div>

            {workRows.length === 0 ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <EmptyState
                    icon={<CheckSquareIcon className="h-5 w-5" />}
                    title="No open tasks"
                    message="Add a todo above, or write `- [ ] …` in any note with an optional priority tag."
                  />
                </div>
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
                  {visibleWork.map((row) => (
                    <li
                      key={row.id}
                      className={priorityRowClass(row.priority)}
                      aria-label={`${PRIORITY_PILL[row.priority]}: ${row.title}`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          row.kind === 'task'
                            ? void toggleTaskDone(row.task.id, true)
                            : void toggleAction(row.item.noteId, row.item.line)
                        }
                        className="mt-0.5 shrink-0 text-text-subtle hover:text-brand-700"
                        aria-label="Mark done"
                        title="Mark done"
                      >
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={priorityInlineLabelClass(row.priority)}>{PRIORITY_PILL[row.priority]}</p>
                        <p
                          className={[
                            'mt-0.5 break-words text-left leading-snug',
                            priorityTitleClass(row.priority),
                          ].join(' ')}
                        >
                          {row.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <button
                            type="button"
                            onClick={row.onSubtitleClick}
                            className="block max-w-full truncate text-left text-xs text-text-muted hover:text-brand-700"
                            title={row.kind === 'task' ? 'Open tasks' : 'Open note'}
                          >
                            {row.subtitle}
                          </button>
                          {row.kind === 'task' && row.task.due_date && (
                            <DueDateChip dueDate={row.task.due_date} />
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                  {workRows.length > ACTION_ITEM_LIMIT && (
                    <li className="px-4 py-2 text-center text-xs text-text-muted">
                      +{workRows.length - ACTION_ITEM_LIMIT} more (sorted by priority)
                    </li>
                  )}
                </ul>
              )}
            </div>
          </Card>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8 lg:items-stretch">
          <section className="flex min-h-0 min-w-0 flex-col lg:h-full">
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
            <Card
              padded="sm"
              className="card-pop card-pop-blue flex min-h-0 flex-1 flex-col"
            >
              {todaysSchedule.length === 0 ? (
                <p className="flex-1 text-sm leading-relaxed text-text-muted">
                  No events today.
                </p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain lg:max-h-[min(58vh,32rem)]">
                  {todaysSchedule.slice(0, 8).map((o) => (
                    <li
                      key={`${o.eventId}:${o.start.toISOString()}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-text">{o.title}</p>
                          {o.source === 'outlook_ics' ? (
                            <Badge variant="subtle">Outlook</Badge>
                          ) : (
                            <Badge variant="purple">App</Badge>
                          )}
                        </div>
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
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="blue">
                          {o.start.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </Badge>
                        <button
                          type="button"
                          className="btn-danger flex h-8 w-8 items-center justify-center p-0"
                          title={`Delete “${o.title}”`}
                          aria-label={`Delete event ${o.title}`}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete “${o.title}”? This removes it from the app.`,
                              )
                            )
                              return;
                            void deleteEvent(o.eventId);
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {todaysSchedule.length > 8 && (
                    <li className="text-xs text-text-muted">+{todaysSchedule.length - 8} more</li>
                  )}
                </ul>
              )}
            </Card>
          </section>

          <div className="flex min-h-0 min-w-0 flex-col gap-6 lg:gap-8">
            <section className="flex min-h-0 min-w-0 flex-col">
              <SectionHeader icon={<NoteIcon className="h-4 w-4" />} title="At a glance" accent="green" />
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Notes" value={notes.length} />
                <StatCard label="Open tasks" value={openTasks.length + actionItems.length} />
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              <Card
                padded="none"
                className="card-pop card-pop-purple flex min-h-0 flex-1 flex-col overflow-hidden lg:max-h-[min(42vh,24rem)]"
              >
                {loading && notes.length === 0 ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <EmptyState
                      icon={<NoteIcon className="h-5 w-5" />}
                      title="Loading…"
                      message="Fetching your notes."
                    />
                  </div>
                ) : recent.length === 0 ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <EmptyState
                      icon={<NoteIcon className="h-5 w-5" />}
                      title="No notes yet"
                      message="Create your first note to see it here."
                    />
                  </div>
                ) : (
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
                    {recent.map((note) => (
                      <RecentNoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} />
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>
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
        placeholder="Quick add a todo…"
        maxLength={200}
        disabled={disabled}
      />
      <button type="submit" className="btn-primary whitespace-nowrap" disabled={disabled}>
        Add
      </button>
    </form>
  );
}

function DueDateChip({ dueDate }: { dueDate: string }) {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  let label: string;
  if (diffDays < 0) label = `${Math.abs(diffDays)}d overdue`;
  else if (diffDays === 0) label = 'Today';
  else if (diffDays === 1) label = 'Tomorrow';
  else if (diffDays <= 7) label = `${diffDays}d`;
  else label = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const color =
    diffDays < 0
      ? 'text-red-600 dark:text-red-400'
      : diffDays === 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-text-muted';

  return (
    <span className={['inline-flex items-center gap-1 text-xs font-medium', color].join(' ')} title={`Due ${dueDate}`}>
      <CalendarIcon className="h-3 w-3" />
      {label}
    </span>
  );
}
