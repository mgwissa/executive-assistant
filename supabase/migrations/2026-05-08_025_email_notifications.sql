-- Adds opt-in email notification preferences and the plumbing to fire an
-- HTTP call to an Edge Function whenever a task transitions to `critical`.
--
-- The daily digest scheduler (pg_cron) and the secrets used by the trigger
-- live in Supabase Vault; setup steps live in README → "Email notifications".
-- This migration is safe to run before those steps; the trigger will just
-- no-op until vault secrets `project_url` and `cron_secret` exist.

-- ---------------------------------------------------------------------------
-- 1. Profile columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists notify_email_enabled boolean not null default false,
  add column if not exists notify_email_digest_enabled boolean not null default true,
  add column if not exists notify_email_digest_local_time time not null default '07:30:00',
  add column if not exists notify_email_escalation_enabled boolean not null default true,
  add column if not exists notify_email_last_digest_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Required extensions (idempotent; will fail silently if already on)
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
-- `supabase_vault` is preinstalled on Supabase projects.

-- ---------------------------------------------------------------------------
-- 3. Helper: read a vault secret without raising if missing.
-- ---------------------------------------------------------------------------

create or replace function public._vault_secret(p_name text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = p_name
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 4. Task-escalation trigger: POSTs to the Edge Function when priority
--    transitions from non-critical -> critical. No-ops when vault is empty.
-- ---------------------------------------------------------------------------

create or replace function public.notify_task_escalated_to_critical()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.priority is distinct from 'critical' then
    return new;
  end if;
  if old.priority is not distinct from new.priority then
    return new;
  end if;

  v_url := public._vault_secret('project_url');
  v_secret := public._vault_secret('cron_secret');
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/send-task-escalation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('task_id', new.id::text)
  );
  return new;
end;
$$;

drop trigger if exists tasks_notify_escalated_to_critical on public.tasks;
create trigger tasks_notify_escalated_to_critical
  after update of priority on public.tasks
  for each row
  when (new.priority = 'critical' and old.priority is distinct from new.priority)
  execute function public.notify_task_escalated_to_critical();

-- ---------------------------------------------------------------------------
-- 5. (Manual step, NOT run by this file)
--
-- After deploying the Edge Functions, run these once in the SQL editor to
-- enable the daily digest cron and to populate vault. Replace the URL and
-- generate a random secret with e.g. `openssl rand -hex 32`.
--
--   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR-LONG-RANDOM-STRING',             'cron_secret');
--
--   select cron.schedule(
--     'send-daily-digest',
--     '*/15 * * * *',
--     $cron$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
--              || '/functions/v1/send-daily-digest',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--       ),
--       body := '{}'::jsonb
--     );
--     $cron$
--   );
-- ---------------------------------------------------------------------------
