import type { BlockNoteEditor } from '@blocknote/core';
import { setActionItemLineDueDate, setActionItemLinePriority } from './format';
import type { TaskPriority } from './priority';
import { PRIORITY_ORDER, dueDateForPriority } from './priority';

/** Markdown for a new checkbox line at a given priority (with auto due when applicable). */
export function newTaskMarkdown(priority: TaskPriority | 'plain'): string {
  if (priority === 'plain') {
    return '- [ ] New task\n';
  }
  const n = PRIORITY_ORDER.indexOf(priority);
  const due = dueDateForPriority(priority);
  const duePart = due ? ` [due:${due}]` : '';
  return `- [ ] [P${n}]${duePart} New task\n`;
}

export function insertTaskMarkdownAfterCursor(
  editor: BlockNoteEditor,
  markdown: string,
): void {
  const { block } = editor.getTextCursorPosition();
  const blocks = editor.tryParseMarkdownToBlocks(markdown);
  if (!blocks.length) return;
  editor.insertBlocks(blocks, block, 'after');
}

/**
 * Replace a checklist block by round-tripping its subtree markdown through `transform`.
 * Keeps nested items / continuation lines intact.
 */
export function transformCheckListBlockMarkdown(
  editor: BlockNoteEditor,
  blockId: string,
  transform: (markdown: string) => string | null,
): void {
  const block = editor.getBlock(blockId);
  if (!block || block.type !== 'checkListItem') return;
  const md = editor.blocksToMarkdownLossy([block]);
  const nextMd = transform(md);
  if (nextMd == null) return;
  const parsed = editor.tryParseMarkdownToBlocks(nextMd);
  if (!parsed.length) return;
  editor.replaceBlocks([blockId], parsed);
}

export function applyPriorityToCheckListBlock(
  editor: BlockNoteEditor,
  blockId: string,
  priority: TaskPriority,
): void {
  transformCheckListBlockMarkdown(editor, blockId, (md) => {
    const lines = md.split('\n');
    return setActionItemLinePriority(lines.join('\n'), 0, priority);
  });
}

export function applyDueDateToCheckListBlock(
  editor: BlockNoteEditor,
  blockId: string,
  due: string | null,
): void {
  transformCheckListBlockMarkdown(editor, blockId, (md) => {
    const lines = md.split('\n');
    return setActionItemLineDueDate(lines.join('\n'), 0, due);
  });
}
