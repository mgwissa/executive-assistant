import { create } from 'zustand';
import { occurrenceStartKey, type DebriefSnoozeMode } from '../lib/meetingDebrief';
import { scheduleMemoryIndex } from '../lib/memorySyncScheduler';
import { supabase } from '../lib/supabase';
import { randomUUID } from '../lib/uuid';
import type { MeetingDebriefState } from '../types';

export type DebriefStatus = 'done' | 'skipped' | 'snoozed';

type MeetingDebriefStateStore = {
  states: MeetingDebriefState[];
  loading: boolean;
  error: string | null;

  fetchRange: (userId: string, fromIso: string, toIso: string) => Promise<void>;
  upsertState: (
    userId: string,
    payload: {
      eventId: string;
      occurrenceStartAt: string;
      status: DebriefStatus;
      snoozedUntil?: string | null;
      snoozeMode?: DebriefSnoozeMode | null;
      notes?: string;
    },
  ) => Promise<MeetingDebriefState | null>;
  clear: () => void;
};

export const useMeetingDebriefStore = create<MeetingDebriefStateStore>((set, get) => ({
  states: [],
  loading: false,
  error: null,

  fetchRange: async (userId, fromIso, toIso) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('meeting_debrief_states')
      .select('*')
      .eq('user_id', userId)
      .gte('occurrence_start_at', fromIso)
      .lte('occurrence_start_at', toIso)
      .order('occurrence_start_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({
      states: (data ?? []).map((s) => ({
        ...s,
        occurrence_start_at: occurrenceStartKey(s.occurrence_start_at),
      })),
      loading: false,
    });
  },

  upsertState: async (userId, payload) => {
    const now = new Date().toISOString();
    const occurrenceKey = occurrenceStartKey(payload.occurrenceStartAt);
    const existing = get().states.find(
      (s) =>
        s.event_id === payload.eventId &&
        occurrenceStartKey(s.occurrence_start_at) === occurrenceKey,
    );

    const optimistic: MeetingDebriefState = {
      id: existing?.id ?? `tmp-${randomUUID()}`,
      user_id: userId,
      event_id: payload.eventId,
      occurrence_start_at: occurrenceKey,
      status: payload.status,
      snoozed_until: payload.snoozedUntil ?? null,
      snooze_mode: payload.snoozeMode ?? null,
      notes: payload.notes ?? '',
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    set({
      states: existing
        ? get().states.map((s) => (s.id === existing.id ? optimistic : s))
        : [...get().states, optimistic],
    });

    const { data, error } = await supabase
      .from('meeting_debrief_states')
      .upsert(
        {
          user_id: userId,
          event_id: payload.eventId,
          occurrence_start_at: occurrenceKey,
          status: payload.status,
          snoozed_until: payload.snoozedUntil ?? null,
          snooze_mode: payload.snoozeMode ?? null,
          notes: payload.notes ?? '',
        },
        { onConflict: 'user_id,event_id,occurrence_start_at' },
      )
      .select()
      .single();

    if (error || !data) {
      set({
        states: existing
          ? get().states.map((s) => (s.id === existing.id ? existing : s))
          : get().states.filter((s) => s.id !== optimistic.id),
        error: error?.message ?? 'Failed to save debrief state',
      });
      return null;
    }

    set({
      states: get().states.map((s) =>
        s.event_id === payload.eventId &&
        occurrenceStartKey(s.occurrence_start_at) === occurrenceKey
          ? { ...data, occurrence_start_at: occurrenceStartKey(data.occurrence_start_at) }
          : s.id === optimistic.id
            ? { ...data, occurrence_start_at: occurrenceStartKey(data.occurrence_start_at) }
            : s,
      ),
    });
    if (payload.notes?.trim()) {
      scheduleMemoryIndex('debrief', data.id);
    }
    return data;
  },

  clear: () => set({ states: [], loading: false, error: null }),
}));
