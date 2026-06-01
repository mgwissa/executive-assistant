-- Phase B: post-meeting debrief tracking (per occurrence) + temperament flag.

alter table public.events
  add column if not exists debrief_required boolean not null default true;

create table if not exists public.meeting_debrief_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_start_at timestamptz not null,
  status text not null default 'done',
  snoozed_until timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_debrief_states_status_check check (status in ('done', 'skipped', 'snoozed')),
  constraint meeting_debrief_states_user_event_occurrence_key unique (
    user_id,
    event_id,
    occurrence_start_at
  )
);

create index if not exists meeting_debrief_states_user_occurrence_idx
  on public.meeting_debrief_states (user_id, occurrence_start_at desc);

alter table public.meeting_debrief_states enable row level security;

drop policy if exists "meeting_debrief_states_select_own" on public.meeting_debrief_states;
create policy "meeting_debrief_states_select_own"
  on public.meeting_debrief_states for select
  using (auth.uid() = user_id);

drop policy if exists "meeting_debrief_states_insert_own" on public.meeting_debrief_states;
create policy "meeting_debrief_states_insert_own"
  on public.meeting_debrief_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "meeting_debrief_states_update_own" on public.meeting_debrief_states;
create policy "meeting_debrief_states_update_own"
  on public.meeting_debrief_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "meeting_debrief_states_delete_own" on public.meeting_debrief_states;
create policy "meeting_debrief_states_delete_own"
  on public.meeting_debrief_states for delete
  using (auth.uid() = user_id);

drop trigger if exists meeting_debrief_states_set_updated_at on public.meeting_debrief_states;
create trigger meeting_debrief_states_set_updated_at
  before update on public.meeting_debrief_states
  for each row execute function public.set_updated_at();
