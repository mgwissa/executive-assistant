-- 2026-04-17_007_task_priority.sql
-- Priority for standalone todos (aligns with [P1]–[P4] in note action items).

alter table public.tasks add column if not exists priority text not null default 'normal';

alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check
  check (priority in ('urgent', 'high', 'normal', 'low'));
