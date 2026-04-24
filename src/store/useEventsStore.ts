import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { randomUUID } from '../lib/uuid';
import type { Event } from '../types';

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

type EventsState = {
  events: Event[];
  loading: boolean;
  error: string | null;

  fetchRange: (userId: string, fromIso: string, toIso: string) => Promise<void>;
  createEvent: (
    userId: string,
    payload: Omit<Event, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'source'> & {
      id?: string;
      source?: string;
    },
  ) => Promise<Event | null>;
  updateEvent: (id: string, patch: Partial<Event>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  deleteOutlookImports: (userId: string) => Promise<string | null>;
  clear: () => void;
};

/** PostgREST default max rows per request; without pagination only the first page is returned. */
const EVENTS_PAGE_SIZE = 1000;

export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  loading: false,
  error: null,

  fetchRange: async (userId, fromIso, toIso) => {
    set({ loading: true, error: null });
    // `toIso` is exclusive (start of next Monday). Split query so recurring rows that begin
    // before `fromIso` are still loaded, while one-off events stay inside the window.
    const mergedById = new Map<string, Event>();

    const pullNoneRecurring = async () => {
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('user_id', userId)
          .eq('recurrence', 'none')
          .gte('start_at', fromIso)
          .lt('start_at', toIso)
          .order('start_at', { ascending: true })
          .range(offset, offset + EVENTS_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        for (const e of batch) {
          if (!e.until_at || e.until_at >= fromIso) mergedById.set(e.id, e);
        }
        if (batch.length < EVENTS_PAGE_SIZE) break;
        offset += EVENTS_PAGE_SIZE;
      }
    };

    const pullRecurring = async () => {
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('user_id', userId)
          .neq('recurrence', 'none')
          .lte('start_at', toIso)
          .or(`until_at.is.null,until_at.gte.${fromIso}`)
          .order('start_at', { ascending: true })
          .range(offset, offset + EVENTS_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        for (const e of batch) {
          if (!e.until_at || e.until_at >= fromIso) mergedById.set(e.id, e);
        }
        if (batch.length < EVENTS_PAGE_SIZE) break;
        offset += EVENTS_PAGE_SIZE;
      }
    };

    try {
      await pullNoneRecurring();
      await pullRecurring();
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load events',
      });
      return;
    }

    const merged = [...mergedById.values()].sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
    set({ events: merged, loading: false });
  },

  createEvent: async (userId, payload) => {
    const now = new Date().toISOString();
    const optimistic: Event = {
      id: `tmp-${randomUUID()}`,
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
      source: payload.source ?? 'manual',
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
        source: payload.source ?? 'manual',
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

  deleteOutlookImports: async (userId) => {
    set({ error: null });
    const prev = get().events;
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'outlook_ics');
    if (error) {
      const msg = error.message;
      set({ error: msg });
      return msg;
    }
    set({ events: prev.filter((e) => e.source !== 'outlook_ics') });
    return null;
  },

  clear: () => set({ events: [], loading: false, error: null }),
}));

