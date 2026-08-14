import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  commitRefToFocusToday,
  markFocusQueueManaged,
  parseFocusQueue,
  refKey,
  type FocusQueuePrefs,
} from '../lib/focusQueue';
import { extractActionItems, toggleActionItemLine, type ActionItem } from '../lib/format';
import { applyMarkdownPatchToNote } from '../lib/noteContentBridge';
import { viewPath } from '../lib/routes';
import { filterActionItemsDeduped } from '../lib/taskActionMatch';
import { toCreateTaskOptions } from '../lib/taskQuickAdd';
import { useAuthStore } from '../store/useAuthStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import type { Json } from '../types/database';
import type { Task } from '../types';
import { CheckSquareIcon, NoteIcon, SquareIcon } from './icons';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQuickAddForm } from './TaskQuickAddForm';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

type WorkBucket = {
  id: string;
  title: string;
  description: string;
  tasks: Task[];
  tone: 'purple' | 'red' | 'blue' | 'green' | 'subtle';
};

function dateLabel(value: string): string {
  return format(parseISO(value), 'MMM d');
}

function taskTiming(task: Task, todayIso: string): { label: string; variant: 'red' | 'amber' | 'blue' | 'subtle' } | null {
  if (task.due_date) {
    if (task.due_date < todayIso) return { label: `Deadline passed ${dateLabel(task.due_date)}`, variant: 'red' };
    if (task.due_date === todayIso) return { label: 'Deadline today', variant: 'amber' };
    return { label: `Deadline ${dateLabel(task.due_date)}`, variant: 'blue' };
  }
  if (task.review_date) {
    return {
      label: task.review_date <= todayIso ? `Review now · ${dateLabel(task.review_date)}` : `Review ${dateLabel(task.review_date)}`,
      variant: task.review_date <= todayIso ? 'amber' : 'subtle',
    };
  }
  return null;
}

function withoutTask(prefs: FocusQueuePrefs, taskId: string): FocusQueuePrefs {
  const key = `task:${taskId}`;
  return markFocusQueueManaged({
    ...prefs,
    stack: prefs.stack.filter((ref) => refKey(ref) !== key),
    snoozedUntil: prefs.snoozedUntil,
  }, 'user');
}

