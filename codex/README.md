# Hosted agent connection

The app exposes a hosted, per-user MCP server. Codex connects to the deployed
Supabase endpoint with OAuth; users do not clone this repository, run a local
bridge, or copy long-lived API tokens.

## Project setup

1. Apply migrations through `2026-09-08_052_workstream_actions.sql`.
2. In Supabase Dashboard, open **Authentication -> OAuth Server**:
   - enable the OAuth server;
   - set the authorization path to `/oauth/consent`;
   - enable dynamic client registration for MCP clients.
3. Confirm the Auth site URL points to the deployed web app and that
   `/oauth/consent` is handled by the SPA host.
4. Set the MCP function's canonical public resource and deploy the functions:

   ```bash
   supabase secrets set MCP_PUBLIC_URL=https://executive-assistant-chi.vercel.app/mcp
   supabase functions deploy agent-connections
   supabase functions deploy codex-api
   supabase functions deploy executive-assistant-mcp
   ```
5. Deploy the Vercel app. Its `/mcp` rewrite proxies the Edge Function without
   exposing the project-specific Supabase function URL as the plugin identity.

Use an asymmetric JWT signing key for the Supabase project. The MCP endpoint
validates every access token with Supabase Auth and requires the OAuth
`client_id` to match an explicitly approved, non-revoked connection owned by
that user.

## User setup

1. In ChatGPT/Codex developer mode, add
   `https://executive-assistant-chi.vercel.app/mcp` as a Streamable HTTP MCP
   server using OAuth.
2. Save the server and restart the ChatGPT desktop app or Codex extension.
3. Select **Authenticate**, sign into the app, verify the client identity and
   redirect destination, review the requested capabilities, and approve access.
4. Open **Profile -> Agent connections** in the deployed app whenever you want
   to review or revoke approved clients.

The Profile page lists approved clients and can revoke them. Revocation first
blocks the client in the app's own connection table and then revokes the
Supabase OAuth grant.

## Exposed tools

- `get_workspace_context`: reads the schedule, open/recent work, focus queue,
  note index and linked excerpts, briefings, and recent audited activity.
- `search_notes`: performs a bounded search when the normal context does not
  contain enough detail.
- `apply_workspace_actions`: creates/updates/completes tasks, reorders the focus
  queue, creates notes, appends explicitly approved context to existing notes,
  marks meeting notes triaged or reopened, moves ordinary notes into or out of
  the Scratch inbox, merges one private owned notebook into another, creates
  workstreams, assigns/unassigns individual note links, and writes
  briefings through the existing audited mutation engine.

Every mutation creates an `agent_runs` row and an `agent_actions` row per
applied change. Ordinary edits remain reversible. `notebook_merge` is the narrow
exception: it preserves every section and note in the destination before it
removes the empty private source notebook, but the source container is not
automatically recreated by Undo. The endpoint cannot delete tasks, change legacy
priority, or arbitrarily rewrite existing BlockNote documents. A `note_append` action
accepts `noteId` and `content`; content may use headings, paragraphs, bullets,
and numbered items. It preserves existing blocks and refuses concurrent edits.
The workspace context exposes `meetingNotesNeedingTriage`. After the user and
agent have captured any decisions, tasks, follow-ups, and durable context, a
`note_triage` action with `noteId` and `triaged: true` clears that note from the
Meeting inbox; `triaged: false` reopens it.
The context also exposes `scratchNotes`. A `note_scratch` action with `noteId`
and `scratch: true` moves an ordinary note into the cleanup inbox without
changing its notebook or section; `scratch: false` promotes it back into the
durable library. Meeting notes continue to use their separate triage lifecycle.
For explicitly approved consolidation, `notebook_merge` requires exact
`sourceNotebookId` and `destinationNotebookId` values returned by context. Both
must be private notebooks owned by the authenticated user; shared notebooks and
notebooks with active invites are refused.

### Workstream actions

Use `workstream_create` with `workstream: {name, description?}`. Names are trimmed
and must be 1–100 characters. An existing case-insensitive name returns its
`targetId` with `skipped: "unchanged"`; it does not rename or edit that workstream.
Use that returned ID in a **subsequent** request:

```json
{
  "kind": "note_workstream",
  "noteId": "<owned note ID from context>",
  "workstreamId": "<existing or newly returned workstream ID>",
  "assigned": true,
  "dedupeKey": "<stable key for this agreed change>"
}
```

`assigned: false` removes only this link. This is a state-setting action, never a
toggle or replacement of all memberships. It does not change note text, blocks,
notebook/section, Scratch, or meeting triage. Foreign notes/workstreams are refused.
No-ops do not create audit actions. A repeated dedupe key returns the original
action/target IDs without reapplying it, even if the action was subsequently undone.

Migration 052 adds service-only `apply_agent_workstream_action` and signed-in,
owner-only `undo_agent_workstream_action`. Data and audit writes are transactional.
Undo requires membership to still match the recorded resulting state; creation
can only be undone while the workstream is unchanged and has no linked notes.
Undo never deletes notes or other workstream memberships. Membership undo is a
current-state check, not a history of intervening manual edits.

Deploy migration 052 **before** `codex-api` and `executive-assistant-mcp`, then the
web app for activity labels, Undo, and automatic workstream-store refresh. Existing
OAuth connections continue to work; refresh the client's tool definitions if it
still shows the older action instructions.

Run `npm run test:workstreams` (Node 22.13+) to exercise the actual migrations in
isolated PostgreSQL via PGlite, including ownership, no-ops, audit rollback, and Undo.

This integration does not poll and does not call a model. The connected MCP
client decides when to read context or request an agreed workspace change.

## Reusable plugin package

`plugins/executive-assistant` is the publishable ChatGPT/Codex plugin. It binds
the hosted MCP server to the `refresh-morning-workspace` skill so the same
morning-planning behavior is available to every authorized user without a repo
clone or local files.

For pre-publication testing, enable ChatGPT developer mode, add the public
`/mcp` endpoint, and complete OAuth with a test account. Before directory
submission, verify the deployed privacy and terms pages, then place the token
generated by the submission flow at
`public/.well-known/openai-apps-challenge` and redeploy. Each user installs the
approved plugin and grants access to only their own workspace.

## Morning refresh automation

After installing and authenticating the plugin in ChatGPT web, create a weekday
7:30 AM scheduled task that uses the bundled `refresh-morning-workspace` skill.
The web task runs in OpenAI's cloud when the user's computer is off. Keep the
desktop automation only as a fallback; it requires the local computer and Codex
app to be available.

The automation should read `get_workspace_context`, use `search_notes` only when
the normal snapshot points to a specific context gap, and then make one audited
`apply_workspace_actions` request that:

- writes or replaces the current local date's morning briefing;
- refreshes the focus queue with at most five ranked outcomes;
- includes a concise reason and concrete next action for every focus item;
- respects real deadlines, arrived review dates, and genuinely external
  `waiting_on` ownership; and
- does not create or complete tasks unless the available evidence is explicit.

The run should finish with a short conversational summary of what changed and
which uncertainties, if any, need the owner's input. Reruns are safe because the
briefing store is keyed by user, kind, and date, while focus reordering replaces
the current plan and every mutation is audited.
