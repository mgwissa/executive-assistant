import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { EmailReviewCase, EmailReviewEvent, EmailReviewIntake, EmailReviewStatus } from '../lib/emailReview';

const PAGE_SIZE = 200;
const MAX_LOADED = 2000;
let generation = 0;
type EmailReviewState = {
  userId: string | null; cases: EmailReviewCase[]; latestIntake: EmailReviewIntake | null;
  checkpoint: EmailReviewIntake | null; truncated: boolean; loading: boolean; error: string | null;
  savingId: string | null; history: Record<string, EmailReviewEvent[]>;
  fetchAll: (userId: string) => Promise<void>;
  fetchHistory: (userId: string, caseId: string) => Promise<void>;
  review: (userId: string, item: EmailReviewCase, status: EmailReviewStatus, note: string) => Promise<string | null>;
  clear: () => void;
};
const initial = { userId: null, cases: [], latestIntake: null, checkpoint: null, truncated: false,
  loading: false, error: null, savingId: null, history: {} };

export const useEmailReviewStore = create<EmailReviewState>((set, get) => ({
  ...initial,
  fetchAll: async (userId) => {
    if (get().userId === userId && get().savingId) return;
    const request = ++generation;
    if (get().userId !== userId) set({ ...initial, userId });
    set({ loading: true, error: null });
    try {
      const cases: EmailReviewCase[] = [];
      let truncated = false;
      for (let offset = 0; offset <= MAX_LOADED; offset += PAGE_SIZE) {
        const { data, error } = await supabase.from('email_review_cases').select('*').eq('user_id', userId)
          .order('received_at', { ascending: false }).order('id')
          .range(offset, offset === MAX_LOADED ? offset : offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (request !== generation) return;
        if (offset === MAX_LOADED) { truncated = !!data?.length; break; }
        cases.push(...(data ?? []) as EmailReviewCase[]);
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }
      const [latest, checkpoint] = await Promise.all([
        supabase.from('email_review_intakes').select('*').eq('user_id', userId).order('created_at', { ascending: false }).order('id').limit(1).maybeSingle(),
        supabase.from('email_review_intakes').select('*').eq('user_id', userId).eq('complete', true).order('covered_through', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (latest.error || checkpoint.error) throw latest.error ?? checkpoint.error;
      if (request === generation) set({ cases, truncated, latestIntake: latest.data as EmailReviewIntake | null,
        checkpoint: checkpoint.data as EmailReviewIntake | null, loading: false });
    } catch (error) {
      if (request === generation) set({ loading: false, error: error instanceof Error ? error.message
        : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Email review could not be loaded.' });
    }
  },
  fetchHistory: async (userId, caseId) => {
    const request = generation;
    const { data, error } = await supabase.from('email_review_events').select('*').eq('user_id', userId)
      .eq('case_id', caseId).order('created_at', { ascending: false }).order('id').limit(20);
    if (request !== generation || get().userId !== userId) return;
    if (error) { set({ error: error.message }); return; }
    set({ history: { ...get().history, [caseId]: (data ?? []) as EmailReviewEvent[] } });
  },
  review: async (userId, item, status, note) => {
    if (get().userId !== userId || get().savingId) return null;
    const request = ++generation; // Invalidate any older in-flight list snapshot.
    set({ savingId: item.id, error: null, loading: false });
    const { data, error } = await supabase.rpc('review_email_case', {
      p_case_id: item.id, p_expected_updated_at: item.updated_at, p_status: status, p_decision_note: note,
    });
    if (request !== generation || get().userId !== userId) return null;
    if (error || !data) { set({ savingId: null, error: error?.message ?? 'Decision was not saved.' }); return null; }
    // PostgREST can represent a composite result as one row or a one-row array.
    const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
    if (!row || row.id !== item.id || row.user_id !== userId || typeof row.updated_at !== 'string') {
      set({ savingId: null, error: 'Unexpected decision receipt. Refresh this case before retrying.' });
      return null;
    }
    const saved = row as EmailReviewCase;
    set({ savingId: null, cases: get().cases.map(c => c.id === item.id ? saved : c) });
    await get().fetchAll(userId); // Includes any intake that arrived during this save.
    await get().fetchHistory(userId, item.id);
    return saved.updated_at;
  },
  clear: () => { ++generation; set(initial); },
}));
