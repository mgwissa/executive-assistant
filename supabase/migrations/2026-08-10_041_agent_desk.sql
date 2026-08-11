-- Agent Desk: Claude as a first-class contributor to this workspace.
--
-- Model: a scheduled agent session polls on the owner's cadence, reads a
-- context snapshot, and acts directly on the workspace -- creating tasks,
-- adjusting priorities, reordering focus, logging chases. There is no approval
-- gate. Trust comes from the audit trail instead: every single write records
-- what it touched, why, and the exact prior state, so anything can be undone.
--
-- Two things make this safe rather than reckless:
--   1. `agent_actions.before` holds the pre-change value of every field the
--      agent touched. Undo is a literal write-back, not a guess.
--   2. Agent sessions are ephemeral and start with no memory, so `agent_memory`
--      is the only continuity between runs -- including corrections the owner
--      makes, which is how the agent stops repeating a mistake.

-- ---------------------------------------------------------------------------
-- Runs: one row per polling invocation. Groups the log into readable chunks.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'adhoc'
    check (kind in ('morning_brief', 'midday_triage', 'evening_closeout', 'chase_sweep', 'adhoc')),
  status text not null default 'running'
    check (status in ('running', 'ok', 'error')),
  trigger_source text not null default 'scheduled'
    check (trigger_source in ('scheduled', 'manual')),
  -- One or two sentences: what the agent did this run, in plain language.
  summary text,
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_user_started_idx
  on public.agent_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Actions: the audit trail. One row per write the agent made.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,

  kind text not null check (kind in (
    'task_create',
    'task_update',
    'task_complete',
    'task_delete',
    'focus_reorder',
    'chase_logged',
    'memory_write'
  )),

  -- What the owner reads in the log.
  title text not null,
  rationale text,
  -- Plain-language change lines, e.g. ["Priority: Active -> Important"].
  -- Rendered as-is so the log never has to understand every payload shape.
  effects jsonb not null default '[]'::jsonb,

  -- What was touched: { "type": "task", "id": "..." } etc.
  target jsonb not null default '{}'::jsonb,

  -- The undo contract. `before` is the prior value of every field written.
  -- null `before` means the row did not exist (undo = delete).
  before jsonb,
  after jsonb,

  category text not null default 'general',

  status text not null default 'applied'
    check (status in ('applied', 'undone', 'failed')),

  apply_error text,
  undo_error text,

  -- Stops the agent redoing the same thing every run. Varies with a time
  -- bucket when an action should be allowed to recur (e.g. a weekly chase).
  dedupe_key text,

  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create index if not exists agent_actions_user_created_idx
  on public.agent_actions (user_id, created_at desc);

create index if not exists agent_actions_run_idx
  on public.agent_actions (run_id);

create unique index if not exists agent_actions_dedupe_idx
  on public.agent_actions (user_id, dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- Memory: the agent's only continuity between ephemeral runs.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'observation'
    check (kind in ('preference', 'pattern', 'fact', 'observation', 'correction')),
  -- Stable slug so a repeated learning updates instead of duplicating.
  key text not null,
  content text not null,
  source_run_id uuid references public.agent_runs (id) on delete set null,
  confidence text not null default 'medium'
    check (confidence in ('low', 'medium', 'high')),
  -- Pinned memories are always included in the context snapshot.
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, key)
);

create index if not exists agent_memory_user_idx
  on public.agent_memory (user_id, pinned desc, updated_at desc);

-- ---------------------------------------------------------------------------
-- Briefs: the morning / evening written output.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  kind text not null check (kind in ('morning', 'evening')),
  brief_date date not null,
  body text not null,
  stats jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, brief_date)
);

create index if not exists agent_briefs_user_date_idx
  on public.agent_briefs (user_id, brief_date desc);

-- ---------------------------------------------------------------------------
-- Profile columns: the owner's standing instructions to the agent.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists agent_playbook text;

alter table public.profiles
  add column if not exists agent_last_run_at timestamptz;

alter table public.profiles
  add column if not exists agent_log_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- RLS. Edge Functions use the service role and bypass these; the app reads
-- and writes as the signed-in user (undo happens client-side).
-- ---------------------------------------------------------------------------
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agent_memory enable row level security;
alter table public.agent_briefs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['agent_runs', 'agent_actions', 'agent_memory', 'agent_briefs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id)',
      t || '_select_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id)',
      t || '_update_own', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t
    );
  end loop;
end $$;
