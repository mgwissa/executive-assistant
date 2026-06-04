import { useCallback, useEffect, useMemo, useState } from 'react';
import { getNoteCanonicalMarkdown } from '../lib/noteContentBridge';
import {
  formatMeetingNoteTitle,
  resolveDefaultNoteSectionId,
  type MeetingNoteTarget,
} from '../lib/meetingNotes';
import { useAuthStore } from '../store/useAuthStore';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';
import { useThemeStore } from '../store/useThemeStore';
import { NotesEditor } from './NotesEditor';
import { NoteIcon, XIcon } from './icons';
import type { Json } from '../types/database';

export type MeetingNotesPanelMode = 'notes' | 'debrief';

type MeetingNotesPanelProps = {
  open: boolean;
  target: MeetingNoteTarget | null;
  mode: MeetingNotesPanelMode;
  timezone: string;
  onClose: () => void;
  onCaptureFollowUps?: () => void;
};

export function MeetingNotesPanel({
  open,
  target,
  mode,
  timezone,
  onClose,
  onCaptureFollowUps,
}: MeetingNotesPanelProps) {
  const user = useAuthStore((s) => s.user);
  const sections = useNotebooksStore((s) => s.sections);
  const activeNotebookId = useNotebooksStore((s) => s.activeNotebookId);
  const ensureDefault = useNotebooksStore((s) => s.ensureDefault);
  const notes = useNotesStore((s) => s.notes);
  const ensureMeetingNote = useNotesStore((s) => s.ensureMeetingNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const theme = useThemeStore((s) => s.theme);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);

  const note = useMemo(
    () => (noteId ? notes.find((n) => n.id === noteId) ?? null : null),
    [notes, noteId],
  );

  const openMeetingNote = useCallback(async () => {
    if (!user || !target) return;
    setLoading(true);
    setError(null);
    try {
      if (sections.length === 0) {
        await ensureDefault(user.id);
      }
      const sectionId = resolveDefaultNoteSectionId(
        useNotebooksStore.getState().sections,
        activeNotebookId,
      );
      if (!sectionId) {
        setError('Create a notebook section first to save meeting notes.');
        return;
      }
      const title = formatMeetingNoteTitle(target.meetingTitle, target.occurrenceStartAt, timezone);
      const created = await ensureMeetingNote(user.id, sectionId, {
        eventId: target.eventId,
        occurrenceStartAt: target.occurrenceStartAt,
        title,
      });
      if (created) setNoteId(created.id);
      else setError('Could not open meeting notes.');
    } finally {
      setLoading(false);
    }
  }, [user, target, sections.length, ensureDefault, activeNotebookId, timezone, ensureMeetingNote]);

  useEffect(() => {
    if (!open || !target) {
      setNoteId(null);
      setError(null);
      return;
    }
    void openMeetingNote();
  }, [open, target?.eventId, target?.occurrenceStartAt, openMeetingNote]);

  const onNoteContentChange = useCallback(
    (payload: { content: string; content_blocks: Json }) => {
      if (!note) return;
      void updateNote(note.id, payload);
    },
    [note, updateNote],
  );

  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close meeting notes"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-text-muted">
              {mode === 'debrief' ? 'Meeting debrief' : 'Meeting notes'}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-text">{target.meetingTitle}</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-2" aria-label="Close">
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="px-4 py-8 text-sm text-text-muted">Opening notes…</p>
          )}
          {error && (
            <p className="px-4 py-8 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          {!loading && !error && note && (
            <div className="flex h-full min-h-[20rem] flex-col px-2 py-2">
              <NotesEditor
                key={note.id}
                noteId={note.id}
                initialMarkdown={getNoteCanonicalMarkdown(note)}
                initialBlocks={note.content_blocks}
                onChange={onNoteContentChange}
                theme={theme}
              />
            </div>
          )}
        </div>

        {mode === 'debrief' && onCaptureFollowUps && (
          <footer className="shrink-0 border-t border-border bg-surface-raised px-4 py-3">
            <p className="mb-2 text-xs text-text-muted">
              Add follow-up tasks and mark the debrief done when you are finished.
            </p>
            <button
              type="button"
              onClick={onCaptureFollowUps}
              className="btn-primary inline-flex w-full items-center justify-center gap-2"
            >
              <NoteIcon className="h-4 w-4" />
              Capture follow-ups
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
