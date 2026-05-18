import { useEffect, useMemo, useState } from 'react';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import type { Note } from '../types';

type MoveNoteModalProps = {
  open: boolean;
  onClose: () => void;
  note: Note;
};

export function MoveNoteModal({ open, onClose, note }: MoveNoteModalProps) {
  const notebooks = useNotebooksStore((s) => s.notebooks);
  const sections = useNotebooksStore((s) => s.sections);
  const setActiveNotebook = useNotebooksStore((s) => s.setActiveNotebook);
  const activeNotebookId = useNotebooksStore((s) => s.activeNotebookId);
  const moveNote = useNotesStore((s) => s.moveNote);

  const currentSection = sections.find((s) => s.id === note.section_id) ?? null;
  const currentNotebookId = currentSection?.notebook_id ?? null;

  const [notebookId, setNotebookId] = useState<string | null>(currentNotebookId);
  const [sectionId, setSectionId] = useState<string | null>(note.section_id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNotebookId(currentNotebookId);
    setSectionId(note.section_id);
    setBusy(false);
  }, [open, currentNotebookId, note.section_id]);

  const sectionsInNotebook = useMemo(
    () => (notebookId ? sections.filter((s) => s.notebook_id === notebookId) : []),
    [sections, notebookId],
  );

  useEffect(() => {
    if (!open || !notebookId) return;
    const ok = sectionsInNotebook.some((s) => s.id === sectionId);
    if (!ok) {
      setSectionId(sectionsInNotebook[0]?.id ?? null);
    }
  }, [open, notebookId, sectionId, sectionsInNotebook]);

  if (!open) return null;

  const unchanged = sectionId === note.section_id;
  const canMove = !!sectionId && !unchanged && !busy;

  const handleMove = async () => {
    if (!sectionId || unchanged) return;
    setBusy(true);
    try {
      await moveNote(note.id, sectionId);
      if (notebookId && notebookId !== activeNotebookId) {
        setActiveNotebook(notebookId);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-note-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border-strong bg-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="move-note-title" className="text-lg font-semibold text-text">
            Move note
          </h2>
          <button type="button" className="btn-ghost h-8 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 truncate text-sm text-text-muted">{note.title || 'Untitled'}</p>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="move-note-notebook"
              className="block text-xs font-medium text-text-muted"
            >
              Notebook
            </label>
            <select
              id="move-note-notebook"
              className="input"
              value={notebookId ?? ''}
              onChange={(e) => setNotebookId(e.target.value || null)}
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="move-note-section"
              className="block text-xs font-medium text-text-muted"
            >
              Section
            </label>
            <select
              id="move-note-section"
              className="input"
              value={sectionId ?? ''}
              onChange={(e) => setSectionId(e.target.value || null)}
              disabled={sectionsInNotebook.length === 0}
            >
              {sectionsInNotebook.length === 0 ? (
                <option value="">No sections in this notebook</option>
              ) : (
                sectionsInNotebook.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
            {sectionsInNotebook.length === 0 ? (
              <p className="text-xs text-text-muted">
                Add a section to this notebook first, then try again.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={!canMove}
            onClick={() => void handleMove()}
          >
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
