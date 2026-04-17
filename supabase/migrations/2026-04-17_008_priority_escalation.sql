-- 2026-04-17_008_priority_escalation.sql
-- Track when priority was set (cadence escalation) + JSON config on profile.

alter table public.tasks add column if not exists priority_set_at timestamptz;

update public.tasks
set priority_set_at = coalesce(updated_at, created_at)
where priority_set_at is null;

alter table public.tasks alter column priority_set_at set default now();
alter table public.tasks alter column priority_set_at set not null;

alter table public.profiles add column if not exists priority_escalation jsonb;
