-- Keep Outlook occurrence IDs and all linked history across refreshes.
alter table public.events add column if not exists outlook_source_key text;
alter table public.events add column if not exists outlook_cancelled_at timestamptz;
create unique index if not exists events_outlook_identity_idx
  on public.events (user_id, outlook_source_key) where source = 'outlook_ics';

alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check check (kind in (
  'task_create','task_update','task_complete','task_delete','focus_reorder',
  'chase_logged','memory_write','note_create','note_append','note_triage',
  'note_scratch','notebook_merge','brief_write','workstream_create','note_workstream','calendar_sync'
));

create or replace function public.apply_outlook_calendar_snapshot(
  p_user_id uuid, p_connection_id uuid, p_expected_url text, p_timezone text,
  p_started_at timestamptz, p_from timestamptz, p_to timestamptz, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_old public.events%rowtype;
  v_new public.events%rowtype;
  v_row record;
  v_actor text := 'Calendar sync';
  v_run uuid;
  v_ids uuid[] := '{}';
  v_matches integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_before jsonb := '[]';
  v_after jsonb := '[]';
  v_notes_before jsonb := '[]';
  v_notes_after jsonb := '[]';
  v_debrief_before jsonb := '[]';
  v_debrief_after jsonb := '[]';
  v_finished timestamptz;
begin
  -- Service-only RPC. User is verified by the Edge route, never request data.
  if p_user_id is null then raise exception 'Verified user required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 53));
  if p_connection_id is not null then
    select name into v_actor from public.agent_connections
    where id = p_connection_id and user_id = p_user_id and revoked_at is null
      and (expires_at is null or expires_at > now()) and 'workspace:write' = any(scopes) for share;
    if not found then raise exception 'An active owned write connection is required'; end if;
  end if;
  select * into strict v_profile from public.profiles where user_id = p_user_id for update;
  if p_expected_url is null or p_timezone is null or p_started_at is null or
     p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '35 days' or
     p_started_at > clock_timestamp() + interval '1 minute' or
     p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'Invalid calendar snapshot';
  end if;
  if v_profile.outlook_ics_url is distinct from p_expected_url or
     coalesce(nullif(v_profile.timezone, ''), 'UTC') <> p_timezone or
     v_profile.outlook_ics_last_synced_at >= p_started_at then
    return jsonb_build_object('status','superseded','lastSyncedAt',v_profile.outlook_ics_last_synced_at);
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(outlook_source_key text, title text, start_at timestamptz, duration_minutes integer, timezone text)
    where r.outlook_source_key is null or octet_length(r.outlook_source_key) > 2000 or r.outlook_source_key = '' or
      r.title is null or r.title = '' or length(r.title) > 4000 or r.start_at is null or
      r.duration_minutes is null or r.duration_minutes < 1 or r.duration_minutes > 525600 or r.timezone is distinct from p_timezone
  ) or exists (select 1 from jsonb_to_recordset(p_rows) as r(outlook_source_key text)
    group by outlook_source_key having count(*) > 1) then
    raise exception 'Invalid or duplicate calendar occurrence';
  end if;

  for v_row in select * from jsonb_to_recordset(p_rows) as r(
    outlook_source_key text, title text, start_at timestamptz, duration_minutes integer, timezone text
  ) loop
    select * into v_old from public.events where user_id = p_user_id and source = 'outlook_ics'
      and outlook_source_key = v_row.outlook_source_key for update;
    if not found then
      -- Adopt old rows once, only when their exact slot/title match is unambiguous.
      select count(*) into v_matches from public.events where user_id = p_user_id and source = 'outlook_ics'
        and outlook_source_key is null and title = v_row.title and start_at = v_row.start_at and duration_minutes = v_row.duration_minutes;
      if v_matches > 1 then raise exception 'Ambiguous legacy calendar meetings require review'; end if;
      if v_matches = 1 then
        select * into v_old from public.events where user_id = p_user_id and source = 'outlook_ics'
          and outlook_source_key is null and title = v_row.title and start_at = v_row.start_at and duration_minutes = v_row.duration_minutes for update;
      end if;
    end if;
    if v_old.id is null then
      insert into public.events (user_id, source, outlook_source_key, title, start_at, duration_minutes, timezone)
        values (p_user_id, 'outlook_ics', v_row.outlook_source_key, v_row.title, v_row.start_at, v_row.duration_minutes, p_timezone) returning * into v_new;
      v_inserted := v_inserted + 1;
      v_after := v_after || jsonb_build_array(to_jsonb(v_new));
    else
      v_new := v_old;
      if (v_old.title, v_old.start_at, v_old.duration_minutes, v_old.timezone, v_old.outlook_source_key, v_old.outlook_cancelled_at)
        is distinct from (v_row.title, v_row.start_at, v_row.duration_minutes, p_timezone, v_row.outlook_source_key, null::timestamptz) then
        v_before := v_before || jsonb_build_array(to_jsonb(v_old));
        -- One-off import: move lookup keys, never rewrite note/debrief content.
        if v_old.start_at <> v_row.start_at then
          v_notes_before := v_notes_before || coalesce((select jsonb_agg(jsonb_build_object('id',id,'linked_occurrence_start_at',linked_occurrence_start_at))
            from public.notes where user_id = p_user_id and linked_event_id = v_old.id and linked_occurrence_start_at = v_old.start_at), '[]');
          with moved as (update public.notes set linked_occurrence_start_at = v_row.start_at
            where user_id = p_user_id and linked_event_id = v_old.id and linked_occurrence_start_at = v_old.start_at returning id, linked_occurrence_start_at)
          select v_notes_after || coalesce(jsonb_agg(to_jsonb(moved)), '[]') into v_notes_after from moved;
          v_debrief_before := v_debrief_before || coalesce((select jsonb_agg(jsonb_build_object('id',id,'occurrence_start_at',occurrence_start_at))
            from public.meeting_debrief_states where user_id = p_user_id and event_id = v_old.id and occurrence_start_at = v_old.start_at), '[]');
          with moved as (update public.meeting_debrief_states set occurrence_start_at = v_row.start_at
            where user_id = p_user_id and event_id = v_old.id and occurrence_start_at = v_old.start_at returning id, occurrence_start_at)
          select v_debrief_after || coalesce(jsonb_agg(to_jsonb(moved)), '[]') into v_debrief_after from moved;
        end if;
        update public.events set title = v_row.title, start_at = v_row.start_at, duration_minutes = v_row.duration_minutes,
          timezone = p_timezone, outlook_source_key = v_row.outlook_source_key, outlook_cancelled_at = null
          where id = v_old.id and user_id = p_user_id returning * into v_new;
        v_updated := v_updated + 1;
        v_after := v_after || jsonb_build_array(to_jsonb(v_new));
      end if;
    end if;
    v_ids := array_append(v_ids, v_new.id);
  end loop;
  -- Absence only applies to the fully parsed window, never the rest of history.
  for v_old in select * from public.events where user_id = p_user_id and source = 'outlook_ics'
    and start_at >= p_from and start_at < p_to and outlook_cancelled_at is null and not (id = any(v_ids)) for update
  loop
    v_before := v_before || jsonb_build_array(to_jsonb(v_old));
    update public.events set outlook_cancelled_at = clock_timestamp() where id = v_old.id returning * into v_new;
    v_after := v_after || jsonb_build_array(to_jsonb(v_new));
    v_removed := v_removed + 1;
  end loop;
  v_finished := clock_timestamp();
  update public.profiles set outlook_ics_last_synced_at = v_finished where user_id = p_user_id;
  insert into public.agent_runs (user_id, agent_connection_id, actor_name, kind, status, trigger_source, summary, started_at, finished_at)
    values (p_user_id, p_connection_id, v_actor, 'adhoc', 'ok', 'manual', 'Refreshed Outlook calendar', p_started_at, v_finished) returning id into v_run;
  insert into public.agent_actions (user_id, run_id, agent_connection_id, actor_name, kind, title, rationale, effects, target, before, after)
    values (p_user_id, v_run, p_connection_id, v_actor, 'calendar_sync', 'Refreshed Outlook calendar',
      'Read the latest published calendar; preserve meeting identities and linked history.',
      jsonb_build_array(format('%s added, %s updated, %s removed from the active schedule.', v_inserted, v_updated, v_removed)),
      jsonb_build_object('type','calendar'),
      jsonb_build_object('events',v_before,'notes',v_notes_before,'meeting_debrief_states',v_debrief_before,'outlook_ics_last_synced_at',v_profile.outlook_ics_last_synced_at),
      jsonb_build_object('events',v_after,'notes',v_notes_after,'meeting_debrief_states',v_debrief_after,'outlook_ics_last_synced_at',v_finished));
  return jsonb_build_object('status','synced','lastSyncedAt',v_finished,'inserted',v_inserted,'updated',v_updated,'removed',v_removed);
end;
$$;
revoke all on function public.apply_outlook_calendar_snapshot(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.apply_outlook_calendar_snapshot(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) to service_role;
