# Agent Context — Executive Assistant / Notes App

> **Read this first — before doing anything in this repo.** Agents and humans alike: do not write code, run migrations, or commit until you have read this file. It is the single source of truth for what the project is, how it's organized, what conventions to follow, and the gotchas that have already bitten us.
>
> **This is a living document.** It does not need to be perfect — it needs to be *current*. **Before every commit**, review whether your change left this doc stale; if so, update it in the *same commit*. Every time you land a change that introduces a new route, table, store, external service, convention, or gotcha, append a line or two to the relevant section. Small, additive updates are better than waiting for the "right time" to rewrite. Future-you will thank you.

## Workflow (every task)

| When | What |
|------|------|
| **Before starting** | Read this file. If the task touches the data model, skim `supabase/migrations/` chronologically. |
| **While working** | Match patterns here; don't introduce new state libs, routing, or styling systems. |
| **Before committing** | Re-read this file. If anything you added/changed/learned isn't documented yet, append it now — **same commit**, not a follow-up. |

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
    TaskQuickAddForm.tsx  Shared task create form (Tasks, Dashboard, Assistant)
    ExecutiveCommandCenter.tsx  NOW / gaps / timeline UI when assistant addon is on
    notes/             Notes-editor-specific sub-pieces (toolbar, etc.)
    ui/                Generic primitives: Card, Badge, EmptyState, SectionHeader, ...
  hooks/               useNotebookRealtime
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
| `/dashboard` | `Dashboard` | Daily command center; **assistant** on → executive HUD + directive + action-items list (checkbox complete); **assistant** off → `CriticalBlocker` + action-items grid |
| `/notes` | `NotesView` (Sidebar + Editor) | Notebook→Section→Note hierarchy; live filter via `useNotesStore.query` |
| `/tasks` | `Tasks` | Standalone tasks + extracted action items from notes |
| `/owed` | `OwedToMePage` | Tasks with non-empty `waiting_on` |
| `/calendar` | `Calendar` | Today/Week view; sources: manual events + Outlook ICS |
| `/links` | `UsefulLinksPage` | User-curated bookmarks |
| `/profile` | `Profile` | Settings: name, timezone, addons, notifications, calendar URL |
| `/assistant` | `AssistantPage` | **Optional addon** — executive command center (NOW / gaps / timeline) + briefing depth |
| `/memory` | `MemoryPage` | **Optional addon** — RAG Q&A over notes, tasks, debriefs (OpenAI) |
| `/time` | `TimeTrackingPage` | **Optional addon** — timers, projects, day grouping |
| `/routine` | `WeeklyRoutinePage` | **Optional addon** — weekly product-leader rhythm |

Optional features are gated by `profile.enabled_addons` (`text[]`). See `src/lib/optionalFeatures.ts`. The route uses `<RequireOptionalFeature>` to redirect users who haven't enabled it.

## Data model (Postgres / Supabase)

All tables are RLS-protected; users only see their own rows except for **shared notebooks** (see below).

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | One row per auth user. Settings + notification prefs | `first_name`, `timezone`, `enabled_addons text[]`, `meeting_rules jsonb` (title-pattern assistant overrides), `weekly_routine jsonb` (custom template; null = built-in guide), `focus_queue jsonb` (focus stack order + `snoozedUntil` per ref), `outlook_ics_url`, `priority_escalation jsonb`, `notify_email_*`, `notify_email_reminder_enabled`, `notify_in_app_nudges_enabled`, `notify_browser_nudges_enabled`, `notify_email_address` (recipient override) |
| `notebooks` | Top-level grouping | `user_id`, `name`, `position` |
| `sections` | Inside a notebook | `notebook_id`, `name`, `position` |
| `notes` | Inside a section | `section_id`, `title`, `content` (markdown), `content_blocks jsonb` (BlockNote doc), `linked_event_id` + `linked_occurrence_start_at` (one note per meeting occurrence — banner Notes/Debrief panel) |
| `tasks` | Standalone tasks | `priority` (critical/urgent/high/normal/low), `due_date`, `due_time` (optional; requires `due_date`), `tags text[]` (filter on `/tasks`), `reminder_sent_at` (email dedupe; future cron), `linked_event_id` (FK → `events`), `waiting_on`, `chase_snoozed_until`, `last_chased_at`, `estimated_minutes`, `description`, `priority_set_at`, `reschedule_count`, `done` |
| `events` | Calendar entries | `source` ('manual' \| 'outlook_ics'), `start_at`, `end_at`, recurrence fields, `prep_required`, `allow_back_to_back`, `debrief_required` (assistant temperament; Outlook rows flags-only on edit) |
| `meeting_debrief_states` | Per-occurrence post-meeting debrief progress | `event_id`, `occurrence_start_at`, `status` ('done' \| 'skipped' \| 'snoozed'), `snoozed_until`, `notes` |
| `useful_links` | Bookmarks | `title`, `url`, `category` |
| `time_entries`, `time_projects` | Time tracking | day-grouped, project-tagged |
| `routine_item_states` | Weekly routine progress | `routine_date`, `item_id`, `status`, `template_version` (isolates progress when user saves a custom routine) |
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
| `useTasksStore` | tasks; `createTask(userId, title, options?)` accepts optional `priority` / `dueDate` / `dueTime` / `tags`; `setTags`; `setDueTime`, `setLinkedEvent`; `deleteTask` prompts via `window.confirm` (returns `boolean`); runs `applyDueDatePromotion` and `applyEscalationFromProfile` post-fetch |
| `useEventsStore` | events; range-based fetch via `eventsFetchIsoRange(timezone)` |
| `useMeetingDebriefStore` | per-occurrence debrief dismiss/snooze/done (`meeting_debrief_states`) |
| `useUsefulLinksStore` | links |
| `useTimeEntriesStore`, `useTimeProjectsStore` | time tracking |
| `useWeeklyRoutineStore` | routine item states |
| `useSharingStore` | notebook invites + members |
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
3. `compareDueTime` on the Tasks page when due dates tie — timed tasks first, earliest first (`src/lib/taskSchedule.ts`)
4. `updated_at` desc (recent first)

