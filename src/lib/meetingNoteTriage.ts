import { extractPreview } from './format';
import type { Event, Note } from '../types';

const FALLBACK_MEETING_MINUTES = 30;

export function hasMeetingNoteContent(note: Pick<Note, 'content'>): boolean {
  return extractPreview(note.content ?? '').length > 0;
}

export function meetingOccurrenceEnded(
  note: Pick<Note, 'linked_event_id' | 'linked_occurrence_start_at'>,
  events: Event[],
  now = new Date(),
): boolean {
  if (!note.linked_event_id || !note.linked_occurrence_start_at) return false;
  const occurrenceStart = new Date(note.linked_occurrence_start_at).getTime();
  if (!Number.isFinite(occurrenceStart)) return false;

  const event = events.find((candidate) => candidate.id === note.linked_event_id);
  const scheduledMinutes = event?.duration_minutes ?? FALLBACK_MEETING_MINUTES;
  const durationMinutes = scheduledMinutes > 0 ? scheduledMinutes : FALLBACK_MEETING_MINUTES;
  return occurrenceStart + durationMinutes * 60_000 <= now.getTime();
}

export function meetingNoteNeedsTriage(note: Note, events: Event[], now = new Date()): boolean {
  return !note.scratch_at && !note.triaged_at && hasMeetingNoteContent(note) && meetingOccurrenceEnded(note, events, now);
}
