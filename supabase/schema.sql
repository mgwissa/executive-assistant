-- Schema for the notes app.
-- Run this in Supabase → SQL Editor → New query.

create extension if not exists "pgcrypto";

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.sections(id) on delete cascade,
  title text not null default 'Untitled',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_user_id_idx on public.notes(user_id);
create index if not exists notes_updated_at_idx on public.notes(updated_at desc);

-- Row-level security: users can only read/write their own notes.
alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
  on public.notes for select
  using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
  on public.notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
  on public.notes for delete
  using (auth.uid() = user_id);

-- Auto-bump updated_at on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists timezone text;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
-- SECURITY DEFINER so it can insert into profiles from the auth schema trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any existing users (safe to re-run).
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Notebooks
-- ---------------------------------------------------------------------------

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Notebook',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notebooks_user_id_idx on public.notebooks(user_id);

alter table public.notebooks enable row level security;

drop policy if exists "notebooks_select_own" on public.notebooks;
create policy "notebooks_select_own" on public.notebooks for select using (auth.uid() = user_id);
drop policy if exists "notebooks_insert_own" on public.notebooks;
create policy "notebooks_insert_own" on public.notebooks for insert with check (auth.uid() = user_id);
drop policy if exists "notebooks_update_own" on public.notebooks;
create policy "notebooks_update_own" on public.notebooks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "notebooks_delete_own" on public.notebooks;
create policy "notebooks_delete_own" on public.notebooks for delete using (auth.uid() = user_id);

drop trigger if exists notebooks_set_updated_at on public.notebooks;
create trigger notebooks_set_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------------

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'General',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sections_notebook_id_idx on public.sections(notebook_id);
create index if not exists sections_user_id_idx on public.sections(user_id);

alter table public.sections enable row level security;

drop policy if exists "sections_select_own" on public.sections;
create policy "sections_select_own" on public.sections for select using (auth.uid() = user_id);
drop policy if exists "sections_insert_own" on public.sections;
create policy "sections_insert_own" on public.sections for insert with check (auth.uid() = user_id);
drop policy if exists "sections_update_own" on public.sections;
create policy "sections_update_own" on public.sections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "sections_delete_own" on public.sections;
create policy "sections_delete_own" on public.sections for delete using (auth.uid() = user_id);

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  priority text not null default 'normal',
  priority_set_at timestamptz not null default now(),
  due_date date,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_priority_check check (priority in ('critical', 'urgent', 'high', 'normal', 'low'))
);

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists tasks_done_idx on public.tasks(user_id, done, updated_at desc);

alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own"
  on public.tasks for select
  using (auth.uid() = user_id);

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own"
  on public.tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete_own"
  on public.tasks for delete
  using (auth.uid() = user_id);

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Events (Calendar)
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  duration_minutes int not null default 30,
  timezone text not null,
  recurrence text not null default 'none',
  interval int not null default 1,
  by_weekday int[] null,
  until_at timestamptz null,
  count int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_user_id_idx on public.events(user_id);
create index if not exists events_start_at_idx on public.events(user_id, start_at);

alter table public.events enable row level security;

drop policy if exists "events_select_own" on public.events;
create policy "events_select_own"
  on public.events for select
  using (auth.uid() = user_id);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = user_id);

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own"
  on public.events for delete
  using (auth.uid() = user_id);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Outlook published ICS (profile URL + imported event source)
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists outlook_ics_url text;
alter table public.profiles add column if not exists outlook_ics_last_synced_at timestamptz;
alter table public.profiles add column if not exists priority_escalation jsonb;

alter table public.tasks add column if not exists priority_set_at timestamptz;
update public.tasks
set priority_set_at = coalesce(updated_at, created_at)
where priority_set_at is null;
alter table public.tasks alter column priority_set_at set default now();
alter table public.tasks alter column priority_set_at set not null;

alter table public.events add column if not exists source text not null default 'manual';

alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check
  check (source in ('manual', 'outlook_ics'));

create index if not exists events_user_source_idx on public.events(user_id, source);
