import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { datetimeLocalValueToIso, isoToDatetimeLocalValue } from '../lib/datetimeLocal';
import { formatDurationSeconds, entryDurationSeconds } from '../lib/timeTrackingFormat';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useTimeEntriesStore, type UpdateTimeEntryPatch } from '../store/useTimeEntriesStore';
import { useTimeProjectsStore } from '../store/useTimeProjectsStore';
import type { TimeEntry, TimeProject } from '../types';
import { ClockIcon, PlusIcon, SquareIcon, TrashIcon } from './icons';
import { TimeTrackingBarChart } from './TimeTrackingBarChart';
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

function groupEntriesByDay(
  entries: (TimeEntry & { ended_at: string })[],
  tz: string,
): [string, (TimeEntry & { ended_at: string })[]][] {
  const map = new Map<string, (TimeEntry & { ended_at: string })[]>();
  for (const e of entries) {
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
}

type CompletedEntryRowProps = {
  entry: TimeEntry & { ended_at: string };
  tz: string;
  taskTitle: string | null;
  projectBadgeText: string;
  hasProject: boolean;
  projects: TimeProject[];
  onUpdate: (entryId: string, patch: UpdateTimeEntryPatch) => Promise<void>;
  onDelete: () => void;
  deleting: boolean;
};

function CompletedEntryRow({
  entry,
  tz,
  taskTitle,
  projectBadgeText,
  hasProject,
  projects,
  onUpdate,
  onDelete,
  deleting,
}: CompletedEntryRowProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftLabel, setDraftLabel] = useState(entry.label);
  const [draftStart, setDraftStart] = useState(() => isoToDatetimeLocalValue(entry.started_at));
  const [draftEnd, setDraftEnd] = useState(() => isoToDatetimeLocalValue(entry.ended_at));
  const [draftProjectId, setDraftProjectId] = useState(entry.project_id ?? '');

  useEffect(() => {
    if (editing) return;
    setDraftLabel(entry.label);
    setDraftStart(isoToDatetimeLocalValue(entry.started_at));
    setDraftEnd(isoToDatetimeLocalValue(entry.ended_at));
    setDraftProjectId(entry.project_id ?? '');
  }, [entry.id, entry.label, entry.started_at, entry.ended_at, entry.project_id, editing]);

  const durSec = entryDurationSeconds(entry);

  const beginEdit = () => {
    setDraftLabel(entry.label);
    setDraftStart(isoToDatetimeLocalValue(entry.started_at));
    setDraftEnd(isoToDatetimeLocalValue(entry.ended_at));
    setDraftProjectId(entry.project_id ?? '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    const startIso = datetimeLocalValueToIso(draftStart);
    const endIso = datetimeLocalValueToIso(draftEnd);
    if (!startIso || !endIso) return;
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      window.alert('End time must be after start time.');
      return;
    }
    setSaving(true);
    try {
      await onUpdate(entry.id, {
        label: draftLabel.trim(),
        started_at: startIso,
        ended_at: endIso,
        project_id: draftProjectId === '' ? null : draftProjectId,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-text-muted" htmlFor={`edit-label-${entry.id}`}>
            Label <span className="font-normal text-text-subtle">(optional)</span>
          </label>
          <input
            id={`edit-label-${entry.id}`}
            type="text"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="input"
            maxLength={200}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-text-muted" htmlFor={`edit-project-${entry.id}`}>
            Project
          </label>
          <select
            id={`edit-project-${entry.id}`}
            value={draftProjectId}
            onChange={(e) => setDraftProjectId(e.target.value)}
            className="input"
          >
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-muted" htmlFor={`edit-start-${entry.id}`}>
              Start
            </label>
            <input
              id={`edit-start-${entry.id}`}
              type="datetime-local"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              className="input font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-text-muted" htmlFor={`edit-end-${entry.id}`}>
              End
            </label>
            <input
              id={`edit-end-${entry.id}`}
              type="datetime-local"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              className="input font-mono text-xs"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={() => void saveEdit()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={cancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3 sm:items-center">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div>
          <span
            className={[
              'inline-flex max-w-full truncate rounded-md px-2.5 py-1 text-sm font-semibold tracking-tight ring-1',
              hasProject
                ? 'bg-brand-500/12 text-brand-900 ring-brand-500/25 dark:bg-brand-500/18 dark:text-brand-100 dark:ring-brand-400/30'
                : 'bg-surface-raised text-text-muted ring-border',
            ].join(' ')}
          >
            {projectBadgeText}
          </span>
        </div>
        <p
          className={
            entry.label.trim()
              ? 'text-[15px] font-medium text-text'
              : 'text-[15px] font-medium italic text-text-muted'
          }
        >
          {entry.label.trim() || 'No label'}
        </p>
        <p className="text-xs text-text-muted">
          {formatInTimeZone(new Date(entry.started_at), tz, 'h:mm a')}
          {' – '}
          {formatInTimeZone(new Date(entry.ended_at), tz, 'h:mm a')}
          {taskTitle ? (
            <>
              {' · '}
              <span className="text-text-muted">{taskTitle}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <span className="font-mono text-sm tabular-nums text-text-muted">
          {formatDurationSeconds(durSec)}
        </span>
        <button
          type="button"
          className="btn-ghost shrink-0 px-2 py-1 text-xs text-text-muted"
          onClick={beginEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn-ghost h-8 w-8 shrink-0 p-0 text-text-muted hover:text-red-600 dark:hover:text-red-400"
          title="Delete session"
          disabled={deleting}
          onClick={onDelete}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function TimeTrackingPage() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const tasks = useTasksStore((s) => s.tasks);
  const projects = useTimeProjectsStore((s) => s.projects);
  const entries = useTimeEntriesStore((s) => s.entries);
  const loading = useTimeEntriesStore((s) => s.loading);
  const error = useTimeEntriesStore((s) => s.error);
  const fetchAll = useTimeEntriesStore((s) => s.fetchAll);
  const startTimer = useTimeEntriesStore((s) => s.startTimer);
  const stopTimer = useTimeEntriesStore((s) => s.stopTimer);
  const updateEntry = useTimeEntriesStore((s) => s.updateEntry);
  const deleteEntry = useTimeEntriesStore((s) => s.deleteEntry);
  const createProject = useTimeProjectsStore((s) => s.create);
  const deleteProject = useTimeProjectsStore((s) => s.deleteProject);

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

  const historyGroups = useMemo(() => {
    const map = new Map<string | null, (TimeEntry & { ended_at: string })[]>();
    for (const e of completed) {
      const pid = e.project_id;
      const list = map.get(pid) ?? [];
      list.push(e);
      map.set(pid, list);
    }

    const resolveName = (projectId: string | null) => {
      if (!projectId) return 'No project';
      return projects.find((p) => p.id === projectId)?.name ?? 'Removed project';
    };

    const groups = [...map.entries()].map(([projectId, groupEntries]) => {
      const name = resolveName(projectId);
      const totalSec = groupEntries.reduce((sum, e) => sum + entryDurationSeconds(e), 0);
      const sortedEntries = [...groupEntries].sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
      return { projectId, name, entries: sortedEntries, totalSec };
    });

    groups.sort((a, b) => {
      if (a.projectId === null && b.projectId !== null) return 1;
      if (a.projectId !== null && b.projectId === null) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return groups;
  }, [completed, projects]);

  const historyGrandTotalSec = useMemo(
    () => completed.reduce((sum, e) => sum + entryDurationSeconds(e), 0),
    [completed],
  );

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

  const projectName = useCallback(
    (projectId: string | null) => {
      if (!projectId) return null;
      return projects.find((p) => p.id === projectId)?.name ?? null;
    },
    [projects],
  );

  const [draftLabel, setDraftLabel] = useState('');
  const [draftTaskId, setDraftTaskId] = useState<string>('');
  const [draftProjectId, setDraftProjectId] = useState<string>('');
  const [runningLabelDraft, setRunningLabelDraft] = useState('');
  const [runningStartDraft, setRunningStartDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  useEffect(() => {
    setRunningLabelDraft(running?.label ?? '');
  }, [running?.id, running?.label]);

  useEffect(() => {
    setRunningStartDraft(running ? isoToDatetimeLocalValue(running.started_at) : '');
  }, [running?.id, running?.started_at]);

  const nowMs = useTickingNow(Boolean(running));

  const runningElapsedSec = running
    ? Math.max(0, Math.floor((nowMs - Date.parse(running.started_at)) / 1000))
    : 0;

  const onStart = async () => {
    if (!user || running) return;
    setStarting(true);
    try {
      await startTimer(user.id, {
        label: draftLabel.trim(),
        taskId: draftTaskId === '' ? null : draftTaskId,
        projectId: draftProjectId === '' ? null : draftProjectId,
      });
      setDraftLabel('');
      setDraftTaskId('');
      setDraftProjectId('');
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
    if (!user || !running) return;
    const next = runningLabelDraft.trim();
    if (next === running.label.trim()) return;
    await updateEntry(user.id, running.id, {
      label: next,
    });
  };

  const onRunningStartBlur = async () => {
    if (!user || !running) return;
    const iso = datetimeLocalValueToIso(runningStartDraft);
    if (!iso || iso === running.started_at) return;
    if (Date.parse(iso) > Date.now()) {
      window.alert('Start time cannot be in the future.');
      setRunningStartDraft(isoToDatetimeLocalValue(running.started_at));
      return;
    }
    await updateEntry(user.id, running.id, { started_at: iso });
  };

  const onAddProject = async () => {
    if (!user) return;
    const name = projectNameDraft.trim();
    if (!name) return;
    setAddingProject(true);
    try {
      await createProject(user.id, name);
      setProjectNameDraft('');
    } finally {
      setAddingProject(false);
    }
  };

  const onDeleteProject = async (id: string, name: string) => {
    if (!user) return;
    if (
      !window.confirm(
        `Delete project “${name}”? Sessions stay in your history; they will no longer be linked to this project.`,
      )
    ) {
      return;
    }
    await deleteProject(user.id, id);
  };

  const onPatchEntry = async (entryId: string, patch: UpdateTimeEntryPatch) => {
    if (!user) return;
    await updateEntry(user.id, entryId, patch);
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
              Labels are optional and can repeat. Use projects to group time, tasks when helpful.
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
            <h2 className="text-sm font-semibold text-text">Projects</h2>
            <p className="mt-1 text-sm text-text-muted">
              Create a project, then attach it when you start a timer or when you edit a past
              session.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label htmlFor="new-project-name" className="block text-xs font-medium text-text-muted">
                  New project
                </label>
                <input
                  id="new-project-name"
                  type="text"
                  value={projectNameDraft}
                  onChange={(e) => setProjectNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onAddProject();
                  }}
                  maxLength={120}
                  disabled={!user || addingProject}
                  placeholder="e.g. Acme redesign"
                  className="input"
                />
              </div>
              <button
                type="button"
                className="btn-secondary inline-flex shrink-0 items-center gap-1.5"
                disabled={!user || addingProject || !projectNameDraft.trim()}
                onClick={() => void onAddProject()}
              >
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </div>
            {projects.length > 0 ? (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface/40">
                {projects.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium text-text">{p.name}</span>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-2 py-1 text-xs text-text-muted hover:text-red-600 dark:hover:text-red-400"
                      onClick={() => void onDeleteProject(p.id, p.name)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-text-muted">No projects yet.</p>
            )}
          </Card>

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
                      Started at (adjust if you started late)
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
                    htmlFor="running-start"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Start time
                  </label>
                  <input
                    id="running-start"
                    type="datetime-local"
                    value={runningStartDraft}
                    onChange={(e) => setRunningStartDraft(e.target.value)}
                    onBlur={() => void onRunningStartBlur()}
                    disabled={!user}
                    className="input max-w-xs font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="running-label"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Label <span className="font-normal text-text-subtle">(optional)</span>
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
                    placeholder="Optional note for this session"
                  />
                </div>

                {running.project_id ? (
                  <p className="text-sm text-text-muted">
                    Project:{' '}
                    <span className="font-medium text-text">
                      {projectName(running.project_id) ?? '(removed)'}
                    </span>
                  </p>
                ) : null}

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
                  Start a timer with an optional label. You can use the same label on many sessions,
                  or leave it empty and rely on project or task only.
                </p>
                <div className="space-y-1.5">
                  <label
                    htmlFor="time-draft-label"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Label <span className="font-normal text-text-subtle">(optional)</span>
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
                    placeholder="e.g. Deep work — or leave blank and use project/task only"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="time-draft-project"
                    className="block text-xs font-medium text-text-muted"
                  >
                    Project (optional)
                  </label>
                  <select
                    id="time-draft-project"
                    value={draftProjectId}
                    onChange={(e) => setDraftProjectId(e.target.value)}
                    disabled={!user || starting}
                    className="input"
                  >
                    <option value="">None</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {projects.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      Optional: add projects above to group this session.
                    </p>
                  ) : null}
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

          <TimeTrackingBarChart completed={completed} tz={tz} projects={projects} />

          <section>
            <h2 className="mb-1 text-sm font-semibold text-text">History</h2>
            <p className="mb-3 text-xs text-text-muted">
              Grouped by project with per-project totals. Days are newest first within each group.
            </p>
            {loading && entries.length === 0 ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : historyGroups.length === 0 ? (
              <Card tone="sunken">
                <p className="text-sm text-text-muted">
                  No completed sessions yet. Stop a timer to see it here.
                </p>
              </Card>
            ) : (
              <div className="space-y-8">
                {completed.length > 0 ? (
                  <p className="text-sm text-text-muted">
                    <span className="text-text">All sessions:</span>{' '}
                    <span className="font-mono font-semibold tabular-nums text-text">
                      {formatDurationSeconds(historyGrandTotalSec)}
                    </span>
                    <span className="text-text-subtle">
                      {' '}
                      · {completed.length} {completed.length === 1 ? 'session' : 'sessions'}
                    </span>
                  </p>
                ) : null}

                {historyGroups.map((group) => (
                  <div key={group.projectId ?? 'none'} className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-strong pb-2">
                      <h3 className="text-base font-semibold tracking-tight text-text">
                        {group.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
                        <span className="font-mono font-semibold tabular-nums text-text">
                          {formatDurationSeconds(group.totalSec)}
                        </span>
                        <span className="text-text-subtle">·</span>
                        <span>
                          {group.entries.length}{' '}
                          {group.entries.length === 1 ? 'session' : 'sessions'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {groupEntriesByDay(group.entries, tz).map(([dayKey, dayEntries], dayIdx) => (
                        <div key={`${group.projectId ?? 'none'}-${dayKey}`}>
                          <p
                            className={[
                              'mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle',
                              dayIdx === 0 ? '' : 'mt-1',
                            ].join(' ')}
                          >
                            {formatInTimeZone(
                              new Date(dayEntries[0].started_at),
                              tz,
                              'EEEE, MMMM d, yyyy',
                            )}
                          </p>
                          <Card tone="raised" padded="none" className="divide-y divide-border overflow-hidden">
                            {dayEntries.map((e) => (
                              <CompletedEntryRow
                                key={e.id}
                                entry={e}
                                tz={tz}
                                taskTitle={taskTitle(e.task_id)}
                                projectBadgeText={
                                  e.project_id
                                    ? projectName(e.project_id) ?? 'Removed project'
                                    : 'No project'
                                }
                                hasProject={Boolean(e.project_id)}
                                projects={projects}
                                onUpdate={(id, patch) => onPatchEntry(id, patch)}
                                onDelete={() =>
                                  void onDelete(e.id, {
                                    message: 'Delete this time entry?',
                                  })
                                }
                                deleting={deletingId === e.id}
                              />
                            ))}
                          </Card>
                        </div>
                      ))}
                    </div>
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
