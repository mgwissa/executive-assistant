-- Private, source-grounded customer cases. NO mailbox credentials, messages or
-- sending capability. Case evidence and immutable intake receipt commit with audit.
begin;
create or replace function public.email_review_source_is_readonly(p_url text)
returns boolean language sql immutable set search_path = '' as $$
  select p_url ~ '^https://outlook\.(office\.com|office365\.com)/(mail/([^/?#]+/)*id/[^/?#]+/?([?#].*)?|mail/deeplink/read/[^/?#]+/?([?#].*)?|owa/?\?([^#]*&)?[Ii][Tt][Ee][Mm][Ii][Dd]=[^&#]+.*)$'
    and p_url !~ '[[:space:][:cntrl:]]'
    and p_url !~* '/(compose|reply|replyall|forward)(/|[?#]|$)'
    and p_url !~* '[?&](action|cmd)=(send|compose|reply|forward)';
$$;
create table if not exists public.email_review_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox text not null default 'hello@autofinder.com' check (mailbox = 'hello@autofinder.com'),
  message_id text not null check (char_length(message_id) between 1 and 1024),
  request_key text not null check (char_length(request_key) between 1 and 150),
  source_version text not null check (char_length(source_version) between 1 and 300),
  source_url text not null check (char_length(source_url) <= 4000 and public.email_review_source_is_readonly(source_url)),
  received_at timestamptz not null,
  source_observed_at timestamptz not null,
  category text not null check (category in ('contact_preference','no_longer_shopping','vehicle_correction','buying_question','data_correction','product_feedback','purchase_feedback')),
  customer_label text not null check (char_length(customer_label) between 1 and 150),
  vehicle_context text not null default '' check (char_length(vehicle_context) <= 250),
  request_summary text not null check (char_length(request_summary) between 1 and 1500),
  suggested_next_step text not null default '' check (char_length(suggested_next_step) <= 800),
  review_status text not null default 'needs_review' check (review_status in ('needs_review','reviewed','handled','no_action')),
  decision_note text not null default '' check (char_length(decision_note) <= 4000),
  reviewed_source_version text,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, mailbox, message_id, request_key)
);
create index if not exists email_review_cases_owner_received on public.email_review_cases(user_id, received_at desc, id);
create table if not exists public.email_review_intakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mailbox text not null default 'hello@autofinder.com' check (mailbox = 'hello@autofinder.com'),
  run_key text not null check (char_length(run_key) between 1 and 200),
  covered_from timestamptz not null,
  covered_through timestamptz not null check (covered_through >= covered_from),
  complete boolean not null,
  message_count integer not null check (message_count >= 0),
  customer_reply_count integer not null check (customer_reply_count between 0 and message_count),
  pages integer not null check (pages >= 1),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),
  seen_messages jsonb not null default '[]' check (jsonb_typeof(seen_messages) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, mailbox, run_key)
);
create table if not exists public.email_review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null references public.email_review_cases(id) on delete cascade,
  kind text not null check (kind in ('source_update','decision')),
  before jsonb,
  after jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists email_review_events_case on public.email_review_events(user_id, case_id, created_at desc);
alter table public.email_review_cases enable row level security;
alter table public.email_review_intakes enable row level security;
alter table public.email_review_events enable row level security;
-- Agent JWTs share the owner's uid. Read through the scope-gated bridge, not REST.
drop policy if exists email_cases_owner on public.email_review_cases;
create policy email_cases_owner on public.email_review_cases for select to authenticated
  using (user_id = auth.uid() and nullif(auth.jwt()->>'client_id','') is null);
drop policy if exists email_intakes_owner on public.email_review_intakes;
create policy email_intakes_owner on public.email_review_intakes for select to authenticated
  using (user_id = auth.uid() and nullif(auth.jwt()->>'client_id','') is null);
drop policy if exists email_events_owner on public.email_review_events;
create policy email_events_owner on public.email_review_events for select to authenticated
  using (user_id = auth.uid() and nullif(auth.jwt()->>'client_id','') is null);
