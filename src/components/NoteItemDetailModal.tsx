import { useEffect, useRef, useState } from 'react';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_LABEL, PRIORITY_ORDER, isPriorityLocked } from '../lib/priority';
import { PriorityBadge } from './ui/PriorityBadge';
import { prioritySelectClass } from '../lib/priorityUiClasses';
import { MarkdownPreview } from './MarkdownPreview';
import type { ActionItem } from '../lib/format';
import { Badge } from './ui/Badge';
import { CheckSquareIcon, NoteIcon, SquareIcon, TrashIcon } from './icons';

type Mode = 'write' | 'preview';

export function NoteItemDetailModal({
  item,
  done,
  onClose,
  onToggle,
  onDelete,
  onRename,
  onPriorityChange,
  onDueDateChange,
  onNotesChange,
  onOpenNote,
}: {
  item: ActionItem;
  done: boolean;
  onClose: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (raw: string) => void;
  onPriorityChange: (p: TaskPriority) => void;
  onDueDateChange: (dueDate: string | null) => void;
  onNotesChange: (notes: string) => void;
  onOpenNote: () => void;
}) {
  const priority = item.priority;
  const locked = !done && isPriorityLocked(item.dueDate);

  const [mode, setMode] = useState<Mode>('write');
  const [titleDraft, setTitleDraft] = useState(item.displayText);
  const [notesDraft, setNotesDraft] = useState(item.description);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(item.displayText);
  }, [item.displayText]);

  useEffect(() => {
    setNotesDraft(item.description);
  }, [item.description]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== item.displayText) {
      onRename(trimmed);
    }
  };

  const hasNotes = notesDraft.trim().length > 0;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-12 backdrop-blur-sm sm:py-16"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Note item: ${item.displayText}`}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-5">
          <button
            type="button"
            onClick={() => {
              onToggle();
              if (!done) onClose();
            }}
            className="mt-1 shrink-0 text-text-subtle hover:text-brand-700 dark:hover:text-brand-400"
            aria-label={done ? 'Mark not done' : 'Mark done'}
            title={done ? 'Mark not done' : 'Mark done'}
          >
            {done ? <CheckSquareIcon className="h-5 w-5" /> : <SquareIcon className="h-5 w-5" />}
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
                done ? 'text-text-muted line-through' : 'text-text',
              ].join(' ')}
              placeholder="Task title"
              maxLength={200}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={priority} />
              <Badge variant="purple">Note</Badge>
              <button
                type="button"
                onClick={onOpenNote}
                className="max-w-full truncate text-xs text-text-muted hover:text-brand-700"
                title="Open source note"
              >
                {item.noteTitle}
              </button>
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
            <label className="text-xs font-medium text-text-muted" htmlFor="modal-note-pri">
              Priority
            </label>
            <select
              id="modal-note-pri"
              value={priority}
              disabled={locked}
              onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
              className={[
                'input mt-0 min-h-[2rem] py-1 text-sm',
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
            {locked && (
              <span className="text-xs italic text-text-subtle">
                Update due date to change priority
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-text-muted" htmlFor="modal-note-due">
              Due
            </label>
            <input
              id="modal-note-due"
              type="date"
              value={item.dueDate ?? ''}
              onChange={(e) => onDueDateChange(e.target.value || null)}
              className="input mt-0 min-h-[2rem] py-1 text-sm"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Delete this task from the note?')) {
                  onDelete();
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
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                onNotesChange(e.target.value);
              }}
              placeholder="Add notes, context, links…"
              className="min-h-[10rem] w-full resize-y rounded-lg border border-border bg-surface-raised p-4 font-sans text-sm leading-relaxed text-text outline-none ring-brand-500/40 placeholder:text-text-subtle focus:ring-2"
              rows={6}
            />
          ) : (
            <div className="min-h-[10rem] rounded-lg border border-border bg-surface-raised p-4">
              {notesDraft ? (
                <MarkdownPreview content={notesDraft} />
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
