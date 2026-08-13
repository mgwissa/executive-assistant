-- Extend the existing audited action log for safe Codex-created notes.

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
    'note_create'
  ));

