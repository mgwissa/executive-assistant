import { useEffect, useMemo, useState } from 'react';
import {
  actionKindMeta,
  isUndoRefusal,
  parseEffects,
  planUndo,
  runKindLabel,
} from '../lib/agentDesk';
import { DEFAULT_AGENT_PLAYBOOK } from '../lib/agentPlaybook';
import { formatRelative } from '../lib/format';
import { useAgentStore } from '../store/useAgentStore';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import type { AgentAction, AgentRun } from '../types';
import { BrainIcon, RefreshIcon, SparklesIcon, SquareIcon } from './icons';
import { MarkdownPreview } from './MarkdownPreview';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';

type Tab = 'activity' | 'brief' | 'memory' | 'playbook';

const TABS: { id: Tab; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'brief', label: 'Brief' },
  { id: 'memory', label: 'What I remember' },
  { id: 'playbook', label: 'Playbook' },
];

/**
 * A run plus the actions it produced. Actions whose run was pruned (or that
 * were written outside a run) collect under a null run so nothing is ever
 * silently dropped from the log.
 */
type LogGroup = { run: AgentRun | null; actions: AgentAction[] };

function groupActionsByRun(runs: AgentRun[], actions: AgentAction[]): LogGroup[] {
  const byRun = new Map<string, AgentAction[]>();
  const orphans: AgentAction[] = [];

  for (const action of actions) {
    if (!action.run_id) {
      orphans.push(action);
      continue;
    }
    const bucket = byRun.get(action.run_id);
    if (bucket) bucket.push(action);
    else byRun.set(action.run_id, [action]);
  }

  const groups: LogGroup[] = [];
  if (orphans.length > 0) groups.push({ run: null, actions: orphans });

  for (const run of runs) {
    const runActions = byRun.get(run.id);
    // Runs with no actions still belong in the log — "I looked and changed
    // nothing" is information worth seeing.
    groups.push({ run, actions: runActions ?? [] });
    byRun.delete(run.id);
  }

  // Anything left references a run older than our fetch window.
  for (const [, leftover] of byRun) {
    groups.push({ run: null, actions: leftover });
  }

  return groups;
}

function isNew(action: AgentAction, seenAt: string | null | undefined): boolean {
  if (!seenAt) return true;
  return action.created_at > seenAt;
}

