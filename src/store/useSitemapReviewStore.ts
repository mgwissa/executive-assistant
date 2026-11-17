import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { buildSitemapReviewModel } from '../lib/sitemapReview';
import type { SitemapNote, SitemapReviewModel } from '../lib/sitemapReview';

const PAGE_SIZE = 200;
const MAX_NOTES = 10_000;
let generation = 0;
type State = {
  userId: string | null; model: SitemapReviewModel; loading: boolean;
  error: string | null; truncated: boolean; loadedAt: string | null;
  fetchAll: (userId: string) => Promise<void>; clear: () => void;
};
const emptyModel: SitemapReviewModel = { runs: [], currentUrls: [], checkpoint: null, warnings: [] };
const initial = { userId: null, model: emptyModel, loading: false, error: null, truncated: false, loadedAt: null };

export const useSitemapReviewStore = create<State>((set, get) => ({
  ...initial,
  fetchAll: async (userId) => {
    const request = ++generation;
    if (get().userId !== userId) set({ ...initial, userId });
    set({ loading: true, error: null });
    try {
      const notes: SitemapNote[] = [];
      let truncated = false;
      for (let offset = 0; offset <= MAX_NOTES; offset += PAGE_SIZE) {
        const { data, error } = await supabase.from('notes')
          .select('id,title,content,updated_at').eq('user_id', userId)
          .ilike('title', 'AutoFinder sitemap%').order('created_at').order('id')
          .range(offset, offset === MAX_NOTES ? offset : offset + PAGE_SIZE - 1);
        if (request !== generation) return;
        if (error) throw error;
        if (offset === MAX_NOTES) { truncated = !!data?.length; break; }
        notes.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }
      const model = await buildSitemapReviewModel(notes);
      if (request === generation) set({ model, truncated, loading: false, loadedAt: new Date().toISOString() });
    } catch (error) {
      if (request === generation) set({ loading: false, error: error instanceof Error ? error.message
        : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Saved sitemap reports could not be loaded.' });
    }
  },
  clear: () => { ++generation; set(initial); },
}));
