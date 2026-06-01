-- Optional labels on standalone tasks (filter on /tasks).

alter table public.tasks add column if not exists tags text[] not null default '{}';

comment on column public.tasks.tags is
  'Lowercase task labels for filtering on the Tasks page. Empty array when unset.';
