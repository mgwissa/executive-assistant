import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { TimeProject } from '../types';

type TimeProjectsState = {
  projects: TimeProject[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  create: (userId: string, name: string) => Promise<TimeProject | null>;
  deleteProject: (userId: string, id: string) => Promise<void>;
  clear: () => void;
};

export const useTimeProjectsStore = create<TimeProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  fetchAll: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('time_projects')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ projects: data ?? [], loading: false });
  },

  create: async (userId, rawName) => {
    const name = rawName.trim();
    if (!name) return null;
    set({ error: null });
    const { data, error } = await supabase
      .from('time_projects')
      .insert({ user_id: userId, name })
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return null;
    }

    set({
      projects: [...get().projects, data].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    });
    return data;
  },

  deleteProject: async (userId, id) => {
    set({ error: null });
    const { error } = await supabase
      .from('time_projects')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set({ projects: get().projects.filter((p) => p.id !== id) });
  },

  clear: () => set({ projects: [], error: null }),
}));
