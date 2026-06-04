import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingReport } from '../lib/assistantBriefing';
import type { DirectiveGap, DirectiveReport, TimelineEntry, WorkItemRef } from '../lib/executiveDirective';
import { dismissBackToBackForMeeting, dismissDebriefForMeeting, dismissPrepForMeeting } from '../lib/meetingDismissals';
import { findMeetingNote } from '../lib/meetingNotes';
import { snoozeUntil } from '../lib/meetingDebrief';
import { meetingRuleShortLabel, parseMeetingRules } from '../lib/meetingTemperament';
import { snoozeUntilFreeIso } from '../lib/scheduleAvailability';
import { applyMarkdownPatchToNote, getNoteCanonicalMarkdown } from '../lib/noteContentBridge';
import { findOpenTaskForNoteActionRef, displayTitleFromNoteLine } from '../lib/taskActionMatch';
import { extractActionItems, setActionItemLineDueDate } from '../lib/format';
import { PRIORITY_PILL, type TaskPriority } from '../lib/priority';
import { formatDueTimeDisplay, normalizeDueTime } from '../lib/taskSchedule';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { MeetingDebriefModal } from './MeetingDebriefModal';
import { MeetingNotesPanel, type MeetingNotesPanelMode } from './MeetingNotesPanel';
import { ScheduleFollowUpModal } from './ScheduleFollowUpModal';
import { TaskDetailModal } from './TaskDetailModal';
import { bumpPriorityOneLevel, snoozeChaseUntil } from '../lib/delegationChase';
import { parseFocusQueue, scheduleFocusForTomorrow, tomorrowIsoFrom } from '../lib/focusQueue';
import { ESTIMATE_PRESETS } from '../lib/taskCapacity';
import {
  defaultFollowUpDate,
  followUpTaskTitle,
  meetingTitleFromPrepLabel,
  prepTaskTitle,
} from '../lib/meetingLifecycle';
import {
  ArrowRightIcon,
  BrainIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  NoteIcon,
} from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { SectionHeader } from './ui/SectionHeader';

type ExecutiveCommandCenterProps = {
  directive: DirectiveReport;
  briefing?: BriefingReport;
  onRefresh?: () => void;
  compact?: boolean;
  /** When set, only render these sections (dashboard split layout). */
  sections?: Array<'now' | 'gaps' | 'next' | 'timeline'>;
  hideBriefingBadges?: boolean;
};

type DebriefTarget = {
  eventId: string;
  occurrenceStartAt: string;
  meetingTitle: string;
};

type FollowUpTarget = {
  eventId: string;
  meetingTitle: string;
  defaultTitle?: string;
};

