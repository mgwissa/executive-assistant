import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionItem } from '../lib/format';
import {
  deleteActionItemLine,
  extractActionItems,
  renameActionItemLine,
  setActionItemLineDueDate,
  setActionItemLineNotes,
  setActionItemLinePriority,
  toggleActionItemLine,
} from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_HINT, PRIORITY_LABEL, PRIORITY_ORDER, isPriorityLocked, priorityRank } from '../lib/priority';
import { PriorityBadge } from './ui/PriorityBadge';
import { priorityRowClass, prioritySelectClass, priorityTitleClass } from '../lib/priorityUiClasses';
import { useAuthStore } from '../store/useAuthStore';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import { useViewStore } from '../store/useViewStore';
import type { Note, Task } from '../types';
import { CheckSquareIcon, NoteIcon, SquareIcon, TrashIcon } from './icons';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';
import { Badge } from './ui/Badge';
import { TaskDetailModal } from './TaskDetailModal';
import { NoteItemDetailModal } from './NoteItemDetailModal';

export function Tasks() {
  const user = useAuthStore((s) => s.user);
  const notes = useNotesStore((s) => s.notes);
  const notesLoading = useNotesStore((s) => s.loading);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActiveNote = useNotesStore((s) => s.setActive);
  const setView = useViewStore((s) => s.setView);
  const { tasks, loading, error, createTask, setTaskPriority, setDueDate, renameTask, toggleDone, deleteTask } =
    useTasksStore();

  const [title, setTitle] = useState('');
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null;
  const [detailNoteTarget, setDetailNoteTarget] = useState<{ noteId: string; line: number } | null>(null);

  const openDbTasks = useMemo(() => {
    const list = tasks.filter((t) => !t.done);
    list.sort((a, b) => {
      const pa = priorityRank((a.priority as TaskPriority) ?? 'normal');
      const pb = priorityRank((b.priority as TaskPriority) ?? 'normal');
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [tasks]);

  const actionItems = useMemo(() => extractActionItems(notes), [notes]);
  const allActionItems = useMemo(() => extractActionItems(notes, { includeDone: true }), [notes]);

  const detailNoteItem = useMemo(
    () =>
      detailNoteTarget
        ? allActionItems.find(
            (a) => a.noteId === detailNoteTarget.noteId && a.line === detailNoteTarget.line,
          ) ?? null
        : null,
    [allActionItems, detailNoteTarget],
  );
  const detailNoteItemDone = useMemo(() => {
    if (!detailNoteTarget) return false;
    const n = notes.find((x) => x.id === detailNoteTarget.noteId);
    if (!n) return false;
    const line = n.content.split('\n')[detailNoteTarget.line];
    return /^\s*[-*+]\s+\[x\]/i.test(line ?? '');
  }, [detailNoteTarget, notes]);

  type OpenRow = { kind: 'task'; task: Task } | { kind: 'note'; item: ActionItem };

  const openRows = useMemo(() => {
    const rows: OpenRow[] = [];
    for (const t of openDbTasks) rows.push({ kind: 'task', task: t });
    for (const a of actionItems) rows.push({ kind: 'note', item: a });
    rows.sort((a, b) => {
      const pa = priorityRank(
        a.kind === 'task' ? ((a.task.priority as TaskPriority) ?? 'normal') : a.item.priority,
      );
      const pb = priorityRank(
        b.kind === 'task' ? ((b.task.priority as TaskPriority) ?? 'normal') : b.item.priority,
      );
      if (pa !== pb) return pa - pb;
      const sa =
        a.kind === 'task'
          ? new Date(a.task.updated_at).getTime()
          : new Date(a.item.noteUpdatedAt).getTime();
      const sb =
        b.kind === 'task'
          ? new Date(b.task.updated_at).getTime()
          : new Date(b.item.noteUpdatedAt).getTime();
      return sb - sa;
    });
    return rows;
  }, [openDbTasks, actionItems]);

  const done = useMemo(() => tasks.filter((t) => t.done), [tasks]);

  const openNote = (id: string) => {
    setActiveNote(id);
    setView('notes');
  };

  const applyNoteLine = (item: ActionItem, map: (content: string) => string | null) => {
    const note = notes.find((n) => n.id === item.noteId);
    if (!note) return;
    const next = map(note.content);
    if (next != null) void updateNote(item.noteId, { content: next });
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconBadge tone="amber" size="md" className="shrink-0">
                <CheckSquareIcon className="h-5 w-5" />
              </IconBadge>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-text">Tasks</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  This list includes standalone todos and open{' '}
                  <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[13px] ring-1 ring-border">
                    - [ ]
                  </code>{' '}
                  lines from your notes. Optional{' '}
                  <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[13px] ring-1 ring-border">[P0]</code>
                  –
                  <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[13px] ring-1 ring-border">[P4]</code>{' '}
                  tags use the same five priority levels.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <Badge variant="blue">{openRows.length} open</Badge>
              <Badge variant="green">{done.length} done</Badge>
            </div>
          </div>

          <PriorityReference />
        </header>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!user) return;
            const created = await createTask(user.id, title);
            if (created) setTitle('');
          }}
          className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input min-w-0 flex-1"
            placeholder="Add a todo…"
            maxLength={200}
          />
          <button type="submit" className="btn-primary w-full shrink-0 whitespace-nowrap sm:w-auto">
            Add
          </button>
        </form>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="space-y-8">
          <section>
            <SectionHeader title="Open" count={openRows.length} accent="blue" />
            <Card padded="none">
              {(loading || notesLoading) && openRows.length === 0 ? (
                <EmptyState
                  icon={<SquareIcon className="h-5 w-5" />}
                  title="Loading…"
                  message="Fetching your tasks and notes."
                />
              ) : openRows.length === 0 ? (
                <EmptyState
                  icon={<SquareIcon className="h-5 w-5" />}
                  title="Nothing here"
                  message="Add a todo above, or write an open checkbox line in a note."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {openRows.map((row) =>
                    row.kind === 'task' ? (
                      <OpenTaskRow
                        key={row.task.id}
                        task={row.task}
                        priority={(row.task.priority as TaskPriority) ?? 'normal'}
                        onToggle={() => void toggleDone(row.task.id, true)}
                        onDelete={() => void deleteTask(row.task.id)}
                        onRename={renameTask}
                        onPriorityChange={(p) => void setTaskPriority(row.task.id, p)}
                        onDueDateChange={(d) => void setDueDate(row.task.id, d)}
                        onOpen={() => setDetailTaskId(row.task.id)}
                      />
                    ) : (
                      <NoteOpenRow
                        key={`note-${row.item.noteId}-${row.item.line}`}
                        item={row.item}
                        note={notes.find((n) => n.id === row.item.noteId)}
                        onToggle={() =>
                          applyNoteLine(row.item, (c) => toggleActionItemLine(c, row.item.line))
                        }
                        onPriorityChange={(p) =>
                          applyNoteLine(row.item, (c) => setActionItemLinePriority(c, row.item.line, p))
                        }
                        onDueDateChange={(d) =>
                          applyNoteLine(row.item, (c) => setActionItemLineDueDate(c, row.item.line, d))
                        }
                        onRename={(raw) =>
                          applyNoteLine(row.item, (c) => renameActionItemLine(c, row.item.line, raw))
                        }
                        onDelete={() =>
                          applyNoteLine(row.item, (c) => deleteActionItemLine(c, row.item.line))
                        }
                        onOpenNote={() => openNote(row.item.noteId)}
                        onOpenDetail={() =>
                          setDetailNoteTarget({ noteId: row.item.noteId, line: row.item.line })
                        }
                      />
                    ),
                  )}
                </ul>
              )}
            </Card>
          </section>
          <TaskSection
            title="Done"
            loading={false}
            tasks={done}
            onToggle={(id, next) => toggleDone(id, next)}
            onDelete={(id) => deleteTask(id)}
            onRename={(id, raw) => void renameTask(id, raw)}
            onOpen={(id) => setDetailTaskId(id)}
            empty="Nothing completed yet."
          />
        </div>
      </div>

      {detailTask && (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTaskId(null)} />
      )}
      {detailNoteItem && (
        <NoteItemDetailModal
          item={detailNoteItem}
          done={detailNoteItemDone}
          onClose={() => setDetailNoteTarget(null)}
          onToggle={() =>
            applyNoteLine(detailNoteItem, (c) => toggleActionItemLine(c, detailNoteItem.line))
          }
          onPriorityChange={(p) =>
            applyNoteLine(detailNoteItem, (c) => setActionItemLinePriority(c, detailNoteItem.line, p))
          }
          onDueDateChange={(d) =>
            applyNoteLine(detailNoteItem, (c) => setActionItemLineDueDate(c, detailNoteItem.line, d))
          }
          onRename={(raw) =>
            applyNoteLine(detailNoteItem, (c) => renameActionItemLine(c, detailNoteItem.line, raw))
          }
          onDelete={() =>
            applyNoteLine(detailNoteItem, (c) => deleteActionItemLine(c, detailNoteItem.line))
          }
          onNotesChange={(n) =>
            applyNoteLine(detailNoteItem, (c) => setActionItemLineNotes(c, detailNoteItem.line, n))
          }
          onOpenNote={() => openNote(detailNoteItem.noteId)}
        />
      )}
    </div>
  );
}

