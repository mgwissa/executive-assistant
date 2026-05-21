# Agent Context — Executive Assistant / Notes App

> **Read this first when starting work in this repo.** It is the single source of truth for what the project is, how it's organized, what conventions to follow, and the gotchas that have already bitten us.
>
> **This is a living document.** It does not need to be perfect — it needs to be *current*. Every time you (agent or human) land a change that introduces a new route, table, store, external service, convention, or gotcha, append a line or two to the relevant section in the same commit. Small, additive updates are better than waiting for the "right time" to rewrite. Future-you will thank you.

## What this app is

A single-user, self-hosted-feel **personal workspace** that started as a notes app and grew into a daily command center. The owner uses it as an "executive assistant" — daily briefing, task triage, calendar, owed-to-me tracking, weekly routine, and time tracking — backed entirely by Supabase. **Cost target: $0** (Supabase free tier + Resend free tier).

Production URL: `https://executive-assistant-chi.vercel.app/dashboard`

## Tech stack

- **React 19 + TypeScript + Vite** — frontend
- **Tailwind 3** with class-based dark mode (`darkMode: 'class'`)
- **Zustand 5** for state (one store per concern; no Redux)
- **React Router 7** for routing
- **Supabase** — Postgres, Auth, RLS, Edge Functions, `pg_cron`, `pg_net`, Vault
- **BlockNote (mantine)** — the notes editor (rich block-based; stores canonical JSON in `notes.content_blocks` plus exported markdown in `notes.content`)
- **Resend** — transactional email (daily digest + critical-task escalation)
- **date-fns / date-fns-tz** — date math, never roll our own
- **Vercel** — frontend hosting

## Top-level layout

```
.cursor/rules/         Cursor rules (project-context.mdc references this file)
public/                Static assets
src/
  App.tsx              Auth gate + route table + Shell layout
  main.tsx             Vite entry
  components/          UI components (one file per concern)
    notes/             Notes-editor-specific sub-pieces (toolbar, etc.)
    ui/                Generic primitives: Card, Badge, EmptyState, SectionHeader, ...
  hooks/               useCriticalOverload, useNotebookRealtime
  lib/                 Pure utilities, supabase client, business logic
  store/               Zustand stores (one file each)
  styles/              CSS (notesEditor.css for BlockNote overrides)
  types/               database.ts (generated/maintained) + index.ts (re-exports)
  editor-test/         Scratch fixtures (not shipped to users)
supabase/
  config.toml          Edge Function deploy config (verify_jwt = false where intentional)
  functions/           Deno Edge Functions
    _shared/           auth.ts (cron-secret check), resend.ts, datetime.ts
    send-daily-digest/
    send-task-escalation/
    sync-outlook-calendar/
  migrations/          Apply in filename order via SQL editor
README.md              Human setup guide (Resend, cron, secrets, etc.)
AGENTS.md              ← you are here
```

## Routes / views

Defined in `src/lib/routes.ts` (single source). All routes sit under a `<Shell>` that renders the persistent left rail (`SideNav`), `TopBar`, and `<Outlet>`.

| Path | View | Notes |
|------|------|-------|
| `/dashboard` | `Dashboard` | Daily command center (briefing + action items + schedule + recent notes) |
| `/notes` | `NotesView` (Sidebar + Editor) | Notebook→Section→Note hierarchy; live filter via `useNotesStore.query` |
| `/tasks` | `Tasks` | Standalone tasks + extracted action items from notes |
| `/owed` | `OwedToMePage` | Tasks with non-empty `waiting_on` |
| `/calendar` | `Calendar` | Today/Week view; sources: manual events + Outlook ICS |
| `/links` | `UsefulLinksPage` | User-curated bookmarks |
| `/profile` | `Profile` | Settings: name, timezone, addons, notifications, calendar URL |
| `/assistant` | `AssistantPage` | **Optional addon** — full daily briefing |
| `/time` | `TimeTrackingPage` | **Optional addon** — timers, projects, day grouping |
| `/routine` | `WeeklyRoutinePage` | **Optional addon** — weekly product-leader rhythm |

Optional features are gated by `profile.enabled_addons` (`text[]`). See `src/lib/optionalFeatures.ts`. The route uses `<RequireOptionalFeature>` to redirect users who haven't enabled it.

