# Codex bridge

The bridge is an explicit, audited connection from Codex desktop to this
workspace. It does not poll or call a model. Codex uses the local helper only
when the owner asks it to read or change workspace state.

## One-time setup

1. Apply `supabase/migrations/2026-08-13_043_codex_bridge_actions.sql`.
2. Set Supabase Function secrets `CODEX_BRIDGE_SECRET` (long random value) and
   `CODEX_USER_ID` (the owner's `auth.users.id`).
3. Deploy `codex-api`.
4. Copy `.env.codex-bridge.example` to `.env.codex-bridge` and put the same
   secret there. The real file is gitignored.

## Local helper

```powershell
node codex/bridge.mjs context
node codex/bridge.mjs search "refinement notes"
node codex/bridge.mjs request C:\path\to\request.json
```

Mutation request files use this shape:

```json
{
  "action": "mutate",
  "summary": "Updated the focus queue from our planning conversation.",
  "actions": [
    {
      "kind": "focus_reorder",
      "title": "Set today's focus",
      "rationale": "These are the three outcomes we agreed matter today.",
      "effects": ["Focus queue: 3 tasks"],
      "taskIds": ["uuid-1", "uuid-2", "uuid-3"]
    }
  ]
}
```

Supported mutations:

- `task_create`: `task` may contain title, deadline/review fields, description,
  waiting-on, estimate, tags, and linked event.
- `task_update`: `taskId` + a patch using those same fields.
- `task_complete`: `taskId`.
- `focus_reorder`: ordered `taskIds` (maximum six).
- `note_create`: `sectionId`, title, content, and optional meeting link fields.
- `brief_write`: `brief` with `kind` (`morning` or `evening`), `brief_date`,
  markdown `body`, and optional `stats`. Rewriting the same kind/date replaces
  the visible brief while preserving the previous row in the audit action.

Every mutation creates a manual `agent_runs` row and one reversible
`agent_actions` row per applied change. The endpoint cannot delete tasks or
change the legacy priority field.
