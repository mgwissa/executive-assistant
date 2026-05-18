-- Optional override for *where* notification emails are delivered.
-- When null, the Edge Functions fall back to the user's auth email.
-- Useful when your app login email differs from the inbox you actually read.

alter table public.profiles
  add column if not exists notify_email_address text;
