import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseDayPlan } from '../../supabase/functions/_shared/dayPlan';
import { useDirectiveClock } from '../hooks/useDirectiveClock';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { parseFocusQueue } from '../lib/focusQueue';
import { viewPath } from '../lib/routes';
import { toCreateTaskOptions, type TaskQuickAddPayload } from '../lib/taskQuickAdd';
import { buildTodayViewModel, formatDuration, formatTodayTime } from '../lib/today';
import { useAuthStore } from '../store/useAuthStore';
import { useAgentStore } from '../store/useAgentStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import type { AgentBrief } from '../types';
import { ArrowRightIcon, CalendarIcon, ClockIcon, NoteIcon, SquareIcon, SparklesIcon } from './icons';
import { MarkdownPreview } from './MarkdownPreview';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQuickAddForm } from './TaskQuickAddForm';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

function SavedBriefCard({ brief, loading, evening = false }: { brief: AgentBrief | null; loading: boolean; evening?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const title = evening ? 'Evening closeout' : 'The plan and context';
  const summary = brief?.body.split(/\r?\n/).map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !/^(?:[-*]|\d+\.)\s/.test(line))
    ?.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return (
    <Card padded="sm">
      <div className="flex items-start gap-3">
        <SparklesIcon className="mt-1 h-4 w-4 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {summary ?? (loading ? 'Loading the saved plan…' : evening
              ? 'Ask Codex to close out your day and save tomorrow’s starting point.'
              : 'Ask Codex for a morning plan. Your next action and answered questions will stay in sync here.')}
          </p>
        </div>
        {brief ? <button type="button" className="btn-ghost shrink-0 text-xs"
          onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
          aria-controls={evening ? 'evening-brief-body' : 'morning-brief-body'}>
          {expanded ? 'Collapse' : 'Read brief'}
        </button> : null}
      </div>
      {brief && expanded ? <div id={evening ? 'evening-brief-body' : 'morning-brief-body'} className="mt-4 border-t border-border pt-4">
        <MarkdownPreview content={brief.body} />
      </div> : null}
    </Card>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const briefs = useAgentStore((state) => state.briefs);
  const briefsLoading = useAgentStore((state) => state.loading);
  const agentError = useAgentStore((state) => state.error);
  const fetchAgentData = useAgentStore((state) => state.fetchAll);
  const profile = useProfileStore((state) => state.profile);
  const notes = useNotesStore((state) => state.notes);
  const setActiveNote = useNotesStore((state) => state.setActive);
  const tasks = useTasksStore((state) => state.tasks);
  const tasksLoading = useTasksStore((state) => state.loading);
  const createTask = useTasksStore((state) => state.createTask);
  const toggleTaskDone = useTasksStore((state) => state.toggleDone);
  const events = useEventsStore((state) => state.events);
  const eventsLoading = useEventsStore((state) => state.loading);
  const eventsError = useEventsStore((state) => state.error);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const clock = useDirectiveClock(true);
  useEffect(() => { if (user) void fetchAgentData(user.id); }, [user, fetchAgentData]);
  const now = useMemo(() => { void clock; return new Date(); }, [clock]);
  const timezone = resolveCalendarTimeZone(profile?.timezone);
  const todayIso = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const morningBrief = briefs.find((brief) => brief.kind === 'morning' && brief.brief_date === todayIso) ?? null;
  const eveningBrief = briefs.find((brief) => brief.kind === 'evening' && brief.brief_date === todayIso) ?? null;
  const stats = morningBrief?.stats && typeof morningBrief.stats === 'object' && !Array.isArray(morningBrief.stats)
    ? morningBrief.stats : {};
  const dayPlan = useMemo(() => parseDayPlan(stats.dayPlan), [stats.dayPlan]);
  const focusPrefs = useMemo(() => parseFocusQueue(profile?.focus_queue), [profile?.focus_queue]);
  const syncAt = profile?.outlook_ics_last_synced_at ?? stats.calendarSyncedAt;
  const syncTime = typeof syncAt === 'string' ? Date.parse(syncAt) : NaN;
  const calendarVerified = !!profile && !eventsLoading && !eventsError
    && (!profile?.outlook_ics_url?.trim() || (
      Number.isFinite(syncTime) && now.getTime() >= syncTime && now.getTime() - syncTime <= 2 * 60 * 60_000
      && stats.calendarRefreshStatus === 'synced' && stats.calendarWindowTruncated === false
    ));
  const today = useMemo(() => buildTodayViewModel({
    now, timezone, events, tasks, notes, focusPrefs, dayPlan, calendarVerified,
  }), [now, timezone, events, tasks, notes, focusPrefs, dayPlan, calendarVerified]);
  const next = today.focus[0] ?? null;
  const loading = tasksLoading || briefsLoading;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const openNote = (noteId: string) => { setActiveNote(noteId); navigate(viewPath('notes')); };
  const capture = async (payload: TaskQuickAddPayload) => {
    if (user) await createTask(user.id, payload.title, toCreateTaskOptions(payload));
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-subtle">{formatInTimeZone(now, timezone, 'EEEE, MMMM d')}</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-text sm:text-3xl">One thing at a time.</h1>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => navigate(viewPath('tasks'))}>
            {today.summary.dueTodayCount} due today · {today.summary.overdueCount} past deadlines
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </button>
        </header>

        {agentError ? <p role="status" className="mb-4 text-sm text-text-muted">The saved plan could not refresh. It may be out of date.</p> : null}
        {today.decision ? (
          <section className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4" aria-labelledby="plan-question">
            <p id="plan-question" className="text-xs font-semibold uppercase tracking-wide text-text-subtle">One answer needed</p>
            <p className="mt-2 text-sm font-medium text-text">{today.decision.prompt}</p>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Tell Codex your answer in our conversation; it will be saved with the plan.
              {today.decision.kind === 'meeting' ? ' Outlook invitations stay unchanged.' : ''}
            </p>
            {today.decision.taskId ? <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setSelectedTaskId(today.decision!.taskId!)}>
              Open task context <ArrowRightIcon className="h-3.5 w-3.5" />
            </button> : null}
          </section>
        ) : null}

        <section aria-labelledby="next-action-heading" className="mb-4">
          <Card padded="none" className="border-brand-500/25 bg-brand-500/[0.04]">
            <div className="p-5 sm:p-6">
              <p id="next-action-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">Do this next</p>
              {next ? <>
                <h2 className="mt-3 text-xl font-semibold leading-snug text-text sm:text-2xl">{next.title}</h2>
                <p className="mt-3 text-base leading-relaxed text-text">{next.nextAction ?? 'Open the task for its saved context before starting.'}</p>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{next.whyNow}</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-primary" onClick={() => setSelectedTaskId(next.taskId)}>Open task <ArrowRightIcon className="h-4 w-4" /></button>
                  <button type="button" className="btn-secondary" onClick={() => void toggleTaskDone(next.taskId, true)}>Mark done</button>
                  {next.timingLabel ? <span className="text-xs text-text-muted">{next.timingLabel}</span> : null}
                </div>
              </> : <p className="mt-3 text-sm leading-relaxed text-text-muted">{loading ? 'Loading your saved focus…'
                : 'No active next action is saved. Ask Codex to choose the next step; your backlog is still in All work.'}</p>}
              <p className="mt-4 text-xs text-text-subtle">
                {focusPrefs.managedBy === 'codex' ? 'Codex plan' : 'Saved focus plan'}
                {focusPrefs.updatedAt ? ` · Updated ${formatInTimeZone(new Date(focusPrefs.updatedAt), timezone, 'MMM d, h:mm a')}` : ''}
              </p>
            </div>
          </Card>
        </section>

        <SavedBriefCard brief={morningBrief} loading={briefsLoading} />

        {today.focus.length > 1 ? <section className="mt-6" aria-labelledby="up-next-heading">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="up-next-heading" className="text-sm font-semibold text-text">After that</h2>
            <button type="button" className="btn-ghost text-xs" onClick={() => navigate(viewPath('tasks'))}>All work <ArrowRightIcon className="h-3.5 w-3.5" /></button>
          </div>
          <Card padded="none">
            <ul className="divide-y divide-border">
              {today.focus.slice(1).map((item, index) => <li key={item.taskId} className="flex items-start gap-3 p-4">
                <span className="mt-0.5 text-xs font-semibold text-text-subtle">{index + 2}</span>
                <button type="button" className="text-text-muted hover:text-emerald-500" onClick={() => void toggleTaskDone(item.taskId, true)} aria-label={`Complete ${item.title}`}><SquareIcon className="h-4 w-4" /></button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedTaskId(item.taskId)}>
                  <p className="text-sm font-medium text-text">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.nextAction ?? item.whyNow}</p>
                </button>
              </li>)}
            </ul>
          </Card>
        </section> : null}

        <section className="mt-6">
          <Card padded="sm">
            <TaskQuickAddForm disabled={!user} variant="embedded" idPrefix="today-quick-add" titlePlaceholder="Capture a commitment…" submitLabel="Capture" onSubmit={capture} />
          </Card>
        </section>

        <section className="mt-7" aria-labelledby="schedule-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="schedule-heading" className="text-lg font-semibold text-text">Around your meetings</h2>
            <button type="button" className="btn-ghost text-xs" onClick={() => navigate(viewPath('calendar'))}>Calendar <ArrowRightIcon className="h-3.5 w-3.5" /></button>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-text-muted">
            {calendarVerified ? 'Available in the latest saved calendar, until 5pm. These are not booked work blocks.'
              : 'Calendar availability is not verified. Refresh the calendar before treating any time as free.'}
          </p>
          {calendarVerified && today.openWindows.length > 0 ? <ul className="mb-4 flex flex-wrap gap-2" aria-label="Available focus windows">
            {today.openWindows.slice(0, 4).map((window) => <li key={window.id} className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
              {formatTodayTime(window.start, timezone)} – {formatTodayTime(window.end, timezone)}
              <span className="ml-2 text-text-subtle">{formatDuration((window.end.getTime() - window.start.getTime()) / 60_000)}</span>
            </li>)}
          </ul> : null}
          <Card padded="none">
            {eventsLoading && today.agenda.length === 0 ? <EmptyState icon={<ClockIcon className="h-5 w-5" />} title="Loading schedule" message="Reading your saved calendar." />
              : today.agenda.length === 0 ? <EmptyState icon={<CalendarIcon className="h-5 w-5" />} title="No scheduled blocks returned" message={calendarVerified ? 'No meetings are saved for today.' : 'An empty schedule does not establish free time.'} />
              : <ol className="divide-y divide-border">
                {today.agenda.map((item) => <li key={item.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 p-4">
                  <div className="text-right font-mono text-xs text-text-muted">
                    <p>{formatTodayTime(item.start, timezone)}</p><p className="mt-1 text-[10px] text-text-subtle">{formatTodayTime(item.end, timezone)}</p>
                  </div>
                  <div className="min-w-0 border-l border-border pl-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <button type="button" className={`min-w-0 text-left text-sm font-semibold ${item.attendance === 'not_attending' ? 'text-text-subtle' : 'text-text'}`} onClick={() => item.kind === 'meeting' ? navigate(viewPath('calendar')) : setSelectedTaskId(item.taskId!)}>
                        {item.title}
                      </button>
                      <Badge variant={item.attendance === 'not_attending' ? 'subtle' : 'blue'}>
                        {item.attendance === 'not_attending' ? 'Not attending' : item.attendance === 'selected' ? 'Your choice' : item.kind === 'meeting' ? 'Meeting' : 'Task'}
                      </Badge>
                    </div>
                    {item.attendance === 'not_attending' ? <p className="mt-2 text-xs text-text-subtle">Your plan reflects the other meeting. This Outlook invitation has not been changed.</p> : null}
                    {item.linkedNote ? <button type="button" className="mt-2 flex items-center gap-2 text-xs text-brand-600 dark:text-brand-300" onClick={() => openNote(item.linkedNote!.id)}>
                      <NoteIcon className="h-3.5 w-3.5" />{item.linkedNote.title}
                    </button> : null}
                  </div>
                </li>)}
              </ol>}
          </Card>
        </section>

        {eveningBrief || Number(formatInTimeZone(now, timezone, 'H')) >= 16 ? <section className="mt-6"><SavedBriefCard brief={eveningBrief} loading={briefsLoading} evening /></section> : null}
      </div>
      {selectedTask ? <TaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} /> : null}
    </div>
  );
}
