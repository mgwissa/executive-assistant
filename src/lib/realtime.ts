import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { isNoteSelfPersistedEcho } from './noteSyncEcho';

type NoteRow = { id: string; section_id: string | null; updated_at: string };

function schedule(
  holder: { current?: ReturnType<typeof setTimeout> },
  fn: () => void,
  ms: number,
) {
  if (holder.current) clearTimeout(holder.current);
  holder.current = setTimeout(() => {
    holder.current = undefined;
    fn();
  }, ms);
}

/**
 * Subscribe to Postgres changes for one notebook. RLS on Realtime filters events
 * to rows the current user may read.
 */
export function subscribeToNotebook(
  notebookId: string,
  sectionIds: string[],
  handlers: {
    onNotesDirty: () => void;
    onSectionsDirty: () => void;
    onMembershipDirty: () => void;
    onNotebookMetaDirty: () => void;
  },
): () => void {
  const sectionSet = new Set(sectionIds);
  const notesRef: { current?: ReturnType<typeof setTimeout> } = {};
  const sectionsRef: { current?: ReturnType<typeof setTimeout> } = {};
  const membersRef: { current?: ReturnType<typeof setTimeout> } = {};
  const metaRef: { current?: ReturnType<typeof setTimeout> } = {};

  const channel = supabase.channel(`notebook-sync:${notebookId}:${Date.now()}`);

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'sections', filter: `notebook_id=eq.${notebookId}` },
    () => schedule(sectionsRef, handlers.onSectionsDirty, 350),
  );

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'notebook_members',
      filter: `notebook_id=eq.${notebookId}`,
    },
    () => schedule(membersRef, handlers.onMembershipDirty, 350),
  );

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'notebooks', filter: `id=eq.${notebookId}` },
    () => schedule(metaRef, handlers.onNotebookMetaDirty, 350),
  );

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'notes' },
    (payload: RealtimePostgresChangesPayload<NoteRow>) => {
      const newRow = payload.new as NoteRow | undefined;
      const oldRow = payload.old as NoteRow | undefined;
      const sec = newRow?.section_id ?? oldRow?.section_id ?? null;
      if (!sec || !sectionSet.has(sec)) return;
      if (payload.eventType === 'UPDATE' && newRow) {
        if (isNoteSelfPersistedEcho(newRow.id, newRow.updated_at)) return;
      }
      schedule(notesRef, handlers.onNotesDirty, 350);
    },
  );

  channel.subscribe();

  return () => {
    if (notesRef.current) clearTimeout(notesRef.current);
    if (sectionsRef.current) clearTimeout(sectionsRef.current);
    if (membersRef.current) clearTimeout(membersRef.current);
    if (metaRef.current) clearTimeout(metaRef.current);
    void supabase.removeChannel(channel);
  };
}
