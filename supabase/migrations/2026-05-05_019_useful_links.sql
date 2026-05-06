-- Personal bookmarks shown on the dashboard.

create table if not exists public.useful_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  url text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint useful_links_label_len check (char_length(label) between 1 and 200),
  constraint useful_links_url_len check (char_length(url) between 1 and 2048)
);

create index if not exists useful_links_user_position_idx on public.useful_links (user_id, position, id);

alter table public.useful_links enable row level security;

drop policy if exists "useful_links_select_own" on public.useful_links;
create policy "useful_links_select_own"
  on public.useful_links for select
  using (auth.uid() = user_id);

drop policy if exists "useful_links_insert_own" on public.useful_links;
create policy "useful_links_insert_own"
  on public.useful_links for insert
  with check (auth.uid() = user_id);

drop policy if exists "useful_links_update_own" on public.useful_links;
create policy "useful_links_update_own"
  on public.useful_links for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "useful_links_delete_own" on public.useful_links;
create policy "useful_links_delete_own"
  on public.useful_links for delete
  using (auth.uid() = user_id);

drop trigger if exists useful_links_set_updated_at on public.useful_links;
create trigger useful_links_set_updated_at
  before update on public.useful_links
  for each row execute function public.set_updated_at();
