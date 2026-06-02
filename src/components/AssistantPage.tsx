import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type BriefingInsight,
  type BriefingReport,
  type NoteProposal,
  generateBriefing,
  getBriefingMode,
  MODE_META,
} from '../lib/assistantBriefing';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import {
  loadDismissedDecisionIds,
  persistDismissedDecisionIds,
} from '../lib/decisionQueue';
import { generateDirective } from '../lib/executiveDirective';
import { parseFocusQueue, type FocusQueuePrefs } from '../lib/focusQueue';
import { parseMeetingRules } from '../lib/meetingTemperament';
import { extractActionItems } from '../lib/format';
import { filterActionItemsDeduped } from '../lib/taskActionMatch';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useMeetingDebriefStore } from '../store/useMeetingDebriefStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { DecisionInsightCard } from './DecisionInsightCard';
import { ExecutiveCommandCenter } from './ExecutiveCommandCenter';
import {
  ArrowRightIcon,
  BrainIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  InboxIcon,
  NoteIcon,
  RefreshIcon,
} from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';
import { TaskQuickAddForm, toCreateTaskOptions } from './TaskQuickAddForm';

type Tab = 'watch' | 'decisions' | 'nuts';

const TAB_CONFIG: Array<{ id: Tab; label: string; emptyMsg: string }> = [
  { id: 'watch', label: 'Watch list', emptyMsg: "No blind spots detected — you're on top of things." },
  {
    id: 'decisions',
    label: 'Decisions needed',
    emptyMsg: 'Nothing waiting on a call from you.',
  },
  { id: 'nuts', label: 'Stats', emptyMsg: 'Nothing critical to report.' },
];

