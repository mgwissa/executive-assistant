import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

type ProfileState = {
  profile: Profile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;

  fetchProfile: (userId: string) => Promise<void>;
  updateProfile: (
    userId: string,
    patch: { first_name?: string | null; timezone?: string | null },
  ) => Promise<void>;
  clear: () => void;
};

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loading: false,
  saving: false,
  error: null,

  fetchProfile: async (userId) => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    // Fall back to creating a row if the trigger somehow didn't (e.g. pre-existing user).
    if (!data) {
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert({ user_id: userId })
        .select()
        .single();
      if (insertError) {
        set({ loading: false, error: insertError.message });
        return;
      }
      set({ profile: inserted, loading: false });
      return;
    }

    set({ profile: data, loading: false });
  },

  updateProfile: async (userId, patch) => {
    set({ saving: true, error: null });
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      set({ saving: false, error: error.message });
      return;
    }
    set({ profile: data, saving: false });
  },

  clear: () => set({ profile: null, error: null }),
}));
