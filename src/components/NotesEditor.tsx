import { useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../styles/notesEditor.css';

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

  return (
    <div className="notes-editor h-full">
      <BlockNoteView
        editor={editor}
        theme={theme}
        onChange={() => {
          if (!initializedRef.current) return;
          const md = editor.blocksToMarkdownLossy();
          if (md === lastEmittedRef.current) return;
          lastEmittedRef.current = md;
          onChange(md);
        }}
      />
    </div>
  );
}
