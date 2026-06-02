-- Working memory: vector chunks over notes, tasks, and meeting debriefs.
-- Indexed by memory-sync Edge Function; queried by memory-ask.

create extension if not exists vector with schema extensions;

create table if not exists public.memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('note', 'task', 'debrief')),
  source_id text not null,
  chunk_index int not null default 0,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, chunk_index)
);

create index if not exists memory_chunks_user_id_idx on public.memory_chunks (user_id);
create index if not exists memory_chunks_source_idx
  on public.memory_chunks (user_id, source_type, source_id);

create index if not exists memory_chunks_embedding_hnsw_idx
  on public.memory_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.profiles
  add column if not exists memory_last_synced_at timestamptz;

alter table public.memory_chunks enable row level security;

create policy "memory_chunks_select_own"
  on public.memory_chunks for select
  using (auth.uid() = user_id);

create policy "memory_chunks_insert_own"
  on public.memory_chunks for insert
  with check (auth.uid() = user_id);

create policy "memory_chunks_update_own"
  on public.memory_chunks for update
  using (auth.uid() = user_id);

create policy "memory_chunks_delete_own"
  on public.memory_chunks for delete
  using (auth.uid() = user_id);

-- Similarity search (service role / Edge Functions only).
create or replace function public.match_memory_chunks(
  query_embedding extensions.vector(1536),
  match_user_id uuid,
  match_count int default 12
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    mc.id,
    mc.source_type,
    mc.source_id,
    mc.chunk_index,
    mc.content,
    mc.metadata,
    1 - (mc.embedding <=> query_embedding) as similarity
  from public.memory_chunks mc
  where mc.user_id = match_user_id
    and mc.embedding is not null
  order by mc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke all on function public.match_memory_chunks(extensions.vector, uuid, int) from public;
grant execute on function public.match_memory_chunks(extensions.vector, uuid, int) to service_role;
