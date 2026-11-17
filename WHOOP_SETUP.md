# WHOOP: private personal context

This feature is implemented locally; it is not connected to a WHOOP account until
the server is configured, deployed, and the owner completes WHOOP authorization.
No account registration, credentials, production migrations, or deployment is
performed by the source changes themselves.

## Keep the WHOOP app on Sandbox

The owner confirmed on October 30, 2026 that Sandbox is the intended tier.
Keep the existing WHOOP developer app there; do not request a higher tier as
part of activation. WHOOP currently permits up to 10 members on Sandbox, with
no approval request needed to build and test. This is a membership tier, not a
separate API hostname: keep the documented OAuth/API endpoints and use this
developer app's credentials. Sandbox still requires explicit owner consent and
returns private account data; it is not a mock-data mode.

Source: [WHOOP app approval and member tiers](https://developer.whoop.com/docs/developing/app-approval/).

## Activation receipt — October 30, 2026

- Hosted Supabase project `jfvwpxykktyehqeliwnx`: migrations 055 and 056 applied.
  All six WHOOP tables have RLS, no direct anonymous/authenticated SELECT, and
  service-only provider RPC access. Existing workspace tables were not changed.
- Required server secrets are present, including a newly generated encryption
  key; no secret values are recorded here. Existing Vault/function cron secrets
  were verified equal without exposing them.
- Active deployments: `whoop` v1, `codex-api` v32, and
  `executive-assistant-mcp` v26. Unauthenticated status, callback and scheduled-sync
  requests return 401. Allowed-origin preflight works; workspace/calendar context
  still succeeds and offers no WHOOP data without separate consent.
- `sync-whoop-personal-context` runs every 30 minutes. Existing
  `send-daily-digest` remains every 15 minutes, unchanged.
- Frontend release prepared at
  `C:/Users/wissam/Documents/Codex/releases/whoop-20261030-release-01/source`.
  It contains the committed baseline plus the explicit WHOOP file allowlist;
  the unrelated local “Today's focus” heading change is excluded. All 109 tests,
  TypeScript checking, and the frontend build pass for this release.
- Frontend published and promoted to `https://executive-assistant-chi.vercel.app`
  as deployment `dpl_DtLxdSwLTzoLS8YVYfkMVktNDVQk`. The live Profile page and
  expected JS asset return 200; WHOOP controls, the original heading, correct
  backend and WHOOP privacy text were verified. Server-secret names are absent
  from the frontend bundle. No Git commit or push was made.
- Vercel CLI 65.8.0 is installed globally and authenticated. The user-scoped
  `vercel@openai-curated` guidance plugin is installed. A single shared
  `https://mcp.vercel.com` entry is OAuth-authorized in Codex, with write approval
  required; its duplicate plugin-provided server is disabled. Existing MCP
  entries are preserved. Tool-level MCP verification awaits a session refresh.
- Browser verification reached the app's sign-in screen. Owner WHOOP consent,
  authenticated panel behavior and the first authenticated sync remain unverified;
  do not describe the WHOOP account as connected until those complete. Sign in,
  choose app-only or specific assistant access, then use Profile -> Connect WHOOP.

## One-time activation

1. In the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com/),
   use the existing Sandbox app for Executive Assistant (create one only on a
   first-time setup). Use the app's public privacy and terms
   pages. Enable only `read:cycles`, `read:recovery`, and `read:sleep`. The OAuth
   authorization flow also requests `offline` to obtain a refresh token.
   The exact production callback address for this Supabase project is:

   `https://executive-assistant-chi.vercel.app/profile?whoop=callback`

2. Set these **server-side Supabase Edge Function secrets**, using the secure
   dashboard/CLI. Do not put their values in Git, a `VITE_*` variable, notes,
   screenshots, or chat:

   - `WHOOP_CLIENT_ID`: developer app's client ID.
   - `WHOOP_CLIENT_SECRET`: developer app's client secret.
   - `WHOOP_TOKEN_ENCRYPTION_KEY`: base64-encoded 32 random bytes, kept stable.
     Generate it locally in a secure terminal with
     `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`.
     Losing/changing this key requires reconnecting WHOOP.
   - `APP_PUBLIC_URL`: `https://executive-assistant-chi.vercel.app`.
   - Existing `CRON_SECRET` must match Vault's `cron_secret` for background sync.
     Existing `project_url` Vault entry must be this Supabase project URL.
   - Optional local development only: `WHOOP_ALLOWED_ORIGINS`, a comma-separated
     explicit list such as `http://localhost:5173`. No wildcard origins.

