-- User-editable weekly routine template (defaults to built-in guide when null).

alter table public.profiles add column if not exists weekly_routine jsonb;

comment on column public.profiles.weekly_routine is
  'Custom weekly operating rhythm: days, time blocks, rituals, cadences, and reference lists. Null uses the built-in product-leader guide.';
