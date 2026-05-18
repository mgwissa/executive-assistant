import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Json } from '../types/database';
import type { Profile } from '../types';

type ProfileState = {
  profile: Profile | null;
  loading: boolean;
  /** True after the first fetch for this session finished (success or error). */
  hydrated: boolean;
  saving: boolean;
  error: string | null;

  fetchProfile: (userId: string) => Promise<void>;
  updateProfile: (
    userId: string,
    patch: {
      first_name?: string | null;
      timezone?: string | null;
      outlook_ics_url?: string | null;
      priority_escalation?: Json | null;
      enabled_addons?: string[];
      notify_email_enabled?: boolean;
      notify_email_digest_enabled?: boolean;
      notify_email_digest_local_time?: string;
      notify_email_escalation_enabled?: boolean;
      notify_email_address?: string | null;
    },
  ) => Promise<void>;
  clear: () => void;
};

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loading: false,
  hydrated: false,
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
      set({ loading: false, error: error.message, hydrated: true });
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
        set({ loading: false, error: insertError.message, hydrated: true });
        return;
      }
      set({ profile: inserted, loading: false, hydrated: true });
      return;
    }

    set({ profile: data, loading: false, hydrated: true });
  },

  updateProfile: async (userId, patch) => {
    set({ saving: true, error: null });
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      set({ saving: false, error: error.message });
      return;
    }
    set({ profile: data, saving: false });
  },

  clear: () => set({ profile: null, error: null, hydrated: false }),
}));
