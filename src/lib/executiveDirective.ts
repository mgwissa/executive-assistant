/**
 * Executive directive engine — time-aware NOW / NEXT / GAPS / timeline.
 * Pure TypeScript, no API calls. Used when the assistant addon is enabled.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { ActionItem } from './format';
import type { TaskPriority } from './priority';
import { priorityRank } from './priority';
import { normalizeDueTime } from './taskSchedule';
import { generateOccurrences } from './recurrence';
import {
  type MeetingRule,
  isBackToBackPair,
  resolveMeetingTemperament,
} from './meetingTemperament';
import type { Event, Task } from '../types';

const TASK_BLOCK_MINUTES = 30;
const PREP_WINDOW_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 20 * 60 * 1000;
const DAY_END_HOUR = 18;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WorkItemRef =
  | { kind: 'task'; taskId: string }
  | { kind: 'action'; noteId: string; line: number };

export type TimelineEntryKind = 'meeting' | 'task' | 'action' | 'gap' | 'suggested';

export type TimelineEntry = {
  id: string;
  kind: TimelineEntryKind;
  title: string;
  start: Date;
  end: Date;
  priority?: TaskPriority;
  ref?: WorkItemRef;
  eventId?: string;
  /** Auto-assigned slot — user hasn't confirmed time yet. */
  suggested?: boolean;
};

export type NowKind = 'in_meeting' | 'prep' | 'work' | 'gap' | 'wind_down' | 'free';

export type NowDirective = {
  kind: NowKind;
  headline: string;
  detail: string;
  until?: Date;
  ref?: WorkItemRef;
  eventId?: string;
};

export type GapKind =
  | 'untimed_today'
  | 'prep_needed'
  | 'back_to_back'
  | 'overlap'
  | 'no_calendar'
  | 'pick_focus'
  | 'orphan_followup'
  | 'stale_waiting';

export type DirectiveGap = {
  id: string;
  kind: GapKind;
  severity: 'critical' | 'warning' | 'info';
  headline: string;
  detail: string;
  ref?: WorkItemRef;
  eventId?: string;
  /** Earlier meeting in a back-to-back pair. */
  relatedEventId?: string;
  /** Meeting title for temperament rule actions. */
  meetingTitle?: string;
  /** Suggested HH:MM (profile TZ) for set-time actions. */
  suggestedTime?: string;
  suggestedDate?: string;
};

export type DirectiveReport = {
  generatedAt: Date;
  timezone: string;
  todayIso: string;
  now: NowDirective;
  /** Next few hours (meetings + timed work + suggestions). */
  next: TimelineEntry[];
  /** Full remainder of today. */
  timeline: TimelineEntry[];
  gaps: DirectiveGap[];
};

