-- Workstream changes and their audit entries commit (and undo) together.
alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check check (kind in (
  'task_create', 'task_update', 'task_complete', 'task_delete', 'focus_reorder',
  'chase_logged', 'memory_write', 'note_create', 'note_append', 'note_triage',
  'note_scratch', 'notebook_merge', 'brief_write', 'workstream_create', 'note_workstream'
));

create or replace function public.apply_agent_workstream_action(
  p_user_id uuid, p_run_id uuid, p_connection_id uuid, p_actor_name text, p_input jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := p_input->>'kind';
  v_key text := nullif(btrim(p_input->>'dedupeKey'), '');
  v_name text;
  v_description text;
  v_workstream public.workstreams%rowtype;
  v_link public.note_workstreams%rowtype;
  v_existing public.agent_actions%rowtype;
  v_workstream_id uuid;
  v_note_id uuid;
  v_assigned boolean;
  v_before jsonb;
  v_after jsonb;
  v_target jsonb;
  v_title text;
  v_action_id uuid;
  v_effects jsonb;
begin
  if v_kind is null or v_kind not in ('workstream_create', 'note_workstream') then
    raise exception 'Unsupported workstream action';
  end if;
  -- This RPC is service-only. Identity must come from the verified principal.
  if not exists (select 1 from public.agent_connections where id = p_connection_id
      and user_id = p_user_id and revoked_at is null
      and (expires_at is null or expires_at > now()) and 'workspace:write' = any(scopes))
    or not exists (select 1 from public.agent_runs where id = p_run_id
      and user_id = p_user_id and agent_connection_id = p_connection_id) then
    raise exception 'An active owned agent connection and run are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 52));
  if v_key is not null then
    select * into v_existing from public.agent_actions where user_id = p_user_id and dedupe_key = v_key;
    if found then
      if v_existing.kind <> v_kind then raise exception 'dedupeKey belongs to a different action'; end if;
      return jsonb_build_object('ok', true, 'kind', v_kind, 'skipped', 'duplicate',
        'actionId', v_existing.id, 'targetId', v_existing.target->>'id');
    end if;
  end if;

  if v_kind = 'workstream_create' then
    if jsonb_typeof(p_input->'workstream'->'name') is distinct from 'string' then
      raise exception 'workstream.name must be a string';
    end if;
    v_name := btrim(p_input->'workstream'->>'name');
    if char_length(v_name) not between 1 and 100 then raise exception 'workstream.name must be 1–100 characters'; end if;
    if p_input->'workstream' ? 'description' and jsonb_typeof(p_input->'workstream'->'description') <> 'string' then
      raise exception 'workstream.description must be a string';
    end if;
    v_description := coalesce(p_input->'workstream'->>'description', '');
    if char_length(v_description) > 4000 then raise exception 'workstream.description must be at most 4000 characters'; end if;
    insert into public.workstreams (user_id, name, description, position)
      select p_user_id, v_name, v_description, coalesce(max(position) + 1, 0)
      from public.workstreams where user_id = p_user_id
      on conflict (user_id, lower(name)) do nothing returning * into v_workstream;
    if not found then
      select * into strict v_workstream from public.workstreams where user_id = p_user_id and lower(name) = lower(v_name);
      return jsonb_build_object('ok', true, 'kind', v_kind, 'skipped', 'unchanged', 'targetId', v_workstream.id);
    end if;
    v_after := to_jsonb(v_workstream);
    v_target := jsonb_build_object('type', 'workstream', 'id', v_workstream.id);
    v_title := 'Created workstream: ' || v_name;
  else
    v_workstream_id := (p_input->>'workstreamId')::uuid;
    v_note_id := (p_input->>'noteId')::uuid;
    if jsonb_typeof(p_input->'assigned') is distinct from 'boolean' then raise exception 'assigned must be true or false (not a toggle)'; end if;
    v_assigned := (p_input->>'assigned')::boolean;
    select * into v_workstream from public.workstreams where id = v_workstream_id and user_id = p_user_id for update;
    if not found then raise exception 'Workstream not found in your workspace'; end if;
    perform 1 from public.notes where id = v_note_id and user_id = p_user_id for update;
    if not found then raise exception 'Note not found in your workspace'; end if;
    select * into v_link from public.note_workstreams where user_id = p_user_id and workstream_id = v_workstream_id and note_id = v_note_id for update;
    if found then v_before := to_jsonb(v_link); end if;
    if v_assigned = (v_before is not null) then
      return jsonb_build_object('ok', true, 'kind', v_kind, 'skipped', 'unchanged', 'targetId', v_note_id);
    end if;
    if v_assigned then
      insert into public.note_workstreams (user_id, workstream_id, note_id)
        values (p_user_id, v_workstream_id, v_note_id) returning * into v_link;
      v_after := to_jsonb(v_link);
    else
      delete from public.note_workstreams where user_id = p_user_id and workstream_id = v_workstream_id and note_id = v_note_id;
    end if;
    v_target := jsonb_build_object('type', 'note', 'id', v_note_id, 'workstreamId', v_workstream_id);
    v_title := case when v_assigned then 'Added note to ' else 'Removed note from ' end || v_workstream.name;
  end if;

  select coalesce(jsonb_agg(e.value), '[]'::jsonb) into v_effects from (
    select value from jsonb_array_elements(case when jsonb_typeof(p_input->'effects') = 'array' then p_input->'effects' else '[]'::jsonb end)
      where jsonb_typeof(value) = 'string' limit 20
  ) e;
  insert into public.agent_actions (user_id, run_id, agent_connection_id, actor_name,
      kind, title, rationale, effects, target, before, after, category, status, dedupe_key)
    values (p_user_id, p_run_id, p_connection_id, p_actor_name, v_kind,
      coalesce(nullif(btrim(p_input->>'title'), ''), v_title), p_input->>'rationale', v_effects,
      v_target, v_before, v_after, 'codex', 'applied', v_key) returning id into v_action_id;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'actionId', v_action_id, 'targetId', v_target->>'id');
