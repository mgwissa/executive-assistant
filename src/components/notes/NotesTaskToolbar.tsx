import { useRef } from 'react';
import { useBlockNoteEditor, useEditorState } from '@blocknote/react';
import {
  applyDueDateToCheckListBlock,
  applyPriorityToCheckListBlock,
} from '../../lib/blocknoteTaskBridge';
import { ACTION_ITEM_RE, DUE_TAG_RE } from '../../lib/format';
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  dueDateForPriority,
  isPriorityLocked,
  parsePriorityPrefix,
  type TaskPriority,
} from '../../lib/priority';

type TaskLineMeta = {
  blockId: string;
  priority: TaskPriority;
  effectiveDue: string | null;
  explicitDue: string | null;
  locked: boolean;
};

function parseTaskLineMeta(md: string): Omit<TaskLineMeta, 'blockId' | 'locked'> | null {
  const line0 = md.split('\n')[0] ?? '';
  const m = line0.match(ACTION_ITEM_RE);
  if (!m) return null;
  const raw = m[2];
  const dueMatch = raw.match(DUE_TAG_RE);
  const explicitDue = dueMatch ? dueMatch[1] : null;
  const withoutDue = raw.replace(DUE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
  const { priority } = parsePriorityPrefix(withoutDue);
  const effectiveDue = explicitDue ?? dueDateForPriority(priority);
  return { priority, effectiveDue, explicitDue };
}

/**
 * Extra formatting-toolbar controls when the cursor is in a checklist block
 * (same markdown semantics as the Tasks view).
 */
export function NotesTaskToolbar() {
  const editor = useBlockNoteEditor();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const taskSnapshot = useEditorState({
    editor,
    on: 'all',
    selector: (s) => {
      const b = s.editor.getTextCursorPosition().block;
      if (b.type !== 'checkListItem') return null;
      const md = s.editor.blocksToMarkdownLossy([b]);
      const meta = parseTaskLineMeta(md);
      if (!meta) return null;
      return {
        blockId: b.id,
        ...meta,
        locked: !b.props.checked && isPriorityLocked(meta.effectiveDue),
      } satisfies TaskLineMeta;
    },
  });

  if (!taskSnapshot) return null;

  const { blockId, locked } = taskSnapshot;
  const priorityValue = taskSnapshot.priority;
  const dueInputValue = taskSnapshot.explicitDue ?? taskSnapshot.effectiveDue ?? '';

  return (
    <div className="mr-1 flex flex-wrap items-center gap-1 border-r border-border pr-2">
      <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:inline">
        Task
      </span>
      <select
        aria-label="Task priority"
        className="h-8 max-w-[9.5rem] rounded-md border border-border bg-surface-raised px-1.5 text-xs text-text"
        disabled={locked}
        value={priorityValue}
        title={locked ? 'Due date is today or past — change due date to adjust priority' : undefined}
        onChange={(e) => {
          applyPriorityToCheckListBlock(editor, blockId, e.target.value as TaskPriority);
        }}
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <input
        key={blockId}
        ref={dateInputRef}
        type="date"
        className="sr-only"
        value={dueInputValue}
        onChange={(e) => {
          const v = e.target.value;
          applyDueDateToCheckListBlock(editor, blockId, v || null);
        }}
      />
      <button
        type="button"
        className="h-8 rounded-md border border-border bg-surface-raised px-2 text-xs font-medium text-text hover:bg-surface-sunken"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
      >
        Due
      </button>
      <button
        type="button"
        className="h-8 rounded-md px-2 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
        title="Remove explicit due tag"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => applyDueDateToCheckListBlock(editor, blockId, null)}
      >
        Clear due
      </button>
      <button
        type="button"
        className="h-8 rounded-md px-2 text-xs font-medium text-text hover:bg-surface-sunken"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const b = editor.getBlock(blockId);
          if (b?.type !== 'checkListItem') return;
          editor.updateBlock(blockId, { props: { checked: !b.props.checked } });
        }}
      >
        Toggle done
      </button>
      <button
        type="button"
        className="h-8 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (window.confirm('Remove this action item (and any nested items under it)?')) {
            editor.removeBlocks([blockId]);
          }
        }}
      >
        Delete
      </button>
    </div>
  );
}
