import { BlockNoteEditor } from '@blocknote/core';
import type { Block } from '@blocknote/core';
import type { Json } from '../types/database';

/** True when the note has been saved with a BlockNote document (canonical source). */
export function isPersistedBlockDocument(content_blocks: unknown): content_blocks is Block[] {
  return Array.isArray(content_blocks) && content_blocks.length > 0;
}

let conversionEditor: BlockNoteEditor | null = null;

function getConversionEditor(): BlockNoteEditor {
  if (!conversionEditor) {
    conversionEditor = BlockNoteEditor.create();
  }
  return conversionEditor;
}

/** Markdown export for search, task extraction, and line-based mutations (Tasks/Dashboard). */
export function blocksToMarkdownLossy(blocks: Block[]): string {
  return getConversionEditor().blocksToMarkdownLossy(blocks);
}

/** Rebuild blocks after a line-oriented edit on canonical markdown. */
export function markdownToBlocks(markdown: string): Block[] {
  return getConversionEditor().tryParseMarkdownToBlocks(markdown);
}

/**
 * Single string representation of note body for regex task parsing and line edits.
 * Prefers stored BlockNote JSON when present; otherwise legacy markdown `content`.
 */
export function getNoteCanonicalMarkdown(note: {
  content: string;
  content_blocks?: Json | null;
}): string {
  if (isPersistedBlockDocument(note.content_blocks)) {
    return blocksToMarkdownLossy(note.content_blocks);
  }
  return note.content ?? '';
}

export function noteDocumentFromEditor(editor: BlockNoteEditor): {
  content: string;
  content_blocks: Json;
} {
  const blocks = editor.document;
  const content = editor.blocksToMarkdownLossy();
  return { content, content_blocks: blocks as unknown as Json };
}

/**
 * Used from Tasks/Dashboard/Emergency when mutating note text by line.
 * Keeps `content` (markdown export) and `content_blocks` in sync.
 */
export function applyMarkdownPatchToNote(
  note: { content: string; content_blocks?: Json | null },
  map: (markdown: string) => string | null,
): { content: string; content_blocks: Json } | null {
  const md0 = getNoteCanonicalMarkdown(note);
  const next = map(md0);
  if (next == null) return null;
  const blocks = markdownToBlocks(next);
  return { content: next, content_blocks: blocks as unknown as Json };
}
