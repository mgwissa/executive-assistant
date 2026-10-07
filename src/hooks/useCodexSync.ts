import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAgentStore } from '../store/useAgentStore';
import { useNotesStore } from '../store/useNotesStore';
import { useNotebooksStore } from '../store/useNotebooksStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useWorkstreamsStore } from '../store/useWorkstreamsStore';
import { useEventsStore } from '../store/useEventsStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { eventsFetchIsoRange } from '../lib/eventQueries';

const CODEX_SYNC_INTERVAL_MS = 30_000;
const RECENT_ACTION_LIMIT = 50;
const DUPLICATE_CHECK_WINDOW_MS = 1_000;

const TASK_ACTIONS = new Set([
  'task_create',
  'task_update',
  'task_complete',
  'task_delete',
  'chase_logged',
]);

type RecentAction = {
  id: string;
  kind: string;
};

/**
 * Keeps the open app in step with audited writes made through the hosted agent
 * bridge. The audit table is the inexpensive change signal; operational stores
 * are refreshed only when a new action says their data may have changed.
 */
export function useCodexSync(userId: string | undefined) {
  const initializedRef = useRef(false);
  const latestActionIdRef = useRef<string | null>(null);
  const checkingRef = useRef(false);
  const lastCheckedAtRef = useRef(0);

  const checkForChanges = useCallback(async () => {
    if (!userId || document.visibilityState === 'hidden' || checkingRef.current) return;

    const checkedAt = Date.now();
    if (checkedAt - lastCheckedAtRef.current < DUPLICATE_CHECK_WINDOW_MS) return;
    lastCheckedAtRef.current = checkedAt;
    checkingRef.current = true;

    try {
      const { data, error } = await supabase
        .from('agent_actions')
        .select('id,kind')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(RECENT_ACTION_LIMIT);

      if (error) {
        console.warn('Codex sync check failed:', error.message);
        return;
      }

      const recentActions = (data ?? []) as RecentAction[];
      const newestActionId = recentActions[0]?.id ?? null;

      const firstCheck = !initializedRef.current;
      if (!firstCheck && newestActionId === latestActionIdRef.current) return;

      const previousIndex = latestActionIdRef.current
        ? recentActions.findIndex((action) => action.id === latestActionIdRef.current)
        : -1;
      const missedCursor = firstCheck || latestActionIdRef.current !== null && previousIndex === -1;
      const changedActions = previousIndex >= 0
        ? recentActions.slice(0, previousIndex)
        : recentActions;
      const changedKinds = new Set(changedActions.map((action) => action.kind));
      const refreshTasks = missedCursor || [...changedKinds].some((kind) => TASK_ACTIONS.has(kind));
      const refreshNotes = missedCursor || ['note_create', 'note_append', 'note_triage', 'note_scratch', 'calendar_sync', 'notebook_merge'].some((kind) => changedKinds.has(kind));
      const refreshNotebooks = missedCursor || changedKinds.has('notebook_merge');
      const refreshWorkstreams = missedCursor || changedKinds.has('workstream_create') || changedKinds.has('note_workstream');
      const refreshProfile = missedCursor || changedKinds.has('focus_reorder') || changedKinds.has('calendar_sync');
      const refreshCalendar = missedCursor || changedKinds.has('calendar_sync');

      const refreshes: Promise<void>[] = [useAgentStore.getState().fetchAll(userId)];
      if (refreshTasks) {
        refreshes.push(useTasksStore.getState().fetchAll(userId));
      }
      if (refreshNotes) {
        refreshes.push(useNotesStore.getState().fetchAll(userId));
      }
      if (refreshNotebooks) {
        refreshes.push(useNotebooksStore.getState().fetchAll(userId));
      }
      if (refreshWorkstreams) {
        refreshes.push(useWorkstreamsStore.getState().fetchAll(userId));
      }
      if (refreshProfile) {
        refreshes.push(useProfileStore.getState().fetchProfile(userId));
      }
      if (refreshCalendar) {
        const { fromIso, toIso } = eventsFetchIsoRange(useProfileStore.getState().profile?.timezone);
        refreshes.push(useEventsStore.getState().fetchRange(userId, fromIso, toIso));
        refreshes.push(useMeetingDebriefStore.getState().fetchRange(userId, fromIso, toIso));
      }

      await Promise.all(refreshes);
      const refreshError = useAgentStore.getState().error
        || (refreshTasks ? useTasksStore.getState().error : null)
        || (refreshNotes ? useNotesStore.getState().error : null)
        || (refreshNotebooks ? useNotebooksStore.getState().error : null)
        || (refreshWorkstreams ? useWorkstreamsStore.getState().error : null)
        || (refreshProfile ? useProfileStore.getState().error : null)
        || (refreshCalendar ? useEventsStore.getState().error || useMeetingDebriefStore.getState().error : null);
      if (refreshError) {
        console.warn('Codex sync refresh failed; keeping the cursor for retry:', refreshError);
        return;
      }
      initializedRef.current = true;
      latestActionIdRef.current = newestActionId;
    } catch (error) {
      console.warn('Codex sync refresh failed; will retry:', error);
    } finally {
      checkingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    initializedRef.current = false;
    latestActionIdRef.current = null;
    lastCheckedAtRef.current = 0;
    if (!userId) return;

    void checkForChanges();
    const intervalId = window.setInterval(() => void checkForChanges(), CODEX_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForChanges();
    };
    const onFocus = () => void checkForChanges();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, checkForChanges]);
}
