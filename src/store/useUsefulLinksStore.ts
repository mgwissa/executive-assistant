import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { externalHref } from '../lib/linkUrl';
import type { UsefulLink } from '../types';

type UsefulLinksState = {
  links: UsefulLink[];
  loading: boolean;
  error: string | null;

  fetchAll: (userId: string) => Promise<void>;
  add: (userId: string, label: string, url: string) => Promise<UsefulLink | null>;
  update: (id: string, label: string, url: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, direction: 'up' | 'down') => Promise<void>;
  clear: () => void;
};

function sortLinks(list: UsefulLink[]): UsefulLink[] {
  return [...list].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}

export const useUsefulLinksStore = create<UsefulLinksState>((set, get) => ({
  links: [],
  loading: false,
  error: null,

  fetchAll: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('useful_links')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ links: sortLinks(data ?? []), loading: false, error: null });
  },

  add: async (userId, label, url) => {
    const lab = label.trim();
    const href = externalHref(url);
    if (!lab) return null;
    if (!href) {
      set({ error: 'Enter a valid http(s) URL' });
      return null;
    }

    const sorted = sortLinks(get().links);
    const nextPos = sorted.length === 0 ? 0 : Math.max(...sorted.map((l) => l.position)) + 1;

    const { data, error } = await supabase
      .from('useful_links')
      .insert({
        user_id: userId,
        label: lab,
        url: href,
        position: nextPos,
      })
      .select()
      .single();

    if (error || !data) {
      set({ error: error?.message ?? 'Could not add link' });
      return null;
    }

    set({ links: sortLinks([...get().links, data]), error: null });
    return data;
  },

  update: async (id, label, url) => {
    const lab = label.trim();
    const href = externalHref(url);
    if (!lab || !href) {
      if (!href) set({ error: 'Enter a valid http(s) URL' });
      return;
    }

    const prev = get().links;
    set({
      links: prev.map((l) => (l.id === id ? { ...l, label: lab, url: href } : l)),
    });

    const { error } = await supabase
      .from('useful_links')
      .update({ label: lab, url: href })
      .eq('id', id);

    if (error) {
      set({ links: prev, error: error.message });
    } else {
      set({ error: null });
    }
  },

  remove: async (id) => {
    const prev = get().links;
    set({ links: prev.filter((l) => l.id !== id) });
    const { error } = await supabase.from('useful_links').delete().eq('id', id);
    if (error) set({ links: prev, error: error.message });
  },

  move: async (id, direction) => {
    const sorted = sortLinks(get().links);
    const i = sorted.findIndex((l) => l.id === id);
    if (i < 0) return;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sorted.length) return;

    const a = sorted[i];
    const b = sorted[j];
    const prev = get().links;

    set({
      links: sortLinks(
        prev.map((l) => {
          if (l.id === a.id) return { ...l, position: b.position };
          if (l.id === b.id) return { ...l, position: a.position };
          return l;
        }),
      ),
    });

    const [resA, resB] = await Promise.all([
      supabase.from('useful_links').update({ position: b.position }).eq('id', a.id),
      supabase.from('useful_links').update({ position: a.position }).eq('id', b.id),
    ]);

    if (resA.error || resB.error) {
      set({ links: prev, error: resA.error?.message ?? resB.error?.message ?? 'Reorder failed' });
    }
  },

  clear: () => set({ links: [], loading: false, error: null }),
}));
