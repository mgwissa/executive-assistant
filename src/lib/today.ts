import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { DirectiveGap, DirectiveReport } from './executiveDirective';
import { extractPreview } from './format';
import { occurrenceStartKey } from './meetingDebrief';
import { findMeetingNote } from './meetingNotes';
import { dedupeOccurrences, generateOccurrences } from './recurrence';
import { executiveDayBounds, findFreeGaps } from './scheduleAvailability';
import { normalizeDueTime } from './taskSchedule';
import { workMinutesForItem } from './taskCapacity';
import type { Event, Note, Task } from '../types';
import type { FocusQueueEntry, FocusWorkMode } from './focusQueue';

export type TodayFocusItem = {
  taskId: string;
  title: string;
  whyNow: string;
  nextAction: string | null;
  mode: FocusWorkMode | null;
  timingLabel: string | null;
};

export type TodayAgendaItem =
  | {
      id: string;
      kind: 'meeting';
      title: string;
      start: Date;
      end: Date;
      eventId: string;
      source: string;
      linkedNote: {
        id: string;
        title: string;
        excerpt: string;
      } | null;
    }
  | {
      id: string;
      kind: 'task';
      title: string;
      start: Date;
      end: Date;
      taskId: string;
    };

export type TodayConcern = {
  id: string;
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  headline: string;
  detail: string;
};

export type TodayViewModel = {
  todayIso: string;
  agenda: TodayAgendaItem[];
  openWindows: Array<{ id: string; start: Date; end: Date }>;
  concerns: TodayConcern[];
  focus: TodayFocusItem[];
  summary: {
    meetingCount: number;
    meetingMinutes: number;
    focusMinutes: number;
    dueWorkCount: number;
  };
};

type TodayViewInput = {
  now: Date;
  timezone: string;
  events: Event[];
  tasks: Task[];
  notes: Note[];
  directive: DirectiveReport;
  focusEntries?: FocusQueueEntry[];
};

const SEVERITY_RANK: Record<TodayConcern['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const CONCERN_RANK: Record<string, number> = {
  overlap: 0,
  capacity_overcommit: 1,
  pick_focus: 2,
  meeting_load: 3,
  back_to_back: 4,
  prep_needed: 5,
  overdue_work: 6,
  delegation_chase: 7,
  untimed_today: 8,
};

const VISIBLE_GAP_KINDS = new Set<DirectiveGap['kind']>([
  'overlap',
  'capacity_overcommit',
  'pick_focus',
  'back_to_back',
  'prep_needed',
  'delegation_chase',
  'untimed_today',
]);

function concernFromGap(gap: DirectiveGap): TodayConcern | null {
  if (!VISIBLE_GAP_KINDS.has(gap.kind)) return null;
  if (gap.kind === 'untimed_today') {
    return {
      id: gap.id,
      kind: gap.kind,
      severity: gap.severity,
      headline: gap.headline,
      detail: 'This work is due or urgent, but it has no protected time on today\'s calendar.',
    };
  }
  return {
    id: gap.id,
    kind: gap.kind,
    severity: gap.severity,
    headline: gap.headline,
    detail: gap.detail,
  };
}

function nextIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function buildTodayViewModel(input: TodayViewInput): TodayViewModel {
  const { now, timezone, events, tasks, notes, directive, focusEntries = [] } = input;
  const { start: dayStart, end: workdayEnd, todayIso } = executiveDayBounds(now, timezone);
  const meetings = dedupeOccurrences(
    events.flatMap((event) =>
      generateOccurrences(
        event,
        dayStart,
        fromZonedTime(`${nextIsoDate(todayIso)}T00:00:00`, timezone),
        { limit: 50 },
      ),
    ),
  ).sort((a, b) => a.start.getTime() - b.start.getTime());

  const meetingAgenda: TodayAgendaItem[] = meetings.map((meeting) => {
    const linked = findMeetingNote(
      notes,
      meeting.eventId,
      occurrenceStartKey(meeting.start),
    );
    return {
      id: `meeting:${meeting.eventId}:${meeting.start.toISOString()}`,
      kind: 'meeting',
      title: meeting.title,
      start: meeting.start,
      end: meeting.end,
      eventId: meeting.eventId,
      source: meeting.source,
      linkedNote: linked
        ? {
            id: linked.id,
            title: linked.title || 'Untitled meeting note',
            excerpt: extractPreview(linked.content) || 'No summary captured yet.',
          }
        : null,
    };
  });

  const timedTaskAgenda: TodayAgendaItem[] = tasks
    .filter(
      (task) =>
        !task.done &&
        task.due_date === todayIso &&
        normalizeDueTime(task.due_time) != null,
    )
    .map((task) => {
      const dueTime = normalizeDueTime(task.due_time) ?? '09:00';
      const start = fromZonedTime(`${todayIso}T${dueTime}:00`, timezone);
      const minutes = workMinutesForItem('task', task.id, tasks);
      return {
        id: `task:${task.id}`,
        kind: 'task' as const,
        title: task.title,
        start,
        end: new Date(start.getTime() + minutes * 60_000),
        taskId: task.id,
      };
    });

  const agenda = [...meetingAgenda, ...timedTaskAgenda].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  const busy = agenda.map((item) => ({ start: item.start, end: item.end }));
  const focusStart = now > dayStart ? now : dayStart;
  const openWindows = findFreeGaps(focusStart, workdayEnd, busy).map((gap) => ({
    id: `open:${gap.start.toISOString()}`,
    ...gap,
  }));
  const focusMinutes = Math.round(
    openWindows.reduce((sum, gap) => sum + (gap.end.getTime() - gap.start.getTime()) / 60_000, 0),
  );

  const overdue = tasks.filter(
    (task) => !task.done && task.due_date != null && task.due_date < todayIso,
  );
  const dueWorkCount = tasks.filter(
    (task) => !task.done && task.due_date != null && task.due_date <= todayIso,
  ).length;

  const focusOrder = new Map(
    (focusEntries ?? [])
      .filter((entry) => entry.kind === 'task')
      .map((entry, index) => [entry.taskId, { index, entry }]),
  );
  const focus = tasks
    .filter((task) => {
      if (task.done) return false;
      if (focusOrder.has(task.id)) return true;
      if (task.waiting_on) return false;
      if (task.due_date) return true;
      if (task.review_date) return task.review_date <= todayIso;
      return false;
    })
    .map((task) => {
      const explicit = focusOrder.get(task.id);
      if (explicit != null) {
        return {
          task,
          rank: explicit.index,
          whyNow: explicit.entry.reason ?? 'Chosen for the active focus queue.',
          nextAction: explicit.entry.nextAction ?? null,
          mode: explicit.entry.mode ?? null,
        };
      }
      if (task.due_date && task.due_date < todayIso) {
        return { task, rank: 100, whyNow: 'A real deadline has passed; decide whether to finish, renegotiate, or close it.', nextAction: null, mode: null };
      }
      if (task.due_date === todayIso) {
        return { task, rank: 110, whyNow: 'A real deadline lands today.', nextAction: null, mode: null };
      }
      if (task.due_date) {
        return { task, rank: 120, whyNow: 'A real deadline is approaching.', nextAction: null, mode: null };
      }
      return { task, rank: 200, whyNow: 'Its review date has arrived; decide whether to activate, defer, or close it.', nextAction: null, mode: null };
    })
    .sort((a, b) => a.rank - b.rank || (a.task.due_date ?? a.task.review_date ?? '').localeCompare(b.task.due_date ?? b.task.review_date ?? ''))
    .slice(0, 5)
    .map(({ task, whyNow, nextAction, mode }) => ({
      taskId: task.id,
      title: task.title,
      whyNow,
      nextAction,
      mode,
      timingLabel: task.due_date
        ? `Deadline ${task.due_date}`
        : task.review_date
          ? `Review ${task.review_date}`
          : null,
    }));
  const meetingMinutes = Math.round(
    meetings.reduce((sum, meeting) => sum + (meeting.end.getTime() - meeting.start.getTime()) / 60_000, 0),
  );

  const concerns: TodayConcern[] = [];
  if (meetings.length >= 6 || meetingMinutes >= 240) {
    concerns.push({
      id: 'meeting-load',
      kind: 'meeting_load',
      severity: meetingMinutes >= 300 ? 'critical' : 'warning',
      headline: `${meetings.length} meetings take ${formatDuration(meetingMinutes)} today`,
      detail: 'Protect the remaining open windows and decide which meetings truly need your attention.',
    });
  }
  if (overdue.length > 0) {
    concerns.push({
      id: 'overdue-work',
      kind: 'overdue_work',
      severity: overdue.length >= 3 ? 'critical' : 'warning',
      headline: `${overdue.length} overdue ${overdue.length === 1 ? 'commitment' : 'commitments'}`,
      detail: 'Choose what still matters today and reschedule or close the rest intentionally.',
    });
  }
  for (const gap of directive.gaps) {
    const concern = concernFromGap(gap);
    if (concern) concerns.push(concern);
  }

  const deduped = new Map<string, TodayConcern>();
  for (const concern of concerns) {
    if (!deduped.has(concern.kind)) deduped.set(concern.kind, concern);
  }
  const rankedConcerns = [...deduped.values()]
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severity !== 0) return severity;
      return (CONCERN_RANK[a.kind] ?? 99) - (CONCERN_RANK[b.kind] ?? 99);
    })
    .slice(0, 3);

  return {
    todayIso,
    agenda,
    openWindows,
    concerns: rankedConcerns,
    focus,
    summary: {
      meetingCount: meetings.length,
      meetingMinutes,
      focusMinutes,
      dueWorkCount,
    },
  };
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function formatTodayTime(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'h:mm a');
}
