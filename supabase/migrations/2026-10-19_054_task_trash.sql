-- Recoverable, tasks-only deletion. No purge job or permanent-delete API.
begin;
alter table public.tasks add column if not exists deleted_at timestamptz;
alter table public.tasks add column if not exists restored_at timestamptz;
create index if not exists tasks_trash_idx on public.tasks (user_id, deleted_at desc)
  where deleted_at is not null;

alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check check (kind in (
  'task_create','task_update','task_complete','task_delete','task_restore','focus_reorder',
  'chase_logged','memory_write','note_create','note_append','note_triage','note_scratch',
  'notebook_merge','brief_write','workstream_create','note_workstream','calendar_sync'
));

-- Ordinary clients cannot bypass audited lifecycle RPCs, edit Trash, or hard-delete.
drop policy if exists tasks_delete_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);
drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks for insert
  with check (auth.uid() = user_id and deleted_at is null and restored_at is null);
revoke delete, update, insert on public.tasks from authenticated, anon;
do $$
declare v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name not in ('deleted_at', 'restored_at');
  execute 'grant insert (' || v_columns || '), update (' || v_columns || ') on public.tasks to authenticated';
end;
$$;

create or replace function public.apply_task_trash_action(
  p_user_id uuid, p_run_id uuid, p_connection_id uuid, p_actor_name text, p_input jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := p_input->>'kind';
  v_task_id uuid := (p_input->>'taskId')::uuid;
  v_key text := nullif(btrim(p_input->>'dedupeKey'), '');
  v_expected timestamptz := (p_input->>'expectedUpdatedAt')::timestamptz;
  v_task public.tasks%rowtype;
  v_existing public.agent_actions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_focus jsonb;
  v_next_focus jsonb;
  v_action_id uuid;
  v_timezone text;
begin
  if v_kind is null or v_kind not in ('task_delete', 'task_restore') or v_task_id is null then
    raise exception 'A task_delete/task_restore action and exact taskId are required';
  end if;
  if p_connection_id is null then
    if auth.uid() is null or auth.uid() is distinct from p_user_id or p_run_id is not null then
      raise exception 'Sign in to change your own task';
    end if;
  elsif not exists (select 1 from public.agent_connections where id = p_connection_id
      and user_id = p_user_id and revoked_at is null
      and (expires_at is null or expires_at > now()) and 'workspace:write' = any(scopes))
    or not exists (select 1 from public.agent_runs where id = p_run_id
      and user_id = p_user_id and agent_connection_id = p_connection_id) then
    raise exception 'An active owned write connection and run are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 54));
  if v_key is not null then
    select * into v_existing from public.agent_actions where user_id = p_user_id and dedupe_key = v_key;
    if found then
      if v_existing.kind <> v_kind or v_existing.target->>'id' <> v_task_id::text then
        raise exception 'dedupeKey belongs to another action or task';
      end if;
      return jsonb_build_object('ok', true, 'kind', v_kind, 'skipped', 'duplicate',
        'actionId', v_existing.id, 'targetId', v_task_id);
    end if;
  end if;
  select * into v_task from public.tasks where id = v_task_id and user_id = p_user_id for update;
  if not found then raise exception 'Task not found in your workspace'; end if;
  if (v_task.deleted_at is not null) = (v_kind = 'task_delete') then
    return jsonb_build_object('ok', true, 'kind', v_kind, 'skipped', 'unchanged', 'targetId', v_task_id);
  end if;
  if v_expected is null or v_task.updated_at is distinct from v_expected then
    raise exception 'Task changed since it was read; refresh and review before retrying';
  end if;
  select focus_queue, coalesce(timezone, 'UTC') into v_focus, v_timezone
    from public.profiles where user_id = p_user_id for update;
  v_next_focus := v_focus;
  if jsonb_typeof(v_focus->'stack') = 'array' then
    select jsonb_set(v_focus, '{stack}', coalesce(jsonb_agg(value order by ord), '[]'::jsonb))
      into v_next_focus from jsonb_array_elements(v_focus->'stack') with ordinality as refs(value, ord)
      where (value->>'kind' = 'task' and value->>'taskId' = v_task_id::text) is not true;
  end if;
  -- Both Trash and Restore remove stale focus references. Restore never re-pins.
  v_before := jsonb_build_object('task', to_jsonb(v_task), 'focus_queue', v_focus);
  update public.tasks set
      deleted_at = case when v_kind = 'task_delete' then clock_timestamp() else null end,
      restored_at = case when v_kind = 'task_restore' then clock_timestamp() else restored_at end,
      reminder_sent_at = case when v_kind = 'task_restore' and due_date is not null and due_time is not null
        and (due_date + due_time) <= timezone(coalesce(v_timezone, 'UTC'), now())
        then coalesce(reminder_sent_at, now()) else reminder_sent_at end
    where id = v_task_id and user_id = p_user_id returning * into v_task;
  if v_next_focus is distinct from v_focus then
    update public.profiles set focus_queue = v_next_focus where user_id = p_user_id;
  end if;
  if v_kind = 'task_delete' then
    delete from public.memory_chunks where user_id = p_user_id
      and source_type = 'task' and source_id = v_task_id::text;
  end if;
  v_after := jsonb_build_object('task', to_jsonb(v_task), 'focus_queue', v_next_focus);
  insert into public.agent_actions (user_id, run_id, agent_connection_id, actor_name,
      kind, title, rationale, effects, target, before, after, category, status, dedupe_key)
    values (p_user_id, p_run_id, p_connection_id, p_actor_name, v_kind,
      case when v_kind = 'task_delete' then 'Moved to Trash: ' else 'Restored task: ' end || v_task.title,
      p_input->>'rationale', jsonb_build_array(case when v_kind = 'task_delete'
        then 'Hidden from active work; task and links retained for Restore'
        else 'Restored without re-pinning or replaying old timed reminders' end),
      jsonb_build_object('type', 'task', 'id', v_task_id, 'recoverable', true),
      v_before, v_after, case when p_connection_id is null then 'owner' else 'codex' end,
      'applied', v_key) returning id into v_action_id;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'actionId', v_action_id, 'targetId', v_task_id);
