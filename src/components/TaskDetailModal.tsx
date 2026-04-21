import { useEffect, useRef, useState } from 'react';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../lib/priority';
import { PriorityBadge } from './ui/PriorityBadge';
import { prioritySelectClass } from '../lib/priorityUiClasses';
import { MarkdownPreview } from './MarkdownPreview';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';
import { CheckSquareIcon, NoteIcon, SquareIcon, TrashIcon } from './icons';

type Mode = 'write' | 'preview';

export function TaskDetailModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const { setTaskPriority, setDueDate, updateDescription, renameTask, toggleDone, deleteTask } =
    useTasksStore();

  const fresh = useTasksStore((s) => s.tasks.find((t) => t.id === task.id));
  const t = fresh ?? task;
  const priority = (t.priority as TaskPriority) ?? 'normal';

  const [mode, setMode] = useState<Mode>('write');
  const [titleDraft, setTitleDraft] = useState(t.title);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(t.title);
  }, [t.title]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== t.title) {
      void renameTask(t.id, trimmed);
    }
  };

  const hasNotes = t.description.length > 0;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-12 backdrop-blur-sm sm:py-16"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Task: ${t.title}`}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-5">
          <button
            type="button"
            onClick={() => {
              void toggleDone(t.id, !t.done);
              if (!t.done) onClose();
            }}
            className="mt-1 shrink-0 text-text-subtle hover:text-brand-700 dark:hover:text-brand-400"
            aria-label={t.done ? 'Mark not done' : 'Mark done'}
            title={t.done ? 'Mark not done' : 'Mark done'}
          >
            {t.done ? (
              <CheckSquareIcon className="h-5 w-5" />
            ) : (
              <SquareIcon className="h-5 w-5" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                  textareaRef.current?.focus();
                }
              }}
              className={[
                'w-full bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-text-subtle',
                t.done ? 'text-text-muted line-through' : 'text-text',
              ].join(' ')}
              placeholder="Task title"
              maxLength={200}
            />
            <div className="mt-2">
              <PriorityBadge priority={priority} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-muted" htmlFor={`modal-pri-${t.id}`}>
              Priority
            </label>
            <select
              id={`modal-pri-${t.id}`}
              value={priority}
              onChange={(e) => void setTaskPriority(t.id, e.target.value as TaskPriority)}
              className={[
                'input mt-0 min-h-[2rem] py-1 text-sm',
                prioritySelectClass(priority),
              ].join(' ')}
            >
              {PRIORITY_ORDER.map((opt) => (
                <option key={opt} value={opt}>
                  {PRIORITY_LABEL[opt]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-muted" htmlFor={`modal-due-${t.id}`}>
              Due
            </label>
            <input
              id={`modal-due-${t.id}`}
              type="date"
              value={t.due_date ?? ''}
              onChange={(e) => void setDueDate(t.id, e.target.value || null)}
              className="input mt-0 min-h-[2rem] py-1 text-sm"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this task?')) {
                  void deleteTask(t.id);
                  onClose();
                }
              }}
              className="btn-ghost h-8 w-8 p-0 text-red-600 hover:bg-red-600/10 dark:text-red-300"
              aria-label="Delete task"
              title="Delete task"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Notes area */}
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-text-muted">
              <NoteIcon className="h-4 w-4" />
              <span className="text-sm font-medium">Notes</span>
              {!hasNotes && mode === 'write' && (
                <span className="text-xs text-text-subtle">— click below to add details</span>
              )}
            </div>
            {hasNotes && (
              <div className="flex items-center gap-1 rounded-md bg-surface-sunken p-0.5 text-xs text-text-muted">
                <button
                  type="button"
                  onClick={() => setMode('write')}
                  className={[
                    'rounded px-2 py-0.5 transition-colors',
                    mode === 'write' ? 'bg-surface-raised text-text shadow-card' : 'hover:text-text',
                  ].join(' ')}
                >
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => setMode('preview')}
                  className={[
                    'rounded px-2 py-0.5 transition-colors',
                    mode === 'preview' ? 'bg-surface-raised text-text shadow-card' : 'hover:text-text',
                  ].join(' ')}
                >
                  Preview
                </button>
              </div>
            )}
          </div>

          {mode === 'write' ? (
            <textarea
              ref={textareaRef}
              value={t.description}
              onChange={(e) => updateDescription(t.id, e.target.value)}
              placeholder="Add notes, context, links…"
              className="min-h-[10rem] w-full resize-y rounded-lg border border-border bg-surface-raised p-4 font-sans text-sm leading-relaxed text-text outline-none ring-brand-500/40 placeholder:text-text-subtle focus:ring-2"
              rows={6}
            />
          ) : (
            <div className="min-h-[10rem] rounded-lg border border-border bg-surface-raised p-4">
              {t.description ? (
                <MarkdownPreview content={t.description} />
              ) : (
                <p className="text-sm text-text-subtle">No notes yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
