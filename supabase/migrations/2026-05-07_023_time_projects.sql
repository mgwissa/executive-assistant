-- Group time sessions by project (separate from tasks). Entries may share the same label across sessions.

create table if not exists public.time_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists time_projects_user_id_idx
  on public.time_projects (user_id, name);

alter table public.time_projects enable row level security;

drop policy if exists "time_projects_select_own" on public.time_projects;
create policy "time_projects_select_own"
  on public.time_projects for select
  using (auth.uid() = user_id);

drop policy if exists "time_projects_insert_own" on public.time_projects;
create policy "time_projects_insert_own"
  on public.time_projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "time_projects_update_own" on public.time_projects;
create policy "time_projects_update_own"
  on public.time_projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "time_projects_delete_own" on public.time_projects;
create policy "time_projects_delete_own"
  on public.time_projects for delete
  using (auth.uid() = user_id);

drop trigger if exists time_projects_set_updated_at on public.time_projects;
create trigger time_projects_set_updated_at
  before update on public.time_projects
  for each row execute function public.set_updated_at();

alter table public.time_entries
  add column if not exists project_id uuid references public.time_projects(id) on delete set null;

create index if not exists time_entries_project_id_idx
  on public.time_entries (project_id)
  where project_id is not null;
