import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useTimeEntriesStore } from '../store/useTimeEntriesStore';
import { formatDurationSeconds } from '../lib/timeTrackingFormat';
import type { TimeEntry } from '../types';
import { ClockIcon, SquareIcon, TrashIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function TimeTrackingPage() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const tasks = useTasksStore((s) => s.tasks);
  const entries = useTimeEntriesStore((s) => s.entries);
  const loading = useTimeEntriesStore((s) => s.loading);
  const error = useTimeEntriesStore((s) => s.error);
  const fetchAll = useTimeEntriesStore((s) => s.fetchAll);
  const startTimer = useTimeEntriesStore((s) => s.startTimer);
  const stopTimer = useTimeEntriesStore((s) => s.stopTimer);
  const updateLabel = useTimeEntriesStore((s) => s.updateLabel);
  const deleteEntry = useTimeEntriesStore((s) => s.deleteEntry);

  const tz =
    profile?.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (user) void fetchAll(user.id);
  }, [user, fetchAll]);

  const running = useMemo(() => entries.find((e) => e.ended_at == null) ?? null, [entries]);

  const completed = useMemo(
    () =>
      entries.filter((e): e is TimeEntry & { ended_at: string } =>
        Boolean(e.ended_at),
      ),
    [entries],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, (TimeEntry & { ended_at: string })[]>();
    for (const e of completed) {
      const key = formatInTimeZone(new Date(e.started_at), tz, 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [completed, tz]);

  const openTasks = useMemo(
    () =>
      [...tasks]
        .filter((t) => !t.done && !t.id.startsWith('tmp-'))
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [tasks],
  );

  const taskTitle = useCallback(
    (taskId: string | null) => {
      if (!taskId) return null;
      return tasks.find((t) => t.id === taskId)?.title ?? null;
    },
    [tasks],
  );

  const [draftLabel, setDraftLabel] = useState('');
  const [draftTaskId, setDraftTaskId] = useState<string>('');
  const [runningLabelDraft, setRunningLabelDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setRunningLabelDraft(running?.label ?? '');
  }, [running?.id, running?.label]);

  const nowMs = useTickingNow(Boolean(running));

  const runningElapsedSec = running
    ? Math.max(0, Math.floor((nowMs - Date.parse(running.started_at)) / 1000))
    : 0;

  const onStart = async () => {
    if (!user || running) return;
    setStarting(true);
    try {
      await startTimer(
        user.id,
        draftLabel.trim() === '' ? 'Untitled' : draftLabel.trim(),
        draftTaskId === '' ? null : draftTaskId,
      );
      setDraftLabel('');
      setDraftTaskId('');
    } finally {
      setStarting(false);
    }
  };

  const onStop = async (id: string) => {
    if (!user) return;
    setStoppingId(id);
    try {
      await stopTimer(user.id, id);
    } finally {
      setStoppingId(null);
    }
  };

  const onRunningLabelBlur = async () => {
    if (!running) return;
    const next = runningLabelDraft.trim();
    if (next === running.label.trim()) return;
    await updateLabel(running.id, next === '' ? 'Untitled' : next);
  };

  const onDelete = async (id: string, opts: { message: string }) => {
    if (!user) return;
    if (!window.confirm(opts.message)) return;
    setDeletingId(id);
    try {
      await deleteEntry(user.id, id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-8 flex items-center gap-4">
          <IconBadge size="lg" tone="blue" className="rounded-full">
            <ClockIcon className="h-6 w-6" />
          </IconBadge>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">Time tracking</h1>
            <p className="mt-1 text-sm text-text-muted">
              Run a timer for what you are doing, then review past sessions below.
            </p>
          </div>
        </header>

        {error ? (
          <p
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="space-y-6">
          <Card tone="sunken">
            {running ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                      Running
                    </p>
                    <p className="mt-1 font-mono text-4xl font-semibold tabular-nums tracking-tight text-text">
                      {formatDurationSeconds(runningElapsedSec)}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Started{' '}
                      {formatInTimeZone(new Date(running.started_at), tz, 'h:mm a')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2"
                      disabled={!user || stoppingId === running.id}
                      onClick={() => void onStop(running.id)}
                    >
                      <SquareIcon className="h-4 w-4" />
                      {stoppingId === running.id ? 'Stopping…' : 'Stop'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-text-muted"
                      disabled={deletingId === running.id}
                      onClick={() =>
                        void onDelete(running.id, {
                          message: 'Discard this timer without logging time?',
                        })
                      }
                    >
                      Discard
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="running-label"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Label
                  </label>
                  <input
                    id="running-label"
                    type="text"
                    value={runningLabelDraft}
                    onChange={(e) => setRunningLabelDraft(e.target.value)}
                    onBlur={() => void onRunningLabelBlur()}
                    maxLength={200}
                    disabled={!user}
                    className="input"
                    placeholder="What are you working on?"
                  />
                </div>

                {running.task_id ? (
                  <p className="text-sm text-text-muted">
                    Linked task:{' '}
                    <span className="font-medium text-text">
                      {taskTitle(running.task_id) ?? '(removed task)'}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">
                  Start a timer to record this session. You can link an open task (optional).
                </p>
                <div className="space-y-1.5">
                  <label
                    htmlFor="time-draft-label"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Label
                  </label>
                  <input
                    id="time-draft-label"
                    type="text"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void onStart();
                    }}
                    maxLength={200}
                    disabled={!user || starting}
                    className="input"
                    placeholder="e.g. Deep work, email, planning…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="time-draft-task"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Task (optional)
                  </label>
                  <select
                    id="time-draft-task"
                    value={draftTaskId}
                    onChange={(e) => setDraftTaskId(e.target.value)}
                    disabled={!user || starting}
                    className="input"
                  >
                    <option value="">None</option>
                    {openTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!user || starting || Boolean(running)}
                  onClick={() => void onStart()}
                >
                  {starting ? 'Starting…' : 'Start timer'}
                </button>
              </div>
            )}
          </Card>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text">History</h2>
            {loading && entries.length === 0 ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : byDay.length === 0 ? (
              <Card tone="sunken">
                <p className="text-sm text-text-muted">
                  No completed sessions yet. Stop a timer to see it here.
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {byDay.map(([dayKey, dayEntries]) => (
                  <div key={dayKey}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-subtle">
                      {formatInTimeZone(
                        new Date(dayEntries[0].started_at),
                        tz,
                        'EEEE, MMMM d, yyyy',
                      )}
                    </h3>
                    <Card padded="none" className="divide-y divide-border overflow-hidden">
                      {dayEntries.map((e) => {
                        const durSec = Math.max(
                          0,
                          Math.floor(
                            (Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000,
                          ),
                        );
                        const title = taskTitle(e.task_id);
                        return (
                          <div
                            key={e.id}
                            className="flex flex-wrap items-start gap-3 px-4 py-3 sm:items-center"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-text">
                                {e.label.trim() || 'Untitled'}
                              </p>
                              <p className="mt-0.5 text-xs text-text-muted">
                                {formatInTimeZone(new Date(e.started_at), tz, 'h:mm a')}
                                {' – '}
                                {formatInTimeZone(new Date(e.ended_at), tz, 'h:mm a')}
                                {title ? (
                                  <>
                                    {' · '}
                                    <span className="text-text-muted">{title}</span>
                                  </>
                                ) : null}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm tabular-nums text-text-muted">
                                {formatDurationSeconds(durSec)}
                              </span>
                              <button
                                type="button"
                                className="btn-ghost h-8 w-8 shrink-0 p-0 text-text-muted hover:text-red-600 dark:hover:text-red-400"
                                title="Delete session"
                                disabled={deletingId === e.id}
                                onClick={() =>
                                  void onDelete(e.id, {
                                    message: 'Delete this time entry?',
                                  })
                                }
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
