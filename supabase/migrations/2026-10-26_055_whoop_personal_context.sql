-- Private WHOOP data: no notebook sharing, general memory indexing or raw provider payloads.
begin;
create table if not exists public.whoop_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'disconnected' check (status in ('pending','connected','reconnect_required','disconnected')),
  generation uuid not null default gen_random_uuid(),
  granted_scopes text[] not null default '{}', connected_at timestamptz, revoked_at timestamptz,
  last_sync_at timestamptz, last_attempt_at timestamptz, last_error_code text, last_cycle_count integer,
  next_sync_at timestamptz, lease_token uuid, lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.whoop_credentials (
  user_id uuid primary key references public.whoop_connections(user_id) on delete cascade,
  encrypted_tokens text not null, updated_at timestamptz not null default now()
);
create table if not exists public.whoop_oauth_states (
  state_hash text primary key, user_id uuid not null unique references public.whoop_connections(user_id) on delete cascade,
  generation uuid not null, connection_ids uuid[] not null default '{}', expires_at timestamptz not null
);
create table if not exists public.whoop_cycle_summaries (
  user_id uuid not null references public.whoop_connections(user_id) on delete cascade,
  cycle_id bigint not null, cycle_start timestamptz not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'), synced_at timestamptz not null,
  primary key (user_id, cycle_id)
);
create table if not exists public.whoop_agent_access (
  user_id uuid not null references public.whoop_connections(user_id) on delete cascade,
  agent_connection_id uuid not null references public.agent_connections(id) on delete cascade,
  granted_at timestamptz not null default now(), primary key (user_id, agent_connection_id)
);
create table if not exists public.whoop_audit_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, created_at timestamptz not null default now()
);
create index if not exists whoop_cycles_owner_start on public.whoop_cycle_summaries(user_id, cycle_start desc);
create index if not exists whoop_sync_due on public.whoop_connections(next_sync_at) where status = 'connected';
do $$
declare t text;
begin
  foreach t in array array['whoop_connections','whoop_credentials','whoop_oauth_states','whoop_cycle_summaries','whoop_agent_access','whoop_audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    -- OAuth agents also have role=authenticated and the owner's auth.uid().
    -- A uid-only SELECT policy would bypass the per-agent health permission.
    -- ALL access therefore goes through verified owner UI or agent-specific RPCs.
    execute format('drop policy if exists whoop_owner_read on public.%I', t);
  end loop;
end $$;

-- All provider mutations + minimal private audit commit together. Service-only:
-- browser callers cannot choose a user, OAuth state, token, lease, or an agent grant.
create or replace function public.apply_whoop_action(p_user_id uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c public.whoop_connections%rowtype; s public.whoop_oauth_states%rowtype;
  ids uuid[]; g uuid; l uuid; encrypted text; result jsonb := '{"ok":true}';
  item jsonb; retry_seconds integer;
begin
  if p_action = 'consume_state' then
    if p_user_id is null then raise exception 'Owner is required'; end if;
    -- Lock connection before state, same order as disconnect/begin.
    select * into c from public.whoop_connections where user_id=p_user_id for update;
    delete from public.whoop_oauth_states where state_hash = p_payload->>'state_hash' and user_id=p_user_id returning * into s;
    if not found or s.expires_at <= now() then return '{"ok":false,"error":"invalid_state"}'; end if;
    if c.generation <> s.generation or c.status <> 'pending' then return '{"ok":false,"error":"invalid_state"}'; end if;
    insert into public.whoop_audit_events(user_id,kind) values(s.user_id,'oauth_callback_received');
    return jsonb_build_object('ok',true,'user_id',s.user_id,'generation',s.generation,'connection_ids',s.connection_ids);
  end if;
  if p_user_id is null then raise exception 'Owner is required'; end if;
  if p_action in ('begin','authorized','grants') then
    if jsonb_typeof(coalesce(p_payload->'connection_ids','[]')) <> 'array' then raise exception 'Invalid assistant selection'; end if;
    select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'connection_ids','[]'));
    if cardinality(ids) > 20 or exists (
      select 1 from unnest(ids) requested(connection_id) where not exists (select 1 from public.agent_connections a
      where a.id = requested.connection_id and a.user_id = p_user_id and a.revoked_at is null and a.auth_kind = 'oauth' and 'context:read' = any(a.scopes))
    ) then raise exception 'Assistant is not an active owned read connection'; end if;
  end if;
  if p_action = 'begin' then
    g := (p_payload->>'generation')::uuid;
    if g is null or length(p_payload->>'state_hash') not between 40 and 64 then raise exception 'Invalid authorization state'; end if;
    insert into public.whoop_connections(user_id,status,generation) values(p_user_id,'pending',g)
      on conflict(user_id) do update set status='pending',generation=g,revoked_at=null,lease_token=null,lease_until=null,updated_at=now();
    delete from public.whoop_oauth_states where user_id=p_user_id or expires_at <= now();
    insert into public.whoop_oauth_states values(p_payload->>'state_hash',p_user_id,g,ids,now()+interval '10 minutes');
  else
    select * into c from public.whoop_connections where user_id=p_user_id for update;
    if not found then return '{"ok":false,"error":"not_connected"}'; end if;
    if p_action = 'authorized' then
      g := (p_payload->>'generation')::uuid;
      if c.generation <> g or c.status <> 'pending' then return '{"ok":false,"error":"connection_changed"}'; end if;
      encrypted := p_payload->>'encrypted_tokens';
      if encrypted is null or length(encrypted) not between 30 and 16000 then raise exception 'Invalid sealed credentials'; end if;
      update public.whoop_connections set status='connected',connected_at=now(),revoked_at=null,
        granted_scopes=array['read:cycles','read:recovery','read:sleep','offline'],
        last_sync_at=null,last_attempt_at=null,last_error_code=null,last_cycle_count=null,next_sync_at=now(),lease_token=null,lease_until=null,updated_at=now() where user_id=p_user_id;
      insert into public.whoop_credentials values(p_user_id,encrypted,now()) on conflict(user_id) do update set encrypted_tokens=excluded.encrypted_tokens,updated_at=now();
      delete from public.whoop_cycle_summaries where user_id=p_user_id;
      delete from public.whoop_agent_access where user_id=p_user_id;
      insert into public.whoop_agent_access(user_id,agent_connection_id) select p_user_id,unnest(ids);
    elsif p_action = 'lease' then
      if c.status <> 'connected' or c.next_sync_at > now() or c.lease_until > now() then return '{"ok":false,"error":"deferred"}'; end if;
      l := (p_payload->>'lease_token')::uuid;
      if l is null then raise exception 'Lease is required'; end if;
      select encrypted_tokens into encrypted from public.whoop_credentials where user_id=p_user_id;
      if encrypted is null then return '{"ok":false,"error":"authorization_required"}'; end if;
      update public.whoop_connections set lease_token=l,lease_until=now()+interval '100 seconds',last_attempt_at=now(),updated_at=now() where user_id=p_user_id;
      result := jsonb_build_object('ok',true,'generation',c.generation,'encrypted_tokens',encrypted);
    elsif p_action in ('tokens','success','failure') then
      g := (p_payload->>'generation')::uuid; l := (p_payload->>'lease_token')::uuid;
      if c.status <> 'connected' or c.generation is distinct from g or c.lease_token is distinct from l or l is null or c.lease_until <= now() then
        return '{"ok":false,"error":"connection_changed"}';
      end if;
      if p_action = 'tokens' then
        encrypted := p_payload->>'encrypted_tokens';
        if encrypted is null or length(encrypted) not between 30 and 16000 then raise exception 'Invalid sealed credentials'; end if;
        update public.whoop_credentials set encrypted_tokens=encrypted,updated_at=now() where user_id=p_user_id;
      elsif p_action = 'success' then
        if jsonb_typeof(p_payload->'cycles') is distinct from 'array' or jsonb_array_length(p_payload->'cycles') > 200 then raise exception 'Invalid cycle collection'; end if;
        for item in select value from jsonb_array_elements(p_payload->'cycles') loop
          if jsonb_typeof(item) <> 'object' or (item - array['cycle_id','cycle_start','cycle_end','timezone_offset','recovery_state','recovery_score','recovery_calibrating','sleep_state','sleep_end','sleep_total_ms','sleep_performance_pct','strain_state','strain','source_updated_at']) <> '{}'::jsonb then
            raise exception 'Only normalized cycle summaries may be stored';
          end if;
          insert into public.whoop_cycle_summaries values(p_user_id,(item->>'cycle_id')::bigint,(item->>'cycle_start')::timestamptz,item,now())
            on conflict(user_id,cycle_id) do update set cycle_start=excluded.cycle_start,summary=excluded.summary,synced_at=now();
        end loop;
        delete from public.whoop_cycle_summaries where user_id=p_user_id and cycle_start < now()-interval '30 days';
        delete from public.whoop_audit_events where user_id=p_user_id and created_at < now()-interval '90 days';
        update public.whoop_connections set last_sync_at=now(),last_error_code=null,last_cycle_count=jsonb_array_length(p_payload->'cycles'),next_sync_at=now()+interval '5 minutes',lease_token=null,lease_until=null,updated_at=now() where user_id=p_user_id;
      else
        retry_seconds := greatest(30,coalesce((p_payload->>'retry_seconds')::integer,300));
        update public.whoop_connections set last_error_code=case when p_payload->>'error_code' in ('authorization_required','missing_scopes','rate_limited','provider_unavailable','invalid_provider_data','incomplete_pagination') then p_payload->>'error_code' else 'sync_failed' end,
          status=case when p_payload->>'error_code' in ('authorization_required','missing_scopes') then 'reconnect_required' else 'connected' end,
          next_sync_at=now()+make_interval(secs=>retry_seconds),lease_token=null,lease_until=null,updated_at=now() where user_id=p_user_id;
      end if;
    elsif p_action = 'grants' then
      if c.status <> 'connected' then return '{"ok":false,"error":"not_connected"}'; end if;
      delete from public.whoop_agent_access where user_id=p_user_id;
      insert into public.whoop_agent_access(user_id,agent_connection_id) select p_user_id,unnest(ids);
    elsif p_action = 'disconnect' then
      select encrypted_tokens into encrypted from public.whoop_credentials where user_id=p_user_id;
      update public.whoop_connections set status='disconnected',generation=gen_random_uuid(),revoked_at=now(),granted_scopes='{}',
        last_sync_at=null,last_attempt_at=null,last_error_code=null,last_cycle_count=null,next_sync_at=null,lease_token=null,lease_until=null,updated_at=now() where user_id=p_user_id;
      delete from public.whoop_credentials where user_id=p_user_id;
      delete from public.whoop_oauth_states where user_id=p_user_id;
      delete from public.whoop_cycle_summaries where user_id=p_user_id;
      delete from public.whoop_agent_access where user_id=p_user_id;
      result := jsonb_build_object('ok',true,'encrypted_tokens',encrypted);
    else raise exception 'Unsupported WHOOP action';
    end if;
  end if;
  insert into public.whoop_audit_events(user_id,kind) values(p_user_id,p_action);
  return result;
