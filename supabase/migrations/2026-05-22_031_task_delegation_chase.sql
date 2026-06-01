-- Phase C: delegation chase — snooze gaps and track last ping without resetting task updated_at.

alter table public.tasks add column if not exists chase_snoozed_until timestamptz;
alter table public.tasks add column if not exists last_chased_at timestamptz;

comment on column public.tasks.chase_snoozed_until is
  'When set and in the future, assistant delegation-chase gaps are suppressed for this task.';
comment on column public.tasks.last_chased_at is
  'Last time you chased the counterparty; idle-day math uses this over updated_at when present.';
