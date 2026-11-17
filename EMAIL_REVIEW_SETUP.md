# Email review - implementation / activation checklist

Owner-approved November 12: a dedicated **Email review** screen, not another
ever-growing note. Route `/email-review` is core navigation. This implementation
does not connect to Outlook, send email, create drafts, change mailbox state,
perform suppression, create leads, or turn requests into tasks.

## Stored records

- `email_review_cases`: one concise customer request per owner + mailbox + exact
  message identity + stable request key. Multiple genuine intents in one message
  remain separate cases; cases are not a count of email messages.
- `email_review_intakes`: immutable source-coverage receipts and compact seen
  message/version keys. The checkpoint is the greatest `covered_through` of a
  **complete, successfully saved** intake. Partial receipts never advance it.
- `email_review_events`: append-only source and owner-decision history. Incoming
  evidence updates never overwrite `review_status`, `decision_note`, or the
  reviewed source version. New versions require attention even for closed cases.

Only `hello@autofinder.com` is accepted. Keep minimum useful customer/vehicle
context, a concise request, suggested human next step, exact Outlook read link,
received timestamp, and a source version/fingerprint. No raw email bodies,
quoted marketing, attachments, tracking/action links, credentials or secrets.
Existing notes and historical receipts are untouched. No historical cases have
been imported or retrospectively marked handled by this source change.

## Security and audit

- Authenticated owner UI reads only owned rows. OAuth agent JWTs cannot use
  owner REST access or owner decision RPCs merely because they share a uid.
- `review_email_case` is owner-session-only and conflict-checks the exact
  PostgREST `updated_at` string. “Handled” / “No action” require a decision note;
  these are the owner's reports, not autonomous mailbox actions.
- MCP `email_review_intake` requires an active owned write connection/run.
  Cases, history, receipt and `agent_actions` entry commit atomically. Audit or
  history failure rolls everything back. A stable dedupe key reuses a saved
  result after interruption. Older delayed snapshots cannot regress evidence.
- Activity explicitly refuses automatic intake Undo: it cannot undo a customer
  action. Correct/review the case while retaining source/decision history.
- The UI has no composer or task-creation action. Source links are restricted to
  read-message routes on Outlook's office.com / office365.com hosts.

## Activation checklist

Steps 1-2 were deployed on November 12; see the production receipt below.
Local regression/preview checks cover step 3, but authenticated production owner
interaction and a real intake/decision have not yet been exercised. Steps 4-5
remain pending and were not authorized by deploying the screen alone.

1. Review and apply **only** migration `2026-11-12_057_email_review.sql` after the
   existing schema (through 056). Do not replay old migrations or reset data.
2. Deploy frontend, `codex-api`, and `executive-assistant-mcp` together, preserving
   unrelated unpublished checkout changes. Refresh MCP tool discovery.
3. Verify authenticated owner reads, scope-gated `get_email_review_context`,
   audited intake receipts, manual decision conflicts and sign-out clearing.
4. Only after Mike approves activating the destination change, update the
   existing morning automation to save structured cases instead of appending
   new findings into the full running note. Keep its schedule, mailbox-only
   source scope, hard no-send boundary, recording policies and focus rules.
   The running note remains historical reference, not a failed/deleted intake.
5. Carry the pending November 12 note-save findings/receipts forward; do not
   silently discard or mark them saved. Read actual source text before saving
   new/changed evidence. Do not import an AI summary as original source proof.

## Intake contract

`get_email_review_context({offset})` returns 50 cases with `hasMore/nextOffset`,
the latest intake attempt and last complete intake. Read every page and preserve
human decisions. This reads saved evidence, **not Outlook**. Provider mailbox
reads remain the separately authorized Outlook shared-mailbox tools.

Use `apply_workspace_actions` with one `email_review_intake` action containing
`dedupeKey`, `intake`, and `cases`. The MCP schema describes every field. Each
case version must appear in `intake.seen_messages`. Duplicate identities within
one batch are refused. Same-version overlap reuses the existing case unchanged.