export interface DirectiveInput {
  tasks: Task[];
  actionItems: ActionItem[];
  events: Event[];
  timezone: string;
  now?: Date;
  /** True when Outlook ICS is configured or manual events exist. */
  hasCalendarSource: boolean;
  /** Title-based temperament overrides from profile. */
  meetingRules?: MeetingRule[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type UnifiedWork = {
  id: string;
  kind: 'task' | 'action';
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  taskId?: string;
  noteId?: string;
  line?: number;
  waitingOn?: string | null;
  linkedEventId?: string | null;
  updatedAt: string;
};

type MeetingBlock = {
  id: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  prepRequired: boolean;
  allowBackToBack: boolean;
};

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function zonedInstant(isoDate: string, time: string, tz: string): Date {
  const t = normalizeDueTime(time) ?? '09:00';
  return fromZonedTime(`${isoDate}T${t}:00`, tz);
}

function dayBounds(now: Date, tz: string): { start: Date; end: Date; todayIso: string } {
  const todayIso = formatInTimeZone(now, tz, 'yyyy-MM-dd');
  const start = fromZonedTime(`${todayIso}T00:00:00`, tz);
  const end = fromZonedTime(`${todayIso}T${DAY_END_HOUR}:00:00`, tz);
  return { start, end, todayIso };
}

function isOverdue(dueDate: string, todayIso: string): boolean {
  return dueDate < todayIso;
}

function isDueTodayOrOverdue(dueDate: string | null, todayIso: string): boolean {
  if (!dueDate) return false;
  return dueDate <= todayIso;
}

function workScore(w: UnifiedWork, todayIso: string): number {
  let score = priorityRank(w.priority) * 100;
  if (w.dueDate === todayIso) score -= 50;
  if (w.dueDate && isOverdue(w.dueDate, todayIso)) score -= 80;
  if (w.dueTime) score -= 10;
  return score;
}

function toUnifiedWork(tasks: Task[], actionItems: ActionItem[], todayIso: string): UnifiedWork[] {
  const out: UnifiedWork[] = [];
  for (const t of tasks) {
    if (t.done) continue;
    const priority = (t.priority as TaskPriority) ?? 'normal';
    const relevant =
      isDueTodayOrOverdue(t.due_date, todayIso) ||
      priority === 'critical' ||
      priority === 'urgent';
    if (!relevant) continue;
    out.push({
      id: `task:${t.id}`,
      kind: 'task',
      title: t.title,
      priority,
      dueDate: t.due_date,
      dueTime: t.due_time,
      taskId: t.id,
      waitingOn: t.waiting_on,
      linkedEventId: t.linked_event_id,
      updatedAt: t.updated_at,
    });
  }
  for (const a of actionItems) {
    const relevant =
      isDueTodayOrOverdue(a.dueDate, todayIso) ||
      a.priority === 'critical' ||
      a.priority === 'urgent';
    if (!relevant) continue;
    out.push({
      id: `action:${a.noteId}:${a.line}`,
      kind: 'action',
      title: a.displayText,
      priority: a.priority,
      dueDate: a.dueDate,
      dueTime: null,
      noteId: a.noteId,
      line: a.line,
      updatedAt: a.noteUpdatedAt,
    });
  }
  out.sort((a, b) => workScore(a, todayIso) - workScore(b, todayIso));
  return out;
}

function getMeetings(
  events: Event[],
  dayStart: Date,
  meetingRules: MeetingRule[],
): MeetingBlock[] {
  const end = new Date(dayStart);
  end.setDate(end.getDate() + 1);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const raw = events.flatMap((e) => generateOccurrences(e, dayStart, end, { limit: 50 }));
  return raw
    .map((o) => {
      const parent = eventById.get(o.eventId);
      const temperament = resolveMeetingTemperament(
        parent ?? { title: o.title, prep_required: true, allow_back_to_back: false },
        meetingRules,
      );
      return {
        id: `meeting:${o.eventId}:${o.start.getTime()}`,
        eventId: o.eventId,
        title: o.title,
        start: o.start,
        end: o.end,
        prepRequired: temperament.prepRequired,
        allowBackToBack: temperament.allowBackToBack,
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function findFreeGaps(
  now: Date,
  dayEnd: Date,
  busy: Array<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const gaps: Array<{ start: Date; end: Date }> = [];
  let cursor = now.getTime() < dayEnd.getTime() ? now : dayEnd;

  for (const b of sorted) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) {
      const gapEnd = b.start.getTime() < dayEnd.getTime() ? b.start : dayEnd;
      if (gapEnd.getTime() - cursor.getTime() >= MIN_GAP_MS) {
        gaps.push({ start: new Date(cursor), end: gapEnd });
      }
    }
    if (b.end > cursor) cursor = b.end;
  }
  if (dayEnd.getTime() - cursor.getTime() >= MIN_GAP_MS) {
    gaps.push({ start: new Date(cursor), end: dayEnd });
  }
  return gaps;
}

function formatTime(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, 'h:mm a');
}

function formatTime24(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, 'HH:mm');
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateDirective(input: DirectiveInput): DirectiveReport {
  const now = input.now ?? new Date();
  const tz = input.timezone;
  const { start: dayStart, end: dayEnd, todayIso } = dayBounds(now, tz);
  const work = toUnifiedWork(input.tasks, input.actionItems, todayIso);
  const meetingRules = input.meetingRules ?? [];
  const meetings = getMeetings(input.events, dayStart, meetingRules);

  const timeline: TimelineEntry[] = [];
  const gaps: DirectiveGap[] = [];
  let gapIdx = 0;
  const nextGapId = () => `gap-${gapIdx++}`;

  // Fixed: meetings on timeline
  for (const m of meetings) {
    timeline.push({
      id: m.id,
      kind: 'meeting',
      title: m.title,
      start: m.start,
      end: m.end,
      eventId: m.eventId,
    });
  }

  // Timed work blocks (tasks due today with time)
  const timedBlocks: Array<{ start: Date; end: Date; work: UnifiedWork }> = [];
  for (const w of work) {
    if (w.kind !== 'task' || !w.dueDate || !w.dueTime) continue;
    if (w.dueDate !== todayIso && !isOverdue(w.dueDate, todayIso)) continue;
    const start = zonedInstant(w.dueDate, w.dueTime, tz);
    const end = addMinutes(start, TASK_BLOCK_MINUTES);
    timedBlocks.push({ start, end, work: w });
    timeline.push({
      id: w.id,
      kind: 'task',
      title: w.title,
      start,
      end,
      priority: w.priority,
      ref: { kind: 'task', taskId: w.taskId! },
    });
  }

  // Overlap detection
  const allBusy = [
    ...meetings.map((m) => ({ start: m.start, end: m.end, label: m.title, type: 'meeting' as const })),
    ...timedBlocks.map((t) => ({ start: t.start, end: t.end, label: t.work.title, type: 'task' as const, work: t.work })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  for (let i = 0; i < allBusy.length - 1; i++) {
    const a = allBusy[i];
    const b = allBusy[i + 1];
    if (b.start < a.end) {
      gaps.push({
        id: nextGapId(),
        kind: 'overlap',
        severity: 'critical',
        headline: 'Schedule conflict',
        detail: `"${a.label}" overlaps with "${b.label}". Decide which takes priority.`,
      });
    }
  }

  // Untimed items due today → suggest slots in free gaps
  const untimed = work.filter(
    (w) => !w.dueTime && w.dueDate && (w.dueDate === todayIso || isOverdue(w.dueDate, todayIso)),
  );
  const busyIntervals = allBusy.map((b) => ({ start: b.start, end: b.end }));
  const freeGaps = findFreeGaps(now, dayEnd, busyIntervals);

  let gapCursor = 0;
  for (const w of untimed) {
    gaps.push({
      id: nextGapId(),
      kind: 'untimed_today',
      severity: w.priority === 'critical' || isOverdue(w.dueDate!, todayIso) ? 'critical' : 'warning',
      headline: `When will you do "${w.title}"?`,
      detail: 'No time set — I assigned a suggested slot below. Adjust if needed.',
      ref: w.kind === 'task' ? { kind: 'task', taskId: w.taskId! } : { kind: 'action', noteId: w.noteId!, line: w.line! },
      suggestedDate: w.dueDate ?? todayIso,
    });

    if (gapCursor < freeGaps.length) {
      const slot = freeGaps[gapCursor];
      gapCursor++;
      const suggestedTime = formatTime24(slot.start, tz);
      const g = gaps[gaps.length - 1];
      g.suggestedTime = suggestedTime;

      timeline.push({
        id: `suggested:${w.id}`,
        kind: w.kind === 'task' ? 'task' : 'action',
        title: w.title,
        start: slot.start,
        end: addMinutes(slot.start, TASK_BLOCK_MINUTES),
        priority: w.priority,
        ref:
          w.kind === 'task'
            ? { kind: 'task', taskId: w.taskId! }
            : { kind: 'action', noteId: w.noteId!, line: w.line! },
        suggested: true,
      });
    }
  }

  // Critical without due date
  for (const w of work.filter((x) => !x.dueDate && (x.priority === 'critical' || x.priority === 'urgent'))) {
    gaps.push({
      id: nextGapId(),
      kind: 'untimed_today',
      severity: 'warning',
      headline: `"${w.title}" has no due date`,
      detail: 'Set when you plan to do this so I can protect time for it.',
      ref:
        w.kind === 'task'
          ? { kind: 'task', taskId: w.taskId! }
          : { kind: 'action', noteId: w.noteId!, line: w.line! },
      suggestedDate: todayIso,
    });
  }

  // Prep gaps (skip routine meetings marked no-prep)
  for (const m of meetings) {
    if (!m.prepRequired) continue;
    if (m.start <= now) continue;
    const msUntil = m.start.getTime() - now.getTime();
    if (msUntil > PREP_WINDOW_MS) continue;
    const linked = work.find((w) => w.linkedEventId === m.eventId);
    const hasPrep = linked && !input.tasks.find((t) => t.id === linked.taskId)?.done;
    if (!hasPrep) {
      gaps.push({
        id: nextGapId(),
        kind: 'prep_needed',
        severity: msUntil < 15 * 60_000 ? 'critical' : 'warning',
        headline: `Prep for "${m.title}"`,
        detail: `Meeting in ${Math.max(1, Math.round(msUntil / 60_000))} min — link or create a prep task.`,
        eventId: m.eventId,
        meetingTitle: m.title,
        suggestedTime: formatTime24(now, tz),
        suggestedDate: todayIso,
      });
    }
  }

  // Back-to-back warnings between consecutive meetings
  for (let i = 0; i < meetings.length - 1; i++) {
    const a = meetings[i];
    const b = meetings[i + 1];
    if (
      isBackToBackPair(a.end, b.start, a.allowBackToBack, b.allowBackToBack) &&
      b.start > now
    ) {
      gaps.push({
        id: nextGapId(),
        kind: 'back_to_back',
        severity: 'warning',
        headline: `Back-to-back: "${a.title}" → "${b.title}"`,
        detail: 'Less than 10 min between meetings — add buffer or mark as OK.',
        eventId: b.eventId,
        relatedEventId: a.eventId,
        meetingTitle: b.title,
      });
    }
  }

  // Orphan follow-ups (linked event passed, task still open)
  for (const w of work) {
    if (w.kind !== 'task' || !w.linkedEventId) continue;
    const meeting = meetings.find((m) => m.eventId === w.linkedEventId);
    if (meeting && meeting.end < now) {
      gaps.push({
        id: nextGapId(),
        kind: 'orphan_followup',
        severity: 'warning',
        headline: `Follow up after "${meeting.title}"?`,
        detail: `"${w.title}" was linked to a meeting that already ended.`,
        ref: { kind: 'task', taskId: w.taskId! },
        eventId: w.linkedEventId,
      });
    }
  }

  // Stale waiting
  for (const w of work) {
    if (!w.waitingOn?.trim()) continue;
    const days = Math.floor((now.getTime() - new Date(w.updatedAt).getTime()) / 86_400_000);
    if (days >= 14) {
      gaps.push({
        id: nextGapId(),
        kind: 'stale_waiting',
        severity: 'info',
        headline: `Still waiting on ${w.waitingOn.trim()}?`,
        detail: `"${w.title}" hasn't moved in ${days} days.`,
        ref: { kind: 'task', taskId: w.taskId! },
      });
    }
  }

  // Too many critical
  const criticalCount = work.filter((w) => w.priority === 'critical').length;
  if (criticalCount >= 3) {
    gaps.push({
      id: nextGapId(),
      kind: 'pick_focus',
      severity: 'critical',
      headline: `${criticalCount} critical items — pick one focus`,
      detail: 'Too many top priorities. Choose what gets the next block of time.',
    });
  }

  // No calendar visibility
  if (!input.hasCalendarSource && meetings.length === 0) {
    gaps.push({
      id: nextGapId(),
      kind: 'no_calendar',
      severity: 'info',
      headline: "I can't see your calendar",
      detail: 'Add an Outlook ICS URL in Profile or create events so I can plan around meetings.',
    });
  }

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Gap entries on timeline (free windows without assignment)
  for (const g of freeGaps.slice(gapCursor)) {
    if (g.end <= now) continue;
    timeline.push({
      id: `free:${g.start.getTime()}`,
      kind: 'gap',
      title: 'Open time',
      start: g.start,
      end: g.end,
    });
  }
  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());

  // NOW directive
  const nowDirective = buildNowDirective(now, tz, meetings, timeline, work, dayEnd);

  // NEXT: entries starting within ~3 hours after now
  const horizon = addMinutes(now, 180);
  const next = timeline.filter((e) => e.end > now && e.start < horizon);

  return {
    generatedAt: now,
    timezone: tz,
    todayIso,
    now: nowDirective,
    next,
    timeline: timeline.filter((e) => e.end > now),
    gaps,
  };
}

function buildNowDirective(
  now: Date,
  tz: string,
  meetings: MeetingBlock[],
  timeline: TimelineEntry[],
  work: UnifiedWork[],
  dayEnd: Date,
): NowDirective {
  const inMeeting = meetings.find((m) => now >= m.start && now < m.end);
  if (inMeeting) {
    return {
      kind: 'in_meeting',
      headline: inMeeting.title,
      detail: `In meeting until ${formatTime(inMeeting.end, tz)}`,
      until: inMeeting.end,
      eventId: inMeeting.eventId,
    };
  }

  const nextMeeting = meetings.find((m) => m.start > now);
  if (nextMeeting?.prepRequired) {
    const msUntil = nextMeeting.start.getTime() - now.getTime();
    if (msUntil <= PREP_WINDOW_MS) {
      const linked = work.find((w) => w.linkedEventId === nextMeeting.eventId);
      if (linked) {
        return {
          kind: 'prep',
          headline: `Prep: ${linked.title}`,
          detail: `${nextMeeting.title} starts at ${formatTime(nextMeeting.start, tz)}`,
          until: nextMeeting.start,
          ref:
            linked.kind === 'task'
              ? { kind: 'task', taskId: linked.taskId! }
              : { kind: 'action', noteId: linked.noteId!, line: linked.line! },
          eventId: nextMeeting.eventId,
        };
      }
      return {
        kind: 'prep',
        headline: `Prep for ${nextMeeting.title}`,
        detail: `Starts in ${Math.max(1, Math.round(msUntil / 60_000))} min — no prep task linked yet.`,
        until: nextMeeting.start,
        eventId: nextMeeting.eventId,
      };
    }
  }

  const activeWork = timeline.find(
    (e) =>
      (e.kind === 'task' || e.kind === 'action' || e.kind === 'suggested') &&
      now >= e.start &&
      now < e.end,
  );
  if (activeWork) {
    return {
      kind: 'work',
      headline: activeWork.title,
      detail: activeWork.suggested
        ? `Suggested block until ${formatTime(activeWork.end, tz)} — confirm or move the time.`
        : `Scheduled until ${formatTime(activeWork.end, tz)}`,
      until: activeWork.end,
      ref: activeWork.ref,
    };
  }

  const upcomingSuggestion = timeline.find(
    (e) => (e.kind === 'suggested' || e.kind === 'task' || e.kind === 'action') && e.start > now,
  );
  if (upcomingSuggestion) {
    const mins = Math.round((upcomingSuggestion.start.getTime() - now.getTime()) / 60_000);
    return {
      kind: 'gap',
      headline: upcomingSuggestion.suggested ? upcomingSuggestion.title : 'Open time',
      detail: upcomingSuggestion.suggested
        ? `Suggested at ${formatTime(upcomingSuggestion.start, tz)} (${mins} min) — get ready or adjust.`
        : `Next: ${upcomingSuggestion.title} at ${formatTime(upcomingSuggestion.start, tz)}`,
      until: upcomingSuggestion.start,
      ref: upcomingSuggestion.ref,
    };
  }

  if (now >= dayEnd) {
    return {
      kind: 'wind_down',
      headline: 'Day is winding down',
      detail: 'No more scheduled blocks. Review tomorrow or close out open items.',
    };
  }

  const top = work[0];
  if (top) {
    return {
      kind: 'free',
      headline: top.title,
      detail: 'Open time — this is your highest-priority work right now.',
      ref:
        top.kind === 'task'
          ? { kind: 'task', taskId: top.taskId! }
          : { kind: 'action', noteId: top.noteId!, line: top.line! },
    };
  }

  return {
    kind: 'free',
    headline: 'All clear for now',
    detail: 'No urgent work on the board. Capture something or enjoy the breathing room.',
  };
}
