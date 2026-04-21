-- Free-form notes/description on tasks.
alter table public.tasks add column if not exists description text not null default '';