## Data model (Postgres / Supabase)

All tables are RLS-protected; users only see their own rows except for **shared notebooks** (see below).

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | One row per auth user. Settings + notification prefs | `first_name`, `timezone`, `enabled_addons text[]`, `outlook_ics_url`, `priority_escalation jsonb`, `notify_email_*`, `notify_email_address` (recipient override) |
| `notebooks` | Top-level grouping | `user_id`, `name`, `position` |
| `sections` | Inside a notebook | `notebook_id`, `name`, `position` |
| `notes` | Inside a section | `section_id`, `title`, `content` (markdown), `content_blocks jsonb` (BlockNote doc) |
| `tasks` | Standalone tasks | `priority` (critical/urgent/high/normal/low), `due_date`, `waiting_on`, `description`, `priority_set_at`, `reschedule_count`, `done` |
| `events` | Calendar entries | `source` ('manual' \| 'outlook_ics'), `start_at`, `end_at`, recurrence fields |
| `useful_links` | Bookmarks | `title`, `url`, `category` |
| `time_entries`, `time_projects` | Time tracking | day-grouped, project-tagged |
| `routine_item_states` | Weekly routine progress | `routine_date`, `item_id`, `status` |
| `notebook_members`, `notebook_invites` | Notebook sharing | shared notebooks expose notes to other auth users via RLS |

### Notebook sharing (briefly)

- A notebook owner generates an invite token (`notebook_invites`).
- Recipient hits a deep link with `?invite=…` → `App.tsx` captures it, stores in `sessionStorage` if logged out, consumes after sign-in via `useSharingStore.acceptInvite`.
- RLS policies on `notebooks/sections/notes` check `notebook_members` so members see the data.

## State (Zustand stores)

Conventions:
- Each store exports a `use<Name>Store` hook and a small surface of state + actions.
- Most stores do **optimistic mutations** (update local state synchronously, then persist; revert on error).
- Network writes that fire on every keystroke (note content, task description) are **debounced** (~500 ms) inside the store action.
- On sign-out, every store has a `clear()` action that `Shell` invokes in a single effect.

| Store | Owns |
|-------|------|
| `useAuthStore` | session, user, sign-in/out, password reset |
| `useProfileStore` | profile row; `updateProfile(userId, patch)` |
| `useNotebooksStore` | notebooks + sections + member counts + `activeNotebookId` |
| `useNotesStore` | notes + `activeId` + free-text `query` (consumed only by notes Sidebar) |
| `useTasksStore` | tasks; also runs `applyDueDatePromotion` and `applyEscalationFromProfile` post-fetch |
| `useEventsStore` | events; range-based fetch via `eventsFetchIsoRange(timezone)` |
| `useUsefulLinksStore` | links |
| `useTimeEntriesStore`, `useTimeProjectsStore` | time tracking |
| `useWeeklyRoutineStore` | routine item states |
| `useSharingStore` | notebook invites + members |
| `useEmergencyStore` | manual override of the "Critical overload" emergency mode |
| `useShellLayoutStore` | mobile nav drawer + notes-sidebar collapsed flag |
| `useThemeStore` | light/dark/system |

## Priority system (tasks + action items)

Five levels stored as enum-ish strings: `critical | urgent | high | normal | low` (`src/lib/priority.ts`).

Public-facing names are **calmer** than the storage values: `Critical / Important / Active / Routine / Later`. Use `PRIORITY_PILL` for UI labels.

Legacy notation in notes still parsed: `[P0]`–`[P4]` (and `(P2)`) before the title of a checkbox.

**Auto-promotion / escalation:**

- When a task's `due_date` is today or past, it is **locked to `critical`** until the due date is pushed forward (`isPriorityLocked`).
- Profile field `priority_escalation jsonb` configures bump cadences per level (e.g. "if a `high` task sits N days, bump to `urgent`"). `applyEscalationFromProfile` runs on every store fetch.
- A DB trigger `tasks_notify_escalated_to_critical` fires when `priority` transitions to `critical` and calls the `send-task-escalation` Edge Function via `net.http_post`.

**Sort order everywhere** (tasks list, dashboard, owed-to-me):
1. `priorityRank` (critical first)
2. `compareDueDate` (earliest first, nulls last)
3. `updated_at` desc (recent first)

