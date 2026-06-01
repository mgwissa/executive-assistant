-- Phase E (slice 1): user-taught focus stack for the executive assistant dashboard.

alter table public.profiles add column if not exists focus_queue jsonb;

comment on column public.profiles.focus_queue is
  'Executive focus stack: user ordering + per-day deferrals. Merged with directive priority on the dashboard.';