**Task schedule helpers:** `src/lib/taskSchedule.ts` — `normalizeDueTime` (Postgres `time` → `HH:MM`), `taskDueLabel`, `compareDueTime`. Clearing `due_date` also clears `due_time`, `linked_event_id`, and `reminder_sent_at`. **Due-time reminders:** `send-due-time-reminders` Edge Function (pg_cron every 5 min) emails when local time ≥ `due_time` on `due_date`; dedupes via `tasks.reminder_sent_at`. Toggle: `profiles.notify_email_reminder_enabled`.

**Quick add:** `TaskQuickAddForm` — title + priority + optional date/time + optional tags. Empty date → auto due-from-priority; explicit date/time passed to `createTask`. Used on `/tasks`, Dashboard action-items card, and Assistant page.

**Task tags:** `tasks.tags text[]` (lowercase, comma-separated input; spaces allowed within a tag — `lib/taskTags.ts`). Edit in `TaskDetailModal`; filter on `/tasks` with `TaskTagFilter` (note action items hidden while a tag filter is active).

**Executive directive** (`lib/executiveDirective.ts`, `ExecutiveCommandCenter.tsx`, `lib/meetingTemperament.ts`, `lib/meetingDebrief.ts`, `lib/meetingLifecycle.ts`, `lib/delegationChase.ts`, `lib/taskCapacity.ts`, `lib/focusQueue.ts`, `lib/decisionQueue.ts`, `lib/eveningCloseout.ts`, `ExecutiveFocusStack.tsx`, `ExecutiveDecisionQueue.tsx`, `ExecutiveEveningCloseout.tsx`, `MeetingDebriefModal.tsx`, `ScheduleFollowUpModal.tsx`, `EventLinkedTasks.tsx`, `ExecutiveDayHud.tsx`, `lib/dayHudMetrics.ts`): When `assistant` addon is on, `generateDirective()` produces `now`, `next`, `gaps`, `timeline`, and **`capacity`**. Workday ends **5pm** profile-local (`DAY_END_HOUR = 17`) for capacity, wind-down, and HUD copy. Gaps include prep, back-to-back, debrief, orphan follow-ups, delegation chase, **missing_estimate**, **capacity_overcommit**, overlaps, untimed work, etc. **Capacity (Phase D):** `tasks.estimated_minutes` drives timeline block sizing and HUD capacity bar; null falls back to 30m (`taskCapacity.DEFAULT_TASK_MINUTES`); set in `TaskDetailModal` or via gap quick-set. **Meeting lifecycle (Phase B):** 15-min suggested prep blocks on timeline; prep gaps with linked prep tasks; post-meeting debrief modal + states; schedule follow-up modal (linked tasks on events via `linked_event_id`; panel in `EventComposer`). **Delegation chase (Phase C slice 1):** `delegation_chase` gaps with mark received / chase again / snooze 7d / bump priority; HUD sidebar lists top stale owed items (`ExecutiveHudSidebar`). **Meeting temperament** per B0. **Dashboard HUD:** `computeDayHudMetrics()` reads `directive.capacity` → day score (0–100), capacity bar, workload/calendar stats; `ExecutiveDayHud` top strip. **`xl+` split layout:** NOW + gaps + **focus stack** left; Next/Rest + delegation chase + **decisions** + **evening close-out** right. Below `xl`, full stack includes sidebar cards. Max width `90rem` when assistant on.

