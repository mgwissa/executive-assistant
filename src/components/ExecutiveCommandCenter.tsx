import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingReport } from '../lib/assistantBriefing';
import type { DirectiveGap, DirectiveReport, TimelineEntry, WorkItemRef } from '../lib/executiveDirective';
import { snoozeUntil } from '../lib/meetingDebrief';
import { appendMeetingRule, buildMeetingRule, parseMeetingRules } from '../lib/meetingTemperament';
import { applyMarkdownPatchToNote } from '../lib/noteContentBridge';
import { setActionItemLineDueDate } from '../lib/format';
import { PRIORITY_PILL } from '../lib/priority';
import { formatDueTimeDisplay, normalizeDueTime } from '../lib/taskSchedule';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { MeetingDebriefModal } from './MeetingDebriefModal';
import { ScheduleFollowUpModal } from './ScheduleFollowUpModal';
import {
  defaultFollowUpDate,
  followUpTaskTitle,
  prepTaskTitle,
} from '../lib/meetingLifecycle';
import { bumpPriorityOneLevel, snoozeChaseUntil } from '../lib/delegationChase';
import { ESTIMATE_PRESETS } from '../lib/taskCapacity';
import type { TaskPriority } from '../lib/priority';
import {
  ArrowRightIcon,
  BrainIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  RefreshIcon,
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
  const createTask = useTasksStore((s) => s.createTask);
  const [debriefTarget, setDebriefTarget] = useState<DebriefTarget | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<FollowUpTarget | null>(null);

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
          onOpenDebrief={(target) => setDebriefTarget(target)}
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
                onOpenDebrief={(target) => setDebriefTarget(target)}
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
          <TimelineList entries={directive.next} tz={tz} limit={6} />
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
          <TimelineList entries={directive.timeline} tz={tz} />
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
      <ScheduleFollowUpModal
        open={!!followUpTarget}
        meetingTitle={followUpTarget?.meetingTitle ?? ''}
        defaultTitle={followUpTarget?.defaultTitle}
        defaultDueDate={defaultFollowUpDate()}
        onClose={() => setFollowUpTarget(null)}
        onSave={saveFollowUp}
      />
    </div>
  );
}

