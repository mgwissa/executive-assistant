-- Human progress is separate from immutable refinement evidence, tasks and ADO.
begin;

create table if not exists public.refinement_item_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A source note is a navigation anchor, not the identity of a human decision.
  note_id uuid references public.notes(id) on delete set null,
  source_id text not null check (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  item_kind text not null check (item_kind in ('action', 'story')),
  item_id text not null check (item_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, source_id, item_kind, item_id)
);
create index if not exists refinement_item_progress_note on public.refinement_item_progress(note_id);
alter table public.refinement_item_progress enable row level security;

-- OAuth agents share the owner's uid; they may only read through the scoped bridge.
drop policy if exists refinement_progress_owner_select on public.refinement_item_progress;
create policy refinement_progress_owner_select on public.refinement_item_progress for select to authenticated
  using (user_id = auth.uid() and nullif(auth.jwt()->>'client_id', '') is null);
revoke all on public.refinement_item_progress from public, anon, authenticated, service_role;
grant select on public.refinement_item_progress to authenticated, service_role;

create or replace function public.set_refinement_progress(
  p_note_id uuid,
  p_source_id text,
  p_item_kind text,
  p_item_id text,
  p_status text,
  p_expected_updated_at timestamptz default null
)
returns public.refinement_item_progress
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_old public.refinement_item_progress%rowtype;
  v_new public.refinement_item_progress%rowtype;
begin
  if v_user_id is null or nullif(auth.jwt()->>'client_id', '') is not null then
    raise exception 'An owner session is required; agents cannot change refinement progress';
  end if;
  if p_source_id is null or p_source_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    or p_item_id is null or p_item_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'Refinement source and item IDs must be safe tokens of at most 200 characters';
  end if;
  if p_item_kind is null or p_item_kind not in ('action', 'story') then
    raise exception 'Unsupported refinement item kind';
  end if;
  if p_status is null or p_status not in ('not_started', 'in_progress', 'complete') then
    raise exception 'Unsupported refinement progress status';
  end if;
  -- Lock the owner note against deletion while saving; its content is never changed.
  perform 1 from public.notes where id = p_note_id and user_id = v_user_id for key share;
  if not found then raise exception 'Owned refinement note not found'; end if;

  select * into v_old from public.refinement_item_progress
    where user_id = v_user_id and source_id = p_source_id and item_kind = p_item_kind and item_id = p_item_id
    for update;
  if found then
    if p_expected_updated_at is null or v_old.updated_at <> p_expected_updated_at then
      raise exception 'Refinement progress changed; refresh before saving' using errcode = '40001';
    end if;
    if v_old.status = p_status then return v_old; end if;
    update public.refinement_item_progress set status = p_status, note_id = p_note_id,
      updated_at = greatest(clock_timestamp(), v_old.updated_at + interval '1 microsecond')
      where user_id = v_user_id and source_id = p_source_id and item_kind = p_item_kind and item_id = p_item_id
      returning * into v_new;
    return v_new;
  end if;
  if p_expected_updated_at is not null then
    raise exception 'Refinement progress changed; refresh before saving' using errcode = '40001';
  end if;
  begin
    insert into public.refinement_item_progress(user_id, note_id, source_id, item_kind, item_id, status)
      values(v_user_id, p_note_id, p_source_id, p_item_kind, p_item_id, p_status)
      returning * into v_new;
  exception when unique_violation then
    -- Another first save won the race. Never overwrite it with an upsert.
    raise exception 'Refinement progress changed; refresh before saving' using errcode = '40001';
  end;
  return v_new;
end;
$$;
revoke all on function public.set_refinement_progress(uuid,text,text,text,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.set_refinement_progress(uuid,text,text,text,text,timestamptz) to authenticated;

commit;
