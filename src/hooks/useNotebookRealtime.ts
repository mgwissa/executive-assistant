import { useEffect, useMemo } from 'react';
import { subscribeToNotebook } from '../lib/realtime';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useNotesStore } from '../store/useNotesStore';

/** Refetch notes / notebook tree when collaborators change the active notebook (last-write-wins). */
export function useNotebookRealtime(userId: string | undefined) {
  const activeNotebookId = useNotebooksStore((s) => s.activeNotebookId);
  const sections = useNotebooksStore((s) => s.sections);
  const fetchNotebooks = useNotebooksStore((s) => s.fetchAll);
  const refreshMemberCounts = useNotebooksStore((s) => s.refreshMemberCounts);
  const fetchNotes = useNotesStore((s) => s.fetchAll);

  const sectionIds = useMemo(() => {
    if (!activeNotebookId) return [];
    return sections.filter((s) => s.notebook_id === activeNotebookId).map((s) => s.id);
  }, [sections, activeNotebookId]);

  const sectionKey = sectionIds.join(',');

  useEffect(() => {
    if (!userId || !activeNotebookId) return;

    return subscribeToNotebook(activeNotebookId, sectionIds, {
      onNotesDirty: () => void fetchNotes(userId),
      onSectionsDirty: () => void fetchNotebooks(userId),
      onMembershipDirty: async () => {
        await fetchNotebooks(userId);
        await refreshMemberCounts();
        void fetchNotes(userId);
      },
      onNotebookMetaDirty: () => void fetchNotebooks(userId),
    });
  }, [
    userId,
    activeNotebookId,
    sectionKey,
    fetchNotes,
    fetchNotebooks,
    refreshMemberCounts,
    sectionIds,
  ]);
}
