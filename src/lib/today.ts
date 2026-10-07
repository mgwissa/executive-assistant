import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { meetingSnapshotKey, parseDayPlan, resolveMeetingChoices, type DayPlan, type PlannedMeeting } from '../../supabase/functions/_shared/dayPlan';
import { occurrenceStartKey } from './meetingDebrief';
import { findMeetingNote } from './meetingNotes';
import { dedupeOccurrences, generateOccurrences } from './recurrence';
import { executiveDayBounds, findFreeGaps } from './scheduleAvailability';
import { normalizeDueTime } from './taskSchedule';
import { workMinutesForItem } from './taskCapacity';
import type { Event, Note, Task } from '../types';
import type { FocusQueuePrefs, FocusWorkMode } from './focusQueue';

export type TodayFocusItem = {
  taskId: string;
  title: string;
  whyNow: string;
  nextAction: string | null;
  mode: FocusWorkMode | null;
  timingLabel: string | null;
};

export type TodayAgendaItem = {
  id: string;
  kind: 'meeting' | 'task';
  title: string;
  start: Date;
  end: Date;
  eventId?: string;
  taskId?: string;
  attendance?: 'selected' | 'not_attending';
  linkedNote: { id: string; title: string; excerpt: string } | null;
};

export type TodayViewModel = {
  agenda: TodayAgendaItem[];
  openWindows: Array<{ id: string; start: Date; end: Date }>;
  decision: { id: string; prompt: string; taskId?: string; kind: 'meeting' | 'context' } | null;
  focus: TodayFocusItem[];
  summary: { meetingCount: number; dueTodayCount: number; overdueCount: number };
};

type TodayViewInput = {
  now: Date;
  timezone: string;
  events: Event[];
  tasks: Task[];
  notes: Note[];
  focusPrefs: FocusQueuePrefs;
  dayPlan?: DayPlan;
  /** Never establish free time from a failed, stale, or incomplete refresh. */
  calendarVerified?: boolean;
};

export function snapshotMeeting(event: { eventId: string; title: string; start: Date; end: Date }): PlannedMeeting {
  return { eventId: event.eventId, title: event.title, startAt: event.start.toISOString(), endAt: event.end.toISOString() };
}

export function buildTodayViewModel(input: TodayViewInput): TodayViewModel {
  const { now, timezone, events, tasks, notes, focusPrefs, calendarVerified = false } = input;
  const { start: dayStart, end: workdayEnd, todayIso } = executiveDayBounds(now, timezone);
  const [year, month, day] = todayIso.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day));
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const meetings = dedupeOccurrences(events.flatMap((event) => generateOccurrences(
    event, dayStart, fromZonedTime(`${nextDate.toISOString().slice(0, 10)}T00:00:00`, timezone), { limit: 50 },
  ))).sort((a, b) => a.start.getTime() - b.start.getTime());
  const plan = input.dayPlan ?? parseDayPlan(null);
  const snapshots = meetings.map(snapshotMeeting);
  const choices = resolveMeetingChoices(snapshots, plan);
  const plannedMeetings = meetings.filter((meeting) => !choices.skippedKeys.has(meetingSnapshotKey(snapshotMeeting(meeting))));
  const meetingAgenda: TodayAgendaItem[] = meetings.map((meeting) => {
    const key = meetingSnapshotKey(snapshotMeeting(meeting));
    const linked = findMeetingNote(notes, meeting.eventId, occurrenceStartKey(meeting.start));
    return {
      id: `meeting:${meeting.eventId}:${meeting.start.toISOString()}`,
      kind: 'meeting', title: meeting.title, start: meeting.start, end: meeting.end, eventId: meeting.eventId,
      attendance: choices.skippedKeys.has(key) ? 'not_attending' : choices.selectedKeys.has(key) ? 'selected' : undefined,
      linkedNote: linked ? { id: linked.id, title: linked.title || 'Untitled meeting note', excerpt: linked.content.slice(0, 240) } : null,
    };
  });
  const timedTasks: TodayAgendaItem[] = tasks
    .filter((task) => !task.done && !task.waiting_on?.trim() && task.due_date === todayIso && normalizeDueTime(task.due_time))
    .map((task) => {
      const start = fromZonedTime(`${todayIso}T${normalizeDueTime(task.due_time)}:00`, timezone);
      return { id: `task:${task.id}`, kind: 'task', title: task.title, start,
        end: new Date(start.getTime() + workMinutesForItem('task', task.id, tasks) * 60_000),
        taskId: task.id, linkedNote: null };
    });
  const agenda = [...meetingAgenda, ...timedTasks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const openWindows = calendarVerified ? findFreeGaps(now > dayStart ? now : dayStart, workdayEnd,
    agenda.filter((item) => item.attendance !== 'not_attending').map((item) => ({ start: item.start, end: item.end })),
  ).map((gap) => ({ id: `open:${gap.start.toISOString()}`, ...gap })) : [];

  // The saved queue is the plan, not a second ranking of the whole backlog.
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const focus: TodayFocusItem[] = [];
  for (const entry of focusPrefs.stack) {
    if (entry.kind !== 'task' || seen.has(entry.taskId)) continue;
    seen.add(entry.taskId);
    const task = taskById.get(entry.taskId);
    if (!task || task.done || task.waiting_on?.trim() || entry.mode === 'waiting') continue;
    if ((focusPrefs.snoozedUntil[`task:${task.id}`] ?? '') > todayIso) continue;
    focus.push({ taskId: task.id, title: task.title,
      whyNow: entry.reason ?? 'Chosen for the saved focus plan.',
      nextAction: entry.nextAction ?? null, mode: entry.mode ?? null,
      timingLabel: task.due_date ? `Deadline ${task.due_date}` : task.review_date ? `Review ${task.review_date}` : null });
    if (focus.length === 5) break;
  }

  let decision: TodayViewModel['decision'] = null;
  // Check every pair, including conflicts nested inside a longer meeting.
  for (let i = 0; i < plannedMeetings.length && !decision; i++) {
    const a = plannedMeetings[i];
    if (a.end <= now) continue;
    for (const b of plannedMeetings.slice(i + 1)) {
      if (b.start >= a.end) break;
      if (b.end <= now) continue;
      decision = { id: `overlap:${a.eventId}:${b.eventId}`, kind: 'meeting',
        prompt: `${formatTodayTime(b.start, timezone)}: “${a.title}” and “${b.title}” overlap. Which are you attending?` };
      break;
    }
  }
  if (!decision) {
    const question = plan.questions.find((question) => question.status === 'open'
      && (!question.taskId || taskById.has(question.taskId) && !taskById.get(question.taskId)!.done
        && !taskById.get(question.taskId)!.waiting_on?.trim()));
    if (question) decision = { ...question, kind: 'context' };
  }

  return { agenda, openWindows, decision, focus,
    summary: { meetingCount: plannedMeetings.length,
      dueTodayCount: tasks.filter((task) => !task.done && task.due_date === todayIso).length,
      overdueCount: tasks.filter((task) => !task.done && task.due_date != null && task.due_date < todayIso).length } };
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
