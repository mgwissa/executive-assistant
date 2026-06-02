-- In-app toasts + optional browser notifications for scheduled task due times.

alter table public.profiles
  add column if not exists notify_in_app_nudges_enabled boolean not null default true;

alter table public.profiles
  add column if not exists notify_browser_nudges_enabled boolean not null default false;
