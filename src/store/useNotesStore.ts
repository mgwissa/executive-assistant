import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Note } from '../types';

type NotesState = {
  notes: Note[];
  activeId: string | null;
  query: string;
  loading: boolean;
  error: string | null;

  setQuery: (q: string) => void;
  setActive: (id: string | null) => void;

  fetchAll: (userId: string) => Promise<void>;
  createNote: (userId: string) => Promise<Note | null>;
  updateNote: (id: string, patch: { title?: string; content?: string }) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  clear: () => void;
};

const DEBOUNCE_MS = 500;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  activeId: null,
  query: '',
  loading: false,
  error: null,

  setQuery: (q) => set({ query: q }),
  setActive: (id) => set({ activeId: id }),

  fetchAll: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({
      notes: data ?? [],
      loading: false,
      activeId: get().activeId ?? data?.[0]?.id ?? null,
    });
  },

  createNote: async (userId) => {
    const now = new Date().toISOString();
    const optimistic: Note = {
      id: `tmp-${crypto.randomUUID()}`,
      user_id: userId,
      title: 'Untitled',
      content: '',
      created_at: now,
      updated_at: now,
    };
    set({ notes: [optimistic, ...get().notes], activeId: optimistic.id });

    const { data, error } = await supabase
      .from('notes')
      .insert({ user_id: userId, title: 'Untitled', content: '' })
      .select()
      .single();

    if (error || !data) {
      set({
        notes: get().notes.filter((n) => n.id !== optimistic.id),
        error: error?.message ?? 'Failed to create note',
      });
      return null;
    }

    set({
      notes: get().notes.map((n) => (n.id === optimistic.id ? data : n)),
      activeId: data.id,
    });
    return data;
  },

  updateNote: async (id, patch) => {
    const now = new Date().toISOString();
    set({
      notes: get().notes.map((n) =>
        n.id === id ? { ...n, ...patch, updated_at: now } : n,
      ),
    });

    // Debounce the write per note
    const existing = pendingTimers.get(id);
    if (existing) clearTimeout(existing);

    pendingTimers.set(
      id,
      setTimeout(async () => {
        pendingTimers.delete(id);
        // Don't write to the backend for unsaved optimistic notes
        if (id.startsWith('tmp-')) return;
        const { error } = await supabase
          .from('notes')
          .update({ ...patch, updated_at: now })
          .eq('id', id);
        if (error) set({ error: error.message });
      }, DEBOUNCE_MS),
    );
  },

  deleteNote: async (id) => {
    const prev = get().notes;
    const next = prev.filter((n) => n.id !== id);
    const activeId =
      get().activeId === id ? (next[0]?.id ?? null) : get().activeId;
    set({ notes: next, activeId });

    if (!id.startsWith('tmp-')) {
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) {
        set({ notes: prev, error: error.message });
      }
    }
  },

  clear: () => set({ notes: [], activeId: null, query: '', error: null }),
}));
