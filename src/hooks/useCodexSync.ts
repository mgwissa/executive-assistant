import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAgentStore } from '../store/useAgentStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';

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
 * Keeps the open app in step with audited writes made through the local Codex
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

      if (!initializedRef.current) {
        initializedRef.current = true;
        latestActionIdRef.current = newestActionId;
        return;
      }

      if (newestActionId === latestActionIdRef.current) return;

      const previousIndex = latestActionIdRef.current
        ? recentActions.findIndex((action) => action.id === latestActionIdRef.current)
        : -1;
      const missedCursor = latestActionIdRef.current !== null && previousIndex === -1;
      const changedActions = previousIndex >= 0
        ? recentActions.slice(0, previousIndex)
        : recentActions;
      const changedKinds = new Set(changedActions.map((action) => action.kind));

      latestActionIdRef.current = newestActionId;

      const refreshes: Promise<void>[] = [useAgentStore.getState().fetchAll(userId)];
      if (missedCursor || [...changedKinds].some((kind) => TASK_ACTIONS.has(kind))) {
        refreshes.push(useTasksStore.getState().fetchAll(userId));
      }
      if (missedCursor || changedKinds.has('note_create') || changedKinds.has('note_append')) {
        refreshes.push(useNotesStore.getState().fetchAll(userId));
      }
      if (missedCursor || changedKinds.has('focus_reorder')) {
        refreshes.push(useProfileStore.getState().fetchProfile(userId));
      }

      await Promise.all(refreshes);
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