**Assistant briefing** (`lib/assistantBriefing.ts`, `/assistant` tabs + digest email): **Stats** (counts), **Watch list** (blind spots EA is monitoring), **Decisions needed** (your call — commit, date, delegate, or drop; reschedule offenders, undated priorities, stale note items). Section id `decisions` in code; not “The Nudge”.

**Assistant roadmap (owner reprioritized 2026-05):** B0 temperament ✅ → B meeting lifecycle ✅ → C delegation (slice 1 ✅) → **D capacity** ✅ → **E focus stack** ✅ → **E decisions** ✅ (dashboard `ExecutiveDecisionQueue`) → **F evening close-out** ✅ (dashboard `ExecutiveEveningCloseout`, active after 5pm) → F capture → A proactive email **deferred** (owner keeps app open). Document shifts here when order changes.

## Notes editor

Two representations live in `notes`:
- `content_blocks jsonb` — canonical BlockNote document (source of truth when present)
- `content text` — markdown export of the same document (used for search and line-based task edits from Tasks/Dashboard)

Both are written together on each save by `NotesEditor`. The bridge lives in `src/lib/noteContentBridge.ts`. The `Sidebar` filters via `getNoteCanonicalMarkdown(note)` so search hits regardless of which field is populated.

Realtime echo: when the client writes its own update, `markNoteSelfPersisted` records the `updated_at` so the realtime subscription (`hooks/useNotebookRealtime`) doesn't bounce its own edit back into the editor.

## Email notifications

Detailed in README §5. Quick map:

- **Migration:** `2026-05-08_025_email_notifications.sql` adds prefs to `profiles`, defines the trigger, and enables `pg_net`/`pg_cron`. `2026-05-08_026_notification_recipient.sql` adds `notify_email_address` (override email).
- **Edge Functions:** `send-daily-digest` (cron-driven every 15 min, fans out to eligible users in their timezone, dedupes via `notify_email_last_digest_at`), `send-due-time-reminders` (cron every 5 min; `due_time` on `due_date` today, dedupes via `tasks.reminder_sent_at`), and `send-task-escalation` (DB-trigger-driven).
- **Auth between cron/trigger and functions:** shared `CRON_SECRET` passed as `x-cron-secret` header. The secret lives in **two places** that must stay in sync: Edge Function env (`supabase secrets set CRON_SECRET=…`) and Supabase Vault (`vault.create_secret(..., 'cron_secret')`).
- **Recipient resolution:** `profiles.notify_email_address` override > `auth.users.email`.

If you change anything related to notification auth, update *both* secret stores.

## In-app nudges

When the tab is open, scheduled tasks nudge you **inside the app** instead of (or in addition to) email:

- **Migration:** `2026-05-22_037_profiles_in_app_nudges.sql` — `profiles.notify_in_app_nudges_enabled` (default true), `notify_browser_nudges_enabled` (default false).
- **Polling:** `hooks/useWorkNudges.ts` runs in `WorkNudgeHost` (mounted from `App.tsx` `Shell`). Every 30s + on tab focus, finds open tasks with `due_date` = today (profile TZ) and `due_time` ≤ now.
- **Dedupe:** `sessionStorage` keys `work-nudge-shown:{taskId}:{date}` and `work-nudge-snooze:{taskId}` — independent of email `reminder_sent_at`.
- **UI:** `ToastHost` + `useToastStore`; Profile → **In-app nudges** for toggles. Browser `Notification` API when tab is hidden and permission granted.

## Working memory (LLM / RAG)

Optional addon `memory` — ask questions across indexed notes, open tasks, and meeting debrief notes:

- **Migration:** `2026-05-22_038_memory_chunks.sql` — `pgvector`, `memory_chunks`, `match_memory_chunks()`, `profiles.memory_last_synced_at`.
- **Edge Functions:** `memory-sync` (chunk + embed via OpenAI; full or per-source), `memory-ask` (vector search + `gpt-4o-mini` with citations). Requires `OPENAI_API_KEY` in Supabase secrets.
- **Route:** `/memory` (`MemoryPage`). Enable in Profile → Optional features.
- **Auto-index:** `lib/memorySyncScheduler.ts` debounces re-index after note/task/debrief saves when addon is on.
- **Chat history:** `lib/memoryChatStorage.ts` persists Memory Q&A in `localStorage` per user (survives route changes and browser restarts; cap 80 turns).
- **Phase 2 (not built yet):** meeting transcript uploads.
- **Gotcha:** read `OPENAI_API_KEY` via `Deno.env.get` at request time — caching it at module load returns empty and causes 503 even after `supabase secrets set`.
- **Gotcha:** Supabase Edge bundler can **BOOT_ERROR** on exotic TS in function params (e.g. conditional `Awaited<ReturnType<…>>` types). Use plain `SupabaseClient` like `sync-outlook-calendar`; inline CORS/auth instead of fragile shared modules.

