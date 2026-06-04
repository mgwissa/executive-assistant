/** Shared meeting lifecycle constants and helpers (Phase B). */

export const PREP_BLOCK_MINUTES = 15;

export function prepBlockStart(meetingStart: Date): Date {
  return new Date(meetingStart.getTime() - PREP_BLOCK_MINUTES * 60_000);
}

export function prepTaskTitle(meetingTitle: string): string {
  return `Prep: ${meetingTitle}`;
}

export function meetingTitleFromPrepLabel(title: string): string | null {
  const prefix = 'Prep: ';
  if (title.startsWith(prefix)) return title.slice(prefix.length);
  return null;
}

export function followUpTaskTitle(meetingTitle: string): string {
  return `Follow up: ${meetingTitle}`;
}

/** Default follow-up due date: next calendar day (YYYY-MM-DD). */
export function defaultFollowUpDate(from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function hasOpenLinkedTask(
  eventId: string,
  tasks: Array<{ id: string; linked_event_id: string | null; done: boolean }>,
): boolean {
  return tasks.some((t) => !t.done && t.linked_event_id === eventId);
}
