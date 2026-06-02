-- Due-time reminder emails: opt-in flag on profiles.
-- Cron + Edge Function setup documented in README §5 (send-due-time-reminders).

alter table public.profiles
  add column if not exists notify_email_reminder_enabled boolean not null default true;

-- Manual cron (after deploying send-due-time-reminders Edge Function):
--
--   select cron.schedule(
--     'send-due-time-reminders',
--     '*/5 * * * *',
--     $cron$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
--              || '/functions/v1/send-due-time-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--       ),
--       body := '{}'::jsonb
--     );
--     $cron$
--   );
