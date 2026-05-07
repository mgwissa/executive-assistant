-- Per-user routine progress. Item definitions live in the app template; rows store dated state.

create table if not exists public.routine_item_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_version text not null,
  routine_date date not null,
  item_id text not null,
  status text not null default 'done',
  completed_at timestamptz,
  notes text not null default '',
  task_id uuid references public.tasks(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routine_item_states_status_check check (status in ('pending', 'done', 'skipped')),
  constraint routine_item_states_item_id_len check (char_length(item_id) between 1 and 160),
  constraint routine_item_states_template_version_len check (char_length(template_version) between 1 and 120),
  constraint routine_item_states_user_date_item_template_key unique (
    user_id,
    routine_date,
    item_id,
    template_version
  )
);

create index if not exists routine_item_states_user_date_idx
  on public.routine_item_states (user_id, routine_date, template_version);

create index if not exists routine_item_states_task_id_idx
  on public.routine_item_states (task_id)
  where task_id is not null;

create index if not exists routine_item_states_event_id_idx
  on public.routine_item_states (event_id)
  where event_id is not null;

alter table public.routine_item_states enable row level security;

drop policy if exists "routine_item_states_select_own" on public.routine_item_states;
create policy "routine_item_states_select_own"
  on public.routine_item_states for select
  using (auth.uid() = user_id);

drop policy if exists "routine_item_states_insert_own" on public.routine_item_states;
create policy "routine_item_states_insert_own"
  on public.routine_item_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "routine_item_states_update_own" on public.routine_item_states;
create policy "routine_item_states_update_own"
  on public.routine_item_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "routine_item_states_delete_own" on public.routine_item_states;
create policy "routine_item_states_delete_own"
  on public.routine_item_states for delete
  using (auth.uid() = user_id);

drop trigger if exists routine_item_states_set_updated_at on public.routine_item_states;
create trigger routine_item_states_set_updated_at
  before update on public.routine_item_states
  for each row execute function public.set_updated_at();
