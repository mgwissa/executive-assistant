-- Independent WHOOP refresh; never changes the morning workspace/Teams schedules.
-- The job is installed only where the existing Supabase cron/Vault setup exists.
do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron')
     and exists(select 1 from pg_extension where extname='pg_net')
     and to_regprocedure('public._vault_secret(text)') is not null then
    if public._vault_secret('project_url') is not null and public._vault_secret('cron_secret') is not null then
      perform cron.schedule('sync-whoop-personal-context','*/30 * * * *',
        $job$select net.http_post(
          url := public._vault_secret('project_url') || '/functions/v1/whoop',
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',public._vault_secret('cron_secret')),
          body := '{"action":"scheduled_sync"}'::jsonb,
          timeout_milliseconds := 100000
        );$job$);
    end if;
  end if;
end $$;
