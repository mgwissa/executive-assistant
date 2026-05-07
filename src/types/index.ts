import type { Database } from './database';

export type Notebook = Database['public']['Tables']['notebooks']['Row'];
export type NotebookInsert = Database['public']['Tables']['notebooks']['Insert'];

export type Section = Database['public']['Tables']['sections']['Row'];
export type SectionInsert = Database['public']['Tables']['sections']['Insert'];

export type Note = Database['public']['Tables']['notes']['Row'];
export type NoteInsert = Database['public']['Tables']['notes']['Insert'];
export type NoteUpdate = Database['public']['Tables']['notes']['Update'];

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type Task = Database['public']['Tables']['tasks']['Row'];
export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

export type TimeEntry = Database['public']['Tables']['time_entries']['Row'];
export type TimeEntryInsert = Database['public']['Tables']['time_entries']['Insert'];
export type TimeEntryUpdate = Database['public']['Tables']['time_entries']['Update'];

export type TimeProject = Database['public']['Tables']['time_projects']['Row'];
export type TimeProjectInsert = Database['public']['Tables']['time_projects']['Insert'];
export type TimeProjectUpdate = Database['public']['Tables']['time_projects']['Update'];

export type Event = Database['public']['Tables']['events']['Row'];
export type EventInsert = Database['public']['Tables']['events']['Insert'];
export type EventUpdate = Database['public']['Tables']['events']['Update'];

export type UsefulLink = Database['public']['Tables']['useful_links']['Row'];
export type UsefulLinkInsert = Database['public']['Tables']['useful_links']['Insert'];
export type UsefulLinkUpdate = Database['public']['Tables']['useful_links']['Update'];