## Notes editor

Two representations live in `notes`:
- `content_blocks jsonb` — canonical BlockNote document (source of truth when present)
- `content text` — markdown export of the same document (used for search and line-based task edits from Tasks/Dashboard)

Both are written together on each save by `NotesEditor`. The bridge lives in `src/lib/noteContentBridge.ts`. The `Sidebar` filters via `getNoteCanonicalMarkdown(note)` so search hits regardless of which field is populated.

Realtime echo: when the client writes its own update, `markNoteSelfPersisted` records the `updated_at` so the realtime subscription (`hooks/useNotebookRealtime`) doesn't bounce its own edit back into the editor.

## Email notifications

Detailed in README §5. Quick map:

- **Migration:** `2026-05-08_025_email_notifications.sql` adds prefs to `profiles`, defines the trigger, and enables `pg_net`/`pg_cron`. `2026-05-08_026_notification_recipient.sql` adds `notify_email_address` (override email).
- **Edge Functions:** `send-daily-digest` (cron-driven every 15 min, fans out to eligible users in their timezone, dedupes via `notify_email_last_digest_at`) and `send-task-escalation` (DB-trigger-driven).
- **Auth between cron/trigger and functions:** shared `CRON_SECRET` passed as `x-cron-secret` header. The secret lives in **two places** that must stay in sync: Edge Function env (`supabase secrets set CRON_SECRET=…`) and Supabase Vault (`vault.create_secret(..., 'cron_secret')`).
- **Recipient resolution:** `profiles.notify_email_address` override > `auth.users.email`.

If you change anything related to notification auth, update *both* secret stores.

## Optional addons

`profiles.enabled_addons text[]` gates these. Defaults to empty. UI lives in Profile; routes redirect when not enabled.

- `time` — TimeTrackingPage
- `routine` — WeeklyRoutinePage (weekly product-leader rhythm; `lib/weeklyRoutine.ts` defines the static plan)
- `assistant` — AssistantPage (full briefing) and the dashboard card

## Conventions

### TypeScript
- DB row types come from `src/types/database.ts`; re-export friendly aliases in `src/types/index.ts`. **Update `database.ts` whenever a migration changes a table.**
- No `any`. Prefer `unknown` and narrow.
- Prefer pure functions in `lib/`; keep components small.

### Styling
- Tailwind classes only. No CSS modules except `notesEditor.css` (BlockNote overrides) and `index.css` tokens.
- Dark mode is `class`-based (`<html class="dark">`). Always provide a `dark:` variant for backgrounds, borders, and accent text.
- Color tokens: `surface / surface-raised / surface-sunken / border / border-strong / text / text-muted / text-subtle / brand-50…brand-950`. **Use these, not raw hex / Tailwind defaults.**
- `brand-950` (`#1e1b4b`) is defined in `tailwind.config.cjs`. Don't reference shades that aren't in the palette.

### Components
- Functional components only. Hooks for state.
- Keep new "feature pages" inside `src/components/` and add the route to `src/App.tsx` + `src/lib/routes.ts`.
- Generic, reusable primitives go in `src/components/ui/`.

### Migrations
- Filename pattern: `YYYY-MM-DD_NNN_short_name.sql`. Always idempotent (`if not exists`, `create or replace`).
- After running a migration in the Supabase SQL Editor, **also commit the file** so others can apply it locally.
- If adding new columns, update `src/types/database.ts` in the **same commit**.

### Git
- Branch `main`, push directly (single-developer). PRs only when asked.
- Commit subject style observed in history: `feat: …`, `fix: …`, `fix(scope): …`, lowercase, imperative.

### Editor / IDE
- Owner is on **Windows + PowerShell**. Bash-isms (`&&` chaining, heredocs, `$(cat <<EOF…)`) break the shell. Use `;` for chaining or split commands. For multi-line strings prefer `Write` tool over inline heredocs.

## Gotchas (already learned)

