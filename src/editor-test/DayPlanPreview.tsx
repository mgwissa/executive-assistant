/** Dev-only visual fixture. No account or production mutations. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { TodayPage } from '../components/TodayPage';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useEventsStore } from '../store/useEventsStore';
import { useAgentStore } from '../store/useAgentStore';
import type { AgentBrief, Event, Profile, Task } from '../types';
import '../index.css';

if (!import.meta.env.DEV) throw new Error('The plan fixture is development-only.');
const timezone = 'America/New_York';
const now = new Date().toISOString();
const date = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
const commonTask = { user_id: 'preview', done: false, priority: 'normal', priority_set_at: now,
  due_date: null, review_date: null, due_time: null, reminder_sent_at: null, linked_event_id: null,
  description: 'Sample task context only.', waiting_on: null, chase_snoozed_until: null, last_chased_at: null,
  estimated_minutes: null, tags: [], reschedule_count: 0, created_at: now, updated_at: now };
const tasks: Task[] = [
  { ...commonTask, id: 'tmp-launch', title: 'Get the new detroittrading.com site live' },
  { ...commonTask, id: 'tmp-inp', title: 'Layne: INP issue — story 66847' },
  { ...commonTask, id: 'tmp-cars', title: 'Layne: Cars Page Schema — story 66988' },
];
const focus = { managedBy: 'codex', updatedAt: now, snoozedUntil: {}, stack: [
  { kind: 'task', taskId: tasks[0].id, reason: 'Your confirmed #1 priority.', nextAction: 'Set up database storage for the contact form, then test a submission end to end.', mode: 'deep_work' },
  { kind: 'task', taskId: tasks[1].id, reason: 'First in Layne’s order.', nextAction: 'Check the current INP fix with the frontend team.', mode: 'quick_follow_up' },
  { kind: 'task', taskId: tasks[2].id, reason: 'Second in Layne’s order.', nextAction: 'Confirm the Cars Page Schema story is ready for refinement.', mode: 'quick_follow_up' },
] };
const commonEvent = { user_id: 'preview', timezone, recurrence: 'none', interval: 1, by_weekday: null,
  until_at: null, count: null, source: 'outlook_ics', outlook_source_key: null, outlook_cancelled_at: null,
  prep_required: false, allow_back_to_back: false, debrief_required: false, created_at: now, updated_at: now };
const events: Event[] = [
  { ...commonEvent, id: 'validation', title: 'Data accuracy validation', start_at: fromZonedTime(`${date}T13:00:00`, timezone).toISOString(), duration_minutes: 30 },
  { ...commonEvent, id: 'one-to-one', title: 'MaryEllen 1:1', start_at: fromZonedTime(`${date}T13:00:00`, timezone).toISOString(), duration_minutes: 60 },
];
const snapshots = events.map((event) => ({ eventId: event.id, title: event.title, startAt: event.start_at,
  endAt: new Date(Date.parse(event.start_at) + event.duration_minutes * 60000).toISOString() }));
const unanswered = new URLSearchParams(window.location.search).has('unanswered');
const dayPlan = { meetingChoices: unanswered ? [] : [{ meetings: snapshots, selectedEventId: 'validation' }], questions: [] };
const brief: AgentBrief = { id: 'sample-brief', user_id: 'preview', kind: 'morning', brief_date: date, run_id: null,
  body: `Keep the website launch first. ${unanswered ? 'Your 1 PM meeting choice is still needed.' : 'Data validation is your confirmed 1 PM choice.'}\n\n### Plan\nDatabase → email notification → Vercel deployment → domain cutover.`,
  stats: { dayPlan, calendarRefreshStatus: 'synced', calendarWindowTruncated: false, calendarSyncedAt: now },
  read_at: null, created_at: now };
useAuthStore.setState({ user: null, session: null });
const profile: Profile = { user_id: 'preview', first_name: 'Mike', timezone, focus_queue: focus,
  outlook_ics_url: 'https://calendar.example.invalid/sample', outlook_ics_last_synced_at: now,
  priority_escalation: null, enabled_addons: [], notify_email_enabled: false,
  notify_email_digest_enabled: false, notify_email_digest_local_time: '07:30:00',
  notify_email_escalation_enabled: false, notify_email_reminder_enabled: false,
  notify_email_last_digest_at: null, notify_email_address: null, notify_in_app_nudges_enabled: false,
  notify_browser_nudges_enabled: false, meeting_rules: [], weekly_routine: null,
  memory_last_synced_at: null, agent_playbook: null, agent_last_run_at: null, agent_log_seen_at: null,
  created_at: now, updated_at: now };
useProfileStore.setState({ profile });
useTasksStore.setState({ tasks, loading: false, toggleDone: async (id, done) => {
  useTasksStore.setState({ tasks: useTasksStore.getState().tasks.map((task) => task.id === id ? { ...task, done } : task) });
}, createTask: async () => null });
useEventsStore.setState({ events, loading: false, error: null });
useAgentStore.setState({ briefs: [brief], loading: false, error: null, fetchAll: async () => {} });
createRoot(document.getElementById('root')!).render(<MemoryRouter>
  <p className="bg-surface-sunken px-4 py-2 text-center text-xs text-text-muted">Development preview · sample data · no production account</p>
  <TodayPage />
</MemoryRouter>);
