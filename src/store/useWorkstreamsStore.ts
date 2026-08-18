import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { randomUUID } from '../lib/uuid';
import type { NoteWorkstream, Workstream } from '../types';

type WorkstreamsState = {
  workstreams: Workstream[];
  noteLinks: NoteWorkstream[];
  activeWorkstreamId: string | null;
  loading: boolean;
  error: string | null;
  fetchAll: (userId: string) => Promise<void>;
  setActiveWorkstream: (id: string | null) => void;
  createWorkstream: (userId: string, name: string) => Promise<Workstream | null>;
  toggleNote: (userId: string, noteId: string, workstreamId: string) => Promise<void>;
  clear: () => void;
};

export const useWorkstreamsStore = create<WorkstreamsState>((set, get) => ({
  workstreams: [],
  noteLinks: [],
  activeWorkstreamId: null,
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    const [workstreamsRes, linksRes] = await Promise.all([
      supabase.from('workstreams').select('*').order('status').order('position').order('created_at'),
      supabase.from('note_workstreams').select('*').order('created_at'),
    ]);
    if (workstreamsRes.error || linksRes.error) {
      set({
        loading: false,
        error: workstreamsRes.error?.message ?? linksRes.error?.message ?? 'Failed to load workstreams',
      });
      return;
    }
    const workstreams = workstreamsRes.data ?? [];
    const current = get().activeWorkstreamId;
    set({
      workstreams,
      noteLinks: linksRes.data ?? [],
      activeWorkstreamId:
        workstreams.find((workstream) => workstream.id === current)?.id ??
        workstreams.find((workstream) => workstream.status === 'active')?.id ??
        workstreams[0]?.id ??
        null,
      loading: false,
    });
  },

  setActiveWorkstream: (id) => set({ activeWorkstreamId: id }),

  createWorkstream: async (userId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const now = new Date().toISOString();
    const optimistic: Workstream = {
      id: `tmp-${randomUUID()}`,
      user_id: userId,
      name: trimmed,
      description: '',
      status: 'active',
      position: get().workstreams.length,
      created_at: now,
      updated_at: now,
    };
    set({
      workstreams: [...get().workstreams, optimistic],
      activeWorkstreamId: optimistic.id,
      error: null,
    });

    const { data, error } = await supabase
      .from('workstreams')
      .insert({ user_id: userId, name: trimmed, position: optimistic.position })
      .select()
      .single();
    if (error || !data) {
      set({
        workstreams: get().workstreams.filter((workstream) => workstream.id !== optimistic.id),
        activeWorkstreamId: null,
        error: error?.message ?? 'Failed to create workstream',
      });
      return null;
    }
    set({
      workstreams: get().workstreams.map((workstream) =>
        workstream.id === optimistic.id ? data : workstream,
      ),
      activeWorkstreamId: data.id,
    });
    return data;
  },

  toggleNote: async (userId, noteId, workstreamId) => {
    const existing = get().noteLinks.find(
      (link) => link.note_id === noteId && link.workstream_id === workstreamId,
    );
    if (existing) {
      set({
        noteLinks: get().noteLinks.filter(
          (link) => !(link.note_id === noteId && link.workstream_id === workstreamId),
        ),
      });
      const { error } = await supabase
        .from('note_workstreams')
        .delete()
        .eq('user_id', userId)
        .eq('note_id', noteId)
        .eq('workstream_id', workstreamId);
      if (error) set({ noteLinks: [...get().noteLinks, existing], error: error.message });
      return;
    }

    const optimistic: NoteWorkstream = {
      user_id: userId,
      note_id: noteId,
      workstream_id: workstreamId,
      created_at: new Date().toISOString(),
    };
    set({ noteLinks: [...get().noteLinks, optimistic], error: null });
    const { data, error } = await supabase
      .from('note_workstreams')
      .insert({ user_id: userId, note_id: noteId, workstream_id: workstreamId })
      .select()
      .single();
    if (error || !data) {
      set({
        noteLinks: get().noteLinks.filter(
          (link) => !(link.note_id === noteId && link.workstream_id === workstreamId),
        ),
        error: error?.message ?? 'Failed to add note to workstream',
      });
      return;
    }
    set({ noteLinks: get().noteLinks.map((link) => (link === optimistic ? data : link)) });
  },

  clear: () =>
    set({
      workstreams: [],
      noteLinks: [],
      activeWorkstreamId: null,
      loading: false,
      error: null,
    }),
}));

