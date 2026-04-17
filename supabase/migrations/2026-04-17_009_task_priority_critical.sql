-- P0 / "critical" — above P1; manual or [P0] prefix only (no auto-escalation into this tier).

alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check
  check (priority in ('critical', 'urgent', 'high', 'normal', 'low'));
