-- Per-user agent credentials. Raw tokens are returned once and never stored.

create table if not exists public.agent_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default array['context:read', 'workspace:write']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists agent_connections_user_created_idx
  on public.agent_connections (user_id, created_at desc);

alter table public.agent_connections enable row level security;

-- Connection metadata is deliberately available only through the
-- authenticated agent-connections Edge Function, which never returns hashes.
revoke all on public.agent_connections from anon, authenticated;

alter table public.agent_runs
  add column if not exists agent_connection_id uuid references public.agent_connections(id) on delete set null;

alter table public.agent_runs
  add column if not exists actor_name text not null default 'Codex';

alter table public.agent_actions
  add column if not exists agent_connection_id uuid references public.agent_connections(id) on delete set null;

alter table public.agent_actions
  add column if not exists actor_name text not null default 'Codex';

create index if not exists agent_runs_connection_idx
  on public.agent_runs (agent_connection_id);

create index if not exists agent_actions_connection_idx
  on public.agent_actions (agent_connection_id);