function PriorityReference() {
  return (
    <Card tone="sunken" padded="sm" className="border-border/80">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Priority pills</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {PRIORITY_ORDER.map((opt) => (
          <li
            key={opt}
            className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface px-2.5 py-2.5"
          >
            <PriorityBadge priority={opt} className="w-fit shrink-0" />
            <span className="min-w-0 text-[12px] leading-snug text-text-muted">{PRIORITY_HINT[opt]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TaskTitleField({
  taskId,
  title,
  done = false,
  className = '',
  titleClassName = '',
  onRename,
}: {
  taskId: string;
  title: string;
  done?: boolean;
  className?: string;
  /** Typography when not editing (open tasks). */
  titleClassName?: string;
  onRename: (id: string, rawTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== title.trim()) {
      onRename(taskId, draft);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={['input w-full min-w-0 flex-1 py-1.5 text-sm text-text', className].join(' ')}
        value={draft}
        maxLength={200}
        aria-label="Todo title"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(title);
            setEditing(false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={[
        'min-w-0 rounded px-1 py-0.5 text-left transition-colors',
        done
          ? 'flex-1 text-sm text-text-muted line-through hover:bg-surface-raised/50'
          : [titleClassName, 'hover:bg-surface-raised/40'].filter(Boolean).join(' '),
        className,
      ].join(' ')}
      title="Click to edit"
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      {title}
    </button>
  );
}

function TaskSection({
  title,
  loading,
  tasks,
  onToggle,
  onDelete,
  onRename,
  onPriorityChange,
  onDueDateChange,
  onOpen,
  empty,
}: {
  title: string;
  loading: boolean;
  tasks: Task[];
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, rawTitle: string) => void;
  onPriorityChange?: (id: string, priority: TaskPriority) => void;
  onDueDateChange?: (id: string, dueDate: string | null) => void;
  onOpen?: (id: string) => void;
  empty: string;
}) {
  const sectionIcon =
    title === 'Done' ? <CheckSquareIcon className="h-5 w-5" /> : <SquareIcon className="h-5 w-5" />;
  const accent = title === 'Done' ? 'green' : 'blue';
  return (
    <section>
      <SectionHeader title={title} count={tasks.length} accent={accent} />
      <Card padded="none">
        {loading ? (
          <EmptyState icon={sectionIcon} title="Loading…" message="Fetching your tasks." />
        ) : tasks.length === 0 ? (
          <EmptyState icon={sectionIcon} title="Nothing here" message={empty} />
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => {
              const p = (t.priority as TaskPriority) ?? 'normal';
              if (t.done) {
                return (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onToggle(t.id, !t.done)}
                      className="mt-0.5 shrink-0 text-text-subtle hover:text-emerald-600 dark:hover:text-emerald-400"
                      aria-label="Mark not done"
                      title="Mark not done"
                    >
                      <CheckSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen?.(t.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <TaskTitleField taskId={t.id} title={t.title} done onRename={onRename} />
                    </button>
                    {t.description && (
                      <NoteIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-text-subtle" />
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(t.id)}
                      className="btn-ghost mt-0.5 h-8 w-8 shrink-0 p-0"
                      aria-label="Delete todo"
                      title="Delete todo"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                );
              }
              return (
                <OpenTaskRow
                  key={t.id}
                  task={t}
                  priority={p}
                  onToggle={() => onToggle(t.id, true)}
                  onDelete={() => onDelete(t.id)}
                  onRename={onRename}
                  onPriorityChange={(next) => onPriorityChange!(t.id, next)}
                  onDueDateChange={(d) => onDueDateChange?.(t.id, d)}
                  onOpen={() => onOpen?.(t.id)}
                />
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

function dueDateStatus(dueDate: string | null): 'none' | 'overdue' | 'today' | 'upcoming' {
  if (!dueDate) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  return 'upcoming';
}

function dueDateLabel(dueDate: string): string {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 7) return `Due in ${diffDays}d`;
  return `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const DUE_DATE_STYLE: Record<ReturnType<typeof dueDateStatus>, string> = {
  none: '',
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-600 dark:text-amber-400',
  upcoming: 'text-text-muted',
};

export function OpenTaskRow({
  task,
  priority,
  onToggle,
  onDelete,
  onRename,
  onPriorityChange,
  onDueDateChange,
  onOpen,
}: {
  task: Task;
  priority: TaskPriority;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (id: string, rawTitle: string) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onDueDateChange?: (dueDate: string | null) => void;
  onOpen?: () => void;
}) {
  const status = dueDateStatus(task.due_date);
  const hasNotes = task.description.length > 0;
  const locked = !task.done && isPriorityLocked(task.due_date);
  return (
    <li className={[priorityRowClass(priority), 'flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4'].join(' ')}>
      <div className="flex min-w-0 flex-1 gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0 text-text-subtle hover:text-brand-700 dark:hover:text-brand-400"
          aria-label="Mark done"
          title="Mark done"
        >
          <SquareIcon className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
            <PriorityBadge priority={priority} className="mt-0.5" />
            <TaskTitleField
              taskId={task.id}
              title={task.title}
              onRename={onRename}
              className="min-w-0 flex-1 text-pretty break-words sm:max-w-[min(100%,42rem)]"
              titleClassName={priorityTitleClass(priority)}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1">
            {task.due_date && (
              <p className={['text-xs font-medium', DUE_DATE_STYLE[status]].join(' ')}>
                {dueDateLabel(task.due_date)}
              </p>
            )}
            {locked && (
              <p className="text-xs italic text-text-subtle">
                Update due date to change priority
              </p>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className={[
                  'inline-flex items-center gap-1 text-xs',
                  hasNotes
                    ? 'font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300'
                    : 'text-text-subtle hover:text-text-muted',
                ].join(' ')}
                title={hasNotes ? 'View notes' : 'Add notes'}
              >
                <NoteIcon className="h-3 w-3" />
                {hasNotes ? 'Notes' : 'Add notes'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 pl-10 sm:ml-auto sm:w-auto sm:shrink-0 sm:pl-0">
        <label className="sr-only" htmlFor={`due-${task.id}`}>
          Due date for {task.title}
        </label>
        <input
          id={`due-${task.id}`}
          type="date"
          value={task.due_date ?? ''}
          onChange={(e) => onDueDateChange?.(e.target.value || null)}
          className={[
            'input mt-0 min-h-[2.25rem] min-w-0 flex-1 py-2 text-sm sm:w-[9.25rem] sm:flex-initial sm:py-1.5',
            status === 'overdue' ? 'border-red-400 text-red-600 dark:border-red-500 dark:text-red-400' : '',
            status === 'today' ? 'border-amber-400 text-amber-600 dark:border-amber-500 dark:text-amber-400' : '',
            !task.due_date ? 'text-text-muted' : '',
          ].filter(Boolean).join(' ')}
          title={task.due_date ? dueDateLabel(task.due_date) : 'Set due date'}
        />
        <label className="sr-only" htmlFor={`pri-${task.id}`}>
          Priority for {task.title}
        </label>
        <select
          id={`pri-${task.id}`}
          value={priority}
          disabled={locked}
          onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
          className={[
            'input mt-0 min-h-[2.25rem] min-w-0 flex-1 py-2 text-sm sm:w-[8.5rem] sm:flex-initial sm:py-1.5',
            prioritySelectClass(priority),
            locked ? 'cursor-not-allowed opacity-60' : '',
          ].filter(Boolean).join(' ')}
          title={locked ? 'Update due date to change priority' : undefined}
        >
          {PRIORITY_ORDER.map((opt) => (
            <option key={opt} value={opt}>
              {PRIORITY_LABEL[opt]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDelete}
          className="btn-ghost h-9 w-9 shrink-0 p-0 sm:h-8 sm:w-8"
          aria-label="Delete todo"
          title="Delete todo"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export function NoteOpenRow({
  item,
  note,
  onToggle,
  onDelete,
  onRename,
  onPriorityChange,
  onDueDateChange,
  onOpenNote,
  onOpenDetail,
}: {
  item: ActionItem;
  note: Note | undefined;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (raw: string) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onDueDateChange: (dueDate: string | null) => void;
  onOpenNote: () => void;
  onOpenDetail?: () => void;
}) {
  const priority = item.priority;
  const sid = `note:${item.noteId}:${item.line}`;
  const status = dueDateStatus(item.dueDate);
  const locked = isPriorityLocked(item.dueDate);
  const hasNotes = item.description.trim().length > 0;
  return (
    <li className={[priorityRowClass(priority), 'flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4'].join(' ')}>
      <div className="flex min-w-0 flex-1 gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={!note}
          className="mt-0.5 shrink-0 text-text-subtle hover:text-brand-700 disabled:opacity-40 dark:hover:text-brand-400"
          aria-label="Mark done"
          title="Mark done"
        >
          <SquareIcon className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
            <PriorityBadge priority={priority} className="mt-0.5" />
            <Badge variant="purple" className="mt-0.5 shrink-0">
              Note
            </Badge>
            <TaskTitleField
              taskId={sid}
              title={item.displayText}
              onRename={(_id, raw) => onRename(raw)}
              className="min-w-0 flex-1 text-pretty break-words sm:max-w-[min(100%,42rem)]"
              titleClassName={priorityTitleClass(priority)}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1">
            {item.dueDate && (
              <p className={['text-xs font-medium', DUE_DATE_STYLE[status]].join(' ')}>
                {dueDateLabel(item.dueDate)}
              </p>
            )}
            {locked && (
              <p className="text-xs italic text-text-subtle">
                Update due date to change priority
              </p>
            )}
            {onOpenDetail && (
              <button
                type="button"
                onClick={onOpenDetail}
                className={[
                  'inline-flex items-center gap-1 text-xs',
                  hasNotes
                    ? 'font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300'
                    : 'text-text-subtle hover:text-text-muted',
                ].join(' ')}
                title={hasNotes ? 'View notes' : 'Add notes'}
              >
                <NoteIcon className="h-3 w-3" />
                {hasNotes ? 'Notes' : 'Add notes'}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenNote}
              className="max-w-full truncate text-left text-xs text-text-muted hover:text-brand-700"
            >
              {item.noteTitle}
            </button>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 pl-10 sm:ml-auto sm:w-auto sm:shrink-0 sm:pl-0">
        <label className="sr-only" htmlFor={`due-note-${sid}`}>
          Due date for {item.displayText}
        </label>
        <input
          id={`due-note-${sid}`}
          type="date"
          value={item.dueDate ?? ''}
          disabled={!note}
          onChange={(e) => onDueDateChange(e.target.value || null)}
          className="input mt-0 min-h-[2.25rem] min-w-0 flex-1 py-2 text-sm sm:w-[9.25rem] sm:flex-initial sm:py-1.5"
        />
        <label className="sr-only" htmlFor={`pri-${sid}`}>
          Priority for {item.displayText}
        </label>
        <select
          id={`pri-${sid}`}
          value={priority}
          disabled={!note || locked}
          onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
          className={[
            'input mt-0 min-h-[2.25rem] min-w-0 flex-1 py-2 text-sm sm:w-[8.5rem] sm:flex-initial sm:py-1.5',
            prioritySelectClass(priority),
            locked ? 'cursor-not-allowed opacity-60' : '',
          ].filter(Boolean).join(' ')}
          title={locked ? 'Update due date to change priority' : undefined}
        >
          {PRIORITY_ORDER.map((opt) => (
            <option key={opt} value={opt}>
              {PRIORITY_LABEL[opt]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDelete}
          disabled={!note}
          className="btn-ghost h-9 w-9 shrink-0 p-0 sm:h-8 sm:w-8 disabled:opacity-40"
          aria-label="Remove line from note"
          title="Remove line from note"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
