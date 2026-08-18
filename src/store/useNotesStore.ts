import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { markNoteSelfPersisted } from '../lib/noteSyncEcho';
import { findMeetingNote } from '../lib/meetingNotes';
import { occurrenceStartKey } from '../lib/meetingDebrief';
import { scheduleMemoryDelete, scheduleMemoryIndex } from '../lib/memorySyncScheduler';
import { randomUUID } from '../lib/uuid';
import type { Json } from '../types/database';
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
  createNote: (
    userId: string,
    sectionId: string,
    options?: { scratch?: boolean },
  ) => Promise<Note | null>;
  /** Find or create a note tied to one calendar occurrence. */
  ensureMeetingNote: (
    userId: string,
    sectionId: string,
    target: { eventId: string; occurrenceStartAt: string; title: string },
  ) => Promise<Note | null>;
  moveNote: (id: string, sectionId: string) => Promise<void>;
  updateNote: (
    id: string,
    patch: { title?: string; content?: string; content_blocks?: Json | null },
  ) => Promise<void>;
  setMeetingTriage: (userId: string, id: string, triaged: boolean) => Promise<boolean>;
  setScratchState: (userId: string, id: string, scratch: boolean) => Promise<boolean>;
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

  fetchAll: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({
      notes: data ?? [],
      loading: false,
      activeId:
        get().activeId ??
        data?.find((note) => !note.scratch_at)?.id ??
        data?.[0]?.id ??
        null,
    });
  },

  createNote: async (userId, sectionId, options) => {
    const now = new Date().toISOString();
    const scratchAt = options?.scratch ? now : null;
    const optimistic: Note = {
      id: `tmp-${randomUUID()}`,
      user_id: userId,
      section_id: sectionId,
      title: 'Untitled',
      content: '',
      content_blocks: null,
      linked_event_id: null,
      linked_occurrence_start_at: null,
      triaged_at: null,
      scratch_at: scratchAt,
      created_at: now,
      updated_at: now,
    };
    set({ notes: [optimistic, ...get().notes], activeId: optimistic.id });

    const { data, error } = await supabase
      .from('notes')
      .insert({
        user_id: userId,
        section_id: sectionId,
        title: 'Untitled',
        content: '',
        scratch_at: scratchAt,
      })
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

  ensureMeetingNote: async (userId, sectionId, target) => {
    const occKey = occurrenceStartKey(target.occurrenceStartAt);
    const existing = findMeetingNote(get().notes, target.eventId, occKey);
    if (existing) {
      set({ activeId: existing.id });
      return existing;
    }

    const now = new Date().toISOString();
    const optimistic: Note = {
      id: `tmp-${randomUUID()}`,
      user_id: userId,
      section_id: sectionId,
      title: target.title,
      content: '',
      content_blocks: null,
      linked_event_id: target.eventId,
      linked_occurrence_start_at: occKey,
      triaged_at: null,
      scratch_at: null,
      created_at: now,
      updated_at: now,
    };
    set({ notes: [optimistic, ...get().notes], activeId: optimistic.id });

    const { data, error } = await supabase
      .from('notes')
      .insert({
        user_id: userId,
        section_id: sectionId,
        title: target.title,
        content: '',
        linked_event_id: target.eventId,
        linked_occurrence_start_at: occKey,
      })
      .select()
      .single();

    if (error || !data) {
      set({
        notes: get().notes.filter((n) => n.id !== optimistic.id),
        error: error?.message ?? 'Failed to create meeting note',
      });
      return null;
    }

    set({
      notes: get().notes.map((n) => (n.id === optimistic.id ? data : n)),
      activeId: data.id,
    });
    return data;
  },

  moveNote: async (id, sectionId) => {
    set({
      notes: get().notes.map((n) => (n.id === id ? { ...n, section_id: sectionId } : n)),
    });
    if (id.startsWith('tmp-')) return;
    const { error } = await supabase.from('notes').update({ section_id: sectionId }).eq('id', id);
    if (error) set({ error: error.message });
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
        const { data, error } = await supabase
          .from('notes')
          .update({ ...patch, updated_at: now })
          .eq('id', id)
          .select('id, updated_at')
          .single();
        if (error) set({ error: error.message });
        else if (data) {
          markNoteSelfPersisted(data.id, data.updated_at);
          scheduleMemoryIndex('note', data.id);
        }
      }, DEBOUNCE_MS),
    );
  },

  setMeetingTriage: async (userId, id, triaged) => {
    const existing = get().notes.find((note) => note.id === id);
    if (!existing || existing.user_id !== userId || !existing.linked_event_id) return false;

    const triagedAt = triaged ? new Date().toISOString() : null;
    const previous = existing;
    set({
      notes: get().notes.map((note) =>
        note.id === id ? { ...note, triaged_at: triagedAt } : note,
      ),
      error: null,
    });

    const { data, error } = await supabase
      .from('notes')
      .update({ triaged_at: triagedAt })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id,triaged_at,updated_at')
      .maybeSingle();
    if (error || !data) {
      set({
        notes: get().notes.map((note) => (note.id === id ? previous : note)),
        error: error?.message ?? 'Meeting note triage could not be updated',
      });
      return false;
    }

    markNoteSelfPersisted(data.id, data.updated_at);
    set({
      notes: get().notes.map((note) =>
        note.id === id
          ? { ...note, triaged_at: data.triaged_at, updated_at: data.updated_at }
          : note,
      ),
    });
    return true;
  },

  setScratchState: async (userId, id, scratch) => {
    const existing = get().notes.find((note) => note.id === id);
    if (!existing || existing.user_id !== userId || existing.linked_event_id) return false;

    const scratchAt = scratch ? new Date().toISOString() : null;
    const previous = existing;
    set({
      notes: get().notes.map((note) =>
        note.id === id ? { ...note, scratch_at: scratchAt } : note,
      ),
      error: null,
    });

    const { data, error } = await supabase
      .from('notes')
      .update({ scratch_at: scratchAt })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id,scratch_at,updated_at')
      .maybeSingle();
    if (error || !data) {
      set({
        notes: get().notes.map((note) => (note.id === id ? previous : note)),
        error: error?.message ?? 'Scratch state could not be updated',
      });
      return false;
    }

    markNoteSelfPersisted(data.id, data.updated_at);
    set({
      notes: get().notes.map((note) =>
        note.id === id
          ? { ...note, scratch_at: data.scratch_at, updated_at: data.updated_at }
          : note,
      ),
    });
    return true;
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
      } else {
        scheduleMemoryDelete('note', id);
      }
    }
  },

  clear: () => set({ notes: [], activeId: null, query: '', error: null }),
}));
