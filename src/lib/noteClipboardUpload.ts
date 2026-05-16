import type { BlockNoteEditor, BlockNoteEditorOptions } from '@blocknote/core';

const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('Could not read file'));
    fr.readAsDataURL(file);
  });
}

function isImageClipboardFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (!file.type && /\.(png|apng|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) return true;
  return false;
}

function clipboardHasImageFiles(event: ClipboardEvent): boolean {
  const cd = event.clipboardData;
  if (!cd?.types.includes('Files')) return false;
  for (let i = 0; i < cd.items.length; i++) {
    const file = cd.items[i].getAsFile();
    if (file && isImageClipboardFile(file)) return true;
  }
  return false;
}

/**
 * BlockNote calls this for pasted/dropped files. We store data URLs in note JSON so
 * images work without a separate file host.
 */
export const noteUploadFile: NonNullable<BlockNoteEditorOptions<any, any, any>['uploadFile']> = async (
  file: File,
  _blockId?: string,
) => {
  if (file.size > MAX_DATA_URL_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_DATA_URL_BYTES / 1024 / 1024)} MB).`);
  }
  return readFileAsDataURL(file);
};

/**
 * When the clipboard has both `text/html` and `Files` (common for screenshots), BlockNote's
 * default handler prefers HTML and never reaches file insertion. Intercept image files first.
 */
export const notePasteHandler: NonNullable<BlockNoteEditorOptions<any, any, any>['pasteHandler']> = ({
  event,
  editor,
  defaultPasteHandler,
}) => {
  if (!clipboardHasImageFiles(event) || !editor.uploadFile) {
    return defaultPasteHandler();
  }

  void insertClipboardImageFiles(event, editor);
  return true;
};

async function insertClipboardImageFiles(
  event: ClipboardEvent,
  editor: BlockNoteEditor<any, any, any>,
): Promise<void> {
  const cd = event.clipboardData;
  if (!cd || !editor.uploadFile) return;

  let referenceBlock = editor.getTextCursorPosition().block;

  for (let i = 0; i < cd.items.length; i++) {
    const file = cd.items[i].getAsFile();
    if (!file || !isImageClipboardFile(file)) continue;

    const partial = { type: 'image' as const, props: { name: file.name || 'image' } };

    const emptyTextBlock =
      referenceBlock.type !== 'image' &&
      Array.isArray(referenceBlock.content) &&
      referenceBlock.content.length === 0;

    const insertedId = emptyTextBlock
      ? editor.updateBlock(referenceBlock, partial).id
      : editor.insertBlocks([partial], referenceBlock, 'after')[0].id;

    try {
      const updateData = await editor.uploadFile(file, insertedId);
      const patch =
        typeof updateData === 'string' ? { props: { url: updateData } } : { ...updateData };
      editor.updateBlock(insertedId, patch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not insert image';
      console.error(e);
      window.alert(msg);
      editor.removeBlocks([insertedId]);
    }

    const next = editor.getBlock(insertedId);
    if (next) referenceBlock = next;
  }
}
