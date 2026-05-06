-- Optional counterparty: you're waiting on this person/team for the outcome.

alter table public.tasks add column if not exists waiting_on text;

comment on column public.tasks.waiting_on is
  'When set, you are waiting on this person or team (free text). Empty or null means it is your own todo with no external owner.';
