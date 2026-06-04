-- Distinguish fixed-duration debrief snoozes from calendar-aware "until I'm free".

alter table public.meeting_debrief_states
  add column if not exists snooze_mode text;

alter table public.meeting_debrief_states
  drop constraint if exists meeting_debrief_states_snooze_mode_check;

alter table public.meeting_debrief_states
  add constraint meeting_debrief_states_snooze_mode_check
  check (snooze_mode is null or snooze_mode in ('fixed', 'until_free'));
