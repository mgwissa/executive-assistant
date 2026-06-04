-- Link notes to a specific calendar event occurrence (live meeting notes + debrief).

alter table public.notes
  add column if not exists linked_event_id uuid references public.events (id) on delete set null,
  add column if not exists linked_occurrence_start_at timestamptz;

create unique index if not exists notes_meeting_occurrence_uniq
  on public.notes (user_id, linked_event_id, linked_occurrence_start_at)
  where linked_event_id is not null and linked_occurrence_start_at is not null;

create index if not exists notes_linked_event_id_idx
  on public.notes (linked_event_id)
  where linked_event_id is not null;
