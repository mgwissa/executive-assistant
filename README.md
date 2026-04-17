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