end;
$$;
revoke all on function public.apply_agent_workstream_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_agent_workstream_action(uuid, uuid, uuid, text, jsonb) to service_role;

create or replace function public.undo_agent_workstream_action(p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_action public.agent_actions%rowtype;
  v_workstream public.workstreams%rowtype;
  v_link public.note_workstreams%rowtype;
  v_workstream_id uuid;
  v_note_id uuid;
  v_current jsonb;
begin
  if v_user_id is null then raise exception 'Sign in to undo this action'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 52));
  select * into v_action from public.agent_actions where id = p_action_id and user_id = v_user_id for update;
  if not found then raise exception 'Action not found in your workspace'; end if;
  if v_action.kind not in ('workstream_create', 'note_workstream') then raise exception 'Not a workstream action'; end if;
  if v_action.status = 'undone' then return; end if;
  if v_action.status <> 'applied' then raise exception 'This action did not apply'; end if;

  v_workstream_id := case when v_action.kind = 'workstream_create'
    then (v_action.target->>'id')::uuid else (v_action.target->>'workstreamId')::uuid end;
  select * into v_workstream from public.workstreams where id = v_workstream_id and user_id = v_user_id for update;
  if not found then raise exception 'Workstream no longer exists'; end if;
  if v_action.kind = 'workstream_create' then
    if to_jsonb(v_workstream) is distinct from v_action.after then raise exception 'Workstream changed since this action; keep it and review manually'; end if;
    -- Locking the parent also blocks concurrent FK inserts while checking links.
    if exists (select 1 from public.note_workstreams where workstream_id = v_workstream_id) then
      raise exception 'Workstream contains notes; remove their links first';
    end if;
    delete from public.workstreams where id = v_workstream_id and user_id = v_user_id;
  else
    v_note_id := (v_action.target->>'id')::uuid;
    perform 1 from public.notes where id = v_note_id and user_id = v_user_id for update;
    if not found then raise exception 'Note no longer exists in your workspace'; end if;
    select * into v_link from public.note_workstreams where user_id = v_user_id and workstream_id = v_workstream_id and note_id = v_note_id for update;
    if found then v_current := to_jsonb(v_link); end if;
    if v_current is distinct from v_action.after then raise exception 'Note membership changed since this action; review it manually'; end if;
    if v_action.before is null then
      delete from public.note_workstreams where user_id = v_user_id and workstream_id = v_workstream_id and note_id = v_note_id;
    else
      insert into public.note_workstreams (user_id, workstream_id, note_id, created_at)
        values (v_user_id, v_workstream_id, v_note_id, (v_action.before->>'created_at')::timestamptz);
    end if;
  end if;
  update public.agent_actions set status = 'undone', undone_at = now(), undo_error = null where id = v_action.id;
end;
$$;
revoke all on function public.undo_agent_workstream_action(uuid) from public, anon, service_role;
grant execute on function public.undo_agent_workstream_action(uuid) to authenticated;
