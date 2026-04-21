import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { computeEscalation, parseEscalationConfig } from '../lib/priorityEscalation';
import { dueDateForPriority, parsePriorityInTitle, parsePriorityPrefix } from '../lib/priority';
import type { TaskPriority } from '../lib/priority';
import type { Task } from '../types';
import { useProfileStore } from './useProfileStore';

type TasksState = {
  tasks: Task[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  applyEscalationFromProfile: (userId: string) => Promise<void>;
  createTask: (userId: string, title: string) => Promise<Task | null>;
  setTaskPriority: (id: string, priority: TaskPriority) => Promise<void>;
  setDueDate: (id: string, dueDate: string | null) => Promise<void>;
  updateDescription: (id: string, description: string) => void;
  renameTask: (id: string, rawTitle: string) => Promise<void>;
  toggleDone: (id: string, done: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  clear: () => void;
};

const DESC_DEBOUNCE_MS = 500;
const descTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    await get().applyEscalationFromProfile(userId);
  },

  applyEscalationFromProfile: async (userId) => {
    const profile = useProfileStore.getState().profile;
    if (!profile || profile.user_id !== userId) return;
    const cfg = parseEscalationConfig(profile.priority_escalation);
    if (!cfg.enabled) return;

    const now = new Date();
    const open = get().tasks.filter((t) => !t.done && !t.id.startsWith('tmp-'));

    for (const task of open) {
      const priority_set_at = task.priority_set_at ?? task.updated_at;
      const result = computeEscalation(
        { id: task.id, done: task.done, priority: task.priority, priority_set_at },
        cfg,
        now,
      );
      if (!result) continue;
      const { nextPriority, newPrioritySetAt } = result;
      const { error } = await supabase
        .from('tasks')
        .update({ priority: nextPriority, priority_set_at: newPrioritySetAt })
        .eq('id', task.id);
      if (error) {
        set({ error: error.message });
        continue;
      }
      set({
        tasks: get().tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                priority: nextPriority,
                priority_set_at: newPrioritySetAt,
                updated_at: newPrioritySetAt,
              }
            : t,
        ),
      });
    }
  },

  createTask: async (userId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return null;

    const { priority, label } = parsePriorityPrefix(trimmed);
    const cleanTitle = label.trim();
    if (!cleanTitle) return null;

    const now = new Date().toISOString();
    const due_date = dueDateForPriority(priority);
    const optimistic: Task = {
      id: `tmp-${crypto.randomUUID()}`,
      user_id: userId,
      title: cleanTitle,
      done: false,
      priority,
      priority_set_at: now,
      due_date,
      description: '',
      created_at: now,
      updated_at: now,
    };
    set({ tasks: [optimistic, ...get().tasks] });

    const { data, error } = await supabase
      .from('tasks')
      .insert({ user_id: userId, title: cleanTitle, done: false, priority, priority_set_at: now, due_date })
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

  setTaskPriority: async (id, priority) => {
    const now = new Date().toISOString();
    const due_date = dueDateForPriority(priority);
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, priority, priority_set_at: now, due_date, updated_at: now } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ priority, priority_set_at: now, due_date })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  setDueDate: async (id, dueDate) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, due_date: dueDate } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ due_date: dueDate })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  updateDescription: (id, description) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, description } : t,
      ),
    });
    const existing = descTimers.get(id);
    if (existing) clearTimeout(existing);
    descTimers.set(
      id,
      setTimeout(async () => {
        descTimers.delete(id);
        if (id.startsWith('tmp-')) return;
        const { error } = await supabase
          .from('tasks')
          .update({ description })
          .eq('id', id);
        if (error) set({ error: error.message });
      }, DESC_DEBOUNCE_MS),
    );
  },

  renameTask: async (id, rawTitle) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const currentP = (task.priority as TaskPriority) ?? 'normal';
    const { title, priority } = parsePriorityInTitle(rawTitle, currentP);
    const trimmed = title.trim();
    if (!trimmed) return;

    const priorityChanged = priority !== currentP;
    const now = new Date().toISOString();
    const priority_set_at = priorityChanged ? now : task.priority_set_at;
    const due_date = priorityChanged ? dueDateForPriority(priority) : task.due_date;

    set({
      tasks: get().tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              title: trimmed,
              priority,
              priority_set_at,
              due_date,
              updated_at: now,
            }
          : t,
      ),
    });

    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({
        title: trimmed,
        priority,
        priority_set_at,
        due_date,
      })
      .eq('id', id);
    if (error) set({ error: error.message });
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