revoke all on public.email_review_cases, public.email_review_intakes, public.email_review_events from public, anon, authenticated;
grant select on public.email_review_cases, public.email_review_intakes, public.email_review_events to authenticated;
grant all on public.email_review_cases, public.email_review_intakes, public.email_review_events to service_role;

alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check check (kind in (
  'task_create','task_update','task_complete','task_delete','task_restore','focus_reorder',
  'chase_logged','memory_write','note_create','note_append','note_triage','note_scratch',
  'notebook_merge','brief_write','workstream_create','note_workstream','calendar_sync','email_review_intake'
));

create or replace function public.apply_agent_email_review_intake(
  p_user_id uuid, p_run_id uuid, p_connection_id uuid, p_actor_name text, p_input jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := nullif(btrim(p_input->>'dedupeKey'),'');
  v_intake jsonb := p_input->'intake';
  v_case jsonb; v_seen jsonb; v_field text;
  v_old public.email_review_cases%rowtype;
  v_new public.email_review_cases%rowtype;
  v_receipt public.email_review_intakes%rowtype;
  v_existing public.agent_actions%rowtype;
  v_before jsonb := '[]'; v_after jsonb := '[]';
  v_changed integer := 0; v_action_id uuid; v_checkpoint timestamptz; v_latest_read_end timestamptz;
begin
  if p_input->>'kind' is distinct from 'email_review_intake' then raise exception 'Unsupported email review action'; end if;
  if not exists (select 1 from public.agent_connections where id = p_connection_id and user_id = p_user_id
      and revoked_at is null and (expires_at is null or expires_at > now()) and 'workspace:write' = any(scopes))
    or not exists (select 1 from public.agent_runs where id = p_run_id and user_id = p_user_id and agent_connection_id = p_connection_id) then
    raise exception 'An active owned write connection and run are required';
  end if;
  if v_key is null or char_length(v_key) > 200 then raise exception 'A stable dedupeKey (1–200 characters) is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,57));
  select * into v_existing from public.agent_actions where user_id = p_user_id and dedupe_key = v_key;
  if found then
    if v_existing.kind <> 'email_review_intake' then raise exception 'dedupeKey belongs to a different action'; end if;
    return jsonb_build_object('ok',true,'kind','email_review_intake','skipped','duplicate','actionId',v_existing.id,'targetId',v_existing.target->>'id');
  end if;
  if jsonb_typeof(v_intake) is distinct from 'object' or v_intake->>'mailbox' is distinct from 'hello@autofinder.com' then
    raise exception 'Only hello@autofinder.com is supported';
  end if;
  for v_field in select jsonb_object_keys(v_intake) loop
    if v_field not in ('mailbox','run_key','covered_from','covered_through','complete','message_count','customer_reply_count','pages','limitations','seen_messages') then
      raise exception 'Unsupported intake field: %',v_field;
    end if;
  end loop;
  if jsonb_typeof(v_intake->'complete') is distinct from 'boolean' then raise exception 'complete must be a boolean'; end if;
  if jsonb_typeof(p_input->'cases') is distinct from 'array' or jsonb_array_length(p_input->'cases') > 100 then raise exception 'cases must contain 0–100 concise findings'; end if;
  if exists (select 1 from jsonb_array_elements(p_input->'cases') c
      group by c->>'message_id',c->>'request_key' having count(*) > 1) then raise exception 'Duplicate case identity in this batch'; end if;
  if jsonb_typeof(v_intake->'seen_messages') is distinct from 'array' or jsonb_array_length(v_intake->'seen_messages') > 2000 then raise exception 'seen_messages must contain at most 2000 compact identities'; end if;
  if jsonb_typeof(v_intake->'limitations') is distinct from 'array' or jsonb_array_length(v_intake->'limitations') > 30 then raise exception 'limitations must be a bounded array'; end if;
  for v_seen in select value from jsonb_array_elements(v_intake->'limitations') loop
    if jsonb_typeof(v_seen) <> 'string' or char_length(v_seen #>> '{}') > 500 then raise exception 'Each limitation must be concise text'; end if;
  end loop;
  for v_seen in select value from jsonb_array_elements(v_intake->'seen_messages') loop
    if jsonb_typeof(v_seen) is distinct from 'object' or jsonb_typeof(v_seen->'message_id') is distinct from 'string'
      or jsonb_typeof(v_seen->'source_version') is distinct from 'string'
      or char_length(v_seen->>'message_id') not between 1 and 1024 or char_length(v_seen->>'source_version') not between 1 and 300
      or (v_seen - 'message_id' - 'source_version') <> '{}'::jsonb then raise exception 'Only compact message_id/source_version identities may be saved'; end if;
  end loop;
  for v_field in select unnest(array['message_count','customer_reply_count','pages']) loop
    if jsonb_typeof(v_intake->v_field) is distinct from 'number' or (v_intake->>v_field) !~ '^[0-9]+$' then raise exception 'Counts/pages must be nonnegative integers'; end if;
  end loop;
  if (v_intake->>'covered_through')::timestamptz > clock_timestamp() + interval '1 minute' then raise exception 'Coverage cannot extend into the future'; end if;
  if (v_intake->>'complete')::boolean then
    select max(covered_through) into v_checkpoint from public.email_review_intakes where user_id = p_user_id and complete;
    if (v_intake->>'covered_from')::timestamptz > coalesce(v_checkpoint,'2026-10-23T04:00:00Z'::timestamptz) then
      raise exception 'Complete coverage must catch up from the saved checkpoint (or October 23 baseline), not skip a gap';
    end if;
    if (select count(distinct s->>'message_id') from jsonb_array_elements(v_intake->'seen_messages') s) < (v_intake->>'message_count')::integer then raise exception 'Complete coverage requires identities for every reviewed message'; end if;
  end if;
  if exists (select 1 from public.email_review_intakes where user_id = p_user_id and run_key = v_intake->>'run_key') then
    raise exception 'This run_key is already saved; reuse its original dedupeKey';
  end if;
  select max(covered_through) into v_latest_read_end from public.email_review_intakes where user_id = p_user_id;
  for v_case in select value from jsonb_array_elements(p_input->'cases') loop
    if jsonb_typeof(v_case) is distinct from 'object' then raise exception 'Each case must be an object'; end if;
    for v_field in select jsonb_object_keys(v_case) loop
      if v_field not in ('message_id','request_key','source_version','source_url','received_at','category','customer_label','vehicle_context','request_summary','suggested_next_step') then
        raise exception 'Unsupported case field (agents cannot change handling decisions): %',v_field;
      end if;
      if jsonb_typeof(v_case->v_field) is distinct from 'string' then raise exception 'Case fields must be text'; end if;
    end loop;
    if (v_case->>'received_at')::timestamptz > (v_intake->>'covered_through')::timestamptz then raise exception 'Case is newer than fixed intake end'; end if;
    if not exists (select 1 from jsonb_array_elements(v_intake->'seen_messages') s
      where s->>'message_id' = v_case->>'message_id' and s->>'source_version' = v_case->>'source_version') then
      raise exception 'Each case version must appear in seen_messages';
    end if;
    select * into v_old from public.email_review_cases where user_id = p_user_id and mailbox = 'hello@autofinder.com'
      and message_id = v_case->>'message_id' and request_key = v_case->>'request_key' for update;
    if found and v_old.source_version = v_case->>'source_version' then continue; end if;
    -- A delayed older run may add missing history but cannot regress newer evidence.
    if v_old.id is not null and (v_intake->>'covered_through')::timestamptz < greatest(v_latest_read_end,v_old.source_observed_at) then continue; end if;
    if v_old.id is not null then v_before := v_before || jsonb_build_array(to_jsonb(v_old)); end if;
    insert into public.email_review_cases(user_id,message_id,request_key,source_version,source_url,received_at,source_observed_at,category,customer_label,vehicle_context,request_summary,suggested_next_step)
      values(p_user_id,v_case->>'message_id',v_case->>'request_key',v_case->>'source_version',v_case->>'source_url',(v_case->>'received_at')::timestamptz,(v_intake->>'covered_through')::timestamptz,
        v_case->>'category',v_case->>'customer_label',coalesce(v_case->>'vehicle_context',''),v_case->>'request_summary',coalesce(v_case->>'suggested_next_step',''))
      on conflict (user_id,mailbox,message_id,request_key) do update set
        source_version=excluded.source_version,source_url=excluded.source_url,received_at=excluded.received_at,source_observed_at=excluded.source_observed_at,category=excluded.category,
        customer_label=excluded.customer_label,vehicle_context=excluded.vehicle_context,request_summary=excluded.request_summary,
        suggested_next_step=excluded.suggested_next_step,updated_at=clock_timestamp()
      returning * into v_new;
    insert into public.email_review_events(user_id,case_id,kind,before,after)
      values(p_user_id,v_new.id,'source_update',case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
    v_after := v_after || jsonb_build_array(to_jsonb(v_new)); v_changed := v_changed+1;
  end loop;
  insert into public.email_review_intakes(user_id,run_key,covered_from,covered_through,complete,message_count,customer_reply_count,pages,limitations,seen_messages)
    values(p_user_id,v_intake->>'run_key',(v_intake->>'covered_from')::timestamptz,(v_intake->>'covered_through')::timestamptz,
      (v_intake->>'complete')::boolean,(v_intake->>'message_count')::integer,(v_intake->>'customer_reply_count')::integer,
      (v_intake->>'pages')::integer,v_intake->'limitations',v_intake->'seen_messages') returning * into v_receipt;
  insert into public.agent_actions(user_id,run_id,agent_connection_id,actor_name,kind,title,rationale,effects,target,before,after,category,status,dedupe_key)
    values(p_user_id,p_run_id,p_connection_id,p_actor_name,'email_review_intake','Saved email review intake',p_input->>'rationale',
      jsonb_build_array(v_changed||' customer case(s) updated','Mailbox read-only; no messages or tasks changed'),
      jsonb_build_object('type','email_review','id',v_receipt.id),jsonb_build_object('cases',v_before),
      jsonb_build_object('cases',v_after,'intake',to_jsonb(v_receipt)),'codex','applied',v_key) returning id into v_action_id;
  return jsonb_build_object('ok',true,'kind','email_review_intake','targetId',v_receipt.id,'actionId',v_action_id,'casesChanged',v_changed);
end;
$$;
revoke all on function public.apply_agent_email_review_intake(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_agent_email_review_intake(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.review_email_case(p_case_id uuid,p_expected_updated_at timestamptz,p_status text,p_decision_note text)
returns public.email_review_cases language plpgsql security definer set search_path = '' as $$
declare v_old public.email_review_cases%rowtype; v_new public.email_review_cases%rowtype;
begin
  if auth.uid() is null or nullif(auth.jwt()->>'client_id','') is not null then raise exception 'An owner session is required; agents cannot record handling decisions'; end if;
  if p_status is null or p_status not in ('needs_review','reviewed','handled','no_action') then raise exception 'Unsupported review status'; end if;
  if p_decision_note is null or char_length(p_decision_note) > 4000 then raise exception 'Decision note must be at most 4000 characters'; end if;
  if p_status in ('handled','no_action') and btrim(p_decision_note) = '' then raise exception 'Record what was handled or why no action is needed'; end if;
  select * into v_old from public.email_review_cases where id = p_case_id and user_id = auth.uid() for update;
  if not found then raise exception 'Case not found'; end if;
  if p_expected_updated_at is null or v_old.updated_at <> p_expected_updated_at then raise exception 'Case changed; refresh before saving your decision'; end if;
  update public.email_review_cases set review_status=p_status,decision_note=p_decision_note,
    reviewed_source_version=source_version,reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_old.id returning * into v_new;
  insert into public.email_review_events(user_id,case_id,kind,before,after) values(auth.uid(),v_old.id,'decision',to_jsonb(v_old),to_jsonb(v_new));
  return v_new;
end;
$$;
revoke all on function public.review_email_case(uuid,timestamptz,text,text) from public,anon,service_role;
grant execute on function public.review_email_case(uuid,timestamptz,text,text) to authenticated;
commit;
