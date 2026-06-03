/**
 * Executive directive engine — time-aware NOW / NEXT / GAPS / timeline.
 * Pure TypeScript, no API calls. Used when the assistant addon is enabled.
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { ActionItem } from './format';
import { actionItemHasMatchingOpenTask } from './taskActionMatch';
import type { TaskPriority } from './priority';
import { priorityRank } from './priority';
import { normalizeDueTime } from './taskSchedule';
import { generateOccurrences, dedupeOccurrences } from './recurrence';
import {
  type MeetingRule,
  isBackToBackPair,
  resolveMeetingTemperament,
} from './meetingTemperament';
import {
  DEBRIEF_WINDOW_MS,
  findDebriefState,
  isDebriefSuppressed,
  isInDebriefWindow,
  occurrenceStartKey,
} from './meetingDebrief';
import { PREP_BLOCK_MINUTES, hasOpenLinkedTask, prepBlockStart, prepTaskTitle } from './meetingLifecycle';
import {
  computeCapacitySnapshot,
  formatEstimateMinutes,
  hasExplicitEstimate,
  workMinutesForItem,
  type CapacitySnapshot,
} from './taskCapacity';
import {
  CHASE_THRESHOLD_DAYS,
  chaseSeverity,
  daysIdle,
  isChaseSnoozed,
} from './delegationChase';
import type { Event, MeetingDebriefState, Task } from '../types';

const PREP_WINDOW_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 20 * 60 * 1000;
const DAY_END_HOUR = 17;

/** End of the executive workday (local hour) for capacity, wind-down, and HUD copy. */
export function executiveDayEndHour(): number {
  return DAY_END_HOUR;
}

export function formatDayEndLabel(hour = DAY_END_HOUR): string {
  const h = hour % 12 || 12;
  const suffix = hour >= 12 ? 'pm' : 'am';
  return `${h}${suffix}`;
}

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

export type NowKind = 'in_meeting' | 'prep' | 'debrief' | 'work' | 'gap' | 'wind_down' | 'free';

export type NowDirective = {
  kind: NowKind;
  headline: string;
  detail: string;
  until?: Date;
  ref?: WorkItemRef;
  eventId?: string;
  /** ISO start of the meeting occurrence (debrief). */
  occurrenceStartAt?: string;
};

export type GapKind =
  | 'untimed_today'
  | 'prep_needed'
  | 'back_to_back'
  | 'meeting_debrief'
  | 'overlap'
  | 'no_calendar'
  | 'pick_focus'
  | 'orphan_followup'
  | 'delegation_chase'
  | 'missing_estimate'
  | 'capacity_overcommit';

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
  /** ISO start of the specific meeting occurrence. */
  occurrenceStartAt?: string;
  /** Suggested HH:MM (profile TZ) for set-time actions. */
  suggestedTime?: string;
  suggestedDate?: string;
  /** Counterparty for delegation chase gaps. */
  waitingOn?: string;
  /** Suggested estimate (minutes) for missing_estimate gaps. */
  suggestedMinutes?: number;
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
  /** Capacity math for HUD (meetings + estimated work vs time until day-end). */
  capacity: CapacitySnapshot;
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
  /** Per-occurrence debrief dismiss / snooze / done states. */
  debriefStates?: MeetingDebriefState[];
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
  estimatedMinutes?: number | null;
};

/** Open work item ranked for today's executive assistant (critical / urgent / due today). */
export type FocusWorkItem = UnifiedWork;

export function buildPrioritizedWork(
  tasks: Task[],
  actionItems: ActionItem[],
  todayIso: string,
): FocusWorkItem[] {
  return toUnifiedWork(tasks, actionItems, todayIso);
}

