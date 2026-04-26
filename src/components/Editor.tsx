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
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select or create a note to get started.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border bg-surface/70 px-6 py-3 backdrop-blur">
        {breadcrumb && (
          <div className="mb-1.5 flex items-center gap-1 text-[11px] text-text-muted">
            <BookIcon className="h-3 w-3" />
            <span>{breadcrumb.notebookName}</span>
            <ChevronRightIcon className="h-3 w-3" />
            <FolderIcon className="h-3 w-3" />
            <span>{breadcrumb.sectionName}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <input
            value={note.title}
            onChange={(e) => {
              updateNote(note.id, { title: e.target.value });
            }}
            placeholder="Untitled"
            className="w-full bg-transparent text-xl font-semibold tracking-tight text-text outline-none placeholder:text-text-subtle"
          />
          <div className="flex items-center gap-3">
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
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-surface-raised">
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
  );
}