export function WorkPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const profile = useProfileStore((state) => state.profile);
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const tasks = useTasksStore((state) => state.tasks);
  const tasksLoading = useTasksStore((state) => state.loading);
  const createTask = useTasksStore((state) => state.createTask);
  const toggleDone = useTasksStore((state) => state.toggleDone);
  const notes = useNotesStore((state) => state.notes);
  const notesLoading = useNotesStore((state) => state.loading);
  const setActiveNote = useNotesStore((state) => state.setActive);
  const updateNote = useNotesStore((state) => state.updateNote);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const timezone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayIso = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const focusPrefs = useMemo(() => parseFocusQueue(profile?.focus_queue), [profile?.focus_queue]);
  const focusTaskIds = useMemo(
    () => focusPrefs.stack.filter((ref) => ref.kind === 'task').map((ref) => ref.taskId),
    [focusPrefs],
  );
  const focusSet = useMemo(() => new Set(focusTaskIds), [focusTaskIds]);
  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const completedTasks = useMemo(
    () => tasks
      .filter((task) => task.done)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [tasks],
  );

  const buckets = useMemo<WorkBucket[]>(() => {
    const byFocus = new Map(focusTaskIds.map((id, index) => [id, index]));
    const focused = openTasks
      .filter((task) => focusSet.has(task.id))
      .sort((a, b) => (byFocus.get(a.id) ?? 999) - (byFocus.get(b.id) ?? 999));
    const remaining = openTasks.filter((task) => !focusSet.has(task.id));
    const deadlines = remaining
      .filter((task) => task.due_date != null)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    const waiting = remaining
      .filter((task) => !task.due_date && !!task.waiting_on)
      .sort((a, b) => (a.waiting_on ?? '').localeCompare(b.waiting_on ?? ''));
    const reviews = remaining
      .filter((task) => !task.due_date && !task.waiting_on && task.review_date != null)
      .sort((a, b) => (a.review_date ?? '').localeCompare(b.review_date ?? ''));
    const unscheduled = remaining
      .filter((task) => !task.due_date && !task.review_date && !task.waiting_on)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return [
      { id: 'focus', title: 'Focus now', description: 'The small queue being actively pushed.', tasks: focused, tone: 'purple' },
      { id: 'deadlines', title: 'Real deadlines', description: 'Commitments with an external consequence-bearing date.', tasks: deadlines, tone: 'red' },
      { id: 'reviews', title: 'Review queue', description: 'Work parked until it deserves another decision.', tasks: reviews, tone: 'blue' },
      { id: 'waiting', title: 'Waiting on', description: 'Commitments blocked on another person or team.', tasks: waiting, tone: 'green' },
      { id: 'unscheduled', title: 'Unscheduled', description: 'Captured work with no deadline or review date yet.', tasks: unscheduled, tone: 'subtle' },
    ];
  }, [focusSet, focusTaskIds, openTasks]);

  const actionItems = useMemo(
    () => filterActionItemsDeduped(tasks, extractActionItems(notes)),
    [tasks, notes],
  );
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  const saveFocus = async (taskId: string, focused: boolean) => {
    if (!user) return;
    const next = focused
      ? commitRefToFocusToday(focusPrefs, { kind: 'task', taskId })
      : withoutTask(focusPrefs, taskId);
    await updateProfile(user.id, { focus_queue: next as unknown as Json });
  };

  const openNote = (noteId: string) => {
    setActiveNote(noteId);
    navigate(viewPath('notes'));
  };

  const completeNoteItem = (item: ActionItem) => {
    const note = notes.find((candidate) => candidate.id === item.noteId);
    if (!note) return;
    const patched = applyMarkdownPatchToNote(note, (content) => toggleActionItemLine(content, item.line));
    if (patched) void updateNote(note.id, patched);
  };

  const doneCount = tasks.filter((task) => task.done).length;
  const focusedCount = buckets[0]?.tasks.length ?? 0;

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-subtle">Commitments</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-text">Work</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
              Deadlines are promises. Review dates are reminders to reconsider. Focus is what deserves pressure now.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="purple">{focusedCount} focused</Badge>
            <Badge variant="blue">{openTasks.length} open</Badge>
            <Badge variant="green">{doneCount} done</Badge>
          </div>
        </header>

        <Card padded="sm" className="mb-7">
          <TaskQuickAddForm
            disabled={!user}
            idPrefix="work-capture"
            titlePlaceholder="Capture a commitment…"
            submitLabel="Capture"
            onSubmit={async (payload) => {
              if (!user) return;
              await createTask(user.id, payload.title, toCreateTaskOptions(payload));
            }}
          />
        </Card>

        <div className="space-y-8">
          {buckets.map((bucket) => (
            <WorkSection
              key={bucket.id}
              bucket={bucket}
              todayIso={todayIso}
              focusSet={focusSet}
              loading={tasksLoading}
              onOpen={setSelectedTaskId}
              onComplete={(id) => void toggleDone(id, true)}
              onFocus={(id, focused) => void saveFocus(id, focused)}
            />
          ))}

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text">From notes</h2>
                <p className="mt-1 text-sm text-text-muted">Open checkbox lines that still live in their source note.</p>
              </div>
              <Badge variant="subtle">{actionItems.length}</Badge>
            </div>
            <Card padded="none">
              {notesLoading ? (
                <EmptyState icon={<NoteIcon className="h-5 w-5" />} title="Loading notes" message="Gathering note commitments." />
              ) : actionItems.length === 0 ? (
                <EmptyState icon={<NoteIcon className="h-5 w-5" />} title="Nothing open in notes" message="Checkboxes captured in notes will appear here." />
              ) : (
                <ul className="divide-y divide-border">
                  {actionItems.map((item) => (
                    <li key={`${item.noteId}:${item.line}`} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                      <button type="button" onClick={() => completeNoteItem(item)} className="mt-0.5 text-text-muted hover:text-emerald-500" aria-label={`Complete ${item.displayText}`}>
                        <SquareIcon className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => openNote(item.noteId)} className="min-w-0 flex-1 text-left">
                        <p className="text-sm font-medium text-text hover:text-brand-600 dark:hover:text-brand-300">{item.displayText}</p>
                        <p className="mt-1 text-xs text-text-muted">From {item.noteTitle}{item.dueDate ? ` · Deadline ${dateLabel(item.dueDate)}` : ''}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <CompletedWorkSection
            tasks={completedTasks}
            loading={tasksLoading}
            onOpen={setSelectedTaskId}
            onReopen={(id) => void toggleDone(id, false)}
          />
        </div>
      </div>

      {selectedTask ? <TaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} /> : null}
    </div>
  );
}

function CompletedWorkSection({
  tasks,
  loading,
  onOpen,
  onReopen,
}: {
  tasks: Task[];
  loading: boolean;
  onOpen: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mb-3 flex w-full items-end justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div>
          <h2 className="text-lg font-semibold text-text">Completed work</h2>
          <p className="mt-1 text-sm text-text-muted">
            Closed loops stay available as a searchable record with their context intact.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="green">{tasks.length}</Badge>
          <span className="text-xs font-medium text-text-muted">{expanded ? 'Hide' : 'Show'}</span>
        </div>
      </button>

      {expanded ? (
        <Card padded="none">
          {loading && tasks.length === 0 ? (
            <EmptyState icon={<CheckSquareIcon className="h-5 w-5" />} title="Loading completed work" message="Gathering closed loops." />
          ) : tasks.length === 0 ? (
            <EmptyState icon={<CheckSquareIcon className="h-5 w-5" />} title="Nothing completed yet" message="Work appears here after its loop is fully closed." />
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <CheckSquareIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-text-muted hover:text-brand-600 dark:hover:text-brand-300">{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-text-subtle">Closed {format(parseISO(task.updated_at), 'MMM d')}</span>
                      {task.description ? <span className="inline-flex items-center gap-1 text-xs text-text-subtle"><NoteIcon className="h-3.5 w-3.5" /> Context preserved</span> : null}
                    </div>
                  </button>
                  <button type="button" onClick={() => onReopen(task.id)} className="btn-secondary shrink-0 text-xs">
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </section>
  );
}

function WorkSection({
  bucket,
  todayIso,
  focusSet,
  loading,
  onOpen,
  onComplete,
  onFocus,
}: {
  bucket: WorkBucket;
  todayIso: string;
  focusSet: Set<string>;
  loading: boolean;
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onFocus: (id: string, focused: boolean) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{bucket.title}</h2>
          <p className="mt-1 text-sm text-text-muted">{bucket.description}</p>
        </div>
        <Badge variant={bucket.tone}>{bucket.tasks.length}</Badge>
      </div>
      <Card padded="none">
        {loading && bucket.tasks.length === 0 ? (
          <EmptyState icon={<SquareIcon className="h-5 w-5" />} title="Loading work" message="Gathering commitments." />
        ) : bucket.tasks.length === 0 ? (
          <div className="px-4 py-4 text-sm text-text-muted sm:px-5">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-border">
            {bucket.tasks.map((task, index) => {
              const timing = taskTiming(task, todayIso);
              const focused = focusSet.has(task.id);
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  {focused ? (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-xs font-semibold text-purple-600 dark:text-purple-300">{index + 1}</span>
                  ) : null}
                  <button type="button" onClick={() => onComplete(task.id)} className="mt-0.5 text-text-muted hover:text-emerald-500" aria-label={`Complete ${task.title}`}>
                    <SquareIcon className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-text hover:text-brand-600 dark:hover:text-brand-300">{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {timing ? <Badge variant={timing.variant}>{timing.label}</Badge> : null}
                      {task.waiting_on ? <Badge variant="green">Waiting on {task.waiting_on}</Badge> : null}
                      {task.description ? <span className="inline-flex items-center gap-1 text-xs text-text-subtle"><NoteIcon className="h-3.5 w-3.5" /> Context</span> : null}
                    </div>
                  </button>
                  <button type="button" onClick={() => onFocus(task.id, !focused)} className={focused ? 'btn-ghost shrink-0 text-xs' : 'btn-secondary shrink-0 text-xs'}>
                    {focused ? 'Remove' : 'Focus'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
