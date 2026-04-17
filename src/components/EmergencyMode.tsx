import { useMemo } from 'react';
import type { ActionItem } from '../lib/format';
import {
  deleteActionItemLine,
  extractActionItems,
  renameActionItemLine,
  setActionItemLinePriority,
  toggleActionItemLine,
} from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { useNotesStore } from '../store/useNotesStore';
import { useTasksStore } from '../store/useTasksStore';
import { useViewStore } from '../store/useViewStore';
import type { Task } from '../types';
import { NoteOpenRow, OpenTaskRow } from './Tasks';
import { Card } from './ui/Card';

type CriticalRow = { kind: 'task'; task: Task } | { kind: 'note'; item: ActionItem };

export function EmergencyMode({ onExit }: { onExit: () => void }) {
  const notes = useNotesStore((s) => s.notes);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActiveNote = useNotesStore((s) => s.setActive);
  const setView = useViewStore((s) => s.setView);
  const { tasks, setTaskPriority, renameTask, toggleDone, deleteTask } = useTasksStore();

  const criticalRows = useMemo(() => {
    const rows: CriticalRow[] = [];
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

  const handleExit = () => {
    if (
      window.confirm(
        'Leave emergency mode? You still have multiple unfinished Critical items. A banner stays at the top so you can jump back in when you’re ready.',
      )
    ) {
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
      {/* Alert wash: deeper red (not rose/pink) in light; stronger glow in dark */}
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
          You have stuff that needs to get done.
        </h1>
        <p className="mt-4 text-base font-semibold leading-snug text-red-900 dark:text-red-200 sm:text-lg">
          Critical work is stacking up and needs to be addressed
        </p>
        <p
          id="emergency-mode-desc"
          className="mt-3 max-w-2xl text-sm leading-relaxed text-red-800/95 dark:text-red-100/85"
        >
          Address these critical items to prevent them from escalating further.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <Card padded="none" className="mx-auto max-w-3xl border-red-500/30 bg-surface-raised shadow-xl ring-1 ring-red-500/25">
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
                  onRename={(raw) =>
                    applyNoteLine(row.item, (c) => renameActionItemLine(c, row.item.line, raw))
                  }
                  onDelete={() =>
                    applyNoteLine(row.item, (c) => deleteActionItemLine(c, row.item.line))
                  }
                  onOpenNote={() => openNote(row.item.noteId)}
                />
              ),
            )}
          </ul>
        </Card>
      </div>

      <footer className="shrink-0 border-t border-stone-200/90 bg-white/70 px-6 py-4 backdrop-blur-[2px] dark:border-red-500/40 dark:bg-black/20 dark:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs leading-relaxed text-red-900/90 dark:text-red-200/80">
            When you’re down to one open Critical item (or zero), this screen drops away — usually
            because you got something done.
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
    </div>
  );
}
