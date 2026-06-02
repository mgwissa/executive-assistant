import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isOptionalFeatureEnabled } from '../lib/optionalFeatures';
import { viewPath } from '../lib/routes';
import { generateBriefing } from '../lib/assistantBriefing';
import { generateDirective } from '../lib/executiveDirective';
import { parseMeetingRules } from '../lib/meetingTemperament';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { filterActionItemsDeduped } from '../lib/taskActionMatch';
import { parseFocusQueue, scheduleFocusForTomorrow, tomorrowIsoFrom, type FocusQueuePrefs } from '../lib/focusQueue';
import {
  loadDismissedDecisionIds,
  persistDismissedDecisionIds,
} from '../lib/decisionQueue';
import type { FocusWorkItem } from '../lib/executiveDirective';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useWeeklyRoutineStore } from '../store/useWeeklyRoutineStore';
import type { ActionItem } from '../lib/format';
import {
  extractActionItems,
  extractPreview,
  formatLongDate,
  formatRelative,
  getGreeting,
  setActionItemLineDueDate,
  toggleActionItemLine,
} from '../lib/format';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_ORDER, PRIORITY_PILL, compareDueDate, priorityRank } from '../lib/priority';
import { priorityInlineLabelClass, priorityRowClass, priorityTitleClass } from '../lib/priorityUiClasses';
import type { Task } from '../types';
import { generateOccurrences } from '../lib/recurrence';
import { applyMarkdownPatchToNote, getNoteCanonicalMarkdown } from '../lib/noteContentBridge';
import type { Note } from '../types';
import {
  getRoutineBlocksForWeekday,
  getRoutineDay,
  getRoutineRitualsForWeekday,
  routineProgress,
  routineWeekDatesFor,
  routineWeekdayFromLabel,
  type RoutineChecklistItem,
  type RoutineStatus,
} from '../lib/weeklyRoutine';
import {
  resolveWeeklyRoutineTemplate,
  routineTemplateVersion,
} from '../lib/weeklyRoutineTemplate';
import {
  ArrowRightIcon,
  BookIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  NoteIcon,
  SquareIcon,
  TrashIcon,
} from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionHeader } from './ui/SectionHeader';
import { TaskQuickAddForm, toCreateTaskOptions, type TaskQuickAddPayload } from './TaskQuickAddForm';
import { ExecutiveCommandCenter } from './ExecutiveCommandCenter';
import { ExecutiveFocusStack } from './ExecutiveFocusStack';
import { ExecutiveDayHud, ExecutiveHudSidebar } from './ExecutiveDayHud';
import { UsefulLinksSection } from './UsefulLinksSection';

const RECENT_LIMIT = 5;
const ACTION_ITEM_LIMIT = 8;

type DashboardWorkRow =
  | {
      kind: 'task';
      id: string;
      priority: TaskPriority;
      title: string;
      subtitle: string;
      onSubtitleClick: () => void;
      task: Task;
    }
  | {
      kind: 'action';
      id: string;
      priority: TaskPriority;
      title: string;
      subtitle: string;
      onSubtitleClick: () => void;
      item: ActionItem;
    };

type WorkRowCtx = { openNote: (id: string) => void; openTasksView: () => void };

function workRowStamp(row: DashboardWorkRow): number {
  return row.kind === 'task'
    ? new Date(row.task.updated_at).getTime()
    : new Date(row.item.noteUpdatedAt).getTime();
}

function workRowDueDate(row: DashboardWorkRow): string | null {
  return row.kind === 'task' ? row.task.due_date : row.item.dueDate;
}

function buildWorkRows(
  openTasks: Task[],
  actionItems: ActionItem[],
  ctx: WorkRowCtx,
): DashboardWorkRow[] {
  const rows: DashboardWorkRow[] = [];
  for (const t of openTasks) {
    const priority = (t.priority as TaskPriority) ?? 'normal';
    rows.push({
      kind: 'task',
      id: `task:${t.id}`,
      priority,
      title: t.title,
      subtitle: t.waiting_on?.trim() ? `Waiting on ${t.waiting_on.trim()}` : 'Tasks',
      onSubtitleClick: ctx.openTasksView,
      task: t,
    });
  }
  for (const a of actionItems) {
    rows.push({
      kind: 'action',
      id: `action:${a.noteId}:${a.line}`,
      priority: a.priority,
      title: a.displayText,
      subtitle: a.noteTitle,
      onSubtitleClick: () => ctx.openNote(a.noteId),
      item: a,
    });
  }
  rows.sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    const due = compareDueDate(workRowDueDate(a), workRowDueDate(b));
    if (due !== 0) return due;
    return workRowStamp(b) - workRowStamp(a);
  });
  return rows;
}

