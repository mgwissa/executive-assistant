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

export type ActionItem = {
  noteId: string;
  noteTitle: string;
  text: string;
  line: number;
};

const ACTION_ITEM_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;

export function extractActionItems(
  notes: { id: string; title: string; content: string }[],
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
      items.push({
        noteId: note.id,
        noteTitle: note.title || 'Untitled',
        text: match[2],
        line: i,
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