end $$;
revoke all on function public.apply_whoop_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_whoop_action(uuid,text,jsonb) to service_role;

-- Metadata-only discovery and the explicit personal-context read share one access check.
create or replace function public.read_whoop_personal_context(p_user_id uuid,p_connection_id uuid,p_metadata_only boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.whoop_connections%rowtype; rows jsonb;
begin
  if not exists(select 1 from public.agent_connections a join public.whoop_agent_access w on w.agent_connection_id=a.id and w.user_id=a.user_id
    where a.id=p_connection_id and a.user_id=p_user_id and a.revoked_at is null and a.auth_kind='oauth' and 'context:read'=any(a.scopes)) then
    return '{"available":false}';
  end if;
  select * into c from public.whoop_connections where user_id=p_user_id;
  if not found or c.status <> 'connected' then return '{"available":false}'; end if;
  if p_metadata_only then return '{"available":true,"readTool":"get_personal_context","sensitive":true}'; end if;
  select coalesce(jsonb_agg(summary order by cycle_start desc),'[]') into rows from
    (select summary,cycle_start from public.whoop_cycle_summaries where user_id=p_user_id and cycle_start >= now()-interval '30 days' order by cycle_start desc limit 14) q;
  return jsonb_build_object('available',true,'connection',jsonb_build_object('status',c.status,'connected_at',c.connected_at,
    'last_sync_at',c.last_sync_at,'last_attempt_at',c.last_attempt_at,'last_error_code',c.last_error_code,'last_cycle_count',c.last_cycle_count,'next_sync_at',c.next_sync_at),'cycles',rows);
end $$;
revoke all on function public.read_whoop_personal_context(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.read_whoop_personal_context(uuid,uuid,boolean) to service_role;

-- Retention runs even if authorization has expired or provider setup is missing.
create or replace function public.cleanup_whoop_storage()
returns void language sql security definer set search_path=pg_catalog,public as $$
  delete from public.whoop_cycle_summaries where cycle_start < now()-interval '30 days';
  delete from public.whoop_audit_events where created_at < now()-interval '90 days';
  delete from public.whoop_oauth_states where expires_at < now();
$$;
revoke all on function public.cleanup_whoop_storage() from public,anon,authenticated;
grant execute on function public.cleanup_whoop_storage() to service_role;
commit;
