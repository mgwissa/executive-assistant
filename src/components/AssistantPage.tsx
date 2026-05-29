import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type BriefingInsight,
  type BriefingReport,
  type NoteProposal,
  generateBriefing,
  getBriefingMode,
  MODE_META,
} from '../lib/assistantBriefing';
import { extractActionItems } from '../lib/format';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
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

type Tab = 'nuts' | 'watch' | 'nudge';

const TAB_CONFIG: Array<{ id: Tab; label: string; emptyMsg: string }> = [
  { id: 'nuts', label: 'Nuts & Bolts', emptyMsg: 'Nothing critical to report.' },
  { id: 'watch', label: 'Watch List', emptyMsg: "No blind spots detected — you're on top of things." },
  { id: 'nudge', label: 'The Nudge', emptyMsg: "No nudges today — all looking clean." },
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
  nudge: {
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
  const tasks = useTasksStore((s) => s.tasks);
  const createTask = useTasksStore((s) => s.createTask);
  const notes = useNotesStore((s) => s.notes);
  const setActive = useNotesStore((s) => s.setActive);
  const events = useEventsStore((s) => s.events);

  const [activeTab, setActiveTab] = useState<Tab>('nuts');
  const [refreshKey, setRefreshKey] = useState(0);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(new Set());
  const [acceptedProposals, setAcceptedProposals] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);

  const actionItems = useMemo(() => extractActionItems(notes), [notes]);

  const report: BriefingReport = useMemo(
    () =>
      generateBriefing({
        tasks,
        actionItems,
        notes,
        events,
        now: new Date(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, actionItems, notes, events, refreshKey],
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

  const tabInsights = useMemo(
    () => report.insights.filter((i) => i.section === activeTab),
    [report.insights, activeTab],
  );

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

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <IconBadge tone="brand" size="lg" className="shrink-0">
                <BrainIcon className="h-6 w-6" />
              </IconBadge>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="purple" className="uppercase tracking-wider text-[10px]">
                    {modeMeta.label}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {report.generatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-text">
                  {mode === 'morning' ? `Good morning, ${name}.` :
                   mode === 'midday'  ? `Midday check-in, ${name}.` :
                   mode === 'afternoon' ? `Afternoon, ${name}.` :
                   `Evening, ${name}.`}
                </h1>
                <p className="mt-1 text-sm text-text-muted">{modeMeta.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="btn-ghost shrink-0 p-2"
              title="Refresh briefing"
              aria-label="Refresh briefing"
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Nuts at a glance — stat strip */}
        <NutsStrip report={report} onNavigate={navigate} />

        <section className="mt-6">
          <SectionHeader
            icon={<CheckSquareIcon className="h-4 w-4" />}
            title="Quick add"
            accent="amber"
          />
          <Card padded="none" className="mt-3 overflow-hidden">
            <TaskQuickAddForm
              variant="embedded"
              disabled={!user}
              idPrefix="assistant-quick-add"
              titlePlaceholder="Capture a task…"
              onSubmit={async (payload) => {
                if (!user) return;
                await createTask(user.id, payload.title, toCreateTaskOptions(payload));
              }}
            />
          </Card>
        </section>

        {/* Main insight tabs */}
        <section className="mt-8">
          <SectionHeader
            icon={<BrainIcon className="h-4 w-4" />}
            title="Your briefing"
            count={report.insights.length}
            accent="brand"
          />

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
                    <span className={[
                      'inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                      activeTab === id
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-raised text-text-muted',
                    ].join(' ')}>
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
              tabInsights.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onOpenTask={openTask}
                  onOpenNote={openNote}
                />
              ))
            )}
          </div>
        </section>

        {/* Note proposals */}
        {(visibleProposals.length > 0 || report.proposals.length > 0) && (
          <section className="mt-8">
            <SectionHeader
              icon={<NoteIcon className="h-4 w-4" />}
              title="From your notes"
              count={visibleProposals.length}
              accent="green"
            />
            <p className="mt-1 mb-3 text-xs text-text-muted">
              I found these signals in your notes — want me to turn them into tasks?
            </p>
            {visibleProposals.length === 0 ? (
              <Card padded="sm">
                <p className="text-sm text-text-muted">All proposals actioned. ✓</p>
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

        {/* No insights at all */}
        {report.insights.length === 0 && report.proposals.length === 0 && (
          <Card padded="sm" className="mt-6">
            <EmptyState
              icon={<BrainIcon className="h-5 w-5" />}
              title="All clear."
              message="No issues detected. Come back after a few tasks and calendar events are in."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Stat strip ──────────────────────────────────────────────────────────────

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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

// ─── Insight card ─────────────────────────────────────────────────────────────

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
  const severityLabel = insight.severity === 'nudge' ? 'Nudge' :
    insight.severity === 'critical' ? 'Critical' :
    insight.severity === 'warning' ? 'Watch' : 'Info';

  return (
    <div className={[
      'rounded-xl border border-border border-l-4 p-4',
      style.border,
      style.bg,
    ].join(' ')}>
      <div className="flex items-start gap-3">
        <div className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot].join(' ')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={['rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', style.badge].join(' ')}>
              {severityLabel}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-semibold text-text">{insight.headline}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{insight.detail}</p>
          {insight.actionTarget && (
            <button
              type="button"
              onClick={() =>
                insight.actionTarget!.kind === 'task' ? onOpenTask() : onOpenNote(insight.actionTarget!.id)
              }
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

// ─── Proposal card ────────────────────────────────────────────────────────────

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
  const typeLabel = proposal.type === 'follow-up' ? '📬 Follow-up' :
    proposal.type === 'review' ? '🔄 Review' : '⏰ Reminder';

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-text-muted">{typeLabel}</span>
            <span className="text-[10px] text-text-subtle">from</span>
            <button
              type="button"
              onClick={onOpenNote}
              className="text-xs font-medium text-brand-700 hover:text-brand-600 hover:underline"
            >
              {proposal.noteTitle}
            </button>
          </div>
          <p className="text-sm font-semibold text-text">{proposal.suggestedTaskTitle}</p>
          {proposal.text !== proposal.suggestedTaskTitle && (
            <p className="mt-0.5 text-xs text-text-muted line-clamp-1">"{proposal.text}"</p>
          )}
          {proposal.suggestedDueDate && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-text-muted">
              <CalendarIcon className="h-3 w-3" />
              Suggested due: {proposal.suggestedDueDate}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={isAccepting}
          className="btn-primary py-1.5 text-xs"
        >
          {isAccepting ? 'Creating…' : '+ Create task'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="btn-ghost py-1.5 text-xs text-text-muted"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