function CriticalBlocker({ rows }: { rows: DashboardWorkRow[] }) {
  const critical = rows.filter((r) => r.priority === 'critical');
  if (critical.length === 0) return null;

  return (
    <div
      className="mb-8 rounded-xl border-2 border-red-500/90 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5 text-red-50 shadow-xl ring-1 ring-red-400/30 dark:border-red-500/75 dark:from-red-950/40 dark:via-zinc-950 dark:to-zinc-950 dark:ring-red-500/30"
      role="region"
      aria-label="Highest priority"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-red-400/95 dark:text-red-300">
        Critical priority
      </p>
      <h2 className="mt-1.5 text-lg font-semibold leading-snug text-white dark:text-red-50">
        Do nothing else until this is handled.
      </h2>
      <ul className="mt-4 space-y-3">
        {critical.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 rounded-lg bg-black/35 px-3 py-2.5 ring-1 ring-white/10 dark:bg-black/25 dark:ring-white/15"
          >
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold leading-snug text-white dark:text-red-50">
                {row.title}
              </p>
              <button
                type="button"
                onClick={row.onSubtitleClick}
                className="mt-1 text-left text-xs text-red-200/85 underline-offset-2 hover:text-red-50 hover:underline dark:text-red-200/90 dark:hover:text-white"
              >
                {row.subtitle}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DashboardActionItemsSection({
  user,
  workRows,
  visibleWork,
  itemCount,
  idPrefix,
  titlePlaceholder = 'Quick add a todo…',
  className = '',
  onQuickAdd,
  onToggleTask,
  onToggleAction,
  onOpenTasks,
}: {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  workRows: DashboardWorkRow[];
  visibleWork: DashboardWorkRow[];
  itemCount: number;
  idPrefix: string;
  titlePlaceholder?: string;
  className?: string;
  onQuickAdd: (payload: TaskQuickAddPayload) => Promise<void>;
  onToggleTask: (id: string, done: boolean) => void;
  onToggleAction: (noteId: string, line: number) => void;
  onOpenTasks: () => void;
}) {
  return (
    <section className={['flex min-h-0 min-w-0 flex-col', className].filter(Boolean).join(' ')}>
      <SectionHeader
        icon={<CheckSquareIcon className="h-4 w-4" />}
        title="Action items"
        count={itemCount}
        accent="amber"
        action={
          <button
            type="button"
            onClick={onOpenTasks}
            className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
          >
            Manage
            <ArrowRightIcon className="h-3 w-3" />
          </button>
        }
      />
      <Card
        padded="none"
        className="card-pop card-pop-amber flex max-h-[min(50vh,30rem)] min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card">
          <TaskQuickAddForm
            variant="embedded"
            disabled={!user}
            idPrefix={idPrefix}
            titlePlaceholder={titlePlaceholder}
            onSubmit={onQuickAdd}
          />
          <div className="shrink-0 space-y-2 border-b border-border bg-surface-raised/35 px-4 py-2.5">
            <p className="text-[11px] leading-relaxed text-text-muted">
              Sorted top to bottom. The left edge and label use the same color; change levels on{' '}
              <button
                type="button"
                onClick={onOpenTasks}
                className="font-medium text-brand-700 hover:text-brand-600"
              >
                Tasks
              </button>
              . In notes:{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono ring-1 ring-border">[P0]</code>
              –
              <code className="rounded bg-surface px-1 py-0.5 font-mono ring-1 ring-border">[P4]</code>
              .
            </p>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {PRIORITY_ORDER.map((p, i) => (
                <span key={p} className="inline-flex items-center gap-1.5">
                  {i > 0 ? (
                    <span className="text-text-muted/50" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <span className={priorityInlineLabelClass(p)}>{PRIORITY_PILL[p]}</span>
                </span>
              ))}
            </div>
          </div>

          {workRows.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EmptyState
                icon={<CheckSquareIcon className="h-5 w-5" />}
                title="No open tasks"
                message="Add a todo above, or write `- [ ] …` in any note with an optional priority tag."
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
              {visibleWork.map((row) => (
                <li
                  key={row.id}
                  className={priorityRowClass(row.priority)}
                  aria-label={`${PRIORITY_PILL[row.priority]}: ${row.title}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      row.kind === 'task'
                        ? void onToggleTask(row.task.id, true)
                        : void onToggleAction(row.item.noteId, row.item.line)
                    }
                    className="mt-0.5 shrink-0 text-text-subtle hover:text-brand-700"
                    aria-label="Mark done"
                    title="Mark done"
                  >
                    <SquareIcon className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={priorityInlineLabelClass(row.priority)}>{PRIORITY_PILL[row.priority]}</p>
                    <p
                      className={[
                        'mt-0.5 break-words text-left leading-snug',
                        priorityTitleClass(row.priority),
                      ].join(' ')}
                    >
                      {row.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <button
                        type="button"
                        onClick={row.onSubtitleClick}
                        className="block max-w-full truncate text-left text-xs text-text-muted hover:text-brand-700"
                        title={row.kind === 'task' ? 'Open tasks' : 'Open note'}
                      >
                        {row.subtitle}
                      </button>
                      {row.kind === 'task' && row.task.due_date && (
                        <DueDateChip dueDate={row.task.due_date} />
                      )}
                      {row.kind === 'task' && row.task.waiting_on?.trim() ? (
                        <span className="truncate rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border">
                          Waiting on {row.task.waiting_on.trim()}
                        </span>
                      ) : null}
                      {row.kind === 'action' && row.item.dueDate && (
                        <DueDateChip dueDate={row.item.dueDate} />
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {workRows.length > ACTION_ITEM_LIMIT && (
                <li className="px-4 py-2 text-center text-xs text-text-muted">
                  +{workRows.length - ACTION_ITEM_LIMIT} more (sorted by priority)
                </li>
              )}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}

function firstNameFromEmail(email: string | undefined | null): string {
  if (!email) return 'there';
  const local = email.split('@')[0];
  const token = local.split(/[._-]/)[0];
  if (!token) return 'there';
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function resolveName(
  profileName: string | null | undefined,
  email: string | undefined | null,
): string {
  const trimmed = profileName?.trim();
  if (trimmed) return trimmed;
  return firstNameFromEmail(email);
}

export function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const notes = useNotesStore((s) => s.notes);
  const loading = useNotesStore((s) => s.loading);
  const events = useEventsStore((s) => s.events);
  const debriefStates = useMeetingDebriefStore((s) => s.states);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const toggleTaskDone = useTasksStore((s) => s.toggleDone);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setDueTime = useTasksStore((s) => s.setDueTime);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setActive = useNotesStore((s) => s.setActive);
  const routineStates = useWeeklyRoutineStore((s) => s.states);
  const routineLoading = useWeeklyRoutineStore((s) => s.loading);
  const fetchRoutineRange = useWeeklyRoutineStore((s) => s.fetchRange);
  const setRoutineItemStatus = useWeeklyRoutineStore((s) => s.setItemStatus);

  const today = useMemo(() => new Date(), []);
  const greeting = getGreeting(today);
  const dateLabel = formatLongDate(today);
  const name = resolveName(profile?.first_name, user?.email);
  const routineEnabled = isOptionalFeatureEnabled(profile, 'routine');
  const timezone = resolveCalendarTimeZone(profile?.timezone);
  const routineTodayDate = formatInTimeZone(today, timezone, 'yyyy-MM-dd');
  const routineTodayWeekday = routineWeekdayFromLabel(formatInTimeZone(today, timezone, 'EEEE'));
  const routineWeekDates = routineWeekDatesFor(routineTodayDate);
  const routineTemplate = useMemo(
    () => resolveWeeklyRoutineTemplate(profile?.weekly_routine),
    [profile?.weekly_routine],
  );
  const routineTemplateVersionKey = routineTemplateVersion(routineTemplate);
  const routineDay = getRoutineDay(routineTodayWeekday, routineTemplate);
  const routineBlocks = useMemo(
    () => getRoutineBlocksForWeekday(routineTodayWeekday, routineTemplate),
    [routineTodayWeekday, routineTemplate],
  );
  const routineRituals = useMemo(
    () => getRoutineRitualsForWeekday(routineTodayWeekday, routineTemplate),
    [routineTodayWeekday, routineTemplate],
  );
  const routineItems = useMemo<RoutineChecklistItem[]>(
    () => [...routineBlocks, ...routineRituals],
    [routineBlocks, routineRituals],
  );
  const routineStatusByItem = useMemo(() => {
    const map = new Map<string, RoutineStatus>();
    for (const row of routineStates) {
      if (row.routine_date === routineTodayDate) {
        map.set(row.item_id, statusFromDb(row.status));
      }
    }
    return map;
  }, [routineStates, routineTodayDate]);
  const routineStatusForItem = useCallback(
    (itemId: string): RoutineStatus => routineStatusByItem.get(itemId) ?? 'pending',
    [routineStatusByItem],
  );
  const routineTodayProgress = routineProgress(routineItems, routineStatusForItem);
  const routineUpcoming = routineBlocks
    .filter((item) => routineStatusForItem(item.id) !== 'done')
    .slice(0, 3);

  useEffect(() => {
    if (!user || !routineEnabled) return;
    void fetchRoutineRange(
      user.id,
      routineWeekDates.monday,
      routineWeekDates.friday,
      routineTemplateVersionKey,
    );
  }, [
    user,
    routineEnabled,
    routineWeekDates.monday,
    routineWeekDates.friday,
    routineTemplateVersionKey,
    fetchRoutineRange,
  ]);

  const recent = useMemo(() => notes.slice(0, RECENT_LIMIT), [notes]);
  const actionItems = useMemo(
    () => filterActionItemsDeduped(tasks, extractActionItems(notes)),
    [notes, tasks],
  );
  const openTasks = useMemo(() => tasks.filter((t) => !t.done), [tasks]);

  const todaysSchedule = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const all = events.flatMap((e) => generateOccurrences(e, start, end, { limit: 50 }));
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    return all;
  }, [events, today]);

  const openNote = useCallback(
    (id: string) => {
      setActive(id);
      navigate(viewPath('notes'));
    },
    [setActive, navigate],
  );

  const workRows = useMemo(
    () =>
      buildWorkRows(openTasks, actionItems, {
        openNote,
        openTasksView: () => navigate(viewPath('tasks')),
      }),
    [openTasks, actionItems, openNote, navigate],
  );
  const visibleWork = workRows.slice(0, ACTION_ITEM_LIMIT);

  const assistantEnabled = isOptionalFeatureEnabled(profile, 'assistant');
  const [directiveRefresh, setDirectiveRefresh] = useState(0);
  const [dismissedDecisionIds, setDismissedDecisionIds] = useState(() =>
    loadDismissedDecisionIds(routineTodayDate),
  );

  useEffect(() => {
    setDismissedDecisionIds(loadDismissedDecisionIds(routineTodayDate));
  }, [routineTodayDate]);

  const dismissDecision = useCallback((id: string) => {
    setDismissedDecisionIds((prev) => {
      const next = new Set(prev).add(id);
      persistDismissedDecisionIds(routineTodayDate, next);
      return next;
    });
  }, [routineTodayDate]);

  const toggleAction = (noteId: string, line: number) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const patched = applyMarkdownPatchToNote(note, (md) => toggleActionItemLine(md, line));
    if (patched) void updateNote(noteId, patched);
    if (assistantEnabled) setDirectiveRefresh((k) => k + 1);
  };

  const handleDashboardQuickAdd = useCallback(
    async (payload: TaskQuickAddPayload) => {
      if (!user) return;
      await createTask(user.id, payload.title, toCreateTaskOptions(payload));
      if (assistantEnabled) setDirectiveRefresh((k) => k + 1);
    },
    [user, createTask, assistantEnabled],
  );

  const handleToggleTaskDone = useCallback(
    (id: string, done: boolean) => {
      void toggleTaskDone(id, done);
      if (assistantEnabled) setDirectiveRefresh((k) => k + 1);
    },
    [toggleTaskDone, assistantEnabled],
  );

  const openTasksView = useCallback(() => navigate(viewPath('tasks')), [navigate]);
  const workItemCount = openTasks.length + actionItems.length;
  const focusQueuePrefs = useMemo(
    () => parseFocusQueue(profile?.focus_queue),
    [profile?.focus_queue],
  );

  const handleFocusQueueUpdate = useCallback(
    (next: FocusQueuePrefs) => {
      if (!user) return;
      const current = useProfileStore.getState().profile;
      if (current) {
        useProfileStore.setState({ profile: { ...current, focus_queue: next } });
      }
      void updateProfile(user.id, { focus_queue: next });
      setDirectiveRefresh((k) => k + 1);
    },
    [user, updateProfile],
  );

  const directive = useMemo(() => {
    if (!assistantEnabled) return null;
    return generateDirective({
      tasks,
      actionItems,
      events,
      timezone,
      now: new Date(),
      hasCalendarSource: !!(profile?.outlook_ics_url?.trim()) || events.length > 0,
      meetingRules: parseMeetingRules(profile?.meeting_rules),
      debriefStates,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantEnabled, tasks, actionItems, events, timezone, profile?.outlook_ics_url, profile?.meeting_rules, debriefStates, directiveRefresh]);

  const handleScheduleFocusTomorrow = useCallback(
    async (item: FocusWorkItem) => {
      if (!user || !directive) return;
      const ref =
        item.kind === 'task' && item.taskId
          ? ({ kind: 'task' as const, taskId: item.taskId })
          : ({ kind: 'action' as const, noteId: item.noteId!, line: item.line! });
      const prefs = parseFocusQueue(useProfileStore.getState().profile?.focus_queue);
      handleFocusQueueUpdate(scheduleFocusForTomorrow(prefs, ref, directive.todayIso));
      const tomorrow = tomorrowIsoFrom(directive.todayIso);
      if (item.kind === 'task' && item.taskId) {
        await setDueDate(item.taskId, tomorrow);
        if (item.dueTime) await setDueTime(item.taskId, null);
      } else if (item.noteId != null && item.line != null) {
        const note = notes.find((n) => n.id === item.noteId);
        if (note) {
          const patched = applyMarkdownPatchToNote(note, (md) =>
            setActionItemLineDueDate(md, item.line!, tomorrow),
          );
          if (patched) await updateNote(item.noteId, patched);
        }
      }
      setDirectiveRefresh((k) => k + 1);
    },
    [user, directive, handleFocusQueueUpdate, setDueDate, setDueTime, notes, updateNote],
  );

  const briefing = useMemo(() => {
    if (!assistantEnabled) return null;
    return generateBriefing({
      tasks,
      actionItems,
      notes,
      events,
      now: new Date(),
      meetingRules: parseMeetingRules(profile?.meeting_rules),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantEnabled, tasks, actionItems, notes, events, profile?.meeting_rules, directiveRefresh]);

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div
        className={[
          'mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10',
          assistantEnabled && directive ? 'max-w-[90rem]' : 'max-w-5xl',
        ].join(' ')}
      >
        <header className="mb-6 sm:mb-8 lg:mb-10">
          <Badge variant="subtle" className="uppercase tracking-wider">
            {dateLabel}
          </Badge>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-text">
            {greeting}, {name}.
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {assistantEnabled
              ? 'Your executive assistant is directing the day.'
              : 'Here\'s your workspace at a glance.'}
            {!profile?.first_name?.trim() && (
              <>
                {' '}
                <button
                  onClick={() => navigate(viewPath('profile'))}
                  className="font-medium text-brand-700 hover:text-brand-600"
                >
                  Set your name
                </button>{' '}
                to personalize this greeting.
              </>
            )}
          </p>
        </header>

        {assistantEnabled && directive ? (
          <>
            <ExecutiveDayHud directive={directive} briefing={briefing} />

            {/* Wide: directive left, schedule rail right */}
            <div className="hidden xl:grid xl:grid-cols-12 xl:items-start xl:gap-8">
              <div className="xl:col-span-8 space-y-6">
                <ExecutiveCommandCenter
                  directive={directive}
                  onRefresh={() => setDirectiveRefresh((k) => k + 1)}
                  sections={['now', 'gaps']}
                  hideBriefingBadges
                />
                <ExecutiveFocusStack
                  directive={directive}
                  tasks={tasks}
                  actionItems={actionItems}
                  prefs={focusQueuePrefs}
                  disabled={!user}
                  onUpdatePrefs={handleFocusQueueUpdate}
                  onScheduleTomorrow={handleScheduleFocusTomorrow}
                  onToggleTask={handleToggleTaskDone}
                  onToggleAction={toggleAction}
                />
              </div>
              <aside className="xl:col-span-4 space-y-4 xl:sticky xl:top-4">
                <ExecutiveCommandCenter
                  directive={directive}
                  onRefresh={() => setDirectiveRefresh((k) => k + 1)}
                  sections={['next', 'timeline']}
                  compact
                  hideBriefingBadges
                />
                {briefing ? (
                  <ExecutiveHudSidebar
                    directive={directive}
                    briefing={briefing}
                    tasks={tasks}
                    notes={notes}
                    actionItems={actionItems}
                    focusPrefs={focusQueuePrefs}
                    dismissedDecisionIds={dismissedDecisionIds}
                    onDismissDecision={dismissDecision}
                    onFocusPrefsUpdate={handleFocusQueueUpdate}
                    onRefresh={() => setDirectiveRefresh((k) => k + 1)}
                  />
                ) : null}
              </aside>
            </div>

            {/* Narrow: full stack */}
            <div className="xl:hidden space-y-6">
              <ExecutiveCommandCenter
                directive={directive}
                onRefresh={() => setDirectiveRefresh((k) => k + 1)}
                hideBriefingBadges
              />
              <ExecutiveFocusStack
                directive={directive}
                tasks={tasks}
                actionItems={actionItems}
                prefs={focusQueuePrefs}
                disabled={!user}
                onUpdatePrefs={handleFocusQueueUpdate}
                onScheduleTomorrow={handleScheduleFocusTomorrow}
                onToggleTask={handleToggleTaskDone}
                onToggleAction={toggleAction}
              />
              {briefing ? (
                <ExecutiveHudSidebar
                  directive={directive}
                  briefing={briefing}
                  tasks={tasks}
                  notes={notes}
                  actionItems={actionItems}
                  focusPrefs={focusQueuePrefs}
                  dismissedDecisionIds={dismissedDecisionIds}
                  onDismissDecision={dismissDecision}
                  onFocusPrefsUpdate={handleFocusQueueUpdate}
                  onRefresh={() => setDirectiveRefresh((k) => k + 1)}
                />
              ) : null}
            </div>

            <DashboardActionItemsSection
              user={user}
              workRows={workRows}
              visibleWork={visibleWork}
              itemCount={workItemCount}
              idPrefix="dashboard-assistant-action"
              titlePlaceholder="Capture something quickly…"
              className="mt-6"
              onQuickAdd={handleDashboardQuickAdd}
              onToggleTask={handleToggleTaskDone}
              onToggleAction={toggleAction}
              onOpenTasks={openTasksView}
            />

            <details className="mb-8 mt-6 rounded-xl border border-border bg-surface-raised">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-muted hover:text-text">
                Reference — schedule & notes
              </summary>
              <div className="border-t border-border px-4 py-4">
                <DashboardReferencePanels
                  todaysSchedule={todaysSchedule}
                  recent={recent}
                  loading={loading}
                  onOpenNote={openNote}
                  onOpenCalendar={() => navigate(viewPath('calendar'))}
                  onOpenNotes={() => navigate(viewPath('notes'))}
                />
              </div>
            </details>
          </>
        ) : (
          <>
        <CriticalBlocker rows={workRows} />

        {routineEnabled ? (
          <WeeklyRoutineDashboardCard
            dayLabel={`${routineDay.label} - ${routineDay.theme}`}
            summary={routineDay.summary}
            date={routineTodayDate}
            progress={routineTodayProgress}
            loading={routineLoading}
            upcoming={routineUpcoming}
            statusForItem={routineStatusForItem}
            onOpen={() => navigate(viewPath('routine'))}
            onStatus={(itemId, status) => {
              if (!user) return;
              void setRoutineItemStatus(
                user.id,
                routineTodayDate,
                itemId,
                status,
                routineTemplateVersionKey,
              );
            }}
          />
        ) : null}

        <div className="mb-6 grid grid-cols-1 gap-6 lg:mb-8 lg:grid-cols-2 lg:gap-8 lg:items-stretch">
          <DashboardActionItemsSection
            user={user}
            workRows={workRows}
            visibleWork={visibleWork}
            itemCount={workItemCount}
            idPrefix="dashboard-quick-add"
            onQuickAdd={handleDashboardQuickAdd}
            onToggleTask={handleToggleTaskDone}
            onToggleAction={toggleAction}
            onOpenTasks={openTasksView}
          />

          <UsefulLinksSection className="flex min-h-0 min-w-0 flex-col" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8 lg:items-stretch">
          <section className="flex min-h-0 min-w-0 flex-col lg:h-full">
            <SectionHeader
              icon={<ClockIcon className="h-4 w-4" />}
              title="Today's schedule"
              accent="blue"
              action={
                <button
                  onClick={() => navigate(viewPath('calendar'))}
                  className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
                >
                  Calendar
                  <ArrowRightIcon className="h-3 w-3" />
                </button>
              }
            />
            <Card
              padded="sm"
              className="card-pop card-pop-blue flex min-h-0 flex-1 flex-col"
            >
              {todaysSchedule.length === 0 ? (
                <p className="flex-1 text-sm leading-relaxed text-text-muted">
                  No events today.
                </p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain lg:max-h-[min(58vh,32rem)]">
                  {todaysSchedule.slice(0, 8).map((o) => (
                    <li
                      key={`${o.eventId}:${o.start.toISOString()}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-text">{o.title}</p>
                          {o.source === 'outlook_ics' ? (
                            <Badge variant="subtle">Outlook</Badge>
                          ) : (
                            <Badge variant="purple">App</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {o.start.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {o.end.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge variant="blue">
                          {o.start.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </Badge>
                        <button
                          type="button"
                          className="btn-danger flex h-8 w-8 items-center justify-center p-0"
                          title={`Delete “${o.title}”`}
                          aria-label={`Delete event ${o.title}`}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete “${o.title}”? This removes it from the app.`,
                              )
                            )
                              return;
                            void deleteEvent(o.eventId);
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {todaysSchedule.length > 8 && (
                    <li className="text-xs text-text-muted">+{todaysSchedule.length - 8} more</li>
                  )}
                </ul>
              )}
            </Card>
          </section>

          <div className="flex min-h-0 min-w-0 flex-col gap-6 lg:gap-8">
            <section className="flex min-h-0 min-w-0 flex-col">
              <SectionHeader icon={<NoteIcon className="h-4 w-4" />} title="At a glance" accent="green" />
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Notes" value={notes.length} />
                <StatCard label="Open tasks" value={openTasks.length + actionItems.length} />
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <SectionHeader
                icon={<NoteIcon className="h-4 w-4" />}
                title="Recent notes"
                accent="brand"
                action={
                  notes.length > 0 ? (
                    <button
                      onClick={() => navigate(viewPath('notes'))}
                      className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
                    >
                      View all
                      <ArrowRightIcon className="h-3 w-3" />
                    </button>
                  ) : null
                }
              />
              <Card
                padded="none"
                className="card-pop card-pop-purple flex min-h-0 flex-1 flex-col overflow-hidden lg:max-h-[min(42vh,24rem)]"
              >
                {loading && notes.length === 0 ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <EmptyState
                      icon={<NoteIcon className="h-5 w-5" />}
                      title="Loading…"
                      message="Fetching your notes."
                    />
                  </div>
                ) : recent.length === 0 ? (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <EmptyState
                      icon={<NoteIcon className="h-5 w-5" />}
                      title="No notes yet"
                      message="Create your first note to see it here."
                    />
                  </div>
                ) : (
                  <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
                    {recent.map((note) => (
                      <RecentNoteRow key={note.id} note={note} onOpen={() => openNote(note.id)} />
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function DashboardReferencePanels({
  todaysSchedule,
  recent,
  loading,
  onOpenNote,
  onOpenCalendar,
  onOpenNotes,
}: {
  todaysSchedule: Array<{ eventId: string; title: string; start: Date; end: Date; source: string }>;
  recent: Note[];
  loading: boolean;
  onOpenNote: (id: string) => void;
  onOpenCalendar: () => void;
  onOpenNotes: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <SectionHeader
          icon={<ClockIcon className="h-4 w-4" />}
          title="Today's schedule"
          accent="blue"
          action={
            <button type="button" onClick={onOpenCalendar} className="text-xs font-medium text-brand-700 hover:text-brand-600">
              Calendar
            </button>
          }
        />
        <Card padded="sm" className="mt-2">
          {todaysSchedule.length === 0 ? (
            <p className="text-sm text-text-muted">No events today.</p>
          ) : (
            <ul className="space-y-2">
              {todaysSchedule.slice(0, 6).map((o) => (
                <li key={`${o.eventId}:${o.start.toISOString()}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-text">{o.title}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {o.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <section>
        <SectionHeader
          icon={<NoteIcon className="h-4 w-4" />}
          title="Recent notes"
          accent="brand"
          action={
            <button type="button" onClick={onOpenNotes} className="text-xs font-medium text-brand-700 hover:text-brand-600">
              View all
            </button>
          }
        />
        <Card padded="none" className="mt-2 divide-y divide-border">
          {loading && recent.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-muted">No notes yet.</p>
          ) : (
            recent.map((note) => (
              <RecentNoteRow key={note.id} note={note} onOpen={() => onOpenNote(note.id)} />
            ))
          )}
        </Card>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card padded="sm">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-text">
        {value}
      </p>
    </Card>
  );
}

function WeeklyRoutineDashboardCard({
  dayLabel,
  summary,
  date,
  progress,
  loading,
  upcoming,
  statusForItem,
  onOpen,
  onStatus,
}: {
  dayLabel: string;
  summary: string;
  date: string;
  progress: { done: number; total: number; percent: number };
  loading: boolean;
  upcoming: RoutineChecklistItem[];
  statusForItem: (itemId: string) => RoutineStatus;
  onOpen: () => void;
  onStatus: (itemId: string, status: RoutineStatus) => void;
}) {
  return (
    <section className="mb-6 lg:mb-8">
      <SectionHeader
        icon={<BookIcon className="h-4 w-4" />}
        title="Today's routine"
        count={progress.total}
        accent="purple"
        action={
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
          >
            Open routine
            <ArrowRightIcon className="h-3 w-3" />
          </button>
        }
      />
      <Card className="card-pop card-pop-purple">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="purple">{date}</Badge>
              {loading ? <Badge variant="subtle">Syncing</Badge> : null}
            </div>
            <h2 className="mt-2 text-lg font-semibold text-text">{dayLabel}</h2>
            <p className="mt-1 text-sm text-text-muted">{summary}</p>

            {upcoming.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                Routine complete for today.
              </p>
            ) : (
              <ul className="mt-4 grid gap-2 lg:grid-cols-3">
                {upcoming.map((item) => {
                  const status = statusForItem(item.id);
                  const isBlock = item.kind === 'time-block';
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 rounded-lg bg-surface-sunken px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={status === 'done'}
                        disabled={loading}
                        onChange={(e) =>
                          onStatus(item.id, e.target.checked ? 'done' : 'pending')
                        }
                        className="mt-1 rounded border-border"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">{item.title}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {isBlock
                            ? `${item.startTime}-${item.endTime}`
                            : `${item.durationMinutes} min ritual`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="min-w-[11rem] rounded-xl bg-surface-sunken p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Progress
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-3xl font-semibold text-text">{progress.percent}%</span>
              <span className="pb-1 text-sm text-text-muted">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function RecentNoteRow({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = extractPreview(getNoteCanonicalMarkdown(note));
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-sunken"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">
            {note.title || 'Untitled'}
          </p>
          {preview && (
            <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">
              {preview}
            </p>
          )}
        </div>
        <Badge variant="purple" className="shrink-0">
          {formatRelative(note.updated_at)}
        </Badge>
      </button>
    </li>
  );
}

function statusFromDb(status: string): RoutineStatus {
  if (status === 'done' || status === 'skipped') return status;
  return 'pending';
}

function DueDateChip({ dueDate }: { dueDate: string }) {
  const parts = dueDate.split('-').map(Number);
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  let label: string;
  if (diffDays < 0) label = `${Math.abs(diffDays)}d overdue`;
  else if (diffDays === 0) label = 'Today';
  else if (diffDays === 1) label = 'Tomorrow';
  else if (diffDays <= 7) label = `${diffDays}d`;
  else label = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const color =
    diffDays < 0
      ? 'text-red-600 dark:text-red-400'
      : diffDays === 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-text-muted';

  return (
    <span className={['inline-flex items-center gap-1 text-xs font-medium', color].join(' ')} title={`Due ${dueDate}`}>
      <CalendarIcon className="h-3 w-3" />
      {label}
    </span>
  );
}
