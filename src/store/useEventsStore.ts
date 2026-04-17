import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Event } from '../types';

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

type EventsState = {
  events: Event[];
  loading: boolean;
  error: string | null;

  fetchRange: (userId: string, fromIso: string, toIso: string) => Promise<void>;
  createEvent: (
    userId: string,
    payload: Omit<Event, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { id?: string },
  ) => Promise<Event | null>;
  updateEvent: (id: string, patch: Partial<Event>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  clear: () => void;
};

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  loading: false,
  error: null,

  fetchRange: async (userId, fromIso, toIso) => {
    set({ loading: true, error: null });
    // Recurring events can start before `from`, so we fetch all events that start before the end
    // and rely on client-side occurrence generation to filter.
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .lte('start_at', toIso)
      .order('start_at', { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    // Extra safety: if until_at exists and is before range, drop it.
    const filtered =
      data?.filter((e) => !e.until_at || e.until_at >= fromIso) ?? [];
    set({ events: filtered, loading: false });
  },

  createEvent: async (userId, payload) => {
    const now = new Date().toISOString();
    const optimistic: Event = {
      id: `tmp-${crypto.randomUUID()}`,
      user_id: userId,
      title: payload.title,
      start_at: payload.start_at,
      duration_minutes: payload.duration_minutes,
      timezone: payload.timezone,
      recurrence: payload.recurrence,
      interval: payload.interval,
      by_weekday: payload.by_weekday ?? null,
      until_at: payload.until_at ?? null,
      count: payload.count ?? null,
      created_at: now,
      updated_at: now,
    };
    set({ events: [...get().events, optimistic] });

    const { data, error } = await supabase
      .from('events')
      .insert({
        user_id: userId,
        title: payload.title,
        start_at: payload.start_at,
        duration_minutes: payload.duration_minutes,
        timezone: payload.timezone,
        recurrence: payload.recurrence,
        interval: payload.interval,
        by_weekday: payload.by_weekday ?? null,
        until_at: payload.until_at ?? null,
        count: payload.count ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      set({
        events: get().events.filter((e) => e.id !== optimistic.id),
        error: error?.message ?? 'Failed to create event',
      });
      return null;
    }

    set({
      events: get().events.map((e) => (e.id === optimistic.id ? data : e)),
    });
    return data;
  },

  updateEvent: async (id, patch) => {
    const now = new Date().toISOString();
    set({
      events: get().events.map((e) =>
        e.id === id ? { ...e, ...patch, updated_at: now } : e,
      ),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('events').update(patch).eq('id', id);
    if (error) set({ error: error.message });
  },

  deleteEvent: async (id) => {
    const prev = get().events;
    set({ events: prev.filter((e) => e.id !== id) });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) set({ events: prev, error: error.message });
  },

  clear: () => set({ events: [], loading: false, error: null }),
}));

