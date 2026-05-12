import { useMemo } from 'react';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useThemeStore } from '../store/useThemeStore';
import { formatRelative } from '../lib/format';
import { NotesEditor } from './NotesEditor';
import { BookIcon, ChevronRightIcon, FolderIcon, TrashIcon } from './icons';

export function Editor() {
  const { notes, activeId, updateNote, deleteNote } = useNotesStore();
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const sections = useNotebooksStore((s) => s.sections);
  const theme = useThemeStore((s) => s.theme);
  const note = notes.find((n) => n.id === activeId) ?? null;

  const breadcrumb = useMemo(() => {
    if (!note?.section_id) return null;
    const section = sections.find((s) => s.id === note.section_id);
    if (!section) return null;
    const notebook = notebooks.find((n) => n.id === section.notebook_id);
    return { notebookName: notebook?.name ?? '', sectionName: section.name };
  }, [note?.section_id, sections, notebooks]);

  const updatedAt = note?.updated_at ?? null;
  const savedLabel = useMemo(
    () => (updatedAt ? `Saved ${formatRelative(updatedAt)}` : ''),
    [updatedAt],
  );

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="rounded-2xl border border-border bg-surface-raised p-8 shadow-card ring-1 ring-border/80">
          <p className="text-sm font-medium text-text">No note open</p>
          <p className="mt-1 max-w-sm text-xs text-text-muted">
            Pick a note in the sidebar or create one with{' '}
            <span className="font-semibold text-text-subtle">New note</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-raised/40">
      <header className="border-b border-border bg-surface/80 px-4 py-4 shadow-sm backdrop-blur sm:px-6">
        {breadcrumb && (
          <nav
            className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-text-muted"
            aria-label="Note location"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/[0.08] px-2 py-0.5 ring-1 ring-brand-500/20 dark:bg-brand-400/10 dark:ring-brand-400/25">
              <BookIcon className="h-3 w-3 text-brand-600 dark:text-brand-400" aria-hidden />
              <span className="max-w-[12rem] truncate font-medium text-text">{breadcrumb.notebookName}</span>
            </span>
            <ChevronRightIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 ring-1 ring-border">
              <FolderIcon className="h-3 w-3 shrink-0 text-text-subtle" aria-hidden />
              <span className="max-w-[14rem] truncate font-medium text-text">{breadcrumb.sectionName}</span>
            </span>
          </nav>
        )}
        <div className="flex items-center justify-between gap-4">
          <input
            value={note.title}
            onChange={(e) => {
              updateNote(note.id, { title: e.target.value });
            }}
            placeholder="Untitled"
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight text-text outline-none placeholder:text-text-subtle md:text-[1.65rem]"
          />
          <div className="flex shrink-0 items-center gap-2">
            {savedLabel ? (
              <span className="hidden whitespace-nowrap rounded-full bg-surface-sunken px-2.5 py-1 text-[11px] font-medium text-text-muted ring-1 ring-border md:inline">
                {savedLabel}
              </span>
            ) : null}
            <button
              onClick={() => {
                if (confirm('Delete this note?')) deleteNote(note.id);
              }}
              className="btn-ghost h-9 w-9 rounded-lg p-0 text-red-600 hover:bg-red-600/10 dark:text-red-300"
              aria-label="Delete note"
              title="Delete note"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_120%_80%_at_50%_0%,rgb(99_102_241_/0.06)_0%,transparent_55%),radial-gradient(ellipse_100%_60%_at_100%_40%,rgb(168_85_247_/0.05)_0%,transparent_50%)] dark:bg-[radial-gradient(ellipse_120%_80%_at_50%_0%,rgb(99_102_241_/0.12)_0%,transparent_55%),radial-gradient(ellipse_100%_60%_at_100%_40%,rgb(168_85_247_/0.08)_0%,transparent_50%)]">
        <div className="notes-editor-page mx-auto min-h-full max-w-[56rem] px-4 pb-16 pt-6 sm:px-8 lg:pb-24">
          <div className="rounded-2xl border border-border bg-surface-raised shadow-[0_1px_2px_rgb(0_0_0_/0.04),0_12px_40px_-12px_rgb(0_0_0_/0.08)] ring-1 ring-border/70 dark:shadow-[0_1px_0_rgb(255_255_255_/0.04)_inset,0_20px_50px_-20px_rgb(0_0_0_/0.5)]">
            <NotesEditor
              key={note.id}
              noteId={note.id}
              initialMarkdown={note.content ?? ''}
              initialBlocks={note.content_blocks ?? null}
              onChange={(payload) => updateNote(note.id, payload)}
              theme={theme}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