3. Apply migrations **055 then 056** after existing migration 054. 056 installs
   its own `sync-whoop-personal-context` job every 30 minutes only when the existing
   `pg_cron`, `pg_net`, and Vault setup is present. It changes no existing jobs.
   If Vault is configured later, rerun 056. The job handles one due connection per
   invocation, oldest first, with a database lease and bounded provider reads.

   This repository's dated migration filenames are not recognized by the current
   Supabase CLI migration runner. An empty `supabase migration list` output is
   therefore not evidence that these schemas exist or that no setup remains.
   Check the actual schema first, then apply only the reviewed WHOOP files in
   order through the SQL Editor or `supabase db query --linked --file <path>`.
   Do not rename/replay the historical migration collection or use `db reset`.

4. Deploy `whoop`, `codex-api`, `executive-assistant-mcp`, and the frontend.
   `supabase/config.toml` disables gateway JWT verification for the cron request;
   the function verifies owner sessions, one-use state, or the cron secret itself.
   WHOOP returns its one-use code/state to Profile; the URL parameters are cleared
   immediately. Only the same verified EA owner session can complete the server-side
   exchange. A state from another EA account is rejected before any WHOOP request.
   Never deploy an unprotected replacement handler.

5. In **Profile → WHOOP**, select the specific approved assistant connection(s)
   that should receive personal context, then **Connect WHOOP**. Sign in and
   approve the requested scopes yourself. Select no agents for app-only access.
   Successful authorization starts an initial sync when you return to Profile;
   **Sync now** is also available. The Today panel displays the private snapshot.

6. Refresh MCP tool discovery. `get_workspace_context` exposes only an availability
   hint to permitted agents. `get_personal_context` reads the separately approved
   cached summary; no live sync or workspace mutation occurs. Existing unselected
   agents see no health data. Revoked workspace clients are always denied.

## Boundaries and behavior

- OAuth secrets and encrypted credentials are never returned to the browser or
  an agent. AES-256-GCM uses a fresh IV and binds each token set to its owner.
- All WHOOP tables have RLS enabled and direct `anon`/`authenticated` access
  revoked. A uid-only SELECT policy is deliberately NOT used: OAuth clients have
  the same uid and could bypass per-agent permission through direct REST.
- Provider management requires a verified owner session **without** `client_id`;
  agents can only use the cached read gated by an active owned connection and a
  separate `whoop_agent_access` row. Caller-supplied user IDs are ignored.
- State is random, hash-only, ten-minute, one-use, and bound to a connection
  generation. Disconnect/reconnect invalidates outstanding callbacks and syncs.
- Tokens rotate under one lease and are saved immediately after refresh, before
  reading data. A late result cannot revive a disconnected/replaced connection.
- Every page of all three v2 collections must complete before a snapshot commits.
  Failures retain previous readings, record an explicit error and defer retries.
  Rate limits preserve Retry-After; request time/page limits fail closed.
- Sleep joins the exact recovery sleep ID/cycle and excludes naps. Actual sleep
  duration sums sleep stages (not time in bed). Pending/unscorable/missing readings
  remain null; scored zero remains zero. Dates refer to WHOOP physiological cycles,
  not an invented calendar-day mapping. Current/ongoing strain is distinguished
  from the last completed cycle.
- Sync timestamps, source dates, calibration, and missing readings are explicit.
  A connection or a recent HTTP success is not proof that today's scores exist.
- Provider actions have a minimal private transactional audit, without tokens or
  health metrics. This is separate from the shared workspace action/undo log.
- Health context is not automatically copied to work briefs, notes, tasks, email,
  vector memory, or notebook sharing. The assistant is instructed to keep it in
  private planning conversation and ask how the owner actually feels. No medical
  or productivity verdict, automatic task ranking, or calendar mutation is added.

## Verification (isolated; no live account)

```
npm run test:whoop
npm run check:whoop-edge
npm run lint
npm run build
```

`test:whoop` exercises real SQL/RLS/RPCs in PGlite plus the actual HTTP service
with a mocked WHOOP transport: owner isolation, agent-specific permission, state
replay/expiry, token encryption/rotation, disconnect races, audit rollback,
pagination, rate-limit handling and retention of last-confirmed readings.

Official references: [API](https://developer.whoop.com/api/),
[OAuth](https://developer.whoop.com/docs/developing/oauth/),
[App setup](https://developer.whoop.com/docs/developing/getting-started/).
