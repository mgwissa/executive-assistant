-- Phase D: task time estimates for capacity planning.

alter table public.tasks add column if not exists estimated_minutes integer;

comment on column public.tasks.estimated_minutes is
  'Expected minutes to complete; null uses assistant default (30m) in capacity math.';

alter table public.tasks drop constraint if exists tasks_estimated_minutes_positive;
alter table public.tasks add constraint tasks_estimated_minutes_positive
  check (estimated_minutes is null or estimated_minutes > 0);
