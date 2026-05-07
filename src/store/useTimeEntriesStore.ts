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

export type StartTimerOpts = {
  label: string;
  taskId: string | null;
  projectId: string | null;
};

export type UpdateTimeEntryPatch = {
  label?: string;
  started_at?: string;
  ended_at?: string | null;
  project_id?: string | null;
};

type TimeEntriesState = {
  entries: TimeEntry[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  startTimer: (userId: string, opts: StartTimerOpts) => Promise<TimeEntry | null>;
  stopTimer: (userId: string, entryId: string) => Promise<void>;
  updateEntry: (
    userId: string,
    entryId: string,
    patch: UpdateTimeEntryPatch,
  ) => Promise<void>;
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

  startTimer: async (userId, opts) => {
    set({ error: null });
    const started_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('time_entries')
      .insert({
        user_id: userId,
        label: opts.label.trim(),
        started_at,
        ended_at: null,
        task_id: opts.taskId,
        project_id: opts.projectId,
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

  updateEntry: async (userId, entryId, patch) => {
    const prev = get().entries.find((e) => e.id === entryId);
    if (!prev) return;

    const nextStart = patch.started_at ?? prev.started_at;
    const nextEnd = patch.ended_at !== undefined ? patch.ended_at : prev.ended_at;

    if (nextEnd != null && Date.parse(nextEnd) <= Date.parse(nextStart)) {
      set({ error: 'End time must be after start time.' });
      return;
    }

    set({ error: null });

    const body: Partial<{
      label: string;
      started_at: string;
      ended_at: string | null;
      project_id: string | null;
    }> = {};

    if (patch.label !== undefined) {
      body.label = patch.label.trim();
    }
    if (patch.started_at !== undefined) body.started_at = patch.started_at;
    if (patch.ended_at !== undefined) body.ended_at = patch.ended_at;
    if (patch.project_id !== undefined) body.project_id = patch.project_id;

    if (Object.keys(body).length === 0) return;

    const { data, error } = await supabase
      .from('time_entries')
      .update(body)
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
