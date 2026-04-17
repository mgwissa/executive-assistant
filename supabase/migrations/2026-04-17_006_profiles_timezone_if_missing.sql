-- 2026-04-17_006_profiles_timezone_if_missing.sql
-- Ensures timezone exists on profiles (fixes PostgREST "schema cache" errors if 002 was skipped).

alter table public.profiles add column if not exists timezone text;
