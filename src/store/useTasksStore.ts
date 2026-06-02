import { create } from 'zustand';
import { normalizeTags } from '../lib/taskTags';
import { supabase } from '../lib/supabase';
import { computeEscalation, parseEscalationConfig } from '../lib/priorityEscalation';
import { normalizeDueTime } from '../lib/taskSchedule';
import { scheduleMemoryDelete, scheduleMemoryIndex } from '../lib/memorySyncScheduler';
import { dueDateForPriority, isPriorityLocked, parsePriorityInTitle, parsePriorityPrefix } from '../lib/priority';
import type { TaskPriority } from '../lib/priority';
import type { Task } from '../types';
import { randomUUID } from '../lib/uuid';
import { useProfileStore } from './useProfileStore';

export type CreateTaskOptions = {
  priority?: TaskPriority;
  /** When omitted, due date is derived from priority. Pass `null` for no due date. */
  dueDate?: string | null;
  dueTime?: string | null;
  linkedEventId?: string | null;
  tags?: string[];
};

type TasksState = {
  tasks: Task[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  applyDueDatePromotion: () => Promise<void>;
  applyEscalationFromProfile: (userId: string) => Promise<void>;
  createTask: (userId: string, title: string, options?: CreateTaskOptions) => Promise<Task | null>;
  setTaskPriority: (id: string, priority: TaskPriority) => Promise<void>;
  setDueDate: (id: string, dueDate: string | null) => Promise<void>;
  setDueTime: (id: string, dueTime: string | null) => Promise<void>;
  setLinkedEvent: (id: string, eventId: string | null) => Promise<void>;
  updateDescription: (id: string, description: string) => void;
  renameTask: (id: string, rawTitle: string) => Promise<void>;
  toggleDone: (id: string, done: boolean) => Promise<void>;
  setWaitingOn: (id: string, value: string | null) => Promise<void>;
  setEstimatedMinutes: (id: string, minutes: number | null) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  snoozeChase: (id: string, untilIso: string) => Promise<void>;
  recordChase: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<boolean>;
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
    await get().applyDueDatePromotion();
    await get().applyEscalationFromProfile(userId);
  },

  applyDueDatePromotion: async () => {
    const open = get().tasks.filter(
      (t) => !t.done && !t.id.startsWith('tmp-') && t.priority !== 'critical' && isPriorityLocked(t.due_date),
    );
    if (open.length === 0) return;

    const now = new Date().toISOString();
    for (const task of open) {
      const { error } = await supabase
        .from('tasks')
        .update({ priority: 'critical', priority_set_at: now })
        .eq('id', task.id);
      if (error) {
        set({ error: error.message });
        continue;
      }
      set({
        tasks: get().tasks.map((t) =>
          t.id === task.id
            ? { ...t, priority: 'critical', priority_set_at: now, updated_at: now }
            : t,
        ),
      });
    }
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

  createTask: async (userId, title, options) => {
    const trimmed = title.trim();
    if (!trimmed) return null;

    let { priority, label } = parsePriorityPrefix(trimmed);
    if (options?.priority) priority = options.priority;
    const cleanTitle = label.trim();
    if (!cleanTitle) return null;

    const now = new Date().toISOString();
    let due_date =
      options?.dueDate !== undefined ? options.dueDate : dueDateForPriority(priority);
    let due_time =
      due_date && options?.dueTime ? normalizeDueTime(options.dueTime) : null;
    if (due_date && isPriorityLocked(due_date)) {
      priority = 'critical';
    }

    const tags = normalizeTags(options?.tags ?? []);

    const optimistic: Task = {
      id: `tmp-${randomUUID()}`,
      user_id: userId,
      title: cleanTitle,
      done: false,
      priority,
      priority_set_at: now,
      due_date,
      due_time,
      reminder_sent_at: null,
      linked_event_id: options?.linkedEventId ?? null,
      description: '',
      waiting_on: null,
      chase_snoozed_until: null,
      last_chased_at: null,
      estimated_minutes: null,
      tags,
      reschedule_count: 0,
      created_at: now,
      updated_at: now,
    };
    set({ tasks: [optimistic, ...get().tasks] });

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        title: cleanTitle,
        done: false,
        priority,
        priority_set_at: now,
        due_date,
        due_time,
        waiting_on: null,
        linked_event_id: options?.linkedEventId ?? null,
        tags,
      })
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
    scheduleMemoryIndex('task', data.id);
    return data;
  },

  setTaskPriority: async (id, priority) => {
    const task = get().tasks.find((t) => t.id === id);
    if (task && !task.done && isPriorityLocked(task.due_date)) return;

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
    const locked = isPriorityLocked(dueDate);
    const now = new Date().toISOString();
    const task = get().tasks.find((t) => t.id === id);
    const promote = locked && task && !task.done && task.priority !== 'critical';
    // Only count as a reschedule when moving an existing due date (not initial assignment)
    const isReschedule = !id.startsWith('tmp-') && task?.due_date != null && task.due_date !== dueDate;
    const clearingDate = !dueDate;

    set({
      tasks: get().tasks.map((t) => {
        if (t.id !== id) return t;
        const updates: Partial<Task> = {
          due_date: dueDate,
          reminder_sent_at: null,
        };
        if (clearingDate) {
          updates.due_time = null;
          updates.linked_event_id = null;
        }
        if (promote) {
          updates.priority = 'critical';
          updates.priority_set_at = now;
          updates.updated_at = now;
        }
        if (isReschedule) {
          updates.reschedule_count = (t.reschedule_count ?? 0) + 1;
        }
        return { ...t, ...updates };
      }),
    });
    if (id.startsWith('tmp-')) return;

    const dbPatch: Record<string, unknown> = {
      due_date: dueDate,
      reminder_sent_at: null,
    };
    if (clearingDate) {
      dbPatch.due_time = null;
      dbPatch.linked_event_id = null;
    }
    if (promote) {
      dbPatch.priority = 'critical';
      dbPatch.priority_set_at = now;
    }
    const { error } = await supabase
      .from('tasks')
      .update(dbPatch)
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  setDueTime: async (id, dueTime) => {
    const task = get().tasks.find((t) => t.id === id);
    const normalized = dueTime ? normalizeDueTime(dueTime) : null;
    if (normalized && !task?.due_date) return;

    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) =>
        t.id === id
          ? { ...t, due_time: normalized, reminder_sent_at: null, updated_at: now }
          : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ due_time: normalized, reminder_sent_at: null })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  setLinkedEvent: async (id, eventId) => {
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, linked_event_id: eventId, updated_at: now } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ linked_event_id: eventId })
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
        else scheduleMemoryIndex('task', id);
      }, DESC_DEBOUNCE_MS),
    );
  },

  renameTask: async (id, rawTitle) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const currentP = (task.priority as TaskPriority) ?? 'normal';
    const locked = !task.done && isPriorityLocked(task.due_date);
    const parsed = parsePriorityInTitle(rawTitle, currentP);
    const trimmed = parsed.title.trim();
    if (!trimmed) return;

    const priority = locked ? currentP : parsed.priority;
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
    else scheduleMemoryIndex('task', id);
  },

  toggleDone: async (id, done) => {
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) => (t.id === id ? { ...t, done, updated_at: now } : t)),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('tasks').update({ done }).eq('id', id);
    if (error) set({ error: error.message });
    else if (done) scheduleMemoryDelete('task', id);
    else scheduleMemoryIndex('task', id);
  },

  setWaitingOn: async (id, value) => {
    const raw = value?.trim() ?? '';
    const next = raw === '' ? null : raw.slice(0, 120);
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) => (t.id === id ? { ...t, waiting_on: next, updated_at: now } : t)),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('tasks').update({ waiting_on: next }).eq('id', id);
    if (error) set({ error: error.message });
    else scheduleMemoryIndex('task', id);
  },

  setEstimatedMinutes: async (id, minutes) => {
    const next =
      minutes != null && minutes > 0 ? Math.min(480, Math.round(minutes)) : null;
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, estimated_minutes: next } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ estimated_minutes: next })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  setTags: async (id, tags) => {
    const next = normalizeTags(tags);
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) => (t.id === id ? { ...t, tags: next, updated_at: now } : t)),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('tasks').update({ tags: next }).eq('id', id);
    if (error) set({ error: error.message });
  },

  snoozeChase: async (id, untilIso) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, chase_snoozed_until: untilIso } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ chase_snoozed_until: untilIso })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  recordChase: async (id) => {
    const now = new Date().toISOString();
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, last_chased_at: now } : t,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase
      .from('tasks')
      .update({ last_chased_at: now })
      .eq('id', id);
    if (error) set({ error: error.message });
  },

  deleteTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    const label = task?.title?.trim();
    const prompt = label ? `Delete “${label}”?` : 'Delete this task?';
    if (!window.confirm(prompt)) return false;

    const prev = get().tasks;
    set({ tasks: prev.filter((t) => t.id !== id) });
    if (id.startsWith('tmp-')) return true;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) {
      set({ tasks: prev, error: error.message });
      return false;
    }
    scheduleMemoryDelete('task', id);
    return true;
  },

  clear: () => set({ tasks: [], loading: false, error: null }),
}));

