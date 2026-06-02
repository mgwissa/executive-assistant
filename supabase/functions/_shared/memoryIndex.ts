export type MemorySourceType = 'note' | 'task' | 'debrief';

export type MemoryChunkInput = {
  sourceType: MemorySourceType;
  sourceId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  sourceUpdatedAt: string | null;
};

const MAX_CHUNK_CHARS = 1400;

/** Split text into paragraph-aware chunks for embedding. */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      for (let i = 0; i < p.length; i += maxChars) {
        chunks.push(p.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + p.length + 2 > maxChars && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function buildNoteDocument(title: string, content: string): string {
  const t = title.trim() || 'Untitled';
  const body = content.trim();
  return body ? `# ${t}\n\n${body}` : `# ${t}`;
}

export function buildTaskDocument(task: {
  title: string;
  description?: string | null;
  waiting_on?: string | null;
  priority?: string | null;
  due_date?: string | null;
  done?: boolean;
  tags?: string[] | null;
}): string {
  const lines = [`Task: ${task.title.trim() || 'Untitled'}`];
  if (task.done) lines.push('Status: done');
  else lines.push('Status: open');
  if (task.priority) lines.push(`Priority: ${task.priority}`);
  if (task.due_date) lines.push(`Due date: ${task.due_date}`);
  if (task.waiting_on?.trim()) lines.push(`Waiting on: ${task.waiting_on.trim()}`);
  if (task.tags?.length) lines.push(`Tags: ${task.tags.join(', ')}`);
  if (task.description?.trim()) {
    lines.push('');
    lines.push(task.description.trim());
  }
  return lines.join('\n');
}

export function buildDebriefDocument(eventTitle: string, occurrenceStart: string, notes: string): string {
  return [
    `Meeting debrief: ${eventTitle.trim() || 'Untitled meeting'}`,
    `When: ${occurrenceStart}`,
    '',
    notes.trim(),
  ].join('\n');
}

export function toChunkInputs(
  sourceType: MemorySourceType,
  sourceId: string,
  document: string,
  metadata: Record<string, unknown>,
  sourceUpdatedAt: string | null,
): MemoryChunkInput[] {
  const parts = chunkText(document);
  if (parts.length === 0) return [];
  return parts.map((content, chunkIndex) => ({
    sourceType,
    sourceId,
    chunkIndex,
    content,
    metadata: { ...metadata, chunkCount: parts.length },
    sourceUpdatedAt,
  }));
}
