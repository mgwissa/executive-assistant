-- Notes 2.0: add an operational workstream lens without moving or rewriting
-- the existing notebook -> section -> note library.

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workstreams_user_name_idx
  on public.workstreams (user_id, lower(name));

create index if not exists workstreams_user_position_idx
  on public.workstreams (user_id, status, position, created_at);

alter table public.workstreams enable row level security;

drop policy if exists "workstreams_select_own" on public.workstreams;
create policy "workstreams_select_own" on public.workstreams
  for select using (auth.uid() = user_id);

drop policy if exists "workstreams_insert_own" on public.workstreams;
create policy "workstreams_insert_own" on public.workstreams
  for insert with check (auth.uid() = user_id);

drop policy if exists "workstreams_update_own" on public.workstreams;
create policy "workstreams_update_own" on public.workstreams
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "workstreams_delete_own" on public.workstreams;
create policy "workstreams_delete_own" on public.workstreams
  for delete using (auth.uid() = user_id);

drop trigger if exists workstreams_set_updated_at on public.workstreams;
create trigger workstreams_set_updated_at
  before update on public.workstreams
  for each row execute function public.set_updated_at();

create table if not exists public.note_workstreams (
  user_id uuid not null references auth.users(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, workstream_id, note_id)
);

create index if not exists note_workstreams_note_idx
  on public.note_workstreams (user_id, note_id);

create index if not exists note_workstreams_workstream_idx
  on public.note_workstreams (user_id, workstream_id);

alter table public.note_workstreams enable row level security;

drop policy if exists "note_workstreams_select_own" on public.note_workstreams;
create policy "note_workstreams_select_own" on public.note_workstreams
  for select using (auth.uid() = user_id);

drop policy if exists "note_workstreams_insert_own" on public.note_workstreams;
create policy "note_workstreams_insert_own" on public.note_workstreams
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.workstreams
      where workstreams.id = workstream_id
        and workstreams.user_id = auth.uid()
    )
    and exists (
      select 1 from public.notes
      where notes.id = note_id
        and notes.user_id = auth.uid()
    )
  );

drop policy if exists "note_workstreams_delete_own" on public.note_workstreams;
create policy "note_workstreams_delete_own" on public.note_workstreams
  for delete using (auth.uid() = user_id);

