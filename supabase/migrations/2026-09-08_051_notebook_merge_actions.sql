-- Allow the hosted agent bridge to consolidate one private owned notebook
-- into another while preserving all existing sections and notes.

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
    'notebook_merge',
    'brief_write'
  ));
