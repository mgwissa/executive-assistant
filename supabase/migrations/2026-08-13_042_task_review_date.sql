-- Agent-first task timing: deadlines are real commitments; review dates are
-- when the assistant should bring work back into consideration.

alter table public.tasks add column if not exists review_date date;

comment on column public.tasks.review_date is
  'Date to resurface/reconsider the task. Unlike due_date, this is not a deadline and carries no automatic priority change.';

-- The owner used 2026-08-28 as a one-time holding date while refreshing the
-- workspace. Preserve that intent without treating every item as a deadline.
update public.tasks
set review_date = due_date,
    due_date = null,
    due_time = null,
    reminder_sent_at = null
where done = false
  and due_date = date '2026-08-28'
  and review_date is null;

