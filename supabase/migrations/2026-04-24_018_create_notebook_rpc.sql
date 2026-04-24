-- Workaround for persistent RLS errors on direct PostgREST inserts into public.notebooks.
-- This RPC inserts a notebook owned by the caller and returns the created row.

create or replace function public.create_notebook(p_name text, p_position int default 0)
returns public.notebooks
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.notebooks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.notebooks (user_id, name, position)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'My Notebook'), coalesce(p_position, 0))
  returning * into row;

  return row;
end;
$$;

revoke all on function public.create_notebook(text, int) from public;
grant execute on function public.create_notebook(text, int) to authenticated;

