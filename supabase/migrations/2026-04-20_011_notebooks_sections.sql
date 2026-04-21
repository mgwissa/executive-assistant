-- Notebooks → Sections → Notes hierarchy.

-- -----------------------------------------------------------------------
-- Notebooks
-- -----------------------------------------------------------------------
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

create policy "notebooks_select_own" on public.notebooks for select using (auth.uid() = user_id);
create policy "notebooks_insert_own" on public.notebooks for insert with check (auth.uid() = user_id);
create policy "notebooks_update_own" on public.notebooks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notebooks_delete_own" on public.notebooks for delete using (auth.uid() = user_id);

drop trigger if exists notebooks_set_updated_at on public.notebooks;
create trigger notebooks_set_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------
-- Sections
-- -----------------------------------------------------------------------
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

create policy "sections_select_own" on public.sections for select using (auth.uid() = user_id);
create policy "sections_insert_own" on public.sections for insert with check (auth.uid() = user_id);
create policy "sections_update_own" on public.sections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "sections_delete_own" on public.sections for delete using (auth.uid() = user_id);

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------
-- Link notes to sections
-- -----------------------------------------------------------------------
alter table public.notes add column if not exists section_id uuid references public.sections(id) on delete cascade;

create index if not exists notes_section_id_idx on public.notes(section_id);

-- -----------------------------------------------------------------------
-- Backfill: give every existing user a default notebook + section,
-- then assign their orphan notes to that section.
-- -----------------------------------------------------------------------
do $$
declare
  uid uuid;
  nb_id uuid;
  sec_id uuid;
begin
  for uid in select distinct user_id from public.notes where section_id is null loop
    insert into public.notebooks (user_id, name, position)
    values (uid, 'My Notebook', 0)
    returning id into nb_id;

    insert into public.sections (notebook_id, user_id, name, position)
    values (nb_id, uid, 'General', 0)
    returning id into sec_id;

    update public.notes
    set section_id = sec_id
    where user_id = uid and section_id is null;
  end loop;
end $$;