export function ExecutiveCommandCenter({
  directive,
  briefing,
  onRefresh,
  compact = false,
  sections,
  hideBriefingBadges = false,
}: ExecutiveCommandCenterProps) {
  const tz = directive.timezone;
  const user = useAuthStore((s) => s.user);
  const upsertDebrief = useMeetingDebriefStore((s) => s.upsertState);
  const notes = useNotesStore((s) => s.notes);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const [debriefTarget, setDebriefTarget] = useState<DebriefTarget | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<FollowUpTarget | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [meetingNotes, setMeetingNotes] = useState<{
    target: DebriefTarget;
    mode: MeetingNotesPanelMode;
  } | null>(null);

  const debriefInitialNotes = useMemo(() => {
    if (!debriefTarget) return '';
    const note = findMeetingNote(notes, debriefTarget.eventId, debriefTarget.occurrenceStartAt);
    return note ? getNoteCanonicalMarkdown(note) : '';
  }, [debriefTarget, notes]);

  const openMeetingNotes = (target: DebriefTarget, mode: MeetingNotesPanelMode) => {
    setMeetingNotes({ target, mode });
  };

  const detailTask = useMemo(
    () => (detailTaskId ? tasks.find((t) => t.id === detailTaskId) ?? null : null),
    [tasks, detailTaskId],
  );

  const openTaskDetail = (taskId: string) => setDetailTaskId(taskId);

  const show = (section: 'now' | 'gaps' | 'next' | 'timeline') =>
    !sections || sections.includes(section);

  const saveFollowUp = async (payload: {
    title: string;
    dueDate: string;
    dueTime: string | null;
  }) => {
    if (!user || !followUpTarget) return;
    await createTask(user.id, payload.title, {
      linkedEventId: followUpTarget.eventId,
      dueDate: payload.dueDate,
      dueTime: payload.dueTime,
    });
    onRefresh?.();
  };

  const saveDebrief = async (payload: { taskTitles: string[]; notes: string }) => {
    if (!user || !debriefTarget) return;
    for (const title of payload.taskTitles) {
      await createTask(user.id, title, { linkedEventId: debriefTarget.eventId });
    }
    await upsertDebrief(user.id, {
      eventId: debriefTarget.eventId,
      occurrenceStartAt: debriefTarget.occurrenceStartAt,
      status: 'done',
      notes: payload.notes,
    });
    onRefresh?.();
  };

  return (
    <div className="space-y-6">
      {show('now') && (
        <NowHero
          now={directive.now}
          tz={tz}
          onRefresh={onRefresh}
          compact={compact}
          onOpenMeetingNotes={openMeetingNotes}
        />
      )}

      {show('gaps') && directive.gaps.length > 0 && (
        <section>
          <SectionHeader
            icon={<BrainIcon className="h-4 w-4" />}
            title="I need from you"
            count={directive.gaps.length}
            accent="amber"
          />
          <ul className="mt-3 space-y-2">
            {directive.gaps.map((gap) => (
              <GapCard
                key={gap.id}
                gap={gap}
                todayIso={directive.todayIso}
                onRefresh={onRefresh}
                onOpenDebrief={(target) => setDebriefTarget(target)}
                onOpenMeetingNotes={openMeetingNotes}
                onOpenTask={openTaskDetail}
                onScheduleFollowUp={(target) => setFollowUpTarget(target)}
              />
            ))}
          </ul>
        </section>
      )}

      {show('next') && directive.next.length > 0 && (
        <section>
          <SectionHeader
            icon={<ClockIcon className="h-4 w-4" />}
            title="Next up"
            count={directive.next.length}
            accent="blue"
          />
          <TimelineList entries={directive.next} tz={tz} limit={6} onOpenMeetingNotes={openMeetingNotes} onRefresh={onRefresh} />
        </section>
      )}

      {show('timeline') && directive.timeline.length > 0 && (
        <section>
          <SectionHeader
            icon={<CalendarIcon className="h-4 w-4" />}
            title="Rest of today"
            count={directive.timeline.length}
            accent="brand"
          />
          <TimelineList entries={directive.timeline} tz={tz} onOpenMeetingNotes={openMeetingNotes} onRefresh={onRefresh} />
        </section>
      )}

      {briefing && !compact && !hideBriefingBadges && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {briefing.nuts.overdueCount > 0 && (
            <Badge variant="red">{briefing.nuts.overdueCount} overdue</Badge>
          )}
          {briefing.nuts.criticalTasks > 0 && (
            <Badge variant="red">{briefing.nuts.criticalTasks} critical</Badge>
          )}
          {briefing.nuts.todayEventCount > 0 && (
            <Badge variant="blue">{briefing.nuts.todayEventCount} meetings</Badge>
          )}
        </div>
      )}
      <MeetingDebriefModal
        open={!!debriefTarget}
        meetingTitle={debriefTarget?.meetingTitle ?? ''}
        initialNotes={debriefInitialNotes}
        onClose={() => setDebriefTarget(null)}
        onSave={saveDebrief}
        onScheduleFollowUp={() => {
          if (!debriefTarget) return;
          setFollowUpTarget({
            eventId: debriefTarget.eventId,
            meetingTitle: debriefTarget.meetingTitle,
            defaultTitle: followUpTaskTitle(debriefTarget.meetingTitle),
          });
          setDebriefTarget(null);
        }}
      />
      <MeetingNotesPanel
        open={!!meetingNotes}
        target={meetingNotes?.target ?? null}
        mode={meetingNotes?.mode ?? 'notes'}
        timezone={tz}
        onClose={() => setMeetingNotes(null)}
        onCaptureFollowUps={
          meetingNotes?.mode === 'debrief'
            ? () => {
                setDebriefTarget(meetingNotes.target);
                setMeetingNotes(null);
              }
            : undefined
        }
      />
      <ScheduleFollowUpModal
        open={!!followUpTarget}
        meetingTitle={followUpTarget?.meetingTitle ?? ''}
        defaultTitle={followUpTarget?.defaultTitle}
        defaultDueDate={defaultFollowUpDate()}
        onClose={() => setFollowUpTarget(null)}
        onSave={saveFollowUp}
      />
      {detailTask && (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTaskId(null)} />
      )}
    </div>
  );
}