## Optional addons

`profiles.enabled_addons text[]` gates these. Defaults to empty. UI lives in Profile; routes redirect when not enabled.

- `time` — TimeTrackingPage
- `routine` — WeeklyRoutinePage (editable weekly rhythm). Built-in guide in `lib/weeklyRoutineGuide.ts`; user overrides in `profiles.weekly_routine` via `lib/weeklyRoutineTemplate.ts`. Progress in `routine_item_states` keyed by `template_version`.
- `assistant` — AssistantPage + **Executive Command Center** on Dashboard when enabled. Pure-TS engines: `lib/executiveDirective.ts` (NOW / NEXT / GAPS / timeline) and `lib/meetingTemperament.ts` (per-event flags + profile `meeting_rules` title patterns). Dashboard shows directive above the shared **Action items** card (`DashboardActionItemsSection` — quick-add + checkbox complete); reference schedule/notes in collapsible panel.
- `memory` — MemoryPage (`/memory`). RAG over `memory_chunks` via `memory-sync` + `memory-ask` Edge Functions. OpenAI embeddings + chat; cited answers link back to notes/tasks/calendar.

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
- **Before every commit:** confirm `AGENTS.md` is current; include doc updates in the same commit when the change warrants it (see **Workflow** and **When you finish a task** above).

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
- **Gap “Set time” on note action items:** scheduling from `ExecutiveCommandCenter` must **update** an existing open task with the same title (`lib/taskActionMatch.ts`), not always `createTask`. Note checkboxes never get `due_time`, so untimed gaps persisted until refresh. **`/tasks` and Dashboard** must use `filterActionItemsDeduped()` — otherwise the same work shows twice (standalone task + note row with “Note” badge). Match titles via `displayText` / `normalizeTaskMatchKey` (incl. em/en dashes).
- **BlockNote checklist checkbox overlap:** `flex: 1` on `.bn-block-content > *:first-child` must **not** apply to `checkListItem` — the first child is the checkbox wrapper, not `.bn-inline-content`. BlockNote sets `.bn-inline-content { width: 100% }`, so the text column overlaps the checkbox and blocks clicks. Target `.bn-inline-content` for flex growth on checklist rows only (`notesEditor.css`).
- **BlockNote empty-block placeholders are a `::after`** on the `.bn-block-content` flex row. Since we set `flex: 1` on the first child (so the editable column fills), the placeholder gets pushed to the right edge of the row by default. Fix in `src/styles/notesEditor.css`: `position: absolute` the `::after` and pin it with `inset-inline-start`. List items need an offset (`28px`) to clear the bullet/checkbox; non-list blocks use `0`.
- **`deleteTask` confirmation lives in the store** — don't add per-page `window.confirm` calls; `deleteTask` returns `false` when the user cancels.
- **Notes perf:** never call `getNoteCanonicalMarkdown()` (runs `blocksToMarkdownLossy`) inside render loops — e.g. sidebar previews/search should use `note.content`. Editor `onChange` debounces markdown export (~300ms) before hitting Zustand; flush on unmount so note switches don't lose edits.
- **Outlook ICS duplicates:** published feeds often include a recurring **master** VEVENT plus **instance/exception** VEVENTs for the same slot. `sync-outlook-calendar` expands masters into one-off rows and used to insert both — dedupe by `start_at|title|duration` before insert; UI uses `dedupeOccurrences()` as a belt-and-suspenders until the user re-syncs.
- **Meeting temperament:** `profiles.meeting_rules` entries use `titlePattern` as a case-insensitive RegExp (invalid patterns fall back to substring match). Gap cards offer **this meeting only** (updates the calendar row) vs **Never prep/debrief for "{title}"** / **Allow back-to-back for "{title}"** (saves a literal-escaped title rule on the profile). Outlook-imported events (`source = outlook_ics`) can only edit assistant flags in the calendar composer — schedule fields stay read-only. Rules may set `prep_required`, `allow_back_to_back`, and/or `debrief_required`.
- **Debrief window:** post-meeting capture gaps fire for 15 minutes after `occurrence.end`; snooze stores `snoozed_until` (+24h) on `meeting_debrief_states` keyed by `(event_id, occurrence_start_at)`. Always compare occurrence keys via `occurrenceStartKey()` — Postgres/`timestamptz` may return `+00:00` while JS uses `Z`, so raw string equality breaks skip/snooze lookups.
- **Prep blocks:** meetings with `prep_required` get a 15-min suggested block on the timeline (`meetingLifecycle.PREP_BLOCK_MINUTES`) unless an open linked task exists; prep gaps suggest slot time at block start.
- **Linked tasks:** `tasks.linked_event_id` ties prep/follow-up tasks to calendar events; create via debrief modal, schedule follow-up modal, gap actions, or `EventLinkedTasks` in event edit.
- **Delegation chase:** idle days use `last_chased_at` when set, else `updated_at`; gaps fire at 5+ days (warning) / 14+ (critical). Snooze writes `chase_snoozed_until` (+7d). “Chase again” only updates `last_chased_at` so staleness resets without touching task content.
- **Task estimates:** `estimated_minutes` null → 30m default in capacity/timeline; explicit values size timed blocks and unscheduled work debt. Overcommit gap fires when planned work exceeds remaining time until 5pm by ≥30m.
- **Focus stack (Phase E slice 1):** `ExecutiveFocusStack` on the dashboard fills the gap below NOW/gaps. Merges `profiles.focus_queue` (user order + `snoozedUntil` hide-until dates) with `buildPrioritizedWork()` (critical/urgent/due-today). Reorder teaches priority; **pin to #1** (rank badge or pin control) or **Tomorrow** sets `due_date` to tomorrow, clears `due_time`, and snoozes the item off today's stack. Same **Tomorrow** action appears on `untimed_today` gaps in **I need from you**.
- **Decision queue (Phase E):** `ExecutiveDecisionQueue` / `DecisionInsightCard` (shared with `/assistant` Decisions tab) surfaces top `decisions` insights from `generateBriefing()`. Stale note action items get **one row each** (`actionTarget: { kind: 'action', noteId, line }`). **Do today** (primary) sets due today, pins to focus stack #1 (`commitRefToFocusToday`), clears snooze, bumps priority for reschedule offenders; works for tasks and note action lines via `lib/commitWorkToday.ts`.
- **Evening close-out (Phase F):** `ExecutiveEveningCloseout` activates when `directive.now.kind === 'wind_down'` (after 5pm). Shows done-today count, carry-forward list, tomorrow #1 from focus stack, and **Push rest to tomorrow** bulk action.
- **Executive directive clock:** `useDirectiveClock()` (60s) drives `generateDirective` / `generateBriefing` on Dashboard and `/assistant` — the NOW banner transitions at meeting end without manual refresh. Gap actions still bump `directiveRefresh` for instant post-mutation updates.
- **Meeting notes:** NOW banner **Notes** (in meeting) / **Debrief** (post-meeting) opens `MeetingNotesPanel` — slide-over BlockNote tied to `(linked_event_id, linked_occurrence_start_at)`. Debrief footer → `MeetingDebriefModal` for follow-up tasks; outcomes textarea pre-fills from the linked note.

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

