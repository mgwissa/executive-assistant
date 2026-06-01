-- Assistant temperament for calendar events + title-based rules on profile.
alter table public.events
  add column if not exists prep_required boolean not null default true;

alter table public.events
  add column if not exists allow_back_to_back boolean not null default false;

alter table public.profiles
  add column if not exists meeting_rules jsonb not null default '[]'::jsonb;
