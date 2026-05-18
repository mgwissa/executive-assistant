# Notes

A tiny, fast, personal notes app built as the foundation of your daily workspace. Markdown + search + dark mode + cloud sync via Supabase. Designed to grow: start with notes, then layer in PM tools, templates, and AI as needed.

## Stack

- **React 19 + TypeScript + Vite** – fast dev loop
- **Tailwind CSS** – class-based dark mode
- **Supabase** – auth + Postgres (with Row-Level Security)
- **Zustand** – lightweight state
- **@uiw/react-md-editor** – markdown editing w/ live preview

## Features (v1)

- Email/password auth
- Sidebar with live search + New Note button
- Markdown editor with live preview
- Auto-save (debounced)
- Dark / light mode (with system preference detection)
- Per-user notes isolated via Postgres RLS

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query** and run the migration files in order:
   - `supabase/migrations/2026-04-17_001_notes.sql`
   - `supabase/migrations/2026-04-17_002_profiles.sql`
   - `supabase/migrations/2026-04-17_003_tasks.sql`
   - `supabase/migrations/2026-04-17_004_events.sql`
   - `supabase/migrations/2026-04-17_005_outlook_ics_sync.sql`
   - `supabase/migrations/2026-04-17_006_profiles_timezone_if_missing.sql` (idempotent; fixes missing `profiles.timezone` if earlier migrations were skipped)
   - `supabase/migrations/2026-04-17_007_task_priority.sql` (todo `priority`: urgent / high / normal / low)
   - `supabase/migrations/2026-04-17_008_priority_escalation.sql` (`tasks.priority_set_at`, `profiles.priority_escalation` JSON for auto bump cadence)
   - `supabase/migrations/2026-04-17_009_task_priority_critical.sql` (optional `critical` / P0 priority above P1)
3. In **Project Settings → API**, grab your **Project URL** and **anon public key**.
4. Copy `.env.example` to `.env.local` and fill in:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> By default Supabase requires email confirmation on sign-up. For faster local testing, go to **Authentication → Providers → Email** and turn off **Confirm email**.

### 3. Run the app

```bash
npm run dev
```

Open <http://localhost:5173>, sign up, and start writing.

### 4. (Optional) Outlook published calendar → app

1. In Outlook on the web, publish your calendar and copy the **ICS** URL (the one ending in `calendar.ics`), not the HTML link.
2. After running migration `2026-04-17_005_outlook_ics_sync.sql`, open **Profile** in the app, paste the URL under **Outlook calendar**, click **Save URL**, then **Sync now**.
3. Deploy the Edge Function so the server can fetch the ICS feed (avoids browser CORS):

```bash
# From the repo root, with Supabase CLI linked to your project
supabase link --project-ref <your-project-ref>
supabase functions deploy sync-outlook-calendar
```

`supabase/config.toml` sets **`verify_jwt = false`** for this function. That is intentional: if your project uses **ECC / ES256** JWT signing keys, the Edge Functions **gateway** can respond with `UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM` / “Unsupported JWT algorithm ES256” **before your code runs**. This app’s function still checks the caller by calling **`auth.getUser()`** with the `Authorization` header, so only valid sessions can sync.

If you deploy from the Dashboard only, run the CLI command above once so hosted Supabase picks up `verify_jwt = false`, or pass **`--no-verify-jwt`** on deploy. Pure Dashboard edits do not read this repo’s `config.toml`.

On hosted Supabase, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available to the function automatically. The function only accepts ICS URLs from known Microsoft hosts (`outlook.office365.com`, `outlook.live.com`, etc.).

Each sync replaces previously imported rows (`events.source = 'outlook_ics'`) and leaves events you created in the app (`source = 'manual'`) untouched. The function only **stores occurrences for the current calendar week** (Monday 00:00 through Sunday, in your profile timezone), so regular Monday syncs stay small and fast.

The **Calendar** page and client fetch use the same Monday–Sunday window.

### 5. (Optional) Email notifications

