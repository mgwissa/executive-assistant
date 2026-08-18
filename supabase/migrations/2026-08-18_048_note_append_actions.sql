-- Allow connected agents to append approved context to an existing note.
-- The API preserves the previous note state in agent_actions so the append is
-- visible in Codex activity and can be undone.

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
    'brief_write'
  ));
