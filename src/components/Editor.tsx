import { useMemo } from 'react';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useThemeStore } from '../store/useThemeStore';
import { formatRelative } from '../lib/format';
import { NotesEditor } from './NotesEditor';
import { BookIcon, FolderIcon, TrashIcon } from './icons';

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
    <div className="flex h-full min-w-0 flex-col bg-surface-raised">
      <header className="border-b border-border bg-surface/90 px-4 py-3.5 shadow-sm backdrop-blur sm:px-6">
        {breadcrumb && (
          <nav
            className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted"
            aria-label="Note location"
          >
            <span className="inline-flex max-w-[40%] items-center gap-1 truncate sm:max-w-none">
              <BookIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{breadcrumb.notebookName}</span>
            </span>
            <span className="text-text-subtle" aria-hidden>
              /
            </span>
            <span className="inline-flex max-w-[40%] items-center gap-1 truncate sm:max-w-none">
              <FolderIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              <span className="truncate text-text">{breadcrumb.sectionName}</span>
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
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight text-text outline-none placeholder:text-text-subtle md:text-[1.625rem]"
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-raised">
        <div className="notes-editor-document w-full max-w-none px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
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
  );
}
