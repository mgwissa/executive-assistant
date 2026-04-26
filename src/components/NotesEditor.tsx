import { useEffect, useMemo, useRef } from 'react';
import type { Block } from '@blocknote/core';
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
import { isPersistedBlockDocument, noteDocumentFromEditor } from '../lib/noteContentBridge';
import type { Json } from '../types/database';
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
  /** Legacy / fallback markdown when `initialBlocks` is absent (pre–content_blocks migration). */
  initialMarkdown: string;
  /** BlockNote document from DB; when present and non-empty, this is the canonical source. */
  initialBlocks: Json | null;
  /** Called with denormalized markdown + canonical blocks on meaningful edits. */
  onChange: (payload: { content: string; content_blocks: Json }) => void;
  /** Forces light / dark theme to follow the app's theme. */
  theme: 'light' | 'dark';
};

/**
 * BlockNote WYSIWYG with JSON block document as source of truth.
 *
 * - When `content_blocks` exists in the DB, the editor loads it directly (no
 *   markdown re-parse), so natural line breaks and layout are preserved.
 * - `content` is still updated as a Markdown export for search and for
 *   line-based task edits from the Tasks/Dashboard views.
 *
 * Slash `/` task group + checklist toolbar behave as before.
 */
export function NotesEditor({
  noteId: _noteId,
  initialMarkdown,
  initialBlocks,
  onChange,
  theme,
}: NotesEditorProps) {
  const editor = useCreateBlockNote();

  const initialMarkdownRef = useRef(initialMarkdown);
  const initialBlocksRef = useRef(initialBlocks);
  const initializedRef = useRef(false);
  const lastEmittedSnapshotRef = useRef<string>('');

  useEffect(() => {
    if (isPersistedBlockDocument(initialBlocksRef.current)) {
      editor.replaceBlocks(editor.document, initialBlocksRef.current as Block[]);
    } else {
      const blocks = editor.tryParseMarkdownToBlocks(initialMarkdownRef.current);
      if (blocks.length > 0) {
        editor.replaceBlocks(editor.document, blocks);
      }
    }
    const snap = JSON.stringify(editor.document);
    lastEmittedSnapshotRef.current = snap;
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
          const snap = JSON.stringify(editor.document);
          if (snap === lastEmittedSnapshotRef.current) return;
          lastEmittedSnapshotRef.current = snap;
          onChange(noteDocumentFromEditor(editor));
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