end;
$$;
revoke all on function public.apply_task_trash_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_task_trash_action(uuid, uuid, uuid, text, jsonb) to service_role;

create or replace function public.set_task_trashed(
  p_task_id uuid, p_trashed boolean, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_trashed is null then raise exception 'Sign in and choose Trash or Restore'; end if;
  return public.apply_task_trash_action(auth.uid(), null, null, 'You', jsonb_build_object(
    'kind', case when p_trashed then 'task_delete' else 'task_restore' end,
    'taskId', p_task_id, 'expectedUpdatedAt', p_expected_updated_at,
    'rationale', 'Explicit task action in the app'));
end;
$$;
revoke all on function public.set_task_trashed(uuid, boolean, timestamptz) from public, anon, service_role;
grant execute on function public.set_task_trashed(uuid, boolean, timestamptz) to authenticated;

create or replace function public.undo_agent_task_lifecycle_action(p_action_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_action public.agent_actions%rowtype;
  v_task public.tasks%rowtype;
  v_expected jsonb;
  v_kind text;
begin
  if v_user_id is null then raise exception 'Sign in to undo this action'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 54));
  select * into v_action from public.agent_actions where id = p_action_id and user_id = v_user_id for update;
  if not found then raise exception 'Action not found in your workspace'; end if;
  if v_action.kind not in ('task_create', 'task_delete', 'task_restore') then raise exception 'Not a task lifecycle action'; end if;
  if v_action.status = 'undone' then return; end if;
  if v_action.status <> 'applied' then raise exception 'This action did not apply'; end if;
  if v_action.kind <> 'task_create' and v_action.target->>'recoverable' is distinct from 'true' then
    raise exception 'Legacy permanent deletion requires manual recovery review';
  end if;
  v_expected := case when v_action.kind = 'task_create' then v_action.after else v_action.after->'task' end;
  if v_expected is null or not (v_expected ? 'updated_at') then raise exception 'Missing task snapshot'; end if;
  select * into v_task from public.tasks where id = (v_action.target->>'id')::uuid and user_id = v_user_id for update;
  if not found then raise exception 'Task no longer exists; nothing was overwritten'; end if;
  if not (to_jsonb(v_task) @> v_expected) then raise exception 'Task changed since this action; review its current state'; end if;
  v_kind := case when v_action.kind = 'task_delete' then 'task_restore' else 'task_delete' end;
  perform public.apply_task_trash_action(v_user_id, null, null, 'You', jsonb_build_object(
    'kind', v_kind, 'taskId', v_task.id, 'expectedUpdatedAt', v_task.updated_at,
    'dedupeKey', 'undo-task:' || v_action.id::text, 'rationale', 'Explicit Undo from Activity'));
  update public.agent_actions set status = 'undone', undone_at = now(), undo_error = null where id = v_action.id;
end;
$$;
revoke all on function public.undo_agent_task_lifecycle_action(uuid) from public, anon, service_role;
grant execute on function public.undo_agent_task_lifecycle_action(uuid) to authenticated;

-- Defense against an in-flight memory sync re-inserting stale embeddings.
-- The vector extension is absent in isolated lifecycle tests, hence dynamic DDL.
do $migration$
begin
  if exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'match_memory_chunks') then
    execute $definition$
      create or replace function public.match_memory_chunks(
        query_embedding extensions.vector(1536), match_user_id uuid, match_count int default 12
      ) returns table (id uuid, source_type text, source_id text, chunk_index int,
        content text, metadata jsonb, similarity float)
      language sql stable security definer set search_path = public, extensions as $body$
        select mc.id, mc.source_type, mc.source_id, mc.chunk_index, mc.content, mc.metadata,
          1 - (mc.embedding <=> query_embedding) as similarity
        from public.memory_chunks mc
        where mc.user_id = match_user_id and mc.embedding is not null
          and (mc.source_type <> 'task' or exists (select 1 from public.tasks t
            where t.id::text = mc.source_id and t.user_id = match_user_id and t.deleted_at is null))
        order by mc.embedding <=> query_embedding limit greatest(match_count, 1);
      $body$;
    $definition$;
  end if;
end;
$migration$;

commit;
