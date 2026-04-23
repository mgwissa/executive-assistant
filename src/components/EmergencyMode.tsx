import { useMemo, useState } from 'react';
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
import type { EmergencyReason } from '../hooks/useCriticalOverload';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import { useViewStore } from '../store/useViewStore';
import type { Task } from '../types';
import { NoteOpenRow, OpenTaskRow } from './Tasks';
import { NoteItemDetailModal } from './NoteItemDetailModal';
import { TaskDetailModal } from './TaskDetailModal';
import { Card } from './ui/Card';
import { SectionHeader } from './ui/SectionHeader';

type EmergencyRow = { kind: 'task'; task: Task } | { kind: 'note'; item: ActionItem };

function overdueLabel(dueDate: string): string {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - due.getTime()) / 86_400_000);
  if (days === 1) return '1 day overdue';
  return `${days} days overdue`;
}

export function EmergencyMode({ reason, onExit }: { reason: EmergencyReason; onExit: () => void }) {
  const notes = useNotesStore((s) => s.notes);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActiveNote = useNotesStore((s) => s.setActive);
  const setView = useViewStore((s) => s.setView);
  const { tasks, setTaskPriority, setDueDate, renameTask, toggleDone, deleteTask } = useTasksStore();
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null;
  const [detailNoteTarget, setDetailNoteTarget] = useState<{ noteId: string; line: number } | null>(null);

  const allNoteItems = useMemo(() => extractActionItems(notes, { includeDone: true }), [notes]);
  const detailNoteItem = useMemo(
    () =>
      detailNoteTarget
        ? allNoteItems.find(
            (a) => a.noteId === detailNoteTarget.noteId && a.line === detailNoteTarget.line,
          ) ?? null
        : null,
    [allNoteItems, detailNoteTarget],
  );
  const detailNoteItemDone = useMemo(() => {
    if (!detailNoteTarget) return false;
    const n = notes.find((x) => x.id === detailNoteTarget.noteId);
    if (!n) return false;
    const line = n.content.split('\n')[detailNoteTarget.line];
    return /^\s*[-*+]\s+\[x\]/i.test(line ?? '');
  }, [detailNoteTarget, notes]);

  const criticalRows = useMemo(() => {
    const rows: EmergencyRow[] = [];
    for (const t of tasks) {
      if (!t.done && (t.priority as TaskPriority) === 'critical') {
        rows.push({ kind: 'task', task: t });
      }
    }
    for (const a of extractActionItems(notes)) {
      if (a.priority === 'critical') rows.push({ kind: 'note', item: a });
    }
    rows.sort((a, b) => {
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
  }, [tasks, notes]);

  const overdueRows = useMemo(() => {
    const rows: EmergencyRow[] = [];
    for (const t of reason.overdueTasks) rows.push({ kind: 'task', task: t });
    for (const a of reason.overdueNoteItems) rows.push({ kind: 'note', item: a });
    rows.sort((a, b) => {
      const da = a.kind === 'task' ? a.task.due_date! : a.item.dueDate!;
      const db = b.kind === 'task' ? b.task.due_date! : b.item.dueDate!;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    return rows;
  }, [reason.overdueTasks, reason.overdueNoteItems]);

  const applyNoteLine = (item: ActionItem, map: (content: string) => string | null) => {
    const note = notes.find((n) => n.id === item.noteId);
    if (!note) return;
    const next = map(note.content);
    if (next != null) void updateNote(item.noteId, { content: next });
  };

  const openNote = (id: string) => {
    setActiveNote(id);
    setView('notes');
  };

  const { headline, subtitle, description } = useMemo(() => {
    const both = reason.hasOverdue && reason.hasCriticalOverload;
    const overdueOnly = reason.hasOverdue && !reason.hasCriticalOverload;
    return {
      headline: both
        ? 'You have overdue items and critical work piling up.'
        : overdueOnly
          ? 'You have items past their due date.'
          : 'You have stuff that needs to get done.',
      subtitle: both
        ? 'Overdue deadlines and critical items need your attention now'
        : overdueOnly
          ? `${overdueRows.length === 1 ? 'An item has' : 'Items have'} slipped past ${overdueRows.length === 1 ? 'its' : 'their'} deadline \u2014 handle ${overdueRows.length === 1 ? 'it' : 'them'} now`
          : 'Critical work is stacking up and needs to be addressed',
      description: both
        ? 'Complete or reschedule every overdue item, and address your critical items to clear this screen.'
        : overdueOnly
          ? 'Complete these items, push the due date forward, or remove the deadline to clear this screen.'
          : 'Address these critical items to prevent them from escalating further.',
    };
  }, [reason.hasOverdue, reason.hasCriticalOverload, overdueRows.length]);

  const footerHint = reason.hasOverdue
    ? 'This screen clears once every item is on time and critical items are under control.'
    : 'When you\u2019re down to one open Critical item (or zero), this screen drops away.';

  const confirmMsg = reason.hasOverdue
    ? 'Leave emergency mode? You still have overdue items. A banner stays at the top so you can jump back in when you\u2019re ready.'
    : 'Leave emergency mode? You still have unfinished Critical items. A banner stays at the top so you can jump back in when you\u2019re ready.';

  const handleExit = () => {
    if (window.confirm(confirmMsg)) {
      onExit();
    }
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-stone-100 text-red-950 dark:bg-zinc-950 dark:text-red-50"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-mode-title"
      aria-describedby="emergency-mode-desc"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_-12%,rgba(185,28,28,0.11),transparent_55%)] dark:bg-[radial-gradient(ellipse_100%_65%_at_50%_-10%,rgba(239,68,68,0.28),transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block bg-[radial-gradient(ellipse_90%_45%_at_50%_105%,rgba(220,38,38,0.18),transparent_55%)]"
        aria-hidden
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-stone-200/90 bg-white/75 px-6 py-7 shadow-sm backdrop-blur-[2px] dark:border-red-500/40 dark:bg-transparent dark:shadow-lg dark:shadow-black/25 sm:px-10 sm:py-9">
        <p className="text-[11px] font-black uppercase tracking-[0.32em] text-red-700 dark:text-red-300">
          Emergency mode
        </p>
        <h1
          id="emergency-mode-title"
          className="mt-3 text-balance text-3xl font-black leading-[1.1] tracking-tight text-red-950 dark:text-white sm:text-4xl"
        >
          {headline}
        </h1>
        <p className="mt-4 text-base font-semibold leading-snug text-red-900 dark:text-red-200 sm:text-lg">
          {subtitle}
        </p>
        <p
          id="emergency-mode-desc"
          className="mt-3 max-w-2xl text-sm leading-relaxed text-red-800/95 dark:text-red-100/85"
        >
          {description}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-8">
        {overdueRows.length > 0 && (
          <div className="mx-auto max-w-3xl">
            <SectionHeader title="Overdue" count={overdueRows.length} accent="red" />
            <Card padded="none" className="border-red-500/30 bg-surface-raised shadow-xl ring-1 ring-red-500/25">
              <ul className="divide-y divide-border">
                {overdueRows.map((row) => {
                  const dueStr = row.kind === 'task' ? row.task.due_date! : row.item.dueDate!;
                  const key = row.kind === 'task' ? row.task.id : `note-${row.item.noteId}-${row.item.line}`;
                  return (
                    <li key={key} className="relative">
                      <span className="absolute right-4 top-3 text-xs font-semibold text-red-600 dark:text-red-400 sm:right-6">
                        {overdueLabel(dueStr)}
                      </span>
                      {row.kind === 'task' ? (
                        <OpenTaskRow
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
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        )}

        {criticalRows.length > 0 && reason.hasCriticalOverload && (
          <div className="mx-auto max-w-3xl">
            <SectionHeader title="Critical priority" count={criticalRows.length} accent="red" />
            <Card padded="none" className="border-red-500/30 bg-surface-raised shadow-xl ring-1 ring-red-500/25">
              <ul className="divide-y divide-border">
                {criticalRows.map((row) =>
                  row.kind === 'task' ? (
                    <OpenTaskRow
                      key={row.task.id}
                      task={row.task}
                      priority="critical"
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
            </Card>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-stone-200/90 bg-white/70 px-6 py-4 backdrop-blur-[2px] dark:border-red-500/40 dark:bg-black/20 dark:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs leading-relaxed text-red-900/90 dark:text-red-200/80">
            {footerHint}
          </p>
          <button
            type="button"
            onClick={handleExit}
            className="rounded-lg border border-red-400/80 bg-white px-4 py-2 text-sm font-medium text-red-900 shadow-sm hover:bg-red-50 dark:border-red-500/50 dark:bg-red-950/80 dark:text-red-100 dark:shadow-none dark:hover:bg-red-900/90"
          >
            Exit emergency mode…
          </button>
        </div>
      </footer>
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
