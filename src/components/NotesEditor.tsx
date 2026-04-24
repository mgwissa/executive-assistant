import { useEffect, useMemo, useRef } from 'react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { createTaskSlashMenuItems } from '../lib/taskSlashMenuItems';
import '../styles/notesEditor.css';
import { NotesTaskToolbar } from './notes/NotesTaskToolbar';

type NotesEditorProps = {
  /**
   * Note id. Used as a stable identity marker — parents should also pass
   * this as a React `key` so switching notes fully remounts the editor
   * and we get a clean initial-content pass.
   */
  noteId: string;
  /** Current markdown content. Only consulted on mount. */
  initialMarkdown: string;
  /** Called with the latest markdown on every change. */
  onChange: (markdown: string) => void;
  /** Forces light / dark theme to follow the app's theme. */
  theme: 'light' | 'dark';
};

/**
 * BlockNote editor wired up to the app's markdown-first data model.
 *
 * Lifecycle notes:
 *   - The parent is expected to mount this with `key={note.id}`, so when
 *     the active note changes the editor is fully remounted. That gives
 *     us a clean `initialMarkdown → blocks` pass per note with no syncing
 *     logic to worry about.
 *   - `initialMarkdown` is snapshotted on mount into a ref so subsequent
 *     prop changes (from the debounced save in useNotesStore echoing back)
 *     don't re-parse and clobber the user's cursor.
 *   - We skip the first onChange event that fires immediately after we
 *     replace the empty document with the parsed blocks, so we don't
 *     write a round-trip-normalised version back to the store on mount.
 *
 * Task system:
 *   - Slash `/` menu includes **Tasks** group (action item + one entry per
 *     priority tier with auto `[Pn]` / `[due:…]`).
 *   - Floating toolbar includes **Task** controls when the selection is in
 *     a checklist block (priority, due, clear due, toggle done, delete).
 */
export function NotesEditor({
  noteId: _noteId,
  initialMarkdown,
  onChange,
  theme,
}: NotesEditorProps) {
  const editor = useCreateBlockNote();

  const initialRef = useRef(initialMarkdown);
  const initializedRef = useRef(false);
  const lastEmittedRef = useRef<string>(initialMarkdown);

  useEffect(() => {
    const blocks = editor.tryParseMarkdownToBlocks(initialRef.current);
    if (blocks.length > 0) {
      editor.replaceBlocks(editor.document, blocks);
    }
    lastEmittedRef.current = editor.blocksToMarkdownLossy();
    initializedRef.current = true;
    // Intentionally run once per mount; parent remounts on note switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slashGetItems = useMemo(
    () => async (query: string) =>
      filterSuggestionItems(
        [...getDefaultReactSlashMenuItems(editor), ...createTaskSlashMenuItems(editor)],
        query,
      ),
    [editor],
  );

  return (
    <div className="notes-editor h-full">
      <BlockNoteView
        editor={editor}
        theme={theme}
        slashMenu={false}
        formattingToolbar={false}
        onChange={() => {
          if (!initializedRef.current) return;
          const md = editor.blocksToMarkdownLossy();
          if (md === lastEmittedRef.current) return;
          lastEmittedRef.current = md;
          onChange(md);
        }}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={slashGetItems} />
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              <NotesTaskToolbar />
              {getFormattingToolbarItems()}
            </FormattingToolbar>
          )}
        />
      </BlockNoteView>
    </div>
  );
}
