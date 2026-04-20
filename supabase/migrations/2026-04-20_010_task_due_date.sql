-- Add optional due date to tasks (calendar date, not timestamp).
alter table public.tasks add column if not exists due_date date;
