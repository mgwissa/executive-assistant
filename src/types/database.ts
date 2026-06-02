export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      notebooks: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      sections: {
        Row: {
          id: string;
          notebook_id: string;
          user_id: string;
          name: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          notebook_id: string;
          user_id: string;
          name?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          notebook_id?: string;
          user_id?: string;
          name?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      notes: {
        Row: {
          id: string;
          user_id: string;
          section_id: string | null;
          title: string;
          content: string;
          content_blocks: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          section_id?: string | null;
          title?: string;
          content?: string;
          content_blocks?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          section_id?: string | null;
          title?: string;
          content?: string;
          content_blocks?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          user_id: string;
          first_name: string | null;
          timezone: string | null;
          outlook_ics_url: string | null;
          outlook_ics_last_synced_at: string | null;
          priority_escalation: Json | null;
          enabled_addons: string[];
          notify_email_enabled: boolean;
          notify_email_digest_enabled: boolean;
          /** Stored as a Postgres `time` value, e.g. `'07:30:00'`. */
          notify_email_digest_local_time: string;
          notify_email_escalation_enabled: boolean;
          notify_email_reminder_enabled: boolean;
          notify_email_last_digest_at: string | null;
          /** Override recipient — when null, the user's auth email is used. */
          notify_email_address: string | null;
          notify_in_app_nudges_enabled: boolean;
          notify_browser_nudges_enabled: boolean;
          meeting_rules: Json;
          /** Custom weekly routine template; null uses the built-in guide. */
          weekly_routine: Json | null;
          focus_queue: Json | null;
          memory_last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          first_name?: string | null;
          timezone?: string | null;
          outlook_ics_url?: string | null;
          outlook_ics_last_synced_at?: string | null;
          priority_escalation?: Json | null;
          enabled_addons?: string[];
          notify_email_enabled?: boolean;
          notify_email_digest_enabled?: boolean;
          notify_email_digest_local_time?: string;
          notify_email_escalation_enabled?: boolean;
          notify_email_reminder_enabled?: boolean;
          notify_email_last_digest_at?: string | null;
          notify_email_address?: string | null;
          notify_in_app_nudges_enabled?: boolean;
          notify_browser_nudges_enabled?: boolean;
          meeting_rules?: Json;
          weekly_routine?: Json | null;
          focus_queue?: Json | null;
          memory_last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          first_name?: string | null;
          timezone?: string | null;
          outlook_ics_url?: string | null;
          outlook_ics_last_synced_at?: string | null;
          priority_escalation?: Json | null;
          enabled_addons?: string[];
          notify_email_enabled?: boolean;
          notify_email_digest_enabled?: boolean;
          notify_email_digest_local_time?: string;
          notify_email_escalation_enabled?: boolean;
          notify_email_reminder_enabled?: boolean;
          notify_email_last_digest_at?: string | null;
          notify_email_address?: string | null;
          notify_in_app_nudges_enabled?: boolean;
          notify_browser_nudges_enabled?: boolean;
          meeting_rules?: Json;
          weekly_routine?: Json | null;
          focus_queue?: Json | null;
          memory_last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          done: boolean;
          priority: string;
          priority_set_at: string;
          due_date: string | null;
          due_time: string | null;
          reminder_sent_at: string | null;
          linked_event_id: string | null;
          description: string;
          waiting_on: string | null;
          chase_snoozed_until: string | null;
          last_chased_at: string | null;
          estimated_minutes: number | null;
          tags: string[];
          reschedule_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          done?: boolean;
          priority?: string;
          priority_set_at?: string;
          due_date?: string | null;
          due_time?: string | null;
          reminder_sent_at?: string | null;
          linked_event_id?: string | null;
          description?: string;
          waiting_on?: string | null;
          chase_snoozed_until?: string | null;
          last_chased_at?: string | null;
          estimated_minutes?: number | null;
          tags?: string[];
          reschedule_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          done?: boolean;
          priority?: string;
          priority_set_at?: string;
          due_date?: string | null;
          due_time?: string | null;
          reminder_sent_at?: string | null;
          linked_event_id?: string | null;
          description?: string;
          waiting_on?: string | null;
          chase_snoozed_until?: string | null;
          last_chased_at?: string | null;
          estimated_minutes?: number | null;
          tags?: string[];
          reschedule_count?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      time_entries: {
        Row: {
          id: string;
          user_id: string;
          label: string;
          started_at: string;
          ended_at: string | null;
          task_id: string | null;
          project_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          label?: string;
          started_at: string;
          ended_at?: string | null;
          task_id?: string | null;
          project_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          label?: string;
          started_at?: string;
          ended_at?: string | null;
          task_id?: string | null;
          project_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      time_projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          start_at: string;
          duration_minutes: number;
          timezone: string;
          recurrence: string;
          interval: number;
          by_weekday: number[] | null;
          until_at: string | null;
          count: number | null;
          source: string;
          prep_required: boolean;
          allow_back_to_back: boolean;
          debrief_required: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          start_at: string;
          duration_minutes?: number;
          timezone: string;
          recurrence?: string;
          interval?: number;
          by_weekday?: number[] | null;
          until_at?: string | null;
          count?: number | null;
          source?: string;
          prep_required?: boolean;
          allow_back_to_back?: boolean;
          debrief_required?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          start_at?: string;
          duration_minutes?: number;
          timezone?: string;
          recurrence?: string;
          interval?: number;
          by_weekday?: number[] | null;
          until_at?: string | null;
          count?: number | null;
          source?: string;
          prep_required?: boolean;
          allow_back_to_back?: boolean;
          debrief_required?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      meeting_debrief_states: {
        Row: {
          id: string;
          user_id: string;
          event_id: string;
          occurrence_start_at: string;
          status: string;
          snoozed_until: string | null;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id: string;
          occurrence_start_at: string;
          status?: string;
          snoozed_until?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_id?: string;
          occurrence_start_at?: string;
          status?: string;
          snoozed_until?: string | null;
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      memory_chunks: {
        Row: {
          id: string;
          user_id: string;
          source_type: string;
          source_id: string;
          chunk_index: number;
          content: string;
          embedding: string | null;
          metadata: Json;
          source_updated_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_type: string;
          source_id: string;
          chunk_index?: number;
          content: string;
          embedding?: string | null;
          metadata?: Json;
          source_updated_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_type?: string;
          source_id?: string;
          chunk_index?: number;
          content?: string;
          embedding?: string | null;
          metadata?: Json;
          source_updated_at?: string | null;
          created_at?: string;
        };
      };
      routine_item_states: {
        Row: {
          id: string;
          user_id: string;
          template_version: string;
          routine_date: string;
          item_id: string;
          status: string;
          completed_at: string | null;
          notes: string;
          task_id: string | null;
          event_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          template_version: string;
          routine_date: string;
          item_id: string;
          status?: string;
          completed_at?: string | null;
          notes?: string;
          task_id?: string | null;
          event_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          template_version?: string;
          routine_date?: string;
          item_id?: string;
          status?: string;
          completed_at?: string | null;
          notes?: string;
          task_id?: string | null;
          event_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      useful_links: {
        Row: {
          id: string;
          user_id: string;
          label: string;
          url: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          label: string;
          url: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          label?: string;
          url?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      notebook_members: {
        Row: {
          notebook_id: string;
          user_id: string;
          role: string;
          invited_by: string | null;
          created_at: string;
        };
        Insert: {
          notebook_id: string;
          user_id: string;
          role?: string;
          invited_by?: string | null;
          created_at?: string;
        };
        Update: {
          notebook_id?: string;
          user_id?: string;
          role?: string;
          invited_by?: string | null;
          created_at?: string;
        };
      };
      notebook_invites: {
        Row: {
          id: string;
          notebook_id: string;
          token: string;
          created_by: string;
          created_at: string;
          expires_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          notebook_id: string;
          token?: string;
          created_by: string;
          created_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          notebook_id?: string;
          token?: string;
          created_by?: string;
          created_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_notebook_invite: {
        Args: { invite_token: string };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
