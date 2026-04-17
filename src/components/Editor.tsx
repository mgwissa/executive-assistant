import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotesStore } from '../store/useNotesStore';
import { formatRelative } from '../lib/format';
import { MarkdownPreview } from './MarkdownPreview';
import { TrashIcon } from './icons';

type Mode = 'write' | 'preview' | 'split';

export function Editor() {
  const { notes, activeId, updateNote, deleteNote } = useNotesStore();
  const note = notes.find((n) => n.id === activeId) ?? null;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<Mode>('split');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setTitle(note?.title ?? '');
    setContent(note?.content ?? '');
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setMode((prev) => (prev ? prev : 'split'));
  }, []);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Select or create a note to get started.
      </div>
    );
  }

  const savedLabel = useMemo(
    () => `Saved ${formatRelative(note.updated_at)}`,
    [note.updated_at],
  );

  const applyEdit = (next: string) => {
    setContent(next);
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
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white/70 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            updateNote(note.id, { title: e.target.value });
          }}
          placeholder="Untitled"
          className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-slate-400"
        />
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1 rounded-md bg-slate-100 p-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:flex">
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
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              aria-label="View mode"
            >
              <option value="write">Write</option>
              <option value="split">Split</option>
              <option value="preview">Preview</option>
            </select>
          </div>
          <span className="hidden whitespace-nowrap text-xs text-slate-400 md:inline">
            {savedLabel}
          </span>
          <button
            onClick={() => {
              if (confirm('Delete this note?')) deleteNote(note.id);
            }}
            className="btn-ghost h-8 w-8 p-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
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
            <div className="flex h-full flex-col overflow-hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-950/40">
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
                className="h-full w-full resize-none bg-transparent font-sans text-[15px] leading-7 text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            </div>
          )}

          {(mode === 'preview' || mode === 'split') && (
            <div className="h-full overflow-auto bg-white px-6 py-5 dark:bg-slate-900">
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
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50'
          : 'text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-700/60',
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
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />;
}