- **`auth.uid()` is NULL in the Supabase SQL Editor** (it runs as superuser). Filter by an explicit `user_id` when testing queries that reference RLS-sensitive policies.
- **`pg_net` schema:** call `net.http_post`, **not** `extensions.http_post`. We had a trigger bug from this once.
- **`brand-950` was missing from Tailwind** until 2026-05-21; every `dark:*-brand-950/*` class was a silent no-op. It is now defined — keep it that way.
- **BlockNote stacks padding** on `.bn-editor` (`padding-inline: 54px` baked in). If the editor "doesn't reach 100% width", check both the outer wrapper padding (`Editor.tsx`) **and** the BlockNote default.
- **Resend sandbox** (`onboarding@resend.dev`) only delivers to the address you signed up with. Verify a domain to send elsewhere.
- **CRON_SECRET sync** — when rotating, update Supabase Function secrets *and* Vault. If they diverge, the digest invocations 401.
- **Optimistic IDs** start with `tmp-…`. Stores skip Supabase writes for those rows.
- **Realtime echo loop:** writes go through `markNoteSelfPersisted`; don't bypass it.
- **Mobile single-pane in `/notes`:** the sidebar and editor swap based on `activeId` below the `md` breakpoint. Layout changes need to account for both.
- **Single child of a flex container needs `flex-1` (or `w-full`)** to fill its parent — a flex item defaults to `flex: 0 1 auto`, so it sizes to content. We hit this on `<Editor>` inside `<main>` of `NotesView`: a fresh empty note collapsed to placeholder width because the outer Editor div lacked grow. Add `flex-1 w-full` (or restructure the parent) whenever a single child should fill a flex parent.
- **Never walk milliseconds to find a date boundary.** `timeTrackingCharts.startOfZonedDayUtc` originally walked back `t -= 1` until the day flipped — that's ~25M `formatInTimeZone` calls per invocation and locked the browser tab when clicking "Custom" in the time-tracking chart. Use `date-fns-tz`'s `fromZonedTime('yyyy-MM-ddT00:00:00', tz)` (O(1)). Same lesson applies anywhere you need start-of-day in a non-UTC zone.
- **BlockNote empty-block placeholders are a `::after`** on the `.bn-block-content` flex row. Since we set `flex: 1` on the first child (so the editable column fills), the placeholder gets pushed to the right edge of the row by default. Fix in `src/styles/notesEditor.css`: `position: absolute` the `::after` and pin it with `inset-inline-start`. List items need an offset (`28px`) to clear the bullet/checkbox; non-list blocks use `0`.
- **Notes perf:** never call `getNoteCanonicalMarkdown()` (runs `blocksToMarkdownLossy`) inside render loops — e.g. sidebar previews/search should use `note.content`. Editor `onChange` debounces markdown export (~300ms) before hitting Zustand; flush on unmount so note switches don't lose edits.

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | ESLint |
| `npm run preview` | Preview prod build |
| `supabase functions deploy <name>` | Deploy a single Edge Function |
| `supabase secrets set KEY=value` | Set a function secret |

## CI

`.github/workflows/` contains a workflow that auto-deploys Edge Functions on push to `main` (manual trigger also available).

## When you (the agent) start working

1. **Read this file.** If your task touches the data model, also skim `supabase/migrations/` chronologically.
2. Match existing patterns — don't introduce new state libraries, styling systems, or routing patterns.
3. If you add or change a column, update `src/types/database.ts` in the same change.
4. After non-trivial edits, run `npm run lint` and check for type errors via `npm run build` if you touched cross-cutting types.
5. Don't commit unless explicitly asked. When asked, follow the conventional commit style in history.

## When you finish a task — update this doc

Before handing the work back, ask yourself: *did anything I just did introduce something a future agent should know?* If yes, add it now while it's fresh. Triggers:

- **Added** a route, page, Zustand store, optional addon, Edge Function, cron job, DB trigger, or external service → document it in the relevant section.
- **Changed** a DB table or column → update both the migration list (implicit, by filename) and the `Data model` table here if a column matters for context.
- **Hit a gotcha** worth remembering (silent CSS no-op, a quirky API behavior, a shell footgun, a misleading error) → add a bullet to **Gotchas**.
- **Changed a convention** (naming, sort order, file layout, env/secret handling) → update **Conventions**.
- **Learned something** non-obvious this session that isn't already in here → write it down. One line is enough.

Append, don't rewrite. The doc accretes — keeping it imperfect-but-current is the goal.
