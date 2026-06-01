/**
 * Executive Assistant Briefing Engine
 *
 * Pure TypeScript — zero API calls, zero cost.
 * Reads across tasks, notes, calendar events, and owed-to-me items to produce
 * a structured briefing with three registers:
 *   1. Nuts & Bolts  — hard data, counts, deadlines
 *   2. Watch List    — cross-references and things that could slip
 *   3. Nudges        — honest pushback (reschedule counters, stale items, etc.)
 *
 * Time-of-day mode shapes which insights are surfaced and how urgent the tone is.
 */

import type { Task } from '../types';
import type { ActionItem } from './format';
import type { Note } from '../types';
import type { Event } from '../types';
import { generateOccurrences } from './recurrence';
import {
  type MeetingRule,
  isBackToBackPair,
  resolveMeetingTemperament,
} from './meetingTemperament';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefingMode = 'morning' | 'midday' | 'afternoon' | 'evening';

export type InsightSeverity = 'info' | 'warning' | 'critical' | 'nudge';

export interface BriefingInsight {
  id: string;
  severity: InsightSeverity;
  section: 'nuts' | 'watch' | 'nudge';
  headline: string;
  detail: string;
  /** Optional: a task or note ID the user can act on */
  actionTarget?: { kind: 'task' | 'note'; id: string };
}

export interface NutsAndBolts {
  totalOpenTasks: number;
  criticalTasks: number;
  overdueCount: number;
  dueTodayCount: number;
  dueThisWeekCount: number;
  owedToMeCount: number;
  owedStaleDays14: number;
  todayEventCount: number;
  backToBackCount: number;
  recentNotesCount: number;
}

export interface BriefingReport {
  mode: BriefingMode;
  modeLabel: string;
  modeDescription: string;
  generatedAt: Date;
  nuts: NutsAndBolts;
  insights: BriefingInsight[];
  /** Extracted reminders from notes that need user action */
  proposals: NoteProposal[];
}

export interface NoteProposal {
  id: string;
  noteId: string;
  noteTitle: string;
  type: 'reminder' | 'follow-up' | 'review';
  text: string;
  /** Suggested due date (YYYY-MM-DD) if extractable */
  suggestedDueDate: string | null;
  /** Suggested task title */
  suggestedTaskTitle: string;
}

// ---------------------------------------------------------------------------
// Time-of-day
// ---------------------------------------------------------------------------

