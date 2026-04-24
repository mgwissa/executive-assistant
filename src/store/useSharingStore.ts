import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { buildNotebookInviteUrl } from '../lib/notebookSharing';
import type { Database } from '../types/database';

export type NotebookMember = Database['public']['Tables']['notebook_members']['Row'];
export type NotebookInvite = Database['public']['Tables']['notebook_invites']['Row'];

/** Stable fallback for selectors; inline `?? []` creates a new array every snapshot and breaks useSyncExternalStore. */
export const EMPTY_NOTEBOOK_MEMBERS: NotebookMember[] = [];

type SharingState = {
  membersByNotebook: Record<string, NotebookMember[]>;
  activeInviteByNotebook: Record<string, NotebookInvite | null>;
  loadingNotebookId: string | null;
  error: string | null;

  fetchSharing: (notebookId: string) => Promise<void>;
  /** Revokes prior active invites and inserts a new one. Returns share URL. */
  rotateInvite: (notebookId: string, userId: string) => Promise<string | null>;
  revokeAllInvites: (notebookId: string) => Promise<void>;
  removeMember: (notebookId: string, memberUserId: string) => Promise<void>;
  leaveNotebook: (notebookId: string, userId: string) => Promise<void>;
  acceptInvite: (token: string) => Promise<string>;
  clearNotebookCache: (notebookId: string) => void;
  clear: () => void;
};

export const useSharingStore = create<SharingState>((set, get) => ({
  membersByNotebook: {},
  activeInviteByNotebook: {},
  loadingNotebookId: null,
  error: null,

  fetchSharing: async (notebookId) => {
    set({ loadingNotebookId: notebookId, error: null });
    const [memRes, invRes] = await Promise.all([
      supabase.from('notebook_members').select('*').eq('notebook_id', notebookId),
      supabase
        .from('notebook_invites')
        .select('*')
        .eq('notebook_id', notebookId)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (memRes.error || invRes.error) {
      set({
        loadingNotebookId: null,
        error: memRes.error?.message ?? invRes.error?.message ?? 'Failed to load sharing',
      });
      return;
    }
    set({
      membersByNotebook: {
        ...get().membersByNotebook,
        [notebookId]: memRes.data ?? [],
      },
      activeInviteByNotebook: {
        ...get().activeInviteByNotebook,
        [notebookId]: invRes.data ?? null,
      },
      loadingNotebookId: null,
    });
  },

  rotateInvite: async (notebookId, userId) => {
    set({ error: null });
    const now = new Date().toISOString();
    await supabase
      .from('notebook_invites')
      .update({ revoked_at: now })
      .eq('notebook_id', notebookId)
      .is('revoked_at', null);

    const { data, error } = await supabase
      .from('notebook_invites')
      .insert({ notebook_id: notebookId, created_by: userId })
      .select()
      .single();

    if (error || !data) {
      set({ error: error?.message ?? 'Failed to create invite' });
      return null;
    }
    set({
      activeInviteByNotebook: {
        ...get().activeInviteByNotebook,
        [notebookId]: data,
      },
    });
    return buildNotebookInviteUrl(data.token);
  },

  revokeAllInvites: async (notebookId) => {
    set({ error: null });
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('notebook_invites')
      .update({ revoked_at: now })
      .eq('notebook_id', notebookId)
      .is('revoked_at', null);
    if (error) {
      set({ error: error.message });
      return;
    }
    set({
      activeInviteByNotebook: {
        ...get().activeInviteByNotebook,
        [notebookId]: null,
      },
    });
  },

  removeMember: async (notebookId, memberUserId) => {
    set({ error: null });
    const { error } = await supabase
      .from('notebook_members')
      .delete()
      .eq('notebook_id', notebookId)
      .eq('user_id', memberUserId);
    if (error) {
      set({ error: error.message });
      return;
    }
    const prev = get().membersByNotebook[notebookId] ?? [];
    set({
      membersByNotebook: {
        ...get().membersByNotebook,
        [notebookId]: prev.filter((m) => m.user_id !== memberUserId),
      },
    });
  },

  leaveNotebook: async (notebookId, userId) => {
    await get().removeMember(notebookId, userId);
  },

  acceptInvite: async (token) => {
    const { data, error } = await supabase.rpc('accept_notebook_invite', {
      invite_token: token,
    });
    if (error) throw error;
    if (!data) throw new Error('Invite accepted but no notebook id returned');
    return data;
  },

  clearNotebookCache: (notebookId) => {
    const { [notebookId]: _m, ...restMembers } = get().membersByNotebook;
    const { [notebookId]: _i, ...restInvites } = get().activeInviteByNotebook;
    set({ membersByNotebook: restMembers, activeInviteByNotebook: restInvites });
  },

  clear: () =>
    set({
      membersByNotebook: {},
      activeInviteByNotebook: {},
      loadingNotebookId: null,
      error: null,
    }),
}));
