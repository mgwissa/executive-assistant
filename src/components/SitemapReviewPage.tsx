import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SitemapReviewView } from './SitemapReviewView';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useSitemapReviewStore } from '../store/useSitemapReviewStore';
import { useNotesStore } from '../store/useNotesStore';
import { supabase } from '../lib/supabase';

export function SitemapReviewPage() {
  const userId = useAuthStore(s => s.user?.id);
  const timezone = resolveCalendarTimeZone(useProfileStore(s => s.profile?.timezone));
  const store = useSitemapReviewStore();
  const navigate = useNavigate();
  const [noteError, setNoteError] = useState<string | null>(null);
  const fetchAll = store.fetchAll;
  const refresh = useCallback(() => { if (userId) void fetchAll(userId); }, [userId, fetchAll]);
  useEffect(refresh, [refresh]);
  const openNote = async (noteId: string) => {
    if (!userId) return;
    setNoteError(null);
    const { data, error } = await supabase.from('notes').select('*').eq('id', noteId).eq('user_id', userId).maybeSingle();
    // A sign-out/account switch must not reinsert another owner's data.
    if (useAuthStore.getState().user?.id !== userId) return;
    if (error || !data) { setNoteError(error?.message ?? 'The source note is no longer available.'); return; }
    useNotesStore.setState(s => ({ notes: [...s.notes.filter(n => n.id !== noteId), data], activeId: noteId }));
    navigate('/notes');
  };
  const owned = store.userId === userId;
  return <SitemapReviewView model={owned ? store.model : { runs: [], checkpoint: null, currentUrls: [], warnings: [] }}
    timezone={timezone} loading={!owned || store.loading} error={owned ? store.error ?? noteError : null}
    truncated={owned && store.truncated} loadedAt={owned ? store.loadedAt : null} onRefresh={refresh} onOpenNote={id => void openNote(id)} />;
}
