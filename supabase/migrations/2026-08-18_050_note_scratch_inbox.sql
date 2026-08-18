-- Notes 2.0 scratch lifecycle. Scratch notes keep their physical library
-- location while staying out of durable workstream/library views until promoted.

alter table public.notes
  add column if not exists scratch_at timestamptz;

comment on column public.notes.scratch_at is
  'When the note was placed in the Scratch inbox. NULL means it is durable library context.';

create index if not exists notes_scratch_inbox_idx
  on public.notes (user_id, scratch_at desc)
  where scratch_at is not null;

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
    'note_scratch',
    'brief_write'
  ));
