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
          description: string;
          waiting_on: string | null;
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
          description?: string;
          waiting_on?: string | null;
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
          description?: string;
          waiting_on?: string | null;
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
          created_at?: string;
          updated_at?: string;
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
