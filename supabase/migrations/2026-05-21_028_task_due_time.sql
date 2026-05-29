-- Optional due time, reminder dedupe (future email cron), and calendar event link.
alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists reminder_sent_at timestamptz;
alter table public.tasks
  add column if not exists linked_event_id uuid references public.events (id) on delete set null;

create index if not exists tasks_linked_event_id_idx
  on public.tasks (linked_event_id)
  where linked_event_id is not null;