const SEVERITY_STYLE: Record<BriefingInsight['severity'], {
  border: string;
  bg: string;
  badge: string;
  dot: string;
}> = {
  critical: {
    border: 'border-l-red-500',
    bg: 'bg-red-50 dark:bg-red-950/20',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    dot: 'bg-red-500',
  },
  warning: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  decision: {
    border: 'border-l-brand-500',
    bg: 'bg-brand-50 dark:bg-brand-950/20',
    badge: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  info: {
    border: 'border-l-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    dot: 'bg-blue-400',
  },
};

export function AssistantPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const notes = useNotesStore((s) => s.notes);
  const setActive = useNotesStore((s) => s.setActive);
  const events = useEventsStore((s) => s.events);
  const debriefStates = useMeetingDebriefStore((s) => s.states);

  const [activeTab, setActiveTab] = useState<Tab>('watch');
  const [refreshKey, setRefreshKey] = useState(0);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(new Set());
  const [acceptedProposals, setAcceptedProposals] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);

  const timezone = resolveCalendarTimeZone(profile?.timezone);
  const focusQueuePrefs = useMemo(
    () => parseFocusQueue(profile?.focus_queue),
    [profile?.focus_queue],
  );

  const actionItems = useMemo(
    () => filterActionItemsDeduped(tasks, extractActionItems(notes)),
    [notes, tasks],
  );

  const directive = useMemo(
    () =>
      generateDirective({
        tasks,
        actionItems,
        events,
        timezone,
        now: new Date(),
        hasCalendarSource: !!(profile?.outlook_ics_url?.trim()) || events.length > 0,
        meetingRules: parseMeetingRules(profile?.meeting_rules),
        debriefStates,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, actionItems, events, timezone, profile?.outlook_ics_url, profile?.meeting_rules, debriefStates, refreshKey],
  );

  const todayIso = directive.todayIso;
  const [dismissedDecisionIds, setDismissedDecisionIds] = useState(() =>
    loadDismissedDecisionIds(formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')),
  );

  useEffect(() => {
    setDismissedDecisionIds(loadDismissedDecisionIds(todayIso));
  }, [todayIso]);

  const dismissDecision = useCallback(
    (id: string) => {
      setDismissedDecisionIds((prev) => {
        const next = new Set(prev).add(id);
        persistDismissedDecisionIds(todayIso, next);
        return next;
      });
    },
    [todayIso],
  );

  const handleFocusQueueUpdate = useCallback(
    (next: FocusQueuePrefs) => {
      if (!user) return;
      const current = useProfileStore.getState().profile;
      if (current) {
        useProfileStore.setState({ profile: { ...current, focus_queue: next } });
      }
      void updateProfile(user.id, { focus_queue: next });
      setRefreshKey((k) => k + 1);
    },
    [user, updateProfile],
  );

  const report: BriefingReport = useMemo(
    () =>
      generateBriefing({
        tasks,
        actionItems,
        notes,
        events,
        now: new Date(),
        meetingRules: parseMeetingRules(profile?.meeting_rules),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, actionItems, notes, events, profile?.meeting_rules, refreshKey],
  );

  const openNote = useCallback(
    (id: string) => {
      setActive(id);
      navigate(viewPath('notes'));
    },
    [setActive, navigate],
  );

  const openTask = useCallback(() => {
    navigate(viewPath('tasks'));
  }, [navigate]);

  const tabInsights = useMemo(() => {
    const section = report.insights.filter((i) => i.section === activeTab);
    if (activeTab !== 'decisions') return section;
    return section.filter((i) => !dismissedDecisionIds.has(i.id));
  }, [report.insights, activeTab, dismissedDecisionIds]);

  const visibleProposals = useMemo(
    () =>
      report.proposals.filter(
        (p) => !dismissedProposals.has(p.id) && !acceptedProposals.has(p.id),
      ),
    [report.proposals, dismissedProposals, acceptedProposals],
  );

  const acceptProposal = async (proposal: NoteProposal) => {
    if (!user) return;
    setAccepting(proposal.id);
    try {
      await createTask(user.id, proposal.suggestedTaskTitle, {
        ...(proposal.suggestedDueDate ? { dueDate: proposal.suggestedDueDate } : {}),
      });
      setAcceptedProposals((prev) => new Set(prev).add(proposal.id));
      setRefreshKey((k) => k + 1);
    } finally {
      setAccepting(null);
    }
  };

  const dismissProposal = (id: string) => {
    setDismissedProposals((prev) => new Set(prev).add(id));
  };

  const mode = getBriefingMode();
  const modeMeta = MODE_META[mode];
  const name = profile?.first_name?.trim() || user?.email?.split('@')[0] || 'there';

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <IconBadge tone="brand" size="lg" className="shrink-0">
                <BrainIcon className="h-6 w-6" />
              </IconBadge>
              <div>
                <Badge variant="purple" className="uppercase tracking-wider text-[10px]">
                  {modeMeta.label}
                </Badge>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">
                  Executive Assistant
                </h1>
                <p className="mt-1 text-sm text-text-muted">
                  {name}, here is what to do now and what I still need from you.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="btn-ghost shrink-0 p-2"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <ExecutiveCommandCenter
          directive={directive}
          briefing={report}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />

        <Card padded="none" className="mt-6 overflow-hidden">
          <TaskQuickAddForm
            variant="embedded"
            disabled={!user}
            idPrefix="assistant-directive-add"
            titlePlaceholder="Capture a task…"
            onSubmit={async (payload) => {
              if (!user) return;
              await createTask(user.id, payload.title, toCreateTaskOptions(payload));
              setRefreshKey((k) => k + 1);
            }}
          />
        </Card>

        {(visibleProposals.length > 0 || report.proposals.length > 0) && (
          <section className="mt-8">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="From your notes"
              count={visibleProposals.length}
              accent="green"
            />
            <p className="mt-1 mb-3 text-xs text-text-muted">
              Signals in your notes — turn into tasks or dismiss.
            </p>
            {visibleProposals.length === 0 ? (
              <Card padded="sm">
                <p className="text-sm text-text-muted">All proposals actioned.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {visibleProposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    isAccepting={accepting === proposal.id}
                    onAccept={() => void acceptProposal(proposal)}
                    onDismiss={() => dismissProposal(proposal.id)}
                    onOpenNote={() => openNote(proposal.noteId)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <section className="mt-8">
          <SectionHeader
            icon={<BrainIcon className="h-4 w-4" />}
            title="Briefing depth"
            count={report.insights.length}
            accent="brand"
          />
          <NutsStrip report={report} onNavigate={navigate} />

          <div className="mt-3 flex gap-1 rounded-lg bg-surface-sunken p-1">
            {TAB_CONFIG.map(({ id, label }) => {
              const count = report.insights.filter((i) => i.section === id).length;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all',
                    activeTab === id
                      ? 'bg-surface text-text shadow-sm ring-1 ring-border'
                      : 'text-text-muted hover:text-text',
                  ].join(' ')}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={[
                        'inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                        activeTab === id ? 'bg-brand-600 text-white' : 'bg-surface-raised text-text-muted',
                      ].join(' ')}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 space-y-3">
            {tabInsights.length === 0 ? (
              <Card padded="sm">
                <EmptyState
                  icon={<BrainIcon className="h-5 w-5" />}
                  title={TAB_CONFIG.find((t) => t.id === activeTab)?.emptyMsg ?? 'Nothing here.'}
                  message=""
                />
              </Card>
            ) : (
              tabInsights.map((insight) =>
                activeTab === 'decisions' ? (
                  <DecisionInsightCard
                    key={insight.id}
                    insight={insight}
                    todayIso={todayIso}
                    focusPrefs={focusQueuePrefs}
                    onFocusPrefsUpdate={handleFocusQueueUpdate}
                    tasks={tasks}
                    notes={notes}
                    actionItems={actionItems}
                    onDismiss={() => dismissDecision(insight.id)}
                    onRefresh={() => setRefreshKey((k) => k + 1)}
                    variant="card"
                  />
                ) : (
                  <InsightCard
                    key={insight.id}
                    insight={insight}
                    onOpenTask={openTask}
                    onOpenNote={openNote}
                  />
                ),
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NutsStrip({ report, onNavigate }: { report: BriefingReport; onNavigate: ReturnType<typeof useNavigate> }) {
  const { nuts } = report;
  type StatItem = { icon: React.ReactNode; label: string; value: number | string; accent: string; onClick?: () => void };
  const stats: StatItem[] = [
    {
      icon: <CheckSquareIcon className="h-4 w-4" />,
      label: 'Open tasks',
      value: nuts.totalOpenTasks,
      accent: nuts.criticalTasks > 0 ? 'text-red-600 dark:text-red-400' : 'text-text',
      onClick: () => onNavigate(viewPath('tasks')),
    },
    {
      icon: <CalendarIcon className="h-4 w-4" />,
      label: "Today's meetings",
      value: nuts.todayEventCount,
      accent: 'text-text',
      onClick: () => onNavigate(viewPath('calendar')),
    },
    {
      icon: <InboxIcon className="h-4 w-4" />,
      label: 'Owed to me',
      value: nuts.owedToMeCount,
      accent: nuts.owedStaleDays14 > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-text',
      onClick: () => onNavigate(viewPath('owed')),
    },
    {
      icon: <ClockIcon className="h-4 w-4" />,
      label: 'Due this week',
      value: nuts.dueThisWeekCount,
      accent: nuts.overdueCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-text',
      onClick: () => onNavigate(viewPath('tasks')),
    },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={s.onClick}
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface-raised p-4 text-left transition-colors hover:border-brand-300 hover:bg-surface-sunken"
        >
          <span className="text-text-muted">{s.icon}</span>
          <span className={['text-2xl font-semibold', s.accent].join(' ')}>{s.value}</span>
          <span className="text-xs text-text-muted">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function InsightCard({
  insight,
  onOpenTask,
  onOpenNote,
}: {
  insight: BriefingInsight;
  onOpenTask: () => void;
  onOpenNote: (id: string) => void;
}) {
  const style = SEVERITY_STYLE[insight.severity];
  const severityLabel =
    insight.severity === 'decision' ? 'Decision' :
    insight.severity === 'critical' ? 'Critical' :
    insight.severity === 'warning' ? 'Watch' : 'Info';

  return (
    <div className={['rounded-xl border border-border border-l-4 p-4', style.border, style.bg].join(' ')}>
      <div className="flex items-start gap-3">
        <div className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot].join(' ')} />
        <div className="min-w-0 flex-1">
          <span className={['rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', style.badge].join(' ')}>
            {severityLabel}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-text">{insight.headline}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{insight.detail}</p>
          {insight.actionTarget && (
            <button
              type="button"
              onClick={() => {
                const t = insight.actionTarget!;
                if (t.kind === 'task') onOpenTask();
                else onOpenNote(t.kind === 'note' ? t.id : t.noteId);
              }}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
            >
              {insight.actionTarget.kind === 'task' ? 'Open tasks' : 'Open note'}
              <ArrowRightIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  isAccepting,
  onAccept,
  onDismiss,
  onOpenNote,
}: {
  proposal: NoteProposal;
  isAccepting: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onOpenNote: () => void;
}) {
  const typeLabel =
    proposal.type === 'follow-up' ? 'Follow-up' :
    proposal.type === 'review' ? 'Review' : 'Reminder';

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-muted">{typeLabel}</span>
          <span className="text-[10px] text-text-subtle">from</span>
          <button type="button" onClick={onOpenNote} className="text-xs font-medium text-brand-700 hover:underline">
            {proposal.noteTitle}
          </button>
        </div>
        <p className="text-sm font-semibold text-text">{proposal.suggestedTaskTitle}</p>
        {proposal.suggestedDueDate && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-text-muted">
            <CalendarIcon className="h-3 w-3" />
            Suggested due: {proposal.suggestedDueDate}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <button type="button" onClick={onAccept} disabled={isAccepting} className="btn-primary py-1.5 text-xs">
          {isAccepting ? 'Creating…' : '+ Create task'}
        </button>
        <button type="button" onClick={onDismiss} className="btn-ghost py-1.5 text-xs text-text-muted">
          Dismiss
        </button>
      </div>
    </div>
  );
}
