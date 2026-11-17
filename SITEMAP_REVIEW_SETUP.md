# Sitemap Review

Local implementation on `feature/2026-11-17-sitemap-review`. Not committed,
pushed or deployed; GitHub issue creation is explicitly deferred by the owner.
Existing Email Review/WHOOP edits remain in the same working tree unchanged.

## Using the panel

Open **Sitemap review** from the main navigation (`/sitemap-review`). It shows
saved checks, exact additions/removals, the latest verified full URL set,
search across every saved URL, and complete Markdown exports. History filters
separate changes and incomplete checks. Provenance opens the owned source notes.

Refresh reloads saved notes; it does not run a crawler. Membership changes are
net differences between captures, not exact publication/deletion times,
page-health checks, traffic or customer impact. An initial baseline is not a
report of newly added URLs. Missing, conflicting, capped or unreadable evidence
never becomes a zero-change result. Failed refreshes retain prior saved evidence
with an explicit freshness warning.

## Storage and morning monitor

No migration, dependency, environment variable, new Edge Function or second
schedule is required. The existing daily 7:30 AM America/New_York monitor
`autofinder-sitemap-changes` remains responsible for complete public-sitemap
reads, catch-up, safe XML parsing, exhaustive reports and notification policy.
Its prompt now also requires compact panel records, including unchanged checks,
before advancing the complete checkpoint. Failed attempts have unknown diff
totals and cannot replace the last complete URL set.

Notes stay in the existing Work / Autofinder section. The November 16 original
baseline parts and master change log remain untouched. Two audited compact
records reference the genuine saved captures:

- Baseline: `186e74c3-3b67-47ef-a028-7728949a0b36`, captured November 16 at
  4:29:22 PM EST. Original four baseline parts total 2,536 URLs.
- Unchanged comparison: `e8e77161-2976-42f5-ba99-8ef45e5909de`, captured
  November 17 at 9:10:13 AM EST; 0 added / 0 removed.

Both were fully read back after audited save run
`05a2c398-9d57-48f6-8a1e-709062281285`. Their URL-set SHA-256 is
`0876b16fb31a73f5a71c0f4157daa688241fec1327073022750193ea46313435`.
Local monitor state retains note/action receipts. This is not a new capture or
a baseline reset, and establishes no history before November 16.

## Version 1 record contract

Titles start with `AutoFinder sitemap`. Content includes the exact marker
`<!-- autofinder-sitemap-review:v1 -->` on its own line immediately followed by
a fenced `json` block containing `SitemapRecord` from `src/lib/sitemapReview.ts`.
Use `formatSitemapRecord` rather than inventing another encoding. Required fields:

- `version: 1`, exact `sourceUrl`, stable per-capture `runId`, `kind`, `complete`.
- `checkedAtUtc`, `previousAtUtc`, `hash`, `previousHash`, `urlCount`,
  `previousUrlCount`, `addedCount`, `removedCount`.
- `partIndex`, `partCount`, exact `addedUrls`, `removedUrls`,
  `baselineNoteIds`, `limitations`, actual `httpStatus` or null.

Complete comparisons require HTTP 200 and coherent totals, all numbered parts,
the exact previous verified capture time/hash/count, disjoint exhaustive URL
lists, correct prior membership and resulting snapshot hash. Multipart metadata
is identical except part index and URL arrays. Preserve URL case, query,
percent escapes and trailing slash; hash UTF-8 sorted unique strings joined
with LF plus final LF. Missing/conflicting parts do not advance coverage.

A baseline has null previous/diff fields and references the original numbered
notes. Each original note has `Part N of M contains C URLs.`, a
`## Baseline URLs` section of individual `- URL` lines, and a
`## Verification receipt` with part/full URL-set SHA-256 values. Every referenced
part and the combined hash/count are verified; never duplicate the baseline as
additions. An incomplete `attempt` has `complete: false`, null diff totals and
empty diff arrays. Unknown results are not zero removals.

The owner-scoped store reads 200 notes per page with a 10,000-note cap and a
one-row sentinel. Capped history is visibly partial; no notes are deleted or
rewritten to work around it. The store clears on sign-out, rejects stale
in-flight account data, and refreshes after audited note creates/appends.

## Local validation and preview

Run `npm run test:sitemap-review`, `npm run test:plan`, `npm run lint` and
`npm run build`, plus existing connection/task/trash/workstream/calendar/
Email Review/WHOOP regressions. Model/store tests cover complete/unchanged/
failed/multipart checks, altered baseline parts, exact URL strings, unsafe URLs,
hash/count/membership conflicts, exhaustive exports, pagination/caps,
account-switch races and audit-sync retries.

Run `npm run dev -- --host 127.0.0.1 --port 5181` and open
`http://127.0.0.1:5181/sitemap-review-preview.html` for account-free fictional
fixtures. The preview is dev-only and not a production build entry. It does not
connect to Supabase or fetch AutoFinder. UI checks cover desktop, 390px/320px
layouts without horizontal overflow, light/dark, empty/error/incomplete states,
search past the first visual page and the full 2,536-fixture-URL export.
Authenticated hosted navigation was not tested or deployed in this task.

Security review is a feature-scoped baseline, not a penetration test or clean
bill of health for pre-existing changes: explicit owner filters, stale-request
invalidation, text-only React rendering, HTTP(S)-only credential-free links,
noopener/noreferrer, no raw HTML, no new credentials, provider calls or writes
from this panel. Existing production RLS remains required.

## Handoff

Review the additive integration in App, routes, core navigation, TopBar,
useCodexSync and its maintained day-plan test harness. New implementation is in
the SitemapReview page/view/store/model and focused test. Use a feature-only diff
against the starting dirty tree to distinguish this work from existing features;
do not blindly stage the entire tree. Deploy only when the owner requests it.
