-- Transition agent attribution from manually issued bearer tokens to
-- Supabase Auth OAuth 2.1 grants used by the hosted MCP server.

alter table public.agent_connections
  alter column token_prefix drop not null;

alter table public.agent_connections
  alter column token_hash drop not null;

alter table public.agent_connections
  add column if not exists oauth_client_id text;

alter table public.agent_connections
  add column if not exists auth_kind text not null default 'oauth';

alter table public.agent_connections
  drop constraint if exists agent_connections_auth_kind_check;

alter table public.agent_connections
  add constraint agent_connections_auth_kind_check
  check (auth_kind in ('oauth', 'legacy_token'));

update public.agent_connections
set auth_kind = 'legacy_token'
where token_hash is not null
  and oauth_client_id is null;

create unique index if not exists agent_connections_user_oauth_client_idx
  on public.agent_connections (user_id, oauth_client_id);