Source processing still uses a fixed UTC end, a minimum 24-hour overlap and at
least a seven-day rolling lookback, following every source continuation. First
complete coverage in the new ledger must start no later than
`2026-10-23T04:00:00Z`; do not invent a bootstrap checkpoint from the unsaved
October 30 sample. For larger intake, save bounded **partial** batches (up to
100 cases, API request under 200 KB), then record complete coverage only after
all source pages and findings have actually been saved. Every receipt is
independently audited. Never advance a checkpoint on a capped/failed read.

Use only actual customer intent: opt-out/contact preferences, no-longer-shopping,
vehicle corrections, buying questions, data corrections, product/data-quality
feedback and reported purchase success. No-longer-shopping is not automatically
a global unsubscribe. Absence of visible teammate correspondence means handling
is unverified, not unanswered or resolved.

## Verification

`npm run test:email-review` runs actual PostgreSQL migration/RPC tests in isolated
PGlite, never production. Also run lint, build, existing task/Trash/workstream/
calendar/day-plan/connection tests, and the Edge type check. Local preview:
`npm run dev -- --host 127.0.0.1 --port 5178`, then
`http://127.0.0.1:5178/email-review-preview.html`.
The preview imports only the presentation layer and fictional in-memory data;
it has no auth/store/provider client and is excluded from the default build.

### Local verification receipt — November 12

- 102 core/Email Review regression tests plus 20 WHOOP isolation regressions
  passed (122 total). Lint, production build, and `check:email-review-edge` passed.
- Browser-verified fictional fixture: desktop 1280px and mobile 390px/default
  narrow viewport, dark/light, search, partial coverage, load failure, empty
  state, saving a review, and retaining saved decisions/unsaved drafts after a
  new source version. Mobile had no horizontal overflow. Temporary viewport
  overrides were reset and the preview tab retained.
- Browser screenshot export was denied by that tool's filesystem sandbox; no
  screenshot file was created. The interactive local preview remains available.
- No migration, deployment, commit, push, live intake, notebook rewrite, email
  action or automation update was performed. Unrelated existing WHOOP and
  heading changes in the working tree were preserved.

### Production activation receipt - November 12

- Live route: https://executive-assistant-chi.vercel.app/email-review
- Supabase project `jfvwpxykktyehqeliwnx`: only migration
  `2026-11-12_057_email_review.sql` applied. All three new tables have RLS;
  owner/service RPC grants were inspected. Cases and intakes were both empty
  after activation. No source findings were invented/imported or marked handled.
- Edge deployments: `codex-api` v33 and `executive-assistant-mcp` v27, active
  November 12 at 19:16:33 UTC. No other function was redeployed or pruned;
  WHOOP remains at its existing version.
- Vercel production deployment `dpl_GWoPJqnHyRe7Zb1NtigqNAsA4GVm` is Ready and
  aliased to the canonical app domain. Rollback baseline:
  `dpl_DtLxdSwLTzoLS8YVYfkMVktNDVQk` (October 30).
- Isolated source release:
  `C:/Users/wissam/Documents/Codex/releases/email-review-20261112-release-01/source`.
  The 24-file allowlist/manifest preserves the previously deployed WHOOP feature
  and excludes unrelated unpublished heading/Profile/Today edits. No commit or
  push was made. Existing production environment values were not printed/pulled.
- The isolated release passed all 122 regression tests, lint, production build
  and the Email Review Edge type check. Post-deploy HTTP verification at
  `2026-11-12T19:27:00.050Z` returned 200 for the route and production bundle;
  the real project's public publishable-key configuration returned 200 from
  read-only Auth settings. Email API and MCP requests without credentials both
  returned 401. An authenticated workspace-context read exposed the new ledger
  discovery hint, and existing audited task creation still succeeded.
- Verification receipt:
  `C:/Users/wissam/Documents/Codex/releases/email-review-20261112-release-01/production-verification-final-02.json`.
  Earlier diagnostic receipts are retained: their failed checks incorrectly
  treated the intentional placeholder fallback literal / publishable-key format
  as missing configuration. The final check validates the actual public client
  key against the real backend; no production-code fix or secret change was needed.
- No live intake or owner review decision was performed. No morning automation,
  mailbox, note history, pending November 12 note-save findings or checkpoint was
  changed. The screen is deployed, not a claim that the mailbox is up to date.
