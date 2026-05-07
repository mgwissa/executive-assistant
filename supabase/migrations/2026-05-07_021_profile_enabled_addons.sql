-- Optional features the user turns on in Profile; drives extra nav items and routes.
alter table public.profiles
  add column if not exists enabled_addons text[] not null default '{}';
