-- 2026-04-17_005_outlook_ics_sync.sql
-- Profile field for Outlook published ICS URL + event source for imported rows.

alter table public.profiles add column if not exists outlook_ics_url text;
alter table public.profiles add column if not exists outlook_ics_last_synced_at timestamptz;

alter table public.events add column if not exists source text not null default 'manual';

alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check
  check (source in ('manual', 'outlook_ics'));

create index if not exists events_user_source_idx on public.events(user_id, source);
