-- Persist the review lifecycle for meeting notes separately from workstream
-- organization. NULL means the linked meeting note still needs triage.

alter table public.notes
  add column if not exists triaged_at timestamptz;

comment on column public.notes.triaged_at is
  'When the owner finished reviewing this meeting note for decisions, tasks, follow-ups, and durable context.';

create index if not exists notes_pending_meeting_triage_idx
  on public.notes (user_id, linked_occurrence_start_at desc)
  where linked_event_id is not null
    and linked_occurrence_start_at is not null
    and triaged_at is null;

alter table public.agent_actions
  drop constraint if exists agent_actions_kind_check;

alter table public.agent_actions
  add constraint agent_actions_kind_check check (kind in (
    'task_create',
    'task_update',
    'task_complete',
    'task_delete',
    'focus_reorder',
    'chase_logged',
    'memory_write',
    'note_create',
    'note_append',
    'note_triage',
    'brief_write'
  ));
