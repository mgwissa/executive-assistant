import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Notebook, Section } from '../types';

type NotebooksState = {
  notebooks: Notebook[];
  sections: Section[];
  /** Row counts in `notebook_members` per notebook (for shared badge). */
  memberCountByNotebook: Record<string, number>;
  activeNotebookId: string | null;
  loading: boolean;
  error: string | null;

  setActiveNotebook: (id: string) => void;

  fetchAll: (userId: string) => Promise<void>;
  /** Ensures at least one notebook + section exists. Call after fetchAll. */
  ensureDefault: (userId: string) => Promise<void>;

  createNotebook: (userId: string, name: string) => Promise<Notebook | null>;
  renameNotebook: (id: string, name: string) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;

  createSection: (notebookId: string, userId: string, name: string) => Promise<Section | null>;
  renameSection: (id: string, name: string) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;

  /** Recompute `memberCountByNotebook` without touching notebooks/sections. */
  refreshMemberCounts: () => Promise<void>;

  clear: () => void;
};

export const useNotebooksStore = create<NotebooksState>((set, get) => ({
  notebooks: [],
  sections: [],
  memberCountByNotebook: {},
  activeNotebookId: null,
  loading: false,
  error: null,

  setActiveNotebook: (id) => set({ activeNotebookId: id }),

  fetchAll: async (_userId) => {
    set({ loading: true, error: null });
    const [nbRes, secRes, memRes] = await Promise.all([
      supabase.from('notebooks').select('*').order('position').order('created_at'),
      supabase.from('sections').select('*').order('position').order('created_at'),
      supabase.from('notebook_members').select('notebook_id'),
    ]);
    if (nbRes.error || secRes.error || memRes.error) {
      set({
        loading: false,
        error:
          nbRes.error?.message ??
          secRes.error?.message ??
          memRes.error?.message ??
          'Fetch failed',
      });
      return;
    }
    const notebooks = nbRes.data ?? [];
    const sections = secRes.data ?? [];
    const memberCountByNotebook: Record<string, number> = {};
    for (const row of memRes.data ?? []) {
      const nid = row.notebook_id as string;
      memberCountByNotebook[nid] = (memberCountByNotebook[nid] ?? 0) + 1;
    }
    const current = get().activeNotebookId;
    const activeNotebookId =
      notebooks.find((n) => n.id === current)?.id ?? notebooks[0]?.id ?? null;
    set({ notebooks, sections, memberCountByNotebook, activeNotebookId, loading: false });
  },

  ensureDefault: async (userId) => {
    if (get().notebooks.length > 0) return;
    const nb = await get().createNotebook(userId, 'My Notebook');
    if (nb) {
      await get().createSection(nb.id, userId, 'General');
    }
  },

  createNotebook: async (userId, name) => {
    const position = get().notebooks.length;
    const now = new Date().toISOString();
    const optimistic: Notebook = {
      id: `tmp-${crypto.randomUUID()}`,
      user_id: userId,
      name,
      position,
      created_at: now,
      updated_at: now,
    };
    set({
      notebooks: [...get().notebooks, optimistic],
      activeNotebookId: get().activeNotebookId ?? optimistic.id,
    });

    const { data, error } = await supabase
      .from('notebooks')
      .insert({ user_id: userId, name, position })
      .select()
      .single();

    if (error || !data) {
      set({
        notebooks: get().notebooks.filter((n) => n.id !== optimistic.id),
        error: error?.message ?? 'Failed to create notebook',
      });
      return null;
    }
    set({
      notebooks: get().notebooks.map((n) => (n.id === optimistic.id ? data : n)),
      activeNotebookId: get().activeNotebookId === optimistic.id ? data.id : get().activeNotebookId,
    });
    return data;
  },

  renameNotebook: async (id, name) => {
    set({ notebooks: get().notebooks.map((n) => (n.id === id ? { ...n, name } : n)) });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('notebooks').update({ name }).eq('id', id);
    if (error) set({ error: error.message });
  },

  deleteNotebook: async (id) => {
    const prev = get().notebooks;
    const next = prev.filter((n) => n.id !== id);
    const sectionIds = get().sections.filter((s) => s.notebook_id === id).map((s) => s.id);
    const activeNotebookId =
      get().activeNotebookId === id ? (next[0]?.id ?? null) : get().activeNotebookId;
    set({
      notebooks: next,
      sections: get().sections.filter((s) => !sectionIds.includes(s.id) && s.notebook_id !== id),
      activeNotebookId,
    });
    if (!id.startsWith('tmp-')) {
      const { error } = await supabase.from('notebooks').delete().eq('id', id);
      if (error) set({ notebooks: prev, error: error.message });
    }
  },

  createSection: async (notebookId, userId, name) => {
    const position = get().sections.filter((s) => s.notebook_id === notebookId).length;
    const now = new Date().toISOString();
    const optimistic: Section = {
      id: `tmp-${crypto.randomUUID()}`,
      notebook_id: notebookId,
      user_id: userId,
      name,
      position,
      created_at: now,
      updated_at: now,
    };
    set({ sections: [...get().sections, optimistic] });

    const { data, error } = await supabase
      .from('sections')
      .insert({ notebook_id: notebookId, user_id: userId, name, position })
      .select()
      .single();

    if (error || !data) {
      set({
        sections: get().sections.filter((s) => s.id !== optimistic.id),
        error: error?.message ?? 'Failed to create section',
      });
      return null;
    }
    set({ sections: get().sections.map((s) => (s.id === optimistic.id ? data : s)) });
    return data;
  },

  renameSection: async (id, name) => {
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, name } : s)) });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('sections').update({ name }).eq('id', id);
    if (error) set({ error: error.message });
  },

  deleteSection: async (id) => {
    const prev = get().sections;
    set({ sections: prev.filter((s) => s.id !== id) });
    if (!id.startsWith('tmp-')) {
      const { error } = await supabase.from('sections').delete().eq('id', id);
      if (error) set({ sections: prev, error: error.message });
    }
  },

  refreshMemberCounts: async () => {
    const { data, error } = await supabase.from('notebook_members').select('notebook_id');
    if (error) {
      set({ error: error.message });
      return;
    }
    const memberCountByNotebook: Record<string, number> = {};
    for (const row of data ?? []) {
      const nid = row.notebook_id as string;
      memberCountByNotebook[nid] = (memberCountByNotebook[nid] ?? 0) + 1;
    }
    set({ memberCountByNotebook });
  },

  clear: () =>
    set({
      notebooks: [],
      sections: [],
      memberCountByNotebook: {},
      activeNotebookId: null,
      loading: false,
      error: null,
    }),
}));
