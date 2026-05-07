import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { TimeEntry } from '../types';

function sortEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const aOpen = a.ended_at == null;
    const bOpen = b.ended_at == null;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });
}

type TimeEntriesState = {
  entries: TimeEntry[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  startTimer: (userId: string, label: string, taskId: string | null) => Promise<TimeEntry | null>;
  stopTimer: (userId: string, entryId: string) => Promise<void>;
  updateLabel: (entryId: string, label: string) => Promise<void>;
  deleteEntry: (userId: string, entryId: string) => Promise<void>;
  clear: () => void;
};

export const useTimeEntriesStore = create<TimeEntriesState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,

  fetchAll: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ entries: sortEntries(data ?? []), loading: false });
  },

  startTimer: async (userId, label, taskId) => {
    set({ error: null });
    const started_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        user_id: userId,
        label: label.trim(),
        started_at,
        ended_at: null,
        task_id: taskId,
      })
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      if (error.code === '23505') {
        await get().fetchAll(userId);
      }
      return null;
    }

    set({ entries: sortEntries([data, ...get().entries]) });
    return data;
  },

  stopTimer: async (userId, entryId) => {
    set({ error: null });
    const ended_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('time_entries')
      .update({ ended_at })
      .eq('id', entryId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    set({
      entries: sortEntries(get().entries.map((e) => (e.id === entryId ? data : e))),
    });
  },

  updateLabel: async (entryId, label) => {
    const next = label.trim();
    const { data, error } = await supabase
      .from('time_entries')
      .update({ label: next })
      .eq('id', entryId)
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    set({
      entries: sortEntries(get().entries.map((e) => (e.id === entryId ? data : e))),
    });
  },

  deleteEntry: async (userId, entryId) => {
    set({ error: null });
    const { error } = await supabase
      .from('time_entries')
      .delete()
      .eq('id', entryId)
      .eq('user_id', userId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set({ entries: get().entries.filter((e) => e.id !== entryId) });
  },

  clear: () => set({ entries: [], error: null }),
}));
