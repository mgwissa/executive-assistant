# Hosted agent connection

The app exposes a hosted, per-user MCP server. Codex connects to the deployed
Supabase endpoint with OAuth; users do not clone this repository, run a local
bridge, or copy long-lived API tokens.

## Project setup

1. Apply migrations through `2026-08-17_046_oauth_agent_connections.sql`.
2. In Supabase Dashboard, open **Authentication -> OAuth Server**:
   - enable the OAuth server;
   - set the authorization path to `/oauth/consent`;
   - enable dynamic client registration for MCP clients.
3. Confirm the Auth site URL points to the deployed web app and that
   `/oauth/consent` is handled by the SPA host.
4. Deploy `agent-connections`, `codex-api`, and
   `executive-assistant-mcp`.

Use an asymmetric JWT signing key for the Supabase project. The MCP endpoint
validates every access token with Supabase Auth and requires the OAuth
`client_id` to match an explicitly approved, non-revoked connection owned by
that user.

## User setup

1. Open **Profile -> Agent connections** in the deployed app.
2. Copy the MCP address.
3. In Codex, add it as a Streamable HTTP MCP server using OAuth.
4. Save the server and restart the ChatGPT desktop app or Codex extension.
5. Select **Authenticate**, sign into the app, verify the client identity and
   redirect destination, review the requested capabilities, and approve access.

The Profile page lists approved clients and can revoke them. Revocation first
blocks the client in the app's own connection table and then revokes the
Supabase OAuth grant.

## Exposed tools

- `get_workspace_context`: reads the schedule, open/recent work, focus queue,
  note index and linked excerpts, briefings, and recent audited activity.
- `search_notes`: performs a bounded search when the normal context does not
  contain enough detail.
- `apply_workspace_actions`: creates/updates/completes tasks, reorders the focus
  queue, creates notes, and writes briefings through the existing audited
  mutation engine.

Every mutation creates an `agent_runs` row and a reversible `agent_actions` row
per applied change. The endpoint cannot delete tasks, change legacy priority,
or arbitrarily rewrite existing BlockNote documents.

This integration does not poll and does not call a model. The connected MCP
client decides when to read context or request an agreed workspace change.
