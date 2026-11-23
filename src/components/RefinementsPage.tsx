import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefinementsView } from './RefinementsView';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useRefinementsStore } from '../store/useRefinementsStore';
import { useRefinementProgressStore } from '../store/useRefinementProgressStore';
import type { RefinementProgressStatus, RefinementProgressTarget } from '../lib/refinementProgress';
import { useNotesStore } from '../store/useNotesStore';
import { supabase } from '../lib/supabase';

export function RefinementsPage() {
  const userId = useAuthStore(s => s.user?.id);
  const timezone = resolveCalendarTimeZone(useProfileStore(s => s.profile?.timezone));
  const store = useRefinementsStore();
  const progressStore = useRefinementProgressStore();
  const navigate = useNavigate();
  const [noteError, setNoteError] = useState<string | null>(null);
  const fetchAll = store.fetchAll;
  const fetchProgress = progressStore.fetchAll;
  const refresh = useCallback(() => {
    setNoteError(null);
    if (userId) { void fetchAll(userId); void fetchProgress(userId); }
  }, [userId, fetchAll, fetchProgress]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    const refreshProgress = () => { if (userId && document.visibilityState !== 'hidden') void fetchProgress(userId); };
    window.addEventListener('focus', refreshProgress);
    return () => window.removeEventListener('focus', refreshProgress);
  }, [userId, fetchProgress]);
  const openNote = async (noteId: string) => {
    if (!userId) return;
    setNoteError(null);
    try {
      const { data, error } = await supabase.from('notes').select('*').eq('id', noteId).eq('user_id', userId).maybeSingle();
      if (useAuthStore.getState().user?.id !== userId) return;
      if (error || !data) { setNoteError(error?.message ?? 'The source note is no longer available.'); return; }
      useNotesStore.setState(s => ({ notes: [...s.notes.filter(n => n.id !== noteId), data], activeId: noteId }));
      navigate('/notes');
    } catch {
      if (useAuthStore.getState().user?.id === userId) setNoteError('The source note could not be opened.');
    }
  };
  const owned = store.userId === userId;
  const progressOwned = progressStore.userId === userId;
  const progressReady = !!userId && owned && !store.loading && !store.error && progressOwned
    && !!progressStore.loadedAt && !progressStore.loading && !progressStore.error;
  const setProgress = (target: RefinementProgressTarget, status: RefinementProgressStatus) => {
    if (!userId || !progressReady) return;
    const meeting = store.model.meetings.find(item => item.noteId === target.noteId);
    if (meeting?.record?.sourceId !== target.sourceId) return;
    const items = target.itemKind === 'action' ? meeting.record.actions : meeting.record.stories;
    if (items.some(item => item.id === target.itemId)) void progressStore.setProgress(userId, target, status);
  };
  return <RefinementsView model={owned ? store.model : { meetings: [], warnings: [] }}
    timezone={timezone} loading={!owned || store.loading} error={owned ? store.error ?? noteError : null}
    truncated={owned && store.truncated} loadedAt={owned ? store.loadedAt : null} onRefresh={refresh} onOpenNote={id => void openNote(id)}
    progress={progressOwned ? progressStore.progress : {}} progressReady={progressReady}
    progressLoading={!progressOwned || progressStore.loading} progressError={progressOwned ? progressStore.error : null}
    savingKey={progressOwned ? progressStore.savingKey : null} onProgressChange={setProgress} />;
}
