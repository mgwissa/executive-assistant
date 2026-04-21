export function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();

  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

import type { TaskPriority } from './priority';
import { PRIORITY_ORDER, dueDateForPriority, parsePriorityInTitle, parsePriorityPrefix } from './priority';

export type ActionItem = {
  noteId: string;
  noteTitle: string;
  noteUpdatedAt: string;
  /** Full checkbox label from the note (may include legacy `[P0]`–`[P4]` priority tags). */
  text: string;
  /** Label with priority tag stripped for display. */
  displayText: string;
  line: number;
  priority: TaskPriority;
  dueDate: string | null;
};

const ACTION_ITEM_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;

/** Matches `[due:YYYY-MM-DD]` anywhere in the text. */
const DUE_TAG_RE = /\[due:(\d{4}-\d{2}-\d{2})\]/i;

/** Leading `- [ ] ` / `* [ ] ` part of a checkbox line (open or done). */
const CHECKBOX_LINE_PREFIX = /^(\s*[-*+]\s+\[[ xX]\]\s+)/;

/** Toggle `- [ ]` ↔ `- [x]` on a single line. */
export function toggleActionItemLine(content: string, line: number): string {
  const lines = content.split('\n');
  const src = lines[line];
  if (src == null) return content;
  const replaced = src.replace(
    /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)/,
    (_m, pre: string, state: string, post: string) =>
      `${pre}${state === ' ' ? 'x' : ' '}${post}`,
  );
  if (replaced === src) return content;
  lines[line] = replaced;
  return lines.join('\n');
}

/** Set legacy `[P0]`–`[P4]` on a note checkbox line to match `priority`, and auto-set due date. */
export function setActionItemLinePriority(
  content: string,
  lineIndex: number,
  priority: TaskPriority,
): string | null {
  const lines = content.split('\n');
  const src = lines[lineIndex];
  if (src == null) return null;
  const m = src.match(ACTION_ITEM_RE);
  if (!m) return null;
  const raw = m[2];
  const withoutDue = raw.replace(DUE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
  const { label } = parsePriorityPrefix(withoutDue);
  const trimmed = label.trim();
  if (!trimmed) return null;
  const prefix = src.match(CHECKBOX_LINE_PREFIX)?.[1];
  if (!prefix) return null;
  const n = PRIORITY_ORDER.indexOf(priority);
  if (n < 0) return null;
  const due = dueDateForPriority(priority);
  const duePart = due ? ` [due:${due}]` : '';
  lines[lineIndex] = `${prefix}[P${n}]${duePart} ${trimmed}`;
  return lines.join('\n');
}

/** Set or remove the `[due:YYYY-MM-DD]` tag on a note checkbox line. */
export function setActionItemLineDueDate(
  content: string,
  lineIndex: number,
  dueDate: string | null,
): string | null {
  const lines = content.split('\n');
  const src = lines[lineIndex];
  if (src == null) return null;
  const m = src.match(ACTION_ITEM_RE);
  if (!m) return null;
  const prefix = src.match(CHECKBOX_LINE_PREFIX)?.[1];
  if (!prefix) return null;
  const raw = m[2];
  const stripped = raw.replace(DUE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
  const duePart = dueDate ? `[due:${dueDate}] ` : '';
  const { priority, label } = parsePriorityPrefix(stripped);
  const n = PRIORITY_ORDER.indexOf(priority);
  const pTag = n >= 0 ? `[P${n}] ` : '';
  lines[lineIndex] = `${prefix}${pTag}${duePart}${label.trim()}`;
  return lines.join('\n');
}

/** Rename / reprioritize a checkbox line; `rawTitle` may include optional `[Pn]` (same as standalone tasks). */
export function renameActionItemLine(
  content: string,
  lineIndex: number,
  rawTitle: string,
): string | null {
  const lines = content.split('\n');
  const src = lines[lineIndex];
  if (src == null) return null;
  const m = src.match(ACTION_ITEM_RE);
  if (!m) return null;
  const prefix = src.match(CHECKBOX_LINE_PREFIX)?.[1];
  if (!prefix) return null;
  const existingDue = m[2].match(DUE_TAG_RE)?.[1] ?? null;
  const currentPriority = parsePriorityPrefix(m[2].replace(DUE_TAG_RE, '').trim()).priority;
  const { title, priority } = parsePriorityInTitle(rawTitle.trim(), currentPriority);
  const trimmed = title.trim();
  if (!trimmed) return null;
  const n = PRIORITY_ORDER.indexOf(priority);
  if (n < 0) return null;
  const priorityChanged = priority !== currentPriority;
  const due = priorityChanged ? dueDateForPriority(priority) : existingDue;
  const duePart = due ? ` [due:${due}]` : '';
  lines[lineIndex] = `${prefix}[P${n}]${duePart} ${trimmed}`;
  return lines.join('\n');
}

/** Remove a checkbox line from note content. */
export function deleteActionItemLine(content: string, lineIndex: number): string | null {
  const lines = content.split('\n');
  if (lines[lineIndex] == null) return null;
  lines.splice(lineIndex, 1);
  return lines.join('\n');
}

export function extractActionItems(
  notes: { id: string; title: string; content: string; updated_at: string }[],
  { includeDone = false }: { includeDone?: boolean } = {},
): ActionItem[] {
  const items: ActionItem[] = [];
  for (const note of notes) {
    if (!note.content) continue;
    const lines = note.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(ACTION_ITEM_RE);
      if (!match) continue;
      const done = match[1].toLowerCase() === 'x';
      if (done && !includeDone) continue;
      const raw = match[2];
      const dueMatch = raw.match(DUE_TAG_RE);
      const explicitDue = dueMatch ? dueMatch[1] : null;
      const withoutDue = raw.replace(DUE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
      const { priority, label } = parsePriorityPrefix(withoutDue);
      const dueDate = explicitDue ?? dueDateForPriority(priority);
      items.push({
        noteId: note.id,
        noteTitle: note.title || 'Untitled',
        noteUpdatedAt: note.updated_at,
        text: raw,
        displayText: label,
        line: i,
        priority,
        dueDate,
      });
    }
  }
  return items;
}

export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function formatLongDate(date: Date = new Date()): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDailyNoteTitle(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function extractPreview(content: string): string {
  if (!content) return '';
  const plain = content
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.slice(0, 120);
}