function NowHero({
  now,
  tz,
  onRefresh,
  compact,
  onOpenDebrief,
}: {
  now: DirectiveReport['now'];
  tz: string;
  onRefresh?: () => void;
  compact?: boolean;
  onOpenDebrief?: (target: DebriefTarget) => void;
}) {
  const navigate = useNavigate();
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const user = useAuthStore((s) => s.user);
  const upsertDebrief = useMeetingDebriefStore((s) => s.upsertState);

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
            {now.until && (
              <p className={['mt-3 text-xs font-medium', muted ? 'text-text-subtle' : 'text-white/70'].join(' ')}>
                Until {formatInTimeZone(now.until, tz, 'h:mm a')}
              </p>
            )}
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className={['btn-ghost shrink-0 p-2', muted ? '' : 'text-white/80 hover:bg-white/10 hover:text-white'].join(' ')}
              title="Refresh"
              aria-label="Refresh directive"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {now.kind === 'debrief' && now.eventId && now.occurrenceStartAt && onOpenDebrief && (
            <>
              <button
                type="button"
                onClick={() =>
                  onOpenDebrief({
                    eventId: now.eventId!,
                    occurrenceStartAt: now.occurrenceStartAt!,
                    meetingTitle: now.headline,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25"
              >
                Capture outcomes
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!user) return;
                  void upsertDebrief(user.id, {
                    eventId: now.eventId!,
                    occurrenceStartAt: now.occurrenceStartAt!,
                    status: 'skipped',
                  }).then(() => onRefresh?.());
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
              >
                Skip
              </button>
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

function GapCard({
  gap,
  onOpenDebrief,
  onScheduleFollowUp,
}: {
  gap: DirectiveGap;
  onOpenDebrief?: (target: DebriefTarget) => void;
  onScheduleFollowUp?: (target: FollowUpTarget) => void;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const updateEvent = useEventsStore((s) => s.updateEvent);
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
        if (note) {
          const patched = applyMarkdownPatchToNote(note, (md) =>
            setActionItemLineDueDate(md, ref.line, dueDate),
          );
          if (patched) await updateNote(ref.noteId, patched);
        }
        if (user) {
          const item = notes.find((n) => n.id === ref.noteId);
          const lines = item ? (item.content ?? '').split('\n') : [];
          const lineText = lines[ref.line] ?? 'Note action item';
          const title = lineText
            .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
            .replace(/\[due:[^\]]+\]/gi, '')
            .trim();
          await createTask(user.id, title || 'Note action item', {
            dueDate,
            dueTime: normalized,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const dismissDebriefForEvent = async (applyToAll: boolean) => {
    if (!gap.eventId) return;
    setBusy(true);
    try {
      await updateEvent(gap.eventId, { debrief_required: false });
      if (applyToAll && user && gap.meetingTitle) {
        const rules = appendMeetingRule(
          parseMeetingRules(profile?.meeting_rules),
          buildMeetingRule(gap.meetingTitle, { debrief_required: false }),
        );
        await updateProfile(user.id, { meeting_rules: rules });
      }
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
      });
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
    } finally {
      setBusy(false);
    }
  };

  const dismissPrepForEvent = async (applyToAll: boolean) => {
    if (!gap.eventId) return;
    setBusy(true);
    try {
      await updateEvent(gap.eventId, { prep_required: false });
      if (applyToAll && user && gap.meetingTitle) {
        const rules = appendMeetingRule(
          parseMeetingRules(profile?.meeting_rules),
          buildMeetingRule(gap.meetingTitle, { prep_required: false }),
        );
        await updateProfile(user.id, { meeting_rules: rules });
      }
    } finally {
      setBusy(false);
    }
  };

  const dismissBackToBack = async (applyToAll: boolean) => {
    if (!gap.eventId) return;
    setBusy(true);
    try {
      await updateEvent(gap.eventId, { allow_back_to_back: true });
      if (gap.relatedEventId) {
        await updateEvent(gap.relatedEventId, { allow_back_to_back: true });
      }
      if (applyToAll && user && gap.meetingTitle) {
        const rules = appendMeetingRule(
          parseMeetingRules(profile?.meeting_rules),
          buildMeetingRule(gap.meetingTitle, { allow_back_to_back: true }),
        );
        await updateProfile(user.id, { meeting_rules: rules });
      }
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

  const actions = useMemo(() => {
    const btns: Array<{ label: string; onClick: () => void; primary?: boolean }> = [];

    if (gap.kind === 'no_calendar') {
      btns.push({
        label: 'Connect calendar',
        primary: true,
        onClick: () => navigate(viewPath('profile')),
      });
      return btns;
    }

    if (gap.ref) {
      btns.push({
        label: gap.ref.kind === 'task' ? 'Open task' : 'Open note',
        onClick: () => {
          if (gap.ref!.kind === 'task') navigate(viewPath('tasks'));
          else {
            useNotesStore.getState().setActive(gap.ref!.noteId);
            navigate(viewPath('notes'));
          }
        },
      });
    }

    if (gap.kind === 'prep_needed' && gap.eventId && gap.meetingTitle) {
      btns.push({
        label: 'Create prep task',
        primary: true,
        onClick: () => {
          if (!user) return;
          void createTask(user.id, prepTaskTitle(gap.meetingTitle!), {
            linkedEventId: gap.eventId,
            dueDate: gap.suggestedDate,
            dueTime: gap.suggestedTime ?? null,
          });
        },
      });
      btns.push({
        label: "Don't prep for this again",
        onClick: () => void dismissPrepForEvent(false),
      });
      if (gap.meetingTitle) {
        btns.push({
          label: 'Apply to all like this',
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
          label: 'Apply to all like this',
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

    if (gap.kind === 'meeting_debrief' && gap.eventId && gap.occurrenceStartAt && onOpenDebrief) {
      btns.push({
        label: 'Capture outcomes',
        primary: true,
        onClick: () =>
          onOpenDebrief({
            eventId: gap.eventId!,
            occurrenceStartAt: gap.occurrenceStartAt!,
            meetingTitle: gap.meetingTitle ?? gap.headline,
          }),
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
        label: "Don't debrief for this again",
        onClick: () => void dismissDebriefForEvent(false),
      });
      if (gap.meetingTitle) {
        btns.push({
          label: 'Apply to all like this',
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
        onClick: () => navigate(viewPath('tasks')),
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
        onClick: () => navigate(viewPath('tasks')),
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
        </div>
      )}
      {actions.length > 0 && (
        <div className={['flex flex-wrap gap-2', canPickTime ? 'mt-2' : 'mt-2.5'].join(' ')}>
          {actions.map((a) => (
            <button
              key={a.label}
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
    </li>
  );
}

function TimelineList({
  entries,
  tz,
  limit,
}: {
  entries: TimelineEntry[];
  tz: string;
  limit?: number;
}) {
  const shown = limit ? entries.slice(0, limit) : entries;
  const navigate = useNavigate();

  const kindIcon = (kind: TimelineEntry['kind']) => {
    if (kind === 'meeting') return <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-brand-600" />;
    if (kind === 'gap') return <ClockIcon className="h-3.5 w-3.5 shrink-0 text-text-subtle" />;
    return <CheckSquareIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" />;
  };

  return (
    <Card padded="none" className="mt-3 divide-y divide-border">
      {shown.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => {
            if (e.ref?.kind === 'task') navigate(viewPath('tasks'));
            else if (e.ref?.kind === 'action') {
              useNotesStore.getState().setActive(e.ref.noteId);
              navigate(viewPath('notes'));
            } else if (e.kind === 'meeting') navigate(viewPath('calendar'));
          }}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
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
      ))}
    </Card>
  );
}