Opt-in email notifications: a daily digest (critical / due today / overdue tasks, waiting-on items, today's events) and an instant alert when a task escalates to Critical. Free, using [Resend](https://resend.com) for sending.

**Cost**: $0 for personal use. Resend's free tier is 100 emails/day, 3,000/month.

**One-time setup**:

1. **Run the migration** `supabase/migrations/2026-05-08_025_email_notifications.sql`. This adds the notification preference columns to `profiles` and installs a DB trigger that fires when a task becomes Critical. It will no-op until you finish the setup below.

2. **Sign up at [resend.com](https://resend.com)** (free, no credit card). Create an API key from **API Keys → Create**.

   For first deploys you can send from `onboarding@resend.dev`, but Resend's sandbox only delivers to the email address you signed up with. To send to anyone else, add and verify a domain under **Domains** and use something like `notifications@your-domain.com`.

3. **Generate a `CRON_SECRET`** (random string used to authenticate calls from pg_cron / DB triggers to the Edge Functions):

   ```bash
   openssl rand -hex 32
   ```

4. **Set Edge Function secrets** so the functions can authenticate to Resend and verify internal calls:

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
   supabase secrets set RESEND_FROM_EMAIL="Notes <notifications@your-domain.com>"
   supabase secrets set CRON_SECRET=<the random string from step 3>
   ```

5. **Deploy the Edge Functions**:

   ```bash
   supabase functions deploy send-daily-digest
   supabase functions deploy send-task-escalation
   ```

   Both deploy with `verify_jwt = false` (see `supabase/config.toml`). They reject any call that doesn't carry the matching `x-cron-secret` header.

6. **Store the same `CRON_SECRET` in Supabase Vault** so pg_cron and the DB trigger can attach it on their calls. Run this in **SQL Editor**, replacing the values:

   ```sql
   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
   select vault.create_secret('YOUR-CRON-SECRET-FROM-STEP-3',          'cron_secret');
   ```

7. **Schedule the daily digest cron** (also in SQL Editor):

   ```sql
   select cron.schedule(
     'send-daily-digest',
     '*/15 * * * *',
     $cron$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
              || '/functions/v1/send-daily-digest',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       ),
       body := '{}'::jsonb
     );
     $cron$
   );
   ```

   The function runs every 15 minutes, picks up users whose local time has reached their configured digest time, and dedupes per-day using `profiles.notify_email_last_digest_at`.

8. **Turn it on in the app**: open **Profile → Email notifications**, flip the master switch, set your preferred digest time, and save. Defaults: digest ON, escalation alerts ON, time `07:30` local.

**Verifying it works**:

- Test the escalation path by editing any open task and setting its due date to today (the auto-promotion trigger fires `priority → critical`, which fires the DB trigger, which calls the Edge Function).
- For the digest, you can force-trigger it from the SQL editor (it will send if "now" in your tz is past your digest time and you haven't received one yet today):

  ```sql
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  ```

  Logs are visible under **Edge Functions → send-daily-digest → Invocations**.

## Scripts

| Command         | What it does                    |
| --------------- | ------------------------------- |
| `npm run dev`   | Start the Vite dev server       |
| `npm run build` | Type-check + build for prod     |
| `npm run preview` | Preview the production build  |
| `npm run lint`  | Run ESLint                      |

## Roadmap ideas

Small, optional steps you can take as needs emerge:

- **Tags / notebooks** – add a `tags text[]` column, filter in sidebar
- **Templates** – seed new notes with boilerplate (PRD, meeting notes, retro)
- **Action items** – detect `- [ ] …` checkboxes and roll up into a tasks view
- **Quick capture** – global keyboard shortcut to open a scratch note
- **AI** – "Summarize this note" / "Draft follow-ups" via OpenAI (server-side)
- **Integrations** – Jira/Linear/Slack import + embed
- **Daily notes** – auto-create a note titled with today's date

## Project layout

```
src/
  components/     UI (Auth, Sidebar, Editor, SearchBar, ThemeToggle, icons)
  store/          Zustand stores (auth, notes, theme)
  lib/            supabase client, formatters
  types/          Shared TS types
  App.tsx         Top-level router (auth gate)
  main.tsx        Vite entry
supabase/
  migrations/     Apply in order in the SQL editor
  schema.sql      Snapshot (legacy; prefer migrations)
```
