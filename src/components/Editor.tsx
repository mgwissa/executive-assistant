import { useMemo, useRef, useState } from 'react';
import { useNotesStore } from '../store/useNotesStore';
import { formatRelative } from '../lib/format';
import { MarkdownPreview } from './MarkdownPreview';
import { TrashIcon } from './icons';

type Mode = 'write' | 'preview' | 'split';

export function Editor() {
  const { notes, activeId, updateNote, deleteNote } = useNotesStore();
  const note = notes.find((n) => n.id === activeId) ?? null;

  const [mode, setMode] = useState<Mode>('split');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const updatedAt = note?.updated_at ?? null;
  const savedLabel = useMemo(
    () => (updatedAt ? `Saved ${formatRelative(updatedAt)}` : ''),
    [updatedAt],
  );

  const title = note?.title ?? '';
  const content = note?.content ?? '';

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select or create a note to get started.
      </div>
    );
  }

  const applyEdit = (next: string) => {
    updateNote(note.id, { content: next });
  };

  const insertAroundSelection = (prefix: string, suffix: string = prefix) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = content.slice(start, end);
    const next = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
    applyEdit(next);

    // Restore selection around original selection (now wrapped).
    requestAnimationFrame(() => {
      const newStart = start + prefix.length;
      const newEnd = newStart + selected.length;
      el.focus();
      el.setSelectionRange(newStart, newEnd);
    });
  };

  const insertLinePrefix = (linePrefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = content.slice(0, start);
    const after = content.slice(end);

    const beforeLineStart = before.lastIndexOf('\n') + 1;
    const selectionText = content.slice(beforeLineStart, end);
    const lines = selectionText.split('\n');
    const nextLines = lines.map((l) => (l.startsWith(linePrefix) ? l : `${linePrefix}${l}`));
    const next =
      content.slice(0, beforeLineStart) + nextLines.join('\n') + after;

    applyEdit(next);
    requestAnimationFrame(() => el.focus());
  };

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const next = content.slice(0, start) + text + content.slice(end);
    applyEdit(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/70 px-6 py-3 backdrop-blur">
        <input
          value={title}
          onChange={(e) => {
            updateNote(note.id, { title: e.target.value });
          }}
          placeholder="Untitled"
          className="w-full bg-transparent text-xl font-semibold tracking-tight text-text outline-none placeholder:text-text-subtle"
        />
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1 rounded-md bg-surface-sunken p-1 text-xs text-text-muted sm:flex">
            <ModeButton active={mode === 'write'} onClick={() => setMode('write')}>
              Write
            </ModeButton>
            <ModeButton active={mode === 'split'} onClick={() => setMode('split')}>
              Split
            </ModeButton>
            <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')}>
              Preview
            </ModeButton>
          </div>
          <div className="flex sm:hidden">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="focus-ring rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-card outline-none"
              aria-label="View mode"
            >
              <option value="write">Write</option>
              <option value="split">Split</option>
              <option value="preview">Preview</option>
            </select>
          </div>
          <span className="hidden whitespace-nowrap text-xs text-text-subtle md:inline">
            {savedLabel}
          </span>
          <button
            onClick={() => {
              if (confirm('Delete this note?')) deleteNote(note.id);
            }}
            className="btn-ghost h-8 w-8 p-0 text-red-600 hover:bg-red-600/10 dark:text-red-300"
            aria-label="Delete note"
            title="Delete note"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className={[
            'grid h-full',
            mode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
          ].join(' ')}
        >
          {(mode === 'write' || mode === 'split') && (
            <div className="flex h-full flex-col overflow-hidden border-r border-border bg-surface-raised">
              <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-sunken px-4 py-2">
                <FormatButton onClick={() => insertAroundSelection('**')} title="Bold">
                  B
                </FormatButton>
                <FormatButton onClick={() => insertAroundSelection('*')} title="Italic">
                  I
                </FormatButton>
                <FormatButton onClick={() => insertAroundSelection('`')} title="Inline code">
                  {'</>'}
                </FormatButton>
                <FormatButton
                  onClick={() => insertAroundSelection('[', '](url)')}
                  title="Link"
                >
                  Link
                </FormatButton>
                <Divider />
                <FormatButton onClick={() => insertLinePrefix('# ')} title="Heading 1">
                  H1
                </FormatButton>
                <FormatButton onClick={() => insertLinePrefix('## ')} title="Heading 2">
                  H2
                </FormatButton>
                <FormatButton onClick={() => insertLinePrefix('- ')} title="Bullet list">
                  List
                </FormatButton>
                <FormatButton onClick={() => insertLinePrefix('- [ ] ')} title="Checklist">
                  Todo
                </FormatButton>
                <FormatButton
                  onClick={() => insertAtCursor('\n```ts\n\n```\n')}
                  title="Code block"
                >
                  Code
                </FormatButton>
              </div>

              <div className="h-full overflow-auto px-6 py-5">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    const next = e.target.value;
                    applyEdit(next);
                  }}
                  placeholder="Start writing…"
                  className="h-full w-full resize-none bg-transparent font-sans text-[15px] leading-7 text-text outline-none placeholder:text-text-subtle"
                />
              </div>
            </div>
          )}

          {(mode === 'preview' || mode === 'split') && (
            <div className="h-full overflow-auto bg-surface-raised px-6 py-5">
              <MarkdownPreview content={content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded px-2 py-1 transition-colors',
        active
          ? 'bg-surface-raised text-text shadow-card'
          : 'text-text-muted hover:bg-surface-raised',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function FormatButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-medium text-text-muted shadow-card hover:bg-surface-sunken"
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />;
}