function ActionRow({
  action,
  seenAt,
  busy,
  onUndo,
}: {
  action: AgentAction;
  seenAt: string | null | undefined;
  busy: boolean;
  onUndo: () => void;
}) {
  const meta = actionKindMeta(action.kind);
  const effects = parseEffects(action.effects);
  const plan = planUndo(action);
  const refusal = isUndoRefusal(plan) ? plan.reason : null;
  const undone = action.status === 'undone';
  const fresh = isNew(action, seenAt) && !undone;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex shrink-0 items-center gap-2 sm:w-32 sm:pt-0.5">
        <Badge variant={meta.accent}>{meta.label}</Badge>
        {fresh ? (
          <span
            className="h-1.5 w-1.5 rounded-full bg-brand-500"
            title="New since you last looked"
            aria-label="New since you last looked"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={[
            'text-sm font-medium',
            undone ? 'text-text-muted line-through' : 'text-text',
          ].join(' ')}
        >
          {action.title}
        </p>

        {effects.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {effects.map((effect, i) => (
              <li key={i} className="font-mono text-xs text-text-muted">
                {effect}
              </li>
            ))}
          </ul>
        ) : null}

        {action.rationale ? (
          <p className="mt-1.5 text-xs leading-relaxed text-text-subtle">{action.rationale}</p>
        ) : null}

        <p className="mt-1 text-[11px] text-text-subtle">By {action.actor_name}</p>

        {action.undo_error ? (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            Undo failed: {action.undo_error}
          </p>
        ) : null}

        {action.apply_error ? (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
            This change did not apply: {action.apply_error}
          </p>
        ) : null}

        {action.before || action.after ? (
          <details className="mt-2 text-xs text-text-subtle">
            <summary className="cursor-pointer select-none font-medium text-text-muted hover:text-text">
              Exact change
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {action.before ? (
                <div className="min-w-0 rounded-md border border-border bg-surface-sunken p-2">
                  <p className="mb-1 font-semibold uppercase tracking-wide">Before</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(action.before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {action.after ? (
                <div className="min-w-0 rounded-md border border-border bg-surface-sunken p-2">
                  <p className="mb-1 font-semibold uppercase tracking-wide">After</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(action.after, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:pt-0.5">
        <span className="text-xs tabular-nums text-text-subtle">
          {formatRelative(action.created_at)}
        </span>
        {undone ? (
          <Badge variant="subtle">Undone</Badge>
        ) : (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy || !!refusal}
            title={refusal ?? 'Reverse this change'}
            className="btn-secondary flex items-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshIcon className="h-3 w-3" />
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>
    </li>
  );
}

function RunGroup({
  group,
  seenAt,
  undoingId,
  onUndo,
}: {
  group: LogGroup;
  seenAt: string | null | undefined;
  undoingId: string | null;
  onUndo: (id: string) => void;
}) {
  const { run, actions } = group;

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-text">
          {run ? runKindLabel(run.kind) : 'Earlier changes'}
        </h3>
        {run ? (
          <span className="text-xs text-text-subtle">{formatRelative(run.started_at)}</span>
        ) : null}
        {run?.status === 'error' ? <Badge variant="red">Failed</Badge> : null}
        {run?.status === 'running' ? <Badge variant="blue">Running</Badge> : null}
        {run?.trigger_source === 'manual' ? <Badge variant="subtle">Manual</Badge> : null}
      </div>

      {run?.summary ? (
        <p className="mb-2 text-sm leading-relaxed text-text-muted">{run.summary}</p>
      ) : null}

      {run?.error ? (
        <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {run.error}
        </p>
      ) : null}

      <Card padded="none">
        {actions.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-subtle">
            Looked things over and left everything alone.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                seenAt={seenAt}
                busy={undoingId === action.id}
                onUndo={() => onUndo(action.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function PlaybookPanel({
  initial,
  persisted,
  saving,
  onSave,
}: {
  initial: string;
  /**
   * False when `initial` is the built-in default rather than something the
   * owner saved. That distinction matters: an unsaved playbook means
   * `profiles.agent_playbook` is still null, and scheduled runs would fetch
   * no instructions at all.
   */
  persisted: boolean;
  saving: boolean;
  onSave: (next: string) => void;
}) {
  // The parent remounts this panel (via `key`) whenever the stored playbook
  // changes, so `initial` is a genuine initial value and needs no effect to
  // stay in sync. Typing does not change `initial`, so drafts survive.
  const [draft, setDraft] = useState(initial);

  const changed = draft !== initial;
  const needsSave = changed || !persisted;

  return (
    <div>
      <p className="mb-3 text-sm leading-relaxed text-text-muted">
        Standing instructions, read at the start of every run. This is how you steer me without
        touching the schedule — add a rule here and the next run picks it up.
      </p>
      {!persisted ? (
        <p className="mb-3 rounded-card border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          This is the suggested starting point, not saved yet. Until you save it,
          <span className="font-medium"> scheduled runs have no instructions to follow</span>. Edit
          it however you like first — it is meant to be yours.
        </p>
      ) : null}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={18}
        spellCheck={false}
        className="w-full rounded-card border border-border bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-text focus:border-brand-500 focus:outline-none"
        placeholder="e.g. Never move anything tagged #board. Chase Priya over Teams, not email."
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!needsSave || saving}
          onClick={() => onSave(draft)}
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : needsSave ? 'Save playbook' : 'Saved'}
        </button>
        {changed ? (
          <button
            type="button"
            onClick={() => setDraft(initial)}
            className="btn-secondary text-sm"
          >
            Discard
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AgentDeskPage({ activityOnly = false }: { activityOnly?: boolean } = {}) {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const savingProfile = useProfileStore((s) => s.saving);

  const runs = useAgentStore((s) => s.runs);
  const actions = useAgentStore((s) => s.actions);
  const briefs = useAgentStore((s) => s.briefs);
  const memory = useAgentStore((s) => s.memory);
  const loading = useAgentStore((s) => s.loading);
  const error = useAgentStore((s) => s.error);
  const undoingId = useAgentStore((s) => s.undoingId);
  const fetchAll = useAgentStore((s) => s.fetchAll);
  const undoAction = useAgentStore((s) => s.undoAction);
  const markLogSeen = useAgentStore((s) => s.markLogSeen);
  const savePlaybook = useAgentStore((s) => s.savePlaybook);

  const [tab, setTab] = useState<Tab>('activity');

  useEffect(() => {
    if (user) void fetchAll(user.id);
  }, [user, fetchAll]);

  const seenAt = profile?.agent_log_seen_at ?? null;

  const newCount = useMemo(
    () => actions.filter((a) => a.status !== 'undone' && isNew(a, seenAt)).length,
    [actions, seenAt],
  );

  const groups = useMemo(() => groupActionsByRun(runs, actions), [runs, actions]);
  const latestBrief = briefs[0] ?? null;
  const lastRunAt = runs[0]?.started_at ?? null;

  const handleUndo = (id: string) => {
    if (!user) return;
    void undoAction(user.id, id);
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconBadge tone="brand" size="md" className="shrink-0">
                <BrainIcon className="h-5 w-5" />
              </IconBadge>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-text">
                  {activityOnly ? 'Codex activity' : 'Agent'}
                </h1>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  {activityOnly
                    ? 'Every workspace change Codex made, newest first, with the reason, exact data, and an undo action when reversal is safe.'
                    : 'Everything I changed in your workspace, newest first. Nothing here is a suggestion — it already happened, and every reversible entry has an undo action.'}
                  {lastRunAt ? (
                    <> Last run {formatRelative(lastRunAt)}.</>
                  ) : (
                    <> No runs yet.</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {newCount > 0 ? <Badge variant="brand">{newCount} new</Badge> : null}
              {newCount > 0 && user ? (
                <button
                  type="button"
                  onClick={() => void markLogSeen(user.id)}
                  className="btn-secondary text-xs"
                >
                  Mark all seen
                </button>
              ) : null}
              {user ? (
                <button
                  type="button"
                  onClick={() => void fetchAll(user.id)}
                  className="btn-secondary flex items-center gap-1 text-xs"
                  title="Reload the log"
                >
                  <RefreshIcon className="h-3 w-3" />
                  Refresh
                </button>
              ) : null}
            </div>
          </div>

          {!activityOnly ? <nav className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'border-brand-600 text-text'
                    : 'border-transparent text-text-muted hover:text-text',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </nav> : null}
        </header>

        {error ? (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        {activityOnly || tab === 'activity' ? (
          loading && actions.length === 0 ? (
            <Card padded="none">
              <EmptyState
                icon={<SquareIcon className="h-5 w-5" />}
                title="Loading…"
                message="Fetching the activity log."
              />
            </Card>
          ) : groups.length === 0 ? (
            <Card padded="none">
              <EmptyState
                icon={<BrainIcon className="h-5 w-5" />}
                title="Nothing yet"
                message="Once Codex changes something, it will show up here with its reason and an undo action when reversal is safe."
              />
            </Card>
          ) : (
            <div>
              {groups.map((group, i) => (
                <RunGroup
                  key={group.run?.id ?? `orphan-${i}`}
                  group={group}
                  seenAt={seenAt}
                  undoingId={undoingId}
                  onUndo={handleUndo}
                />
              ))}
            </div>
          )
        ) : null}

        {!activityOnly && tab === 'brief' ? (
          latestBrief ? (
            <div>
              <SectionHeader
                title={latestBrief.kind === 'morning' ? 'Morning brief' : 'Evening close-out'}
                accent="brand"
                icon={<SparklesIcon className="h-4 w-4" />}
              />
              <Card>
                <p className="mb-3 text-xs text-text-subtle">{latestBrief.brief_date}</p>
                <MarkdownPreview content={latestBrief.body} />
              </Card>
            </div>
          ) : (
            <Card padded="none">
              <EmptyState
                icon={<SparklesIcon className="h-5 w-5" />}
                title="No brief yet"
                message="Morning and evening briefs land here once the scheduled runs are set up."
              />
            </Card>
          )
        ) : null}

        {!activityOnly && tab === 'memory' ? (
          memory.length === 0 ? (
            <Card padded="none">
              <EmptyState
                icon={<BrainIcon className="h-5 w-5" />}
                title="Nothing learned yet"
                message="Preferences and patterns I pick up land here. Each run starts with no memory, so this is the only thing I carry forward."
              />
            </Card>
          ) : (
            <Card padded="none">
              <ul className="divide-y divide-border">
                {memory.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge variant={m.kind === 'correction' ? 'amber' : 'purple'}>
                        {m.kind}
                      </Badge>
                      {m.pinned ? <Badge variant="brand">Pinned</Badge> : null}
                      <span className="font-mono text-[11px] text-text-subtle">{m.key}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-text">{m.content}</p>
                    <p className="mt-1 text-xs text-text-subtle">
                      Updated {formatRelative(m.updated_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )
        ) : null}

        {!activityOnly && tab === 'playbook' && user ? (
          <PlaybookPanel
            key={profile?.agent_playbook ?? ''}
            initial={profile?.agent_playbook ?? DEFAULT_AGENT_PLAYBOOK}
            persisted={!!profile?.agent_playbook}
            saving={savingProfile}
            onSave={(next) => void savePlaybook(user.id, next)}
          />
        ) : null}
      </div>
    </div>
  );
}