function NowHero({
  now,
  tz,
  onRefresh,
  compact,
  onOpenMeetingNotes,
}: {
  now: DirectiveReport['now'];
  tz: string;
  onRefresh?: () => void;
  compact?: boolean;
  onOpenMeetingNotes?: (target: DebriefTarget, mode: MeetingNotesPanelMode) => void;
}) {
  const navigate = useNavigate();
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const upsertDebrief = useMeetingDebriefStore((s) => s.upsertState);
  const [prepBusy, setPrepBusy] = useState(false);

  const skipPrep = async (applyToAll: boolean) => {
    if (!user || !now.eventId || !now.meetingTitle) return;
    setPrepBusy(true);
    try {
      await dismissPrepForMeeting(user.id, now.eventId, now.meetingTitle, applyToAll);
      onRefresh?.();
    } finally {
      setPrepBusy(false);
    }
  };

  const kindLabel: Record<typeof now.kind, string> = {
    in_meeting: 'In meeting',
    prep: 'Prep now',
    debrief: 'Debrief now',
    work: 'Do this now',
    gap: 'Coming up',
    wind_down: 'Wind down',
    free: 'Focus now',
  };

  const kindTone: Record<typeof now.kind, string> = {
    in_meeting: 'from-brand-900 to-brand-950 dark:from-brand-950 dark:to-brand-950',
    prep: 'from-amber-600 to-amber-800 dark:from-amber-900 dark:to-amber-950',
    debrief: 'from-emerald-600 to-emerald-800 dark:from-emerald-900 dark:to-emerald-950',
    work: 'from-brand-700 to-brand-900 dark:from-brand-900 dark:to-brand-950',
    gap: 'from-surface-sunken to-surface-raised',
    wind_down: 'from-surface-sunken to-surface-raised',
    free: 'from-brand-600 to-brand-800 dark:from-brand-900 dark:to-brand-950',
  };

  const muted = now.kind === 'gap' || now.kind === 'wind_down';

  const meetingTarget: DebriefTarget | null =
    now.eventId && now.occurrenceStartAt
      ? {
          eventId: now.eventId,
          occurrenceStartAt: now.occurrenceStartAt,
          meetingTitle: now.meetingTitle ?? now.headline,
        }
      : null;

  const showMeetingNotes =
    meetingTarget && onOpenMeetingNotes && (now.kind === 'in_meeting' || now.kind === 'prep');
  const notesButtonMuted = now.kind === 'prep' || muted;

  const snoozeDebriefUntilFree = async () => {
    if (!user || !meetingTarget) return;
    await upsertDebrief(user.id, {
      eventId: meetingTarget.eventId,
      occurrenceStartAt: meetingTarget.occurrenceStartAt,
      status: 'snoozed',
      snoozedUntil: snoozeUntilFreeIso({
        timezone: profile?.timezone ?? 'UTC',
        events: useEventsStore.getState().events,
        tasks: useTasksStore.getState().tasks,
        meetingRules: parseMeetingRules(profile?.meeting_rules),
      }),
      snoozeMode: 'until_free',
    });
    onRefresh?.();
  };

  const onPrimary = () => {
    if (!now.ref) {
      navigate(viewPath('tasks'));
      return;
    }
    if (now.ref.kind === 'task') navigate(viewPath('tasks'));
    else {
      useNotesStore.getState().setActive(now.ref.noteId);
      navigate(viewPath('notes'));
    }
  };

  return (
    <Card
      padded="none"
      className={[
        'overflow-hidden border-2 border-brand-500/30 shadow-lg',
        compact ? '' : 'lg:shadow-xl',
      ].join(' ')}
    >
      <div className={['bg-gradient-to-br px-5 py-6 sm:px-8 sm:py-8', kindTone[now.kind], muted ? 'text-text' : 'text-white'].join(' ')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className={['text-[11px] font-bold uppercase tracking-[0.2em]', muted ? 'text-text-muted' : 'text-white/80'].join(' ')}>
              {kindLabel[now.kind]}
            </p>
            <h2 className={['mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl', muted ? 'text-text' : 'text-white'].join(' ')}>
              {now.headline}
            </h2>
            <p className={['mt-2 max-w-xl text-sm leading-relaxed', muted ? 'text-text-muted' : 'text-white/85'].join(' ')}>
              {now.detail}
            </p>
            {now.until && now.kind !== 'in_meeting' && (
              <p className={['mt-3 text-xs font-medium', muted ? 'text-text-subtle' : 'text-white/70'].join(' ')}>
                Until {formatInTimeZone(now.until, tz, 'h:mm a')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {showMeetingNotes && (
            <button
              type="button"
              onClick={() => onOpenMeetingNotes!(meetingTarget!, 'notes')}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                notesButtonMuted
                  ? 'bg-brand-600 text-white hover:bg-brand-500'
                  : 'bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25',
              ].join(' ')}
            >
              <NoteIcon className="h-4 w-4" />
              Meeting notes
            </button>
          )}
          {meetingTarget && onOpenMeetingNotes && now.kind === 'debrief' && (
            <>
              <button
                type="button"
                onClick={() => onOpenMeetingNotes(meetingTarget, 'debrief')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25"
              >
                <NoteIcon className="h-4 w-4" />
                Debrief
              </button>
              <button
                type="button"
                onClick={() => void snoozeDebriefUntilFree()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
              >
                Until I&apos;m free
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!user) return;
                  void upsertDebrief(user.id, {
                    eventId: meetingTarget.eventId,
                    occurrenceStartAt: meetingTarget.occurrenceStartAt,
                    status: 'skipped',
                  }).then(() => onRefresh?.());
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
              >
                Skip
              </button>
            </>
          )}
          {now.kind === 'prep' && now.eventId && now.meetingTitle && (
            <>
              <button
                type="button"
                disabled={prepBusy}
                onClick={() => void skipPrep(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20 disabled:opacity-60"
              >
                Skip prep this time
              </button>
              <MeetingRuleButton
                action="prep_off"
                meetingTitle={now.meetingTitle}
                disabled={prepBusy}
                onClick={() => void skipPrep(true)}
              />
            </>
          )}
          {now.ref && (
            <>
              <button
                type="button"
                onClick={onPrimary}
                className={[
                  'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                  muted ? 'bg-brand-600 text-white hover:bg-brand-500' : 'bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25',
                ].join(' ')}
              >
                Open
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
              {now.ref?.kind === 'task' && now.kind !== 'in_meeting' && (
                <button
                  type="button"
                  onClick={() => {
                    if (now.ref?.kind === 'task') void toggleDone(now.ref.taskId, true);
                  }}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                    muted ? 'border border-border bg-surface hover:bg-surface-raised' : 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20',
                  ].join(' ')}
                >
                  <CheckSquareIcon className="h-4 w-4" />
                  Mark done
                </button>
              )}
            </>
          )}
          {now.eventId && (
            <button
              type="button"
              onClick={() => navigate(viewPath('calendar'))}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                muted ? 'border border-border bg-surface hover:bg-surface-raised' : 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20',
              ].join(' ')}
            >
              <CalendarIcon className="h-4 w-4" />
              Calendar
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

type GapAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** Profile rule — rendered as a bordered two-line control, not a ghost pill. */
  ruleAction?: 'prep_off' | 'back_to_back_ok' | 'debrief_off';
  ruleMeetingTitle?: string;
};

function MeetingRuleButton({
  action,
  meetingTitle,
  onClick,
  disabled,
}: {
  action: 'prep_off' | 'back_to_back_ok' | 'debrief_off';
  meetingTitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const title = meetingTitle.trim() || 'this meeting';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-left shadow-sm transition-colors hover:border-brand-400 hover:bg-surface-sunken disabled:opacity-50 sm:max-w-md"
    >
      <span className="block text-xs font-semibold text-text">{meetingRuleShortLabel(action)}</span>
      <span className="mt-0.5 block truncate text-xs text-text-muted" title={title}>
        for &ldquo;{title}&rdquo;
      </span>
    </button>
  );
}

function GapCard({
  gap,
  todayIso,
  onRefresh,
  onOpenDebrief,
  onOpenMeetingNotes,
  onOpenTask,
  onScheduleFollowUp,
}: {
  gap: DirectiveGap;
  todayIso: string;
  onRefresh?: () => void;
  onOpenDebrief?: (target: DebriefTarget) => void;
  onOpenMeetingNotes?: (target: DebriefTarget, mode: MeetingNotesPanelMode) => void;
  onOpenTask?: (taskId: string) => void;
  onScheduleFollowUp?: (target: FollowUpTarget) => void;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const upsertDebrief = useMeetingDebriefStore((s) => s.upsertState);
  const setDueTime = useTasksStore((s) => s.setDueTime);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setLinkedEvent = useTasksStore((s) => s.setLinkedEvent);
  const createTask = useTasksStore((s) => s.createTask);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const setTaskPriority = useTasksStore((s) => s.setTaskPriority);
  const snoozeChase = useTasksStore((s) => s.snoozeChase);
  const recordChase = useTasksStore((s) => s.recordChase);
  const setEstimatedMinutes = useTasksStore((s) => s.setEstimatedMinutes);
  const updateNote = useNotesStore((s) => s.updateNote);
  const notes = useNotesStore((s) => s.notes);
  const [busy, setBusy] = useState(false);

  const openTask = (taskId: string) => {
    if (onOpenTask) onOpenTask(taskId);
    else navigate(viewPath('tasks'));
  };

  const canPickTime =
    Boolean(gap.ref && gap.suggestedDate) &&
    (gap.kind === 'untimed_today' || gap.kind === 'prep_needed');
  const [customTime, setCustomTime] = useState(gap.suggestedTime ?? '');

  useEffect(() => {
    setCustomTime(gap.suggestedTime ?? '');
  }, [gap.id, gap.suggestedTime]);

  const applyScheduledTime = async (ref: WorkItemRef, dueDate: string, dueTime: string) => {
    const normalized = normalizeDueTime(dueTime);
    if (!normalized) return;
    setBusy(true);
    try {
      if (ref.kind === 'task') {
        await setDueDate(ref.taskId, dueDate);
        await setDueTime(ref.taskId, normalized);
      } else {
        const note = notes.find((n) => n.id === ref.noteId);
        const lineText = note ? getNoteCanonicalMarkdown(note).split('\n')[ref.line] ?? '' : '';
        if (note) {
          const patched = applyMarkdownPatchToNote(note, (md) =>
            setActionItemLineDueDate(md, ref.line, dueDate),
          );
          if (patched) await updateNote(ref.noteId, patched);
        }
        const openTasks = useTasksStore.getState().tasks.filter((t) => !t.done);
        const actionItems = extractActionItems(notes);
        const existing = findOpenTaskForNoteActionRef(openTasks, actionItems, ref, lineText);
        const actionItem = actionItems.find((i) => i.noteId === ref.noteId && i.line === ref.line);
        const title = actionItem?.displayText ?? (displayTitleFromNoteLine(lineText) || 'Note action item');
        if (existing) {
          await setDueDate(existing.id, dueDate);
          await setDueTime(existing.id, normalized);
        } else if (user) {
          await createTask(user.id, title, {
            dueDate,
            dueTime: normalized,
          });
        }
      }
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const dismissDebriefForEvent = async (applyToAll: boolean) => {
    if (!gap.eventId || !user) return;
    setBusy(true);
    try {
      await dismissDebriefForMeeting(
        user.id,
        gap.eventId,
        gap.meetingTitle ?? gap.headline,
        applyToAll,
      );
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const snoozeDebriefUntilFree = async () => {
    if (!user || !gap.eventId || !gap.occurrenceStartAt) return;
    setBusy(true);
    try {
      await upsertDebrief(user.id, {
        eventId: gap.eventId,
        occurrenceStartAt: gap.occurrenceStartAt,
        status: 'snoozed',
        snoozedUntil: snoozeUntilFreeIso({
          timezone: profile?.timezone ?? 'UTC',
          events: useEventsStore.getState().events,
          tasks: useTasksStore.getState().tasks,
          meetingRules: parseMeetingRules(profile?.meeting_rules),
        }),
        snoozeMode: 'until_free',
      });
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const snoozeDebrief = async () => {
    if (!user || !gap.eventId || !gap.occurrenceStartAt) return;
    setBusy(true);
    try {
      await upsertDebrief(user.id, {
        eventId: gap.eventId,
        occurrenceStartAt: gap.occurrenceStartAt,
        status: 'snoozed',
        snoozedUntil: snoozeUntil(new Date()),
        snoozeMode: 'fixed',
      });
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const skipDebrief = async () => {
    if (!user || !gap.eventId || !gap.occurrenceStartAt) return;
    setBusy(true);
    try {
      await upsertDebrief(user.id, {
        eventId: gap.eventId,
        occurrenceStartAt: gap.occurrenceStartAt,
        status: 'skipped',
      });
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const dismissPrepForEvent = async (applyToAll: boolean) => {
    if (!gap.eventId || !user) return;
    setBusy(true);
    try {
      await dismissPrepForMeeting(
        user.id,
        gap.eventId,
        gap.meetingTitle ?? gap.headline,
        applyToAll,
      );
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const dismissBackToBack = async (applyToAll: boolean) => {
    if (!gap.eventId || !user) return;
    setBusy(true);
    try {
      await dismissBackToBackForMeeting(
        user.id,
        gap.eventId,
        gap.relatedEventId,
        gap.meetingTitle ?? gap.headline,
        applyToAll,
      );
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const severityBorder =
    gap.severity === 'critical'
      ? 'border-l-red-500'
      : gap.severity === 'warning'
        ? 'border-l-amber-500'
        : 'border-l-brand-500';

  const applySuggestedTime = async (ref: WorkItemRef) => {
    if (!gap.suggestedTime || !gap.suggestedDate) return;
    await applyScheduledTime(ref, gap.suggestedDate, gap.suggestedTime);
  };

  const scheduleForTomorrow = async (ref: WorkItemRef) => {
    setBusy(true);
    try {
      const tomorrow = tomorrowIsoFrom(todayIso);
      if (user) {
        const prefs = parseFocusQueue(useProfileStore.getState().profile?.focus_queue);
        const next = scheduleFocusForTomorrow(prefs, ref, todayIso);
        const current = useProfileStore.getState().profile;
        if (current) {
          useProfileStore.setState({ profile: { ...current, focus_queue: next } });
        }
        void updateProfile(user.id, { focus_queue: next });
      }
      if (ref.kind === 'task') {
        await setDueDate(ref.taskId, tomorrow);
        await setDueTime(ref.taskId, null);
      } else {
        const note = notes.find((n) => n.id === ref.noteId);
        const lineText = note ? getNoteCanonicalMarkdown(note).split('\n')[ref.line] ?? '' : '';
        if (note) {
          const patched = applyMarkdownPatchToNote(note, (md) =>
            setActionItemLineDueDate(md, ref.line, tomorrow),
          );
          if (patched) await updateNote(ref.noteId, patched);
        }
        const openTasks = useTasksStore.getState().tasks.filter((t) => !t.done);
        const actionItems = extractActionItems(notes);
        const existing = findOpenTaskForNoteActionRef(openTasks, actionItems, ref, lineText);
        if (existing) {
          await setDueDate(existing.id, tomorrow);
          await setDueTime(existing.id, null);
        }
      }
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  };

  const actions = useMemo(() => {
    const btns: GapAction[] = [];

    if (gap.kind === 'no_calendar') {
      btns.push({
        label: 'Connect calendar',
        primary: true,
        onClick: () => navigate(viewPath('profile')),
      });
      return btns;
    }

    if (gap.ref && gap.kind !== 'missing_estimate' && gap.kind !== 'delegation_chase') {
      btns.push({
        label: gap.ref.kind === 'task' ? 'Open task' : 'Open note',
        onClick: () => {
          if (gap.ref!.kind === 'task') openTask(gap.ref!.taskId);
          else {
            useNotesStore.getState().setActive(gap.ref!.noteId);
            navigate(viewPath('notes'));
          }
        },
      });
    }

    if (gap.kind === 'prep_needed' && gap.eventId && gap.meetingTitle) {
      if (onOpenMeetingNotes && gap.occurrenceStartAt) {
        btns.push({
          label: 'Meeting notes',
          primary: true,
          onClick: () =>
            onOpenMeetingNotes(
              {
                eventId: gap.eventId!,
                occurrenceStartAt: gap.occurrenceStartAt!,
                meetingTitle: gap.meetingTitle!,
              },
              'notes',
            ),
        });
      }
      btns.push({
        label: 'Create prep task',
        primary: !onOpenMeetingNotes || !gap.occurrenceStartAt,
        onClick: () => {
          if (!user) return;
          void createTask(user.id, prepTaskTitle(gap.meetingTitle!), {
            linkedEventId: gap.eventId,
            dueDate: gap.suggestedDate,
            dueTime: gap.suggestedTime ?? null,
          }).then(() => onRefresh?.());
        },
      });
      btns.push({
        label: 'Skip prep this time',
        onClick: () => void dismissPrepForEvent(false),
      });
      if (gap.meetingTitle) {
        btns.push({
          label: '',
          ruleAction: 'prep_off',
          ruleMeetingTitle: gap.meetingTitle,
          onClick: () => void dismissPrepForEvent(true),
        });
      }
    }

    if (gap.kind === 'back_to_back' && gap.eventId) {
      btns.push({
        label: 'Back-to-back is fine',
        primary: true,
        onClick: () => void dismissBackToBack(false),
      });
      if (gap.meetingTitle) {
        btns.push({
          label: '',
          ruleAction: 'back_to_back_ok',
          ruleMeetingTitle: gap.meetingTitle,
          onClick: () => void dismissBackToBack(true),
        });
      }
    }

    if (gap.kind === 'prep_needed' && gap.eventId && gap.ref?.kind === 'task') {
      const taskRef = gap.ref;
      btns.push({
        label: 'Link to meeting',
        onClick: () => void setLinkedEvent(taskRef.taskId, gap.eventId!),
      });
    }

    if (gap.kind === 'meeting_debrief' && gap.eventId && gap.occurrenceStartAt) {
      const debriefTarget: DebriefTarget = {
        eventId: gap.eventId,
        occurrenceStartAt: gap.occurrenceStartAt,
        meetingTitle: gap.meetingTitle ?? gap.headline,
      };
      if (onOpenMeetingNotes) {
        btns.push({
          label: 'Debrief',
          primary: true,
          onClick: () => onOpenMeetingNotes(debriefTarget, 'debrief'),
        });
      } else if (onOpenDebrief) {
        btns.push({
          label: 'Capture outcomes',
          primary: true,
          onClick: () => onOpenDebrief(debriefTarget),
        });
      }
      btns.push({
        label: "Until I'm free",
        primary: true,
        onClick: () => void snoozeDebriefUntilFree(),
      });
      btns.push({
        label: 'Snooze 24h',
        onClick: () => void snoozeDebrief(),
      });
      btns.push({
        label: 'Schedule follow-up',
        onClick: () =>
          onScheduleFollowUp?.({
            eventId: gap.eventId!,
            meetingTitle: gap.meetingTitle ?? gap.headline,
            defaultTitle: followUpTaskTitle(gap.meetingTitle ?? 'meeting'),
          }),
      });
      btns.push({
        label: 'Skip',
        onClick: () => void skipDebrief(),
      });
      btns.push({
        label: 'Skip debrief this time',
        onClick: () => void dismissDebriefForEvent(false),
      });
      if (gap.meetingTitle) {
        btns.push({
          label: '',
          ruleAction: 'debrief_off',
          ruleMeetingTitle: gap.meetingTitle,
          onClick: () => void dismissDebriefForEvent(true),
        });
      }
      return btns;
    }

    if (gap.kind === 'orphan_followup' && gap.eventId && onScheduleFollowUp) {
      btns.push({
        label: 'Schedule follow-up',
        primary: true,
        onClick: () =>
          onScheduleFollowUp({
            eventId: gap.eventId!,
            meetingTitle: gap.meetingTitle ?? 'meeting',
            defaultTitle: followUpTaskTitle(gap.meetingTitle ?? 'meeting'),
          }),
      });
    }

    if (gap.kind === 'orphan_followup' && gap.ref?.kind === 'task') {
      const taskRef = gap.ref;
      btns.push({
        label: 'Mark done',
        onClick: () => void toggleDone(taskRef.taskId, true),
      });
    }

    if (gap.kind === 'delegation_chase' && gap.ref?.kind === 'task') {
      const taskRef = gap.ref;
      btns.push({
        label: 'Mark received',
        primary: true,
        onClick: () => void toggleDone(taskRef.taskId, true),
      });
      btns.push({
        label: 'Chase again',
        onClick: () => void recordChase(taskRef.taskId),
      });
      btns.push({
        label: 'Snooze 7d',
        onClick: () => void snoozeChase(taskRef.taskId, snoozeChaseUntil()),
      });
      const task = useTasksStore.getState().tasks.find((t) => t.id === taskRef.taskId);
      const nextPriority = task
        ? bumpPriorityOneLevel((task.priority as TaskPriority) ?? 'normal')
        : null;
      if (nextPriority) {
        btns.push({
          label: 'Bump priority',
          onClick: () => void setTaskPriority(taskRef.taskId, nextPriority),
        });
      }
      btns.push({
        label: 'Open in Owed',
        onClick: () => navigate(viewPath('owed')),
      });
      btns.push({
        label: 'Open task',
        onClick: () => openTask(taskRef.taskId),
      });
      return btns;
    }

    if (gap.kind === 'missing_estimate' && gap.ref?.kind === 'task') {
      const taskRef = gap.ref;
      const defaultMins = gap.suggestedMinutes ?? 30;
      btns.push({
        label: `Set ${defaultMins}m`,
        primary: true,
        onClick: () => void setEstimatedMinutes(taskRef.taskId, defaultMins),
      });
      for (const m of ESTIMATE_PRESETS.filter((p) => p !== defaultMins).slice(0, 3)) {
        btns.push({
          label: `${m}m`,
          onClick: () => void setEstimatedMinutes(taskRef.taskId, m),
        });
      }
      btns.push({
        label: 'Open task',
        onClick: () => openTask(taskRef.taskId),
      });
      return btns;
    }

    if (gap.kind === 'capacity_overcommit') {
      btns.push({
        label: 'Open calendar',
        primary: true,
        onClick: () => navigate(viewPath('calendar')),
      });
      btns.push({
        label: 'Review tasks',
        onClick: () => navigate(viewPath('tasks')),
      });
      return btns;
    }

    return btns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, navigate, user, notes]);

  return (
    <li className={['rounded-xl border border-border border-l-4 bg-surface-raised px-4 py-3', severityBorder].join(' ')}>
      <p className="text-sm font-semibold text-text">{gap.headline}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{gap.detail}</p>
      {canPickTime && gap.ref && gap.suggestedDate && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            type="time"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            className="input min-h-[2rem] w-[7.5rem] py-1 text-xs"
            aria-label="Pick a time"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy || !customTime}
            onClick={() => void applyScheduledTime(gap.ref!, gap.suggestedDate!, customTime)}
            className="btn-primary py-1.5 text-xs"
          >
            Set time
          </button>
          {gap.suggestedTime && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void applySuggestedTime(gap.ref!)}
              className="btn-ghost py-1.5 text-xs"
            >
              Use {formatDueTimeDisplay(gap.suggestedTime)}
            </button>
          )}
          {gap.kind === 'untimed_today' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void scheduleForTomorrow(gap.ref!)}
              className="btn-ghost py-1.5 text-xs"
              title="Due tomorrow — drops off today's plan"
            >
              Tomorrow
            </button>
          )}
        </div>
      )}
      {actions.length > 0 && (() => {
        const pillActions = actions.filter((a) => !a.ruleAction);
        const ruleActions = actions.filter((a) => a.ruleAction && a.ruleMeetingTitle);
        return (
          <div className={canPickTime ? 'mt-2 space-y-2' : 'mt-2.5 space-y-2'}>
            {pillActions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pillActions.map((a, i) => (
                  <button
                    key={`${a.label}-${i}`}
                    type="button"
                    disabled={busy}
                    onClick={a.onClick}
                    className={a.primary ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {ruleActions.length > 0 && (
              <div className="flex flex-col gap-2">
                {ruleActions.map((a, i) => (
                  <MeetingRuleButton
                    key={`rule-${a.ruleAction}-${i}`}
                    action={a.ruleAction!}
                    meetingTitle={a.ruleMeetingTitle!}
                    onClick={a.onClick}
                    disabled={busy}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </li>
  );
}

function TimelinePrepDismiss({
  eventId,
  meetingTitle,
  onRefresh,
}: {
  eventId: string;
  meetingTitle: string;
  onRefresh?: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const run = async (applyToAll: boolean) => {
    if (!user) return;
    setBusy(true);
    try {
      await dismissPrepForMeeting(user.id, eventId, meetingTitle, applyToAll);
      onRefresh?.();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title="Skip prep for this meeting"
        aria-label={`Skip prep for ${meetingTitle}`}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost mt-0.5 p-2 text-text-muted hover:text-text"
      >
        <span className="text-xs font-medium">No prep</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-surface-raised p-2 shadow-lg">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(false)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-text hover:bg-surface-sunken disabled:opacity-50"
            >
              Skip prep this time
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
              className="mt-1 block w-full rounded-md border border-border px-2 py-1.5 text-left text-xs text-text hover:bg-surface-sunken disabled:opacity-50"
            >
              <span className="block font-medium">{meetingRuleShortLabel('prep_off')}</span>
              <span className="mt-0.5 block truncate text-[10px] text-text-muted" title={meetingTitle}>
                for &ldquo;{meetingTitle}&rdquo;
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TimelineList({
  entries,
  tz,
  limit,
  onOpenMeetingNotes,
  onRefresh,
}: {
  entries: TimelineEntry[];
  tz: string;
  limit?: number;
  onOpenMeetingNotes?: (target: DebriefTarget, mode: MeetingNotesPanelMode) => void;
  onRefresh?: () => void;
}) {
  const shown = limit ? entries.slice(0, limit) : entries;
  const navigate = useNavigate();

  const openEntry = (e: TimelineEntry) => {
    if (e.ref?.kind === 'task') navigate(viewPath('tasks'));
    else if (e.ref?.kind === 'action') {
      useNotesStore.getState().setActive(e.ref.noteId);
      navigate(viewPath('notes'));
    } else if (e.kind === 'meeting') navigate(viewPath('calendar'));
  };

  const kindIcon = (kind: TimelineEntry['kind']) => {
    if (kind === 'meeting') return <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-brand-600" />;
    if (kind === 'gap') return <ClockIcon className="h-3.5 w-3.5 shrink-0 text-text-subtle" />;
    return <CheckSquareIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" />;
  };

  return (
    <Card padded="none" className="mt-3 divide-y divide-border">
      {shown.map((e) => {
        const prepMeetingTitle =
          e.meetingTitle ??
          (e.kind === 'suggested' ? meetingTitleFromPrepLabel(e.title) : null);
        const showPrepDismiss =
          e.eventId &&
          prepMeetingTitle &&
          (e.kind === 'suggested' || (e.kind === 'meeting' && e.prepRequired));

        return (
        <div
          key={e.id}
          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
        >
          <button
            type="button"
            onClick={() => openEntry(e)}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
          >
            <span className="mt-0.5 w-[4.5rem] shrink-0 text-xs font-medium tabular-nums text-text-muted">
              {formatInTimeZone(e.start, tz, 'h:mm a')}
            </span>
            {kindIcon(e.kind)}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{e.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                {e.suggested && (
                  <Badge variant="subtle" className="text-[10px]">
                    Suggested
                  </Badge>
                )}
                {e.priority && (
                  <span className="text-[10px] font-medium text-text-muted">{PRIORITY_PILL[e.priority]}</span>
                )}
                {e.kind === 'gap' && <span className="text-[10px] text-text-subtle">Open</span>}
              </div>
            </div>
            <span className="shrink-0 text-xs text-text-subtle">{formatInTimeZone(e.end, tz, 'h:mm a')}</span>
          </button>
          {showPrepDismiss && (
            <TimelinePrepDismiss
              eventId={e.eventId!}
              meetingTitle={prepMeetingTitle!}
              onRefresh={onRefresh}
            />
          )}
          {e.kind === 'meeting' && e.eventId && e.occurrenceStartAt && onOpenMeetingNotes && (
            <button
              type="button"
              title="Meeting notes"
              aria-label={`Meeting notes for ${e.title}`}
              onClick={() =>
                onOpenMeetingNotes(
                  {
                    eventId: e.eventId!,
                    occurrenceStartAt: e.occurrenceStartAt!,
                    meetingTitle: e.title,
                  },
                  'notes',
                )
              }
              className="btn-ghost mt-0.5 shrink-0 p-2"
            >
              <NoteIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        );
      })}
    </Card>
  );
}
