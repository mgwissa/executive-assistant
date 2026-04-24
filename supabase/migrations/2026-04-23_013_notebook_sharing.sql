-- Shared notebooks: members, invite links, RLS, accept RPC, Realtime publication.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.notebook_members (
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role = 'editor'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (notebook_id, user_id)
);

create index if not exists notebook_members_user_id_idx on public.notebook_members(user_id);

create table if not exists public.notebook_invites (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz
);

create index if not exists notebook_invites_notebook_id_idx on public.notebook_invites(notebook_id);

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER bypasses RLS; avoids policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_notebook_owner(nb_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.notebooks n
    where n.id = nb_id and n.user_id = auth.uid()
  );
$$;

create or replace function public.has_notebook_access(nb_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_notebook_owner(nb_id)
    or exists (
      select 1 from public.notebook_members m
      where m.notebook_id = nb_id and m.user_id = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- Accept invite (bypasses notebook_members insert policy)
-- ---------------------------------------------------------------------------
create or replace function public.accept_notebook_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.notebook_invites%rowtype;
begin
  if invite_token is null or length(trim(invite_token)) = 0 then
    raise exception 'invalid invite';
  end if;

  select *
    into inv
  from public.notebook_invites
  where token = invite_token
    and revoked_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'invalid or expired invite';
  end if;

  insert into public.notebook_members (notebook_id, user_id, role, invited_by)
  values (inv.notebook_id, auth.uid(), 'editor', inv.created_by)
  on conflict (notebook_id, user_id) do nothing;

  return inv.notebook_id;
end;
$$;

revoke all on function public.accept_notebook_invite(text) from public;
grant execute on function public.accept_notebook_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notebooks: RLS
-- ---------------------------------------------------------------------------
drop policy if exists "notebooks_select_own" on public.notebooks;
drop policy if exists "notebooks_insert_own" on public.notebooks;
drop policy if exists "notebooks_update_own" on public.notebooks;
drop policy if exists "notebooks_delete_own" on public.notebooks;
drop policy if exists "notebooks_select_access" on public.notebooks;
drop policy if exists "notebooks_update_access" on public.notebooks;
drop policy if exists "notebooks_delete_owner" on public.notebooks;

create policy "notebooks_select_access" on public.notebooks
  for select using (public.has_notebook_access(id));

create policy "notebooks_insert_own" on public.notebooks
  for insert with check (auth.uid() = user_id);

create policy "notebooks_update_access" on public.notebooks
  for update using (public.has_notebook_access(id))
  with check (public.has_notebook_access(id));

create policy "notebooks_delete_owner" on public.notebooks
  for delete using (public.is_notebook_owner(id));

-- ---------------------------------------------------------------------------
-- Sections: RLS
-- ---------------------------------------------------------------------------
drop policy if exists "sections_select_own" on public.sections;
drop policy if exists "sections_insert_own" on public.sections;
drop policy if exists "sections_update_own" on public.sections;
drop policy if exists "sections_delete_own" on public.sections;
drop policy if exists "sections_select_access" on public.sections;
drop policy if exists "sections_insert_access" on public.sections;
drop policy if exists "sections_update_access" on public.sections;
drop policy if exists "sections_delete_access" on public.sections;

create policy "sections_select_access" on public.sections
  for select using (public.has_notebook_access(notebook_id));

create policy "sections_insert_access" on public.sections
  for insert with check (
    auth.uid() = user_id
    and public.has_notebook_access(notebook_id)
  );

create policy "sections_update_access" on public.sections
  for update using (public.has_notebook_access(notebook_id))
  with check (public.has_notebook_access(notebook_id));

create policy "sections_delete_access" on public.sections
  for delete using (public.has_notebook_access(notebook_id));

-- ---------------------------------------------------------------------------
-- Notes: RLS
-- ---------------------------------------------------------------------------
drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;
drop policy if exists "notes_select_access" on public.notes;
drop policy if exists "notes_insert_access" on public.notes;
drop policy if exists "notes_update_access" on public.notes;
drop policy if exists "notes_delete_access" on public.notes;

create policy "notes_select_access" on public.notes
  for select using (
    (
      section_id is not null
      and exists (
        select 1 from public.sections s
        where s.id = notes.section_id
          and public.has_notebook_access(s.notebook_id)
      )
    )
    or (section_id is null and auth.uid() = notes.user_id)
  );

create policy "notes_insert_access" on public.notes
  for insert with check (
    auth.uid() = user_id
    and (
      (
        section_id is not null
        and exists (
          select 1 from public.sections s
          where s.id = notes.section_id
            and public.has_notebook_access(s.notebook_id)
        )
      )
      or (section_id is null)
    )
  );

create policy "notes_update_access" on public.notes
  for update using (
    (
      section_id is not null
      and exists (
        select 1 from public.sections s
        where s.id = notes.section_id
          and public.has_notebook_access(s.notebook_id)
      )
    )
    or (section_id is null and auth.uid() = notes.user_id)
  )
  with check (
    (
      section_id is not null
      and exists (
        select 1 from public.sections s
        where s.id = notes.section_id
          and public.has_notebook_access(s.notebook_id)
      )
    )
    or (section_id is null and auth.uid() = user_id)
  );

create policy "notes_delete_access" on public.notes
  for delete using (
    (
      section_id is not null
      and exists (
        select 1 from public.sections s
        where s.id = notes.section_id
          and public.has_notebook_access(s.notebook_id)
      )
    )
    or (section_id is null and auth.uid() = notes.user_id)
  );

-- ---------------------------------------------------------------------------
-- notebook_members: RLS
-- ---------------------------------------------------------------------------
alter table public.notebook_members enable row level security;

drop policy if exists "notebook_members_select" on public.notebook_members;
drop policy if exists "notebook_members_insert_owner" on public.notebook_members;
drop policy if exists "notebook_members_delete" on public.notebook_members;

create policy "notebook_members_select" on public.notebook_members
  for select using (public.has_notebook_access(notebook_id));

create policy "notebook_members_insert_owner" on public.notebook_members
  for insert with check (public.is_notebook_owner(notebook_id));

create policy "notebook_members_delete" on public.notebook_members
  for delete using (
    public.is_notebook_owner(notebook_id)
    or user_id = auth.uid()
  );

grant select, insert, delete on public.notebook_members to authenticated;

-- ---------------------------------------------------------------------------
-- notebook_invites: RLS
-- ---------------------------------------------------------------------------
alter table public.notebook_invites enable row level security;

drop policy if exists "notebook_invites_select" on public.notebook_invites;
drop policy if exists "notebook_invites_insert" on public.notebook_invites;
drop policy if exists "notebook_invites_update" on public.notebook_invites;
drop policy if exists "notebook_invites_delete" on public.notebook_invites;

create policy "notebook_invites_select" on public.notebook_invites
  for select using (public.is_notebook_owner(notebook_id));

create policy "notebook_invites_insert" on public.notebook_invites
  for insert with check (
    public.is_notebook_owner(notebook_id)
    and auth.uid() = created_by
  );

create policy "notebook_invites_update" on public.notebook_invites
  for update using (public.is_notebook_owner(notebook_id));

create policy "notebook_invites_delete" on public.notebook_invites
  for delete using (public.is_notebook_owner(notebook_id));

grant select, insert, update, delete on public.notebook_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.notebook_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notebook_invites;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notebooks;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sections;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
end $$;