type MeetingBlock = {
  id: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  prepRequired: boolean;
  allowBackToBack: boolean;
  debriefRequired: boolean;
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
      estimatedMinutes: t.estimated_minutes,
    });
  }
  for (const a of actionItems) {
    if (actionItemHasMatchingOpenTask(tasks, a)) continue;
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
  const raw = dedupeOccurrences(events.flatMap((e) => generateOccurrences(e, dayStart, end, { limit: 50 })));
  return raw
    .map((o) => {
      const parent = eventById.get(o.eventId);
      const temperament = resolveMeetingTemperament(
        parent ?? {
          title: o.title,
          prep_required: true,
          allow_back_to_back: false,
          debrief_required: true,
        },
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
        debriefRequired: temperament.debriefRequired,
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
  const debriefStates = input.debriefStates ?? [];
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
    const blockMins = workMinutesForItem('task', w.taskId, input.tasks);
    const end = addMinutes(start, blockMins);
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
      const needed = workMinutesForItem(w.kind, w.taskId, input.tasks);
      let slotIndex = gapCursor;
      while (slotIndex < freeGaps.length) {
        const slot = freeGaps[slotIndex]!;
        const slotMins = (slot.end.getTime() - slot.start.getTime()) / 60_000;
        if (slotMins >= needed) {
          gapCursor = slotIndex + 1;
          const suggestedTime = formatTime24(slot.start, tz);
          const g = gaps[gaps.length - 1]!;
          g.suggestedTime = suggestedTime;

          timeline.push({
            id: `suggested:${w.id}`,
            kind: w.kind === 'task' ? 'task' : 'action',
            title: w.title,
            start: slot.start,
            end: addMinutes(slot.start, needed),
            priority: w.priority,
            ref:
              w.kind === 'task'
                ? { kind: 'task', taskId: w.taskId! }
                : { kind: 'action', noteId: w.noteId!, line: w.line! },
            suggested: true,
          });
          break;
        }
        slotIndex++;
      }
      if (slotIndex >= freeGaps.length) {
        gapCursor = freeGaps.length;
      }
    }
  }

  // Missing time estimates for due-today / overdue tasks
  for (const w of work) {
    if (w.kind !== 'task' || !w.taskId) continue;
    if (!isDueTodayOrOverdue(w.dueDate, todayIso) && w.priority !== 'critical' && w.priority !== 'urgent') {
      continue;
    }
    const task = input.tasks.find((t) => t.id === w.taskId);
    if (!task || hasExplicitEstimate(task.estimated_minutes)) continue;
    gaps.push({
      id: nextGapId(),
      kind: 'missing_estimate',
      severity: w.priority === 'critical' || (w.dueDate && isOverdue(w.dueDate, todayIso)) ? 'warning' : 'info',
      headline: `How long is "${w.title}"?`,
      detail: 'Add a time estimate so capacity math reflects reality.',
      ref: { kind: 'task', taskId: w.taskId },
      suggestedMinutes: 30,
    });
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

  // Suggested prep blocks (15 min before meetings that need prep)
  for (const m of meetings) {
    if (!m.prepRequired || m.start <= now) continue;
    if (hasOpenLinkedTask(m.eventId, input.tasks)) continue;
    const blockStart = prepBlockStart(m.start);
    const effectiveStart = blockStart < now ? now : blockStart;
    if (effectiveStart >= m.start) continue;
    timeline.push({
      id: `prep-suggested:${m.eventId}:${m.start.getTime()}`,
      kind: 'suggested',
      title: prepTaskTitle(m.title),
      start: effectiveStart,
      end: m.start,
      eventId: m.eventId,
      suggested: true,
    });
  }

  // Prep gaps (skip routine meetings marked no-prep)
  for (const m of meetings) {
    if (!m.prepRequired) continue;
    if (m.start <= now) continue;
    const msUntil = m.start.getTime() - now.getTime();
    if (msUntil > PREP_WINDOW_MS) continue;
    if (hasOpenLinkedTask(m.eventId, input.tasks)) continue;
    const blockStart = prepBlockStart(m.start);
    const slotStart = blockStart < now ? now : blockStart;
    gaps.push({
      id: nextGapId(),
      kind: 'prep_needed',
      severity: msUntil < PREP_BLOCK_MINUTES * 60_000 ? 'critical' : 'warning',
      headline: `Prep for "${m.title}"`,
      detail: `${PREP_BLOCK_MINUTES}-min prep block suggested before meeting — create a linked prep task or accept the slot.`,
      eventId: m.eventId,
      meetingTitle: m.title,
      suggestedTime: formatTime24(slotStart, tz),
      suggestedDate: todayIso,
    });
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

  // Post-meeting debrief (0–15 min after end)
  for (const m of meetings) {
    if (!m.debriefRequired) continue;
    if (!isInDebriefWindow(now, m.end)) continue;
    const state = findDebriefState(debriefStates, m.eventId, m.start);
    if (isDebriefSuppressed(state, now)) continue;
    const minsAgo = Math.max(1, Math.round((now.getTime() - m.end.getTime()) / 60_000));
    gaps.push({
      id: nextGapId(),
      kind: 'meeting_debrief',
      severity: 'warning',
      headline: `Capture outcomes from "${m.title}"?`,
      detail: `Meeting ended ${minsAgo} min ago — note follow-ups while it's fresh.`,
      eventId: m.eventId,
      meetingTitle: m.title,
      occurrenceStartAt: occurrenceStartKey(m.start),
    });
  }

  // Orphan follow-ups (linked event passed, task still open)
  for (const w of work) {
    if (w.kind !== 'task' || !w.linkedEventId) continue;
    const meeting = meetings.find((m) => m.eventId === w.linkedEventId && m.end < now);
    if (!meeting) continue;
    const debriefActive = gaps.some(
      (g) =>
        g.kind === 'meeting_debrief' &&
        g.eventId === meeting.eventId &&
        g.occurrenceStartAt === occurrenceStartKey(meeting.start),
    );
    if (debriefActive) continue;
    gaps.push({
      id: nextGapId(),
      kind: 'orphan_followup',
      severity: 'warning',
      headline: `Follow up after "${meeting.title}"?`,
      detail: `"${w.title}" was linked to a meeting that already ended — schedule a follow-up or mark done.`,
      ref: { kind: 'task', taskId: w.taskId! },
      eventId: w.linkedEventId,
      meetingTitle: meeting.title,
    });
  }

  // Delegation chase — open tasks waiting on someone with no movement
  for (const t of input.tasks) {
    if (t.done || !t.waiting_on?.trim()) continue;
    if (isChaseSnoozed(t, now)) continue;
    const days = daysIdle(t, now);
    if (days < CHASE_THRESHOLD_DAYS) continue;
    const who = t.waiting_on.trim();
    gaps.push({
      id: nextGapId(),
      kind: 'delegation_chase',
      severity: chaseSeverity(days),
      headline: `Chase ${who} on "${t.title}"?`,
      detail: `No movement in ${days} day${days === 1 ? '' : 's'}. Ping them, bump priority, or mark received.`,
      ref: { kind: 'task', taskId: t.id },
      waitingOn: who,
    });
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
  const nowDirective = buildNowDirective(now, tz, meetings, timeline, work, dayEnd, debriefStates);

  // NEXT: entries starting within ~3 hours after now
  const horizon = addMinutes(now, 180);
  const next = timeline.filter((e) => e.end > now && e.start < horizon);
  const futureTimeline = timeline.filter((e) => e.end > now);

  const capacity = computeCapacitySnapshot({
    now,
    dayEnd,
    timeline: futureTimeline,
    gaps,
    tasks: input.tasks,
  });

  if (capacity.overcommitMinutes >= 30) {
    gaps.unshift({
      id: nextGapId(),
      kind: 'capacity_overcommit',
      severity: capacity.capacityRatio > 1.15 ? 'critical' : 'warning',
      headline: `Overcommitted by ~${formatEstimateMinutes(capacity.overcommitMinutes)}`,
      detail: `${formatEstimateMinutes(capacity.bookedMinutes)} planned, ${formatEstimateMinutes(capacity.remainingMinutes)} left until ${formatDayEndLabel()} — defer work, shorten estimates, or block focus time.`,
    });
  }

  return {
    generatedAt: now,
    timezone: tz,
    todayIso,
    now: nowDirective,
    next,
    timeline: futureTimeline,
    gaps,
    capacity,
  };
}

function buildNowDirective(
  now: Date,
  tz: string,
  meetings: MeetingBlock[],
  timeline: TimelineEntry[],
  work: UnifiedWork[],
  dayEnd: Date,
  debriefStates: MeetingDebriefState[],
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

  const debriefMeeting = meetings.find((m) => {
    if (!m.debriefRequired) return false;
    if (!isInDebriefWindow(now, m.end)) return false;
    const state = findDebriefState(debriefStates, m.eventId, m.start);
    return !isDebriefSuppressed(state, now);
  });
  if (debriefMeeting) {
    const minsAgo = Math.max(1, Math.round((now.getTime() - debriefMeeting.end.getTime()) / 60_000));
    return {
      kind: 'debrief',
      headline: debriefMeeting.title,
      detail: `Meeting ended ${minsAgo} min ago — capture outcomes and follow-ups.`,
      until: new Date(debriefMeeting.end.getTime() + DEBRIEF_WINDOW_MS),
      eventId: debriefMeeting.eventId,
      occurrenceStartAt: occurrenceStartKey(debriefMeeting.start),
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