1. **Read this file first** — before any code, exploration, or commits.
2. If your task touches the data model, also skim `supabase/migrations/` chronologically.
3. Match existing patterns — don't introduce new state libraries, styling systems, or routing patterns.
4. If you add or change a column, update `src/types/database.ts` in the same change.
5. After non-trivial edits, run `npm run lint` and check for type errors via `npm run build` if you touched cross-cutting types.
6. Don't commit unless explicitly asked. When asked, follow the conventional commit style in history.

## When you finish a task — update this doc (required before commit)

**Before staging or committing**, ask: *did anything I just did introduce something a future agent should know?* If yes, update `AGENTS.md` in the **same commit**. Do not push doc updates as a separate follow-up unless the user explicitly wants that split.

- **Added** a route, page, Zustand store, optional addon, Edge Function, cron job, DB trigger, or external service → document it in the relevant section.
- **Changed** a DB table or column → update both the migration list (implicit, by filename) and the `Data model` table here if a column matters for context.
- **Hit a gotcha** worth remembering (silent CSS no-op, a quirky API behavior, a shell footgun, a misleading error) → add a bullet to **Gotchas**.
- **Changed a convention** (naming, sort order, file layout, env/secret handling) → update **Conventions**.
- **Learned something** non-obvious this session that isn't already in here → write it down. One line is enough.

Append, don't rewrite. The doc accretes — keeping it imperfect-but-current is the goal.
