import type { BlockNoteEditor } from '@blocknote/core';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { RiListCheck3 } from 'react-icons/ri';
import { insertTaskMarkdownAfterCursor, newTaskMarkdown } from './blocknoteTaskBridge';
import { PRIORITY_LABEL, PRIORITY_ORDER, type TaskPriority } from './priority';

export function createTaskSlashMenuItems(editor: BlockNoteEditor): DefaultReactSuggestionItem[] {
  const icon = <RiListCheck3 size={18} />;

  const plain: DefaultReactSuggestionItem = {
    title: 'Action item',
    subtext: 'Checkbox line — add [P1] or [due:YYYY-MM-DD] in text',
    aliases: ['task', 'todo', 'checkbox', 'action', '[]', 'checklist'],
    group: 'Tasks',
    icon,
    onItemClick: () => insertTaskMarkdownAfterCursor(editor, newTaskMarkdown('plain')),
  };

  const byPriority: DefaultReactSuggestionItem[] = PRIORITY_ORDER.map((p: TaskPriority) => {
    const n = PRIORITY_ORDER.indexOf(p);
    return {
      title: `${PRIORITY_LABEL[p]} task`,
      subtext: `Inserts [P${n}] and suggested due date`,
      aliases: [p, `p${n}`, `[p${n}]`, `priority ${n}`],
      group: 'Tasks',
      icon,
      onItemClick: () => insertTaskMarkdownAfterCursor(editor, newTaskMarkdown(p)),
    };
  });

  return [plain, ...byPriority];
}
