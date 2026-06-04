import { formatInTimeZone } from 'date-fns-tz';
import { occurrenceStartKey } from './meetingDebrief';
import type { Note, Section } from '../types';

export type MeetingNoteTarget = {
  eventId: string;
  occurrenceStartAt: string;
  meetingTitle: string;
};

export function formatMeetingNoteTitle(meetingTitle: string, occurrenceStartAt: string, tz: string): string {
  const dateLabel = formatInTimeZone(new Date(occurrenceStartAt), tz, 'MMM d, yyyy');
  const title = meetingTitle.trim() || 'Meeting';
  return `${title} — ${dateLabel}`;
}

export function findMeetingNote(
  notes: Note[],
  eventId: string,
  occurrenceStartAt: string,
): Note | undefined {
  const key = occurrenceStartKey(occurrenceStartAt);
  return notes.find(
    (n) =>
      n.linked_event_id === eventId &&
      n.linked_occurrence_start_at != null &&
      occurrenceStartKey(n.linked_occurrence_start_at) === key,
  );
}

/** First section in the active notebook, else any section. */
export function resolveDefaultNoteSectionId(
  sections: Section[],
  activeNotebookId: string | null,
): string | null {
  if (sections.length === 0) return null;
  if (activeNotebookId) {
    const inNotebook = sections.find((s) => s.notebook_id === activeNotebookId);
    if (inNotebook) return inNotebook.id;
  }
  return sections[0]?.id ?? null;
}
