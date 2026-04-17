import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Task } from '../types';

type TasksState = {
  tasks: Task[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  createTask: (userId: string, title: string) => Promise<Task | null>;
  toggleDone: (id: string, done: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  clear: () => void;
};

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchAll: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ tasks: data ?? [], loading: false });
  },

  createTask: async (userId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return null;

    const now = new Date().toISOString();
    const optimistic: Task = {
      id: `tmp-${crypto.randomUUID()}`,
      user_id: userId,
      title: trimmed,
      done: false,
      created_at: now,
      updated_at: now,
    };
    set({ tasks: [optimistic, ...get().tasks] });

    const { data, error } = await supabase
      .from('tasks')
      .insert({ user_id: userId, title: trimmed, done: false })
      .select()
      .single();

    if (error || !data) {
      set({
        tasks: get().tasks.filter((t) => t.id !== optimistic.id),
        error: error?.message ?? 'Failed to create task',
      });
      return null;
    }

    set({
      tasks: get().tasks.map((t) => (t.id === optimistic.id ? data : t)),
    });
    return data;
  },

  toggleDone: async (id, done) => {
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) => (t.id === id ? { ...t, done, updated_at: now } : t)),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('tasks').update({ done }).eq('id', id);
    if (error) set({ error: error.message });
  },

  deleteTask: async (id) => {
    const prev = get().tasks;
    set({ tasks: prev.filter((t) => t.id !== id) });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) set({ tasks: prev, error: error.message });
  },

  clear: () => set({ tasks: [], loading: false, error: null }),
}));

