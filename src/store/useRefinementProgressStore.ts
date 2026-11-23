import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { isRefinementProgressRow, isRefinementProgressStatus, isRefinementProgressTarget,
  refinementProgressKey, refinementProgressTarget } from '../lib/refinementProgress';
import type { RefinementProgressRow, RefinementProgressStatus, RefinementProgressTarget } from '../lib/refinementProgress';

const PAGE_SIZE = 200;
const MAX_ROWS = 10_000;
let generation = 0;
type State = {
  userId: string | null; progress: Record<string, RefinementProgressRow>; loading: boolean;
  error: string | null; loadedAt: string | null; savingKey: string | null;
  fetchAll: (userId: string) => Promise<void>;
  setProgress: (userId: string, target: RefinementProgressTarget, status: RefinementProgressStatus) => Promise<boolean>;
  clear: () => void;
};
const initial = { userId: null, progress: {}, loading: false, error: null, loadedAt: null, savingKey: null };
const message = (error: unknown): string => error instanceof Error ? error.message
  : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Progress could not be loaded.';

export const useRefinementProgressStore = create<State>((set, get) => ({
  ...initial,
  fetchAll: async (userId) => {
    if (get().userId === userId && get().savingKey) return;
    const request = ++generation;
    if (get().userId !== userId) set({ ...initial, userId });
    set({ loading: true, error: null });
    try {
      const progress: Record<string, RefinementProgressRow> = {};
      for (let offset = 0; offset <= MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await supabase.from('refinement_item_progress')
          .select('user_id,note_id,source_id,item_kind,item_id,status,updated_at').eq('user_id', userId)
          .order('source_id').order('item_kind').order('item_id')
          .range(offset, offset === MAX_ROWS ? offset : offset + PAGE_SIZE - 1);
        if (request !== generation) return;
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Saved progress response was incomplete. Refresh before making changes.');
        if (offset === MAX_ROWS) {
          if (data?.length) throw new Error('Saved progress exceeds the supported history limit; completion controls are unavailable.');
          break;
        }
        for (const row of data ?? []) {
          if (!isRefinementProgressRow(row, userId)) throw new Error('Unexpected saved progress. Refresh before making changes.');
          const key = refinementProgressKey(refinementProgressTarget(row));
          if (progress[key]) throw new Error('Conflicting saved progress. Refresh before making changes.');
          progress[key] = row;
        }
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }
      if (request === generation) set({ progress, loading: false, loadedAt: new Date().toISOString() });
    } catch (error) {
      if (request === generation) set({ loading: false, error: message(error) });
    }
  },
  setProgress: async (userId, target, status) => {
    const state = get();
    if (state.userId !== userId || state.loading || state.savingKey || !state.loadedAt || state.error) return false;
    if (!isRefinementProgressTarget(target) || !isRefinementProgressStatus(status)) {
      set({ error: 'Invalid progress selection. Refresh before retrying.' }); return false;
    }
    const key = refinementProgressKey(target);
    const existing = state.progress[key];
    if ((existing?.status ?? 'not_started') === status) return true;
    const request = ++generation;
    set({ savingKey: key, error: null });
    try {
      const { data, error } = await supabase.rpc('set_refinement_progress', {
        p_note_id: target.noteId, p_source_id: target.sourceId, p_item_kind: target.itemKind,
        p_item_id: target.itemId, p_status: status, p_expected_updated_at: existing?.updated_at ?? null,
      });
      if (request !== generation || get().userId !== userId) return false;
      if (error) throw error;
      const row: unknown = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
      if (!isRefinementProgressRow(row, userId) || refinementProgressKey(refinementProgressTarget(row)) !== key
        || row.note_id !== target.noteId || row.status !== status) throw new Error('Unexpected save receipt.');
      // Only confirmed persistence changes the visible status or hides an active item.
      set({ savingKey: null, progress: { ...get().progress, [key]: row } });
      return true;
    } catch (error) {
      if (request === generation && get().userId === userId) {
        set({ savingKey: null, error: `${message(error)} Refresh saved reviews before retrying.` });
      }
      return false;
    }
  },
  clear: () => { ++generation; set(initial); },
}));
