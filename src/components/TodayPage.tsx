import { formatInTimeZone } from 'date-fns-tz';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDirectiveClock } from '../hooks/useDirectiveClock';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { generateDirective } from '../lib/executiveDirective';
import { extractActionItems } from '../lib/format';
import { parseMeetingRules } from '../lib/meetingTemperament';
import { viewPath } from '../lib/routes';
import { filterActionItemsDeduped } from '../lib/taskActionMatch';
import { parseFocusQueue } from '../lib/focusQueue';
import { toCreateTaskOptions, type TaskQuickAddPayload } from '../lib/taskQuickAdd';
import {
  buildTodayViewModel,
  formatDuration,
  formatTodayTime,
  type TodayConcern,
} from '../lib/today';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import {
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  NoteIcon,
  SquareIcon,
  SparklesIcon,
} from './icons';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQuickAddForm } from './TaskQuickAddForm';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

const CONCERN_STYLE: Record<TodayConcern['severity'], string> = {
  critical: 'border-red-500/30 bg-red-500/[0.06]',
  warning: 'border-amber-500/30 bg-amber-500/[0.06]',
  info: 'border-blue-500/30 bg-blue-500/[0.06]',
};

function greetingFor(now: Date, timezone: string): string {
  const hour = Number(formatInTimeZone(now, timezone, 'H'));
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

function displayName(firstName: string | null | undefined, email: string | null | undefined): string {
  const preferred = firstName?.trim();
  if (preferred) return preferred;
  return email?.split('@')[0]?.split(/[._-]/)[0] || 'there';
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-text">{value}</p>
      <p className="mt-0.5 truncate text-xs text-text-muted">{detail}</p>
    </div>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const profile = useProfileStore((state) => state.profile);
  const notes = useNotesStore((state) => state.notes);
  const notesLoading = useNotesStore((state) => state.loading);
  const setActiveNote = useNotesStore((state) => state.setActive);
  const tasks = useTasksStore((state) => state.tasks);
  const tasksLoading = useTasksStore((state) => state.loading);
  const createTask = useTasksStore((state) => state.createTask);
  const toggleTaskDone = useTasksStore((state) => state.toggleDone);
  const events = useEventsStore((state) => state.events);
  const eventsLoading = useEventsStore((state) => state.loading);
  const debriefStates = useMeetingDebriefStore((state) => state.states);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const clock = useDirectiveClock(true);

  const timezone = resolveCalendarTimeZone(profile?.timezone);
  const now = useMemo(() => {
    void clock;
    return new Date();
  }, [clock]);
  const actionItems = useMemo(
    () => filterActionItemsDeduped(tasks, extractActionItems(notes)),
    [tasks, notes],
  );
  const directive = useMemo(
    () =>
      generateDirective({
        tasks,
        actionItems,
        events,
        timezone,
        now,
        hasCalendarSource: !!profile?.outlook_ics_url?.trim() || events.length > 0,
        meetingRules: parseMeetingRules(profile?.meeting_rules),
        debriefStates,
      }),
    [tasks, actionItems, events, timezone, now, profile?.outlook_ics_url, profile?.meeting_rules, debriefStates],
  );
  const today = useMemo(
    () => {
      const focusTaskIds = parseFocusQueue(profile?.focus_queue).stack
        .filter((ref) => ref.kind === 'task')
        .map((ref) => ref.taskId);
      return buildTodayViewModel({ now, timezone, events, tasks, notes, directive, focusTaskIds });
    },
    [now, timezone, events, tasks, notes, directive, profile?.focus_queue],
  );

  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;
  const loading = notesLoading || tasksLoading || eventsLoading;
  const dateLabel = formatInTimeZone(now, timezone, 'EEEE, MMMM d');

  const openNote = (noteId: string) => {
    setActiveNote(noteId);
    navigate(viewPath('notes'));
  };

  const handleQuickAdd = async (payload: TaskQuickAddPayload) => {
    if (!user) return;
    await createTask(user.id, payload.title, toCreateTaskOptions(payload));
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge variant="subtle" className="uppercase tracking-wider">
              {dateLabel}
            </Badge>
            <h1 className="mt-3 text-3xl font-medium tracking-tight text-text sm:text-4xl">
              {greetingFor(now, timezone)}, {displayName(profile?.first_name, user?.email)}.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
              Here is the shape of your day, the context already attached to it, and what deserves a decision.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            Live in {timezone}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Today at a glance">
          <SummaryMetric
            label="Meetings"
            value={String(today.summary.meetingCount)}
            detail={`${formatDuration(today.summary.meetingMinutes)} on calendar`}
          />
          <SummaryMetric
            label="Meeting time"
            value={formatDuration(today.summary.meetingMinutes)}
            detail="Across today's schedule"
          />
          <SummaryMetric
            label="Open focus"
            value={formatDuration(today.summary.focusMinutes)}
            detail="In windows of 20m or more"
          />
          <SummaryMetric
            label="Deadlines"
            value={String(today.summary.dueWorkCount)}
            detail="Due today or overdue"
          />
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-subtle">Your day</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-text">Schedule and context</h2>
              </div>
              <button type="button" className="btn-ghost" onClick={() => navigate(viewPath('calendar'))}>
                Calendar <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <Card padded="none" className="overflow-hidden">
              {loading && today.agenda.length === 0 ? (
                <EmptyState icon={<ClockIcon className="h-5 w-5" />} title="Loading today" message="Gathering your schedule and work." />
              ) : today.agenda.length === 0 ? (
                <EmptyState icon={<CalendarIcon className="h-5 w-5" />} title="No scheduled blocks" message="Your calendar is clear today." />
              ) : (
                <ol className="divide-y divide-border">
                  {today.agenda.map((item) => (
                    <li key={item.id} className="grid grid-cols-[4.6rem_minmax(0,1fr)] gap-3 px-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:px-5">
                      <div className="pt-0.5 text-right font-mono text-xs text-text-muted">
                        <p>{formatTodayTime(item.start, timezone)}</p>
                        <p className="mt-1 text-[10px] text-text-subtle">{formatTodayTime(item.end, timezone)}</p>
                      </div>
                      <div className="min-w-0 border-l border-border pl-4">
                        <div className="flex flex-wrap items-start gap-2">
                          <button
                            type="button"
                            onClick={() => item.kind === 'meeting' ? navigate(viewPath('calendar')) : setSelectedTaskId(item.taskId)}
                            className="min-w-0 flex-1 text-left text-sm font-semibold text-text hover:text-brand-600 dark:hover:text-brand-300"
                          >
                            {item.title}
                          </button>
                          <Badge variant={item.kind === 'meeting' ? 'blue' : 'purple'}>
                            {item.kind === 'meeting' ? 'Meeting' : 'Task'}
                          </Badge>
                        </div>
                        {item.kind === 'meeting' && item.linkedNote ? (
                          <div className="mt-3 rounded-lg border border-brand-500/20 bg-brand-500/[0.05] p-3">
                            <div className="flex items-start gap-3">
                              <NoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                              <div className="min-w-0 flex-1">
                                <button type="button" onClick={() => openNote(item.linkedNote!.id)} className="truncate text-left text-xs font-semibold text-text hover:text-brand-600 dark:hover:text-brand-300">
                                  {item.linkedNote.title}
                                </button>
                                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{item.linkedNote.excerpt}</p>
                              </div>
                              <button type="button" onClick={() => openNote(item.linkedNote!.id)} className="btn-ghost h-8 shrink-0 px-2 text-xs">
                                Open
                              </button>
                            </div>
                          </div>
                        ) : item.kind === 'meeting' ? (
                          <p className="mt-2 text-xs text-text-subtle">No meeting note linked to this occurrence.</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>

          <aside className="min-w-0 space-y-6">
            <section>
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-subtle">Watchouts</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-text">Worth your attention</h2>
              </div>
              <div className="space-y-3">
                {today.concerns.length === 0 ? (
                  <Card padded="sm" className="border-emerald-500/20 bg-emerald-500/[0.05]">
                    <p className="text-sm font-semibold text-text">No major concerns</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">The day looks workable from the information currently available.</p>
                  </Card>
                ) : (
                  today.concerns.map((concern) => (
                    <div key={concern.id} className={`rounded-xl border p-4 ${CONCERN_STYLE[concern.severity]}`}>
                      <div className="flex items-start gap-3">
                        <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                        <div>
                          <p className="text-sm font-semibold text-text">{concern.headline}</p>
                          <p className="mt-1 text-xs leading-relaxed text-text-muted">{concern.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-text">Open focus windows</h2>
                <span className="text-xs text-text-muted">Until 5pm</span>
              </div>
              <Card padded="sm">
                {today.openWindows.length === 0 ? (
                  <p className="text-sm text-text-muted">No open window of 20 minutes or more remains.</p>
                ) : (
                  <ul className="space-y-2">
                    {today.openWindows.slice(0, 4).map((window) => (
                      <li key={window.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-text">{formatTodayTime(window.start, timezone)} – {formatTodayTime(window.end, timezone)}</span>
                        <Badge variant="subtle">{formatDuration((window.end.getTime() - window.start.getTime()) / 60_000)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </aside>
        </div>

        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-subtle">Commitments</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-text">Focus queue</h2>
            </div>
            <button type="button" className="btn-ghost" onClick={() => navigate(viewPath('tasks'))}>
              All work <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <Card padded="none" className="overflow-hidden">
            <div className="border-b border-border p-4 sm:p-5">
              <TaskQuickAddForm
                disabled={!user}
                variant="embedded"
                idPrefix="today-quick-add"
                titlePlaceholder="Capture a commitment…"
                submitLabel="Capture"
                onSubmit={handleQuickAdd}
              />
            </div>
            {today.focus.length === 0 ? (
              <div className="px-4 py-5 text-sm text-text-muted sm:px-5">
                Nothing is being pushed right now. Real deadlines and arrived review dates appear automatically; Work can set a temporary starting point until the Codex bridge manages this queue.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {today.focus.map((item, index) => (
                  <li key={item.taskId} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600 dark:text-brand-300">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleTaskDone(item.taskId, true)}
                      className="mt-0.5 text-text-muted hover:text-emerald-500"
                      aria-label={`Complete ${item.title}`}
                    >
                      <SquareIcon className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setSelectedTaskId(item.taskId)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-text hover:text-brand-600 dark:hover:text-brand-300">{item.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.whyNow}</p>
                      {item.timingLabel ? <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">{item.timingLabel}</p> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {selectedTask ? <TaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} /> : null}
    </div>
  );
}
