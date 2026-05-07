-- Time tracking sessions: one open row per user (ended_at is null) enforced by partial unique index.

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  started_at timestamptz not null,
  ended_at timestamptz,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists time_entries_user_started_idx
  on public.time_entries (user_id, started_at desc);

create unique index if not exists time_entries_one_running_per_user
  on public.time_entries (user_id)
  where ended_at is null;

alter table public.time_entries enable row level security;

drop policy if exists "time_entries_select_own" on public.time_entries;
create policy "time_entries_select_own"
  on public.time_entries for select
  using (auth.uid() = user_id);

drop policy if exists "time_entries_insert_own" on public.time_entries;
create policy "time_entries_insert_own"
  on public.time_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "time_entries_update_own" on public.time_entries;
create policy "time_entries_update_own"
  on public.time_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "time_entries_delete_own" on public.time_entries;
create policy "time_entries_delete_own"
  on public.time_entries for delete
  using (auth.uid() = user_id);

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();