export function getBriefingMode(now: Date = new Date()): BriefingMode {
  const hour = now.getHours();
  if (hour >= 6 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  return 'evening';
}

export const MODE_META: Record<BriefingMode, { label: string; description: string }> = {
  morning: {
    label: 'Launch Mode',
    description: "Here's your day. Priorities, gaps, and what to watch before the meetings start.",
  },
  midday: {
    label: 'Pulse Check',
    description: "Halfway through. Here's what hasn't moved and what's still live.",
  },
  afternoon: {
    label: 'Wind Down',
    description: "End of day approaching. Here's what to close, what to defer, and a preview of tomorrow.",
  },
  evening: {
    label: 'Tomorrow Prep',
    description: "Day's done. Here's your tomorrow brief and anything worth prepping tonight.",
  },
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffDays(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const t = today();
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

function daysSinceUpdated(isoStr: string): number {
  const updated = new Date(isoStr);
  const now = new Date();
  return Math.floor((now.getTime() - updated.getTime()) / 86_400_000);
}

function startOfWeek(): Date {
  const d = today();
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(): Date {
  const sow = startOfWeek();
  const eow = new Date(sow);
  eow.setDate(sow.getDate() + 6);
  return eow;
}

function isoToday(): string {
  const d = today();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Staleness thresholds (by priority)
// ---------------------------------------------------------------------------

const STALE_DAYS: Record<string, number> = {
  critical: 3,
  urgent:   5,
  high:     10,
  normal:   21,
  low:      45,
};

// ---------------------------------------------------------------------------
// Note signal extraction
// ---------------------------------------------------------------------------

const REMINDER_PATTERNS: Array<{
  re: RegExp;
  type: NoteProposal['type'];
  extractDate?: (m: RegExpMatchArray, now: Date) => string | null;
  extractTitle?: (m: RegExpMatchArray, context: string) => string;
}> = [
  // "remember in 3 months" / "revisit in 2 weeks" / "check back in 6 months"
  {
    re: /(?:remember|revisit|check back|follow up|review|look at this again)\s+(?:this\s+)?in\s+(\d+)\s+(days?|weeks?|months?)/i,
    type: 'reminder',
    extractDate: (m, now) => {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const d = new Date(now);
      if (unit.startsWith('day')) d.setDate(d.getDate() + n);
      else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7);
      else if (unit.startsWith('month')) d.setMonth(d.getMonth() + n);
      return isoDate(d);
    },
    extractTitle: (_m, ctx) => {
      const clean = ctx.replace(/\s+/g, ' ').slice(0, 80);
      return `Reminder: ${clean}`;
    },
  },
  // "follow up with [Name]"
  {
    re: /follow[- ]?up\s+with\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
    type: 'follow-up',
    extractDate: () => null,
    extractTitle: (m) => `Follow up with ${m[1]}`,
  },
  // "need to remember to [verb phrase]"
  {
    re: /need to remember(?:\s+to)?\s+(.{10,80})/i,
    type: 'reminder',
    extractDate: () => null,
    extractTitle: (m) => `Remember: ${m[1].trim()}`,
  },
  // "by [month] [year]" or "by Q[1-4] [year]" e.g. "by October 2026" / "by Q4 2026"
  {
    re: /by\s+(Q[1-4])\s+(\d{4})/i,
    type: 'review',
    extractDate: (m) => {
      const qStart = { Q1: '01', Q2: '04', Q3: '07', Q4: '10' } as Record<string, string>;
      const mo = qStart[m[1].toUpperCase()] ?? '01';
      return `${m[2]}-${mo}-01`;
    },
    extractTitle: (m, ctx) => `Review by ${m[1]} ${m[2]}: ${ctx.slice(0, 60)}`,
  },
];

export function extractNoteProposals(notes: Note[]): NoteProposal[] {
  const proposals: NoteProposal[] = [];
  const now = new Date();

  for (const note of notes) {
    const content: string =
      typeof note.content === 'string' ? note.content : '';
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip completed checkboxes
      if (/^\s*[-*+]\s+\[x\]/i.test(line)) continue;

      for (const pattern of REMINDER_PATTERNS) {
        const m = line.match(pattern.re);
        if (!m) continue;

        const context = line.replace(/^\s*[-*+]?\s*\[[ ]\]?\s*/, '').trim();
        const suggestedDueDate = pattern.extractDate ? pattern.extractDate(m, now) : null;
        const suggestedTaskTitle = pattern.extractTitle
          ? pattern.extractTitle(m, context)
          : context.slice(0, 80);

        // Dedupe: don't emit the same pattern from the same note twice
        const proposalId = `proposal:${note.id}:${pattern.type}:${m[0].slice(0, 20)}`;
        if (proposals.some((p) => p.id === proposalId)) continue;

        proposals.push({
          id: proposalId,
          noteId: note.id,
          noteTitle: note.title || 'Untitled',
          type: pattern.type,
          text: context,
          suggestedDueDate,
          suggestedTaskTitle: suggestedTaskTitle.slice(0, 120),
        });
        break; // only first matching pattern per line
      }
    }
  }

  return proposals.slice(0, 10); // cap at 10 proposals
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

function getTodayOccurrences(
  events: Event[],
  now: Date,
): Array<{ eventId: string; title: string; start: Date; end: Date }> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const all = events.flatMap((e) => generateOccurrences(e, start, end, { limit: 50 }));
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  return all.map((o) => ({ eventId: o.eventId, title: o.title, start: o.start, end: o.end }));
}

function getTomorrowOccurrences(events: Event[], now: Date): Array<{ title: string; start: Date; end: Date }> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const all = events.flatMap((e) => generateOccurrences(e, start, end, { limit: 50 }));
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  return all.map((o) => ({ title: o.title, start: o.start, end: o.end }));
}

/** Count back-to-back meeting pairs (gap < 10 min), respecting temperament flags. */
function countBackToBack(
  occurrences: Array<{ eventId: string; title: string; start: Date; end: Date }>,
  events: Event[],
  meetingRules: MeetingRule[],
): number {
  const eventById = new Map(events.map((e) => [e.id, e]));
  let count = 0;
  for (let i = 0; i < occurrences.length - 1; i++) {
    const a = occurrences[i];
    const b = occurrences[i + 1];
    const aTemp = resolveMeetingTemperament(
      eventById.get(a.eventId) ?? {
        title: a.title,
        prep_required: true,
        allow_back_to_back: false,
        debrief_required: true,
      },
      meetingRules,
    );
    const bTemp = resolveMeetingTemperament(
      eventById.get(b.eventId) ?? {
        title: b.title,
        prep_required: true,
        allow_back_to_back: false,
        debrief_required: true,
      },
      meetingRules,
    );
    if (isBackToBackPair(a.end, b.start, aTemp.allowBackToBack, bTemp.allowBackToBack)) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main briefing generator
// ---------------------------------------------------------------------------

export interface BriefingInput {
  tasks: Task[];
  actionItems: ActionItem[];
  notes: Note[];
  events: Event[];
  now?: Date;
  meetingRules?: MeetingRule[];
}

export function generateBriefing(input: BriefingInput): BriefingReport {
  const now = input.now ?? new Date();
  const mode = getBriefingMode(now);
  const meta = MODE_META[mode];

  const { tasks, actionItems, notes, events } = input;
  const openTasks = tasks.filter((t) => !t.done);
  const todayIso = isoToday();
  const eow = endOfWeek();
  const eowIso = isoDate(eow);

  // ---- Calendar ----
  const todayEvents = getTodayOccurrences(events, now);
  const tomorrowEvents = getTomorrowOccurrences(events, now);
  const meetingRules = input.meetingRules ?? [];
  const backToBackCount = countBackToBack(todayEvents, events, meetingRules);

  // ---- Nuts & Bolts counts ----
  const criticalTasks = openTasks.filter((t) => t.priority === 'critical');
  const overdueCount = openTasks.filter((t) => {
    const d = diffDays(t.due_date);
    return d !== null && d < 0;
  }).length;
  const dueTodayCount = openTasks.filter((t) => t.due_date === todayIso).length;
  const dueThisWeekCount = openTasks.filter((t) => {
    if (!t.due_date) return false;
    return t.due_date >= todayIso && t.due_date <= eowIso;
  }).length;
  const owedToMeTasks = openTasks.filter((t) => t.waiting_on?.trim());
  const owedStaleDays14 = owedToMeTasks.filter((t) => daysSinceUpdated(t.updated_at) >= 14).length;

  const nuts: NutsAndBolts = {
    totalOpenTasks: openTasks.length + actionItems.length,
    criticalTasks: criticalTasks.length,
    overdueCount,
    dueTodayCount,
    dueThisWeekCount,
    owedToMeCount: owedToMeTasks.length,
    owedStaleDays14,
    todayEventCount: todayEvents.length,
    backToBackCount,
    recentNotesCount: notes.length,
  };

  // ---- Build insights ----
  const insights: BriefingInsight[] = [];
  let insightIndex = 0;
  const nextId = () => `insight-${insightIndex++}`;

  // --- NUTS SECTION ---

  if (criticalTasks.length > 0) {
    insights.push({
      id: nextId(),
      severity: 'critical',
      section: 'nuts',
      headline: `${criticalTasks.length} critical task${criticalTasks.length > 1 ? 's' : ''} demand attention`,
      detail: criticalTasks.slice(0, 3).map((t) => `"${t.title}"`).join(', ') +
        (criticalTasks.length > 3 ? ` +${criticalTasks.length - 3} more` : ''),
      actionTarget: criticalTasks[0] ? { kind: 'task', id: criticalTasks[0].id } : undefined,
    });
  }

  if (overdueCount > 0) {
    const overdueTasks = openTasks
      .filter((t) => { const d = diffDays(t.due_date); return d !== null && d < 0; })
      .slice(0, 3);
    insights.push({
      id: nextId(),
      severity: 'warning',
      section: 'nuts',
      headline: `${overdueCount} task${overdueCount > 1 ? 's are' : ' is'} past due`,
      detail: overdueTasks.map((t) => {
        const d = diffDays(t.due_date)!;
        return `"${t.title}" (${Math.abs(d)}d overdue)`;
      }).join(', '),
      actionTarget: overdueTasks[0] ? { kind: 'task', id: overdueTasks[0].id } : undefined,
    });
  }

  if (backToBackCount > 0 && (mode === 'morning' || mode === 'midday')) {
    insights.push({
      id: nextId(),
      severity: 'info',
      section: 'nuts',
      headline: `${backToBackCount} back-to-back meeting${backToBackCount > 1 ? 's' : ''} today`,
      detail: 'No buffer between them. Any prep or decisions should happen before the block starts.',
    });
  }

  if (mode === 'morning' && dueThisWeekCount > 0) {
    insights.push({
      id: nextId(),
      severity: 'info',
      section: 'nuts',
      headline: `${dueThisWeekCount} task${dueThisWeekCount > 1 ? 's' : ''} due this week`,
      detail: dueTodayCount > 0
        ? `Including ${dueTodayCount} due today.`
        : 'None due today specifically — but the week is live.',
    });
  }

  if ((mode === 'afternoon' || mode === 'evening') && dueTodayCount > 0) {
    const todayTasks = openTasks.filter((t) => t.due_date === todayIso);
    insights.push({
      id: nextId(),
      severity: 'warning',
      section: 'nuts',
      headline: `${dueTodayCount} task${dueTodayCount > 1 ? 's' : ''} due today still open`,
      detail: todayTasks.slice(0, 3).map((t) => `"${t.title}"`).join(', '),
      actionTarget: todayTasks[0] ? { kind: 'task', id: todayTasks[0].id } : undefined,
    });
  }

  // --- WATCH SECTION ---

  // Owed-to-me cross-ref: people in owed-to-me list who appear in today's/tomorrow's calendar
  if (owedToMeTasks.length > 0) {
    const calendarTitles = [...todayEvents, ...tomorrowEvents].map((e) => e.title.toLowerCase());
    const chaseWindows: string[] = [];
    for (const t of owedToMeTasks) {
      const name = t.waiting_on?.trim();
      if (!name) continue;
      // Split the name into tokens and see if any appear in a calendar event title
      const tokens = name.toLowerCase().split(/\s+/);
      const found = calendarTitles.some((ct) => tokens.some((tok) => tok.length > 2 && ct.includes(tok)));
      if (found) chaseWindows.push(name);
    }
    if (chaseWindows.length > 0) {
      insights.push({
        id: nextId(),
        severity: 'warning',
        section: 'watch',
        headline: `Chase window: ${chaseWindows.slice(0, 2).join(' and ')} on your calendar`,
        detail: `${chaseWindows.join(', ')} appear${chaseWindows.length === 1 ? 's' : ''} in your schedule today or tomorrow — and you have open "Owed to me" items for them. Good window to follow up.`,
      });
    }
  }

  // Stale owed-to-me
  if (owedStaleDays14 > 0) {
    insights.push({
      id: nextId(),
      severity: 'warning',
      section: 'watch',
      headline: `${owedStaleDays14} "Owed to me" item${owedStaleDays14 > 1 ? 's have' : ' has'} gone cold (14+ days)`,
      detail: owedToMeTasks
        .filter((t) => daysSinceUpdated(t.updated_at) >= 14)
        .slice(0, 3)
        .map((t) => `"${t.title}" (waiting on ${t.waiting_on})`)
        .join('; '),
    });
  }

  // Tomorrow's meetings with no prep notes/tasks
  if ((mode === 'afternoon' || mode === 'evening') && tomorrowEvents.length > 0) {
    const unprepared: string[] = [];
    for (const ev of tomorrowEvents.slice(0, 5)) {
      const evWords = ev.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const hasRelatedNote = notes.some((n) =>
        evWords.some((w) => (n.title + ' ' + (typeof n.content === 'string' ? n.content : '')).toLowerCase().includes(w)),
      );
      const hasRelatedTask = openTasks.some((t) =>
        evWords.some((w) => t.title.toLowerCase().includes(w)),
      );
      if (!hasRelatedNote && !hasRelatedTask) {
        unprepared.push(ev.title);
      }
    }
    if (unprepared.length > 0) {
      insights.push({
        id: nextId(),
        severity: 'warning',
        section: 'watch',
        headline: `${unprepared.length} tomorrow meeting${unprepared.length > 1 ? 's' : ''} with no prep notes or tasks`,
        detail: unprepared.slice(0, 3).map((t) => `"${t}"`).join(', ') + ' — worth a quick note before you close out.',
      });
    }
  }

  // Stale high-priority tasks (based on STALE_DAYS thresholds)
  const stalePriorityTasks = openTasks.filter((t) => {
    const threshold = STALE_DAYS[t.priority] ?? 21;
    return daysSinceUpdated(t.updated_at) >= threshold && t.priority !== 'low';
  });
  if (stalePriorityTasks.length > 0) {
    insights.push({
      id: nextId(),
      severity: 'warning',
      section: 'watch',
      headline: `${stalePriorityTasks.length} task${stalePriorityTasks.length > 1 ? 's are' : ' is'} stale relative to their priority`,
      detail: stalePriorityTasks.slice(0, 3).map((t) => {
        const d = daysSinceUpdated(t.updated_at);
        return `"${t.title}" (${d}d untouched, priority: ${t.priority})`;
      }).join('; '),
      actionTarget: stalePriorityTasks[0] ? { kind: 'task', id: stalePriorityTasks[0].id } : undefined,
    });
  }

  // Long-running open tasks (45+ days)
  const longRunningTasks = openTasks.filter((t) => daysSinceUpdated(t.created_at) >= 45);
  if (longRunningTasks.length > 0 && mode !== 'midday') {
    insights.push({
      id: nextId(),
      severity: 'info',
      section: 'watch',
      headline: `${longRunningTasks.length} task${longRunningTasks.length > 1 ? 's' : ''} open for 45+ days`,
      detail: longRunningTasks.slice(0, 3).map((t) => `"${t.title}"`).join(', ') + ' — consider purging, delegating, or actually scheduling them.',
    });
  }

  // --- NUDGE SECTION ---

  // Reschedule offenders (>= 3 reschedules)
  const RESCHEDULE_THRESHOLD = 3;
  const rescheduleTasks = openTasks
    .filter((t) => (t.reschedule_count ?? 0) >= RESCHEDULE_THRESHOLD)
    .sort((a, b) => (b.reschedule_count ?? 0) - (a.reschedule_count ?? 0));

  for (const t of rescheduleTasks.slice(0, 3)) {
    const count = t.reschedule_count ?? 0;
    insights.push({
      id: nextId(),
      severity: 'nudge',
      section: 'nudge',
      headline: `"${t.title}" has been rescheduled ${count} time${count > 1 ? 's' : ''}`,
      detail: count >= 5
        ? `At this point, be honest: does this actually need to happen? If yes, put real calendar time on it and stop deferring. If no, cut it.`
        : `You've moved this ${count} times. It's either not a real priority or it needs dedicated time. Which is it?`,
      actionTarget: { kind: 'task', id: t.id },
    });
  }

  // Action items in notes that have been sitting a long time
  const staleActionItems = actionItems.filter((a) => {
    const d = daysSinceUpdated(a.noteUpdatedAt);
    return d >= 14;
  });
  if (staleActionItems.length > 0) {
    insights.push({
      id: nextId(),
      severity: 'nudge',
      section: 'nudge',
      headline: `${staleActionItems.length} note action item${staleActionItems.length > 1 ? 's' : ''} haven't been touched in 14+ days`,
      detail: staleActionItems.slice(0, 3).map((a) => `"${a.displayText}" in ${a.noteTitle}`).join('; ') +
        ' — either convert these to tasks with due dates, or check them off.',
    });
  }

  // Tasks with no due date but high priority
  const highNoDueDate = openTasks.filter(
    (t) => (t.priority === 'critical' || t.priority === 'urgent') && !t.due_date,
  );
  if (highNoDueDate.length > 0) {
    insights.push({
      id: nextId(),
      severity: 'nudge',
      section: 'nudge',
      headline: `${highNoDueDate.length} high-priority task${highNoDueDate.length > 1 ? 's have' : ' has'} no due date`,
      detail: highNoDueDate.slice(0, 3).map((t) => `"${t.title}"`).join(', ') +
        " — if it's actually important, give it a date. Otherwise, lower the priority.",
    });
  }

  // Morning-specific: free time suggestion
  if (mode === 'morning') {
    const freeSlotsExist = todayEvents.length < 4;
    const hasCriticalOrUrgent = openTasks.some((t) => t.priority === 'critical' || t.priority === 'urgent');
    if (freeSlotsExist && hasCriticalOrUrgent) {
      const topTask = openTasks.find((t) => t.priority === 'critical' || t.priority === 'urgent');
      if (topTask) {
        insights.push({
          id: nextId(),
          severity: 'info',
          section: 'nudge',
          headline: `You have open time today — "${topTask.title}" is the top priority`,
          detail: `${todayEvents.length} meetings scheduled. Consider blocking time for your highest-priority work before the day fills up.`,
          actionTarget: { kind: 'task', id: topTask.id },
        });
      }
    }
  }

  // Extract note proposals
  const proposals = extractNoteProposals(notes);

  return {
    mode,
    modeLabel: meta.label,
    modeDescription: meta.description,
    generatedAt: now,
    nuts,
    insights,
    proposals,
  };
}

// ---------------------------------------------------------------------------
// Briefing summary text helpers (used in email + dashboard card)
// ---------------------------------------------------------------------------

export function briefingSummaryLines(report: BriefingReport): string[] {
  const { nuts, insights } = report;
  const lines: string[] = [];

  // Lead with the hardest number
  if (nuts.criticalTasks > 0) {
    lines.push(`🔴 ${nuts.criticalTasks} critical task${nuts.criticalTasks > 1 ? 's' : ''} require immediate attention`);
  }
  if (nuts.overdueCount > 0) {
    lines.push(`⚠️ ${nuts.overdueCount} task${nuts.overdueCount > 1 ? 's are' : ' is'} past due`);
  }
  if (nuts.dueTodayCount > 0) {
    lines.push(`📅 ${nuts.dueTodayCount} task${nuts.dueTodayCount > 1 ? 's' : ''} due today`);
  }

  // Meetings
  if (nuts.todayEventCount > 0) {
    const extra = nuts.backToBackCount > 0 ? `, ${nuts.backToBackCount} back-to-back` : '';
    lines.push(`🗓 ${nuts.todayEventCount} meeting${nuts.todayEventCount > 1 ? 's' : ''} today${extra}`);
  }

  // Owed to me
  if (nuts.owedToMeCount > 0) {
    const stale = nuts.owedStaleDays14 > 0 ? ` (${nuts.owedStaleDays14} gone cold)` : '';
    lines.push(`📥 ${nuts.owedToMeCount} item${nuts.owedToMeCount > 1 ? 's' : ''} owed to you${stale}`);
  }

  // Top watch/nudge insight
  const topWatch = insights.find((i) => i.section === 'watch');
  if (topWatch) lines.push(`👁 ${topWatch.headline}`);

  const topNudge = insights.find((i) => i.section === 'nudge');
  if (topNudge) lines.push(`👋 ${topNudge.headline}`);

  return lines;
}

/** Plain-text briefing for email digest */
export function briefingToEmailHtml(report: BriefingReport, firstName: string): string {
  const { mode, modeLabel, modeDescription, nuts, insights, proposals } = report;
  const name = firstName || 'there';
  const timeGreeting =
    mode === 'morning' ? 'Good morning' :
    mode === 'midday'  ? 'Midday check-in' :
    mode === 'afternoon' ? 'Afternoon' : 'Evening';

  const sectionInsights = (section: BriefingInsight['section']) =>
    insights.filter((i) => i.section === section);

  const insightRow = (i: BriefingInsight) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;color:#111;font-size:14px;">${i.headline}</div>
        <div style="color:#6b7280;font-size:13px;margin-top:3px;">${i.detail}</div>
      </td>
    </tr>`;

  const nutRows = [
    nuts.totalOpenTasks > 0 && `<tr><td style="padding:6px 16px;font-size:13px;color:#374151;">Open tasks</td><td style="padding:6px 16px;font-size:13px;font-weight:600;color:#111;text-align:right;">${nuts.totalOpenTasks}</td></tr>`,
    nuts.overdueCount > 0 && `<tr><td style="padding:6px 16px;font-size:13px;color:#dc2626;">Overdue</td><td style="padding:6px 16px;font-size:13px;font-weight:600;color:#dc2626;text-align:right;">${nuts.overdueCount}</td></tr>`,
    nuts.dueTodayCount > 0 && `<tr><td style="padding:6px 16px;font-size:13px;color:#d97706;">Due today</td><td style="padding:6px 16px;font-size:13px;font-weight:600;color:#d97706;text-align:right;">${nuts.dueTodayCount}</td></tr>`,
    nuts.todayEventCount > 0 && `<tr><td style="padding:6px 16px;font-size:13px;color:#374151;">Meetings today</td><td style="padding:6px 16px;font-size:13px;font-weight:600;color:#111;text-align:right;">${nuts.todayEventCount}</td></tr>`,
    nuts.owedToMeCount > 0 && `<tr><td style="padding:6px 16px;font-size:13px;color:#374151;">Owed to you</td><td style="padding:6px 16px;font-size:13px;font-weight:600;color:#111;text-align:right;">${nuts.owedToMeCount}</td></tr>`,
  ].filter(Boolean).join('');

  const watchSection = sectionInsights('watch');
  const nudgeSection = sectionInsights('nudge');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
    <tr>
      <td style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <table width="100%"><tr><td style="padding:24px 24px 16px;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6366f1;margin-bottom:4px;">${modeLabel}</div>
          <div style="font-size:22px;font-weight:700;color:#111;">${timeGreeting}, ${name}.</div>
          <div style="font-size:14px;color:#6b7280;margin-top:4px;">${modeDescription}</div>
        </td></tr></table>

        <!-- Nuts & Bolts -->
        <table width="100%" style="border-collapse:collapse;">
          <tr><td style="padding:16px 16px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;">AT A GLANCE</td></tr>
          ${nutRows}
        </table>

        <!-- Watch List -->
        ${watchSection.length > 0 ? `
        <table width="100%" style="border-collapse:collapse;border-top:1px solid #f3f4f6;margin-top:8px;">
          <tr><td style="padding:16px 16px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;">KEEP AN EYE ON</td></tr>
          ${watchSection.map(insightRow).join('')}
        </table>` : ''}

        <!-- Nudges -->
        ${nudgeSection.length > 0 ? `
        <table width="100%" style="border-collapse:collapse;border-top:1px solid #f3f4f6;margin-top:8px;">
          <tr><td style="padding:16px 16px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;">WHILE WE'RE AT IT</td></tr>
          ${nudgeSection.map(insightRow).join('')}
        </table>` : ''}

        <!-- Proposals -->
        ${proposals.length > 0 ? `
        <table width="100%" style="border-collapse:collapse;border-top:1px solid #f3f4f6;margin-top:8px;">
          <tr><td style="padding:16px 16px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;">FROM YOUR NOTES</td></tr>
          ${proposals.slice(0, 3).map((p) => `
          <tr><td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111;font-size:14px;">${p.suggestedTaskTitle}</div>
            <div style="color:#6b7280;font-size:13px;margin-top:2px;">From note: "${p.noteTitle}"${p.suggestedDueDate ? ` · Suggested due: ${p.suggestedDueDate}` : ''}</div>
          </td></tr>`).join('')}
        </table>` : ''}

        <!-- Footer -->
        <table width="100%"><tr><td style="padding:16px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;">
          Generated by your Executive Assistant · <a href="https://executive-assistant-chi.vercel.app/assistant" style="color:#6366f1;">Open full briefing</a>
        </td></tr></table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
