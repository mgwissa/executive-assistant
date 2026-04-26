-- BlockNote document as JSON (canonical). Legacy notes keep content_blocks NULL
-- and load from markdown `content` until the first save from the new editor.

alter table public.notes add column if not exists content_blocks jsonb;

comment on column public.notes.content_blocks is
  'BlockNote block document (json). When non-null and non-empty, editor loads this instead of parsing `content` as Markdown. `content` remains a denormalized Markdown export for search and task line mutations.';
