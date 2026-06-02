import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActionItem } from '../lib/format';
import {
  carryForwardWork,
  countCompletedToday,
  tomorrowFocusTop,
} from '../lib/eveningCloseout';
import { formatDayEndLabel } from '../lib/executiveDirective';
import type { DirectiveReport } from '../lib/executiveDirective';
import { setActionItemLineDueDate } from '../lib/format';
import { applyMarkdownPatchToNote } from '../lib/noteContentBridge';
import { scheduleFocusForTomorrow, tomorrowIsoFrom, type FocusQueuePrefs } from '../lib/focusQueue';
import { viewPath } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useNotesStore } from '../store/useNotesStore';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import type { Task } from '../types';
import { CalendarIcon, CheckSquareIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';

type ExecutiveEveningCloseoutProps = {
  directive: DirectiveReport;
  tasks: Task[];
  actionItems: ActionItem[];
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  onRefresh?: () => void;
};

export function ExecutiveEveningCloseout({
  directive,
  tasks,
  actionItems,
  focusPrefs,
  onFocusPrefsUpdate,
  onRefresh,
}: ExecutiveEveningCloseoutProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const notes = useNotesStore((s) => s.notes);
  const updateNote = useNotesStore((s) => s.updateNote);
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setDueTime = useTasksStore((s) => s.setDueTime);

  const { todayIso, timezone: tz } = directive;
  const isActive = directive.now.kind === 'wind_down';

  const completedCount = useMemo(
    () => countCompletedToday(tasks, todayIso, tz),
    [tasks, todayIso, tz],
  );
  const carryForward = useMemo(
    () => carryForwardWork(tasks, actionItems, todayIso, 3),
    [tasks, actionItems, todayIso],
  );
  const tomorrowTop = useMemo(
    () => tomorrowFocusTop(tasks, actionItems, todayIso, focusPrefs),
    [tasks, actionItems, todayIso, focusPrefs],
  );

  const handlePushCarryForward = async () => {
    if (!user || carryForward.length === 0) return;
    const tomorrow = tomorrowIsoFrom(todayIso);
    let prefs = focusPrefs;
    for (const item of carryForward) {
      const ref =
        item.kind === 'task' && item.taskId
          ? ({ kind: 'task' as const, taskId: item.taskId })
          : ({ kind: 'action' as const, noteId: item.noteId!, line: item.line! });
      prefs = scheduleFocusForTomorrow(prefs, ref, todayIso);
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
    }
    onFocusPrefsUpdate(prefs);
    const current = useProfileStore.getState().profile;
    if (current) {
      useProfileStore.setState({ profile: { ...current, focus_queue: prefs } });
    }
    void updateProfile(user.id, { focus_queue: prefs });
    onRefresh?.();
  };

  if (!isActive) {
    return (
      <Card padded="sm" tone="sunken" className="border border-dashed border-border">
        <div className="flex items-start gap-3 opacity-70">
          <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div>
            <p className="text-sm font-medium text-text-muted">Evening close-out</p>
            <p className="mt-0.5 text-xs text-text-subtle">
              Opens at {formatDayEndLabel()}.
              {carryForward.length > 0
                ? ` ${carryForward.length} item${carryForward.length > 1 ? 's' : ''} still open today.`
                : completedCount > 0
                  ? ` ${completedCount} done so far today.`
                  : ''}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padded="sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
          Evening close-out
        </p>
        <Badge variant="subtle">End of day</Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Done today</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-text">{completedCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Carry forward</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-text">{carryForward.length}</p>
        </div>
      </div>

      {carryForward.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {carryForward.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs text-text-muted">
              <CheckSquareIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" />
              <span className="line-clamp-2">{item.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-text-muted">Today&apos;s queue is clear.</p>
      )}

      {tomorrowTop ? (
        <div className="mt-3 rounded-lg border border-brand-500/25 bg-brand-50/50 px-3 py-2 dark:bg-brand-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            Tomorrow #1
          </p>
          <p className="mt-0.5 text-sm font-medium text-text">{tomorrowTop.title}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {carryForward.length > 0 ? (
          <button
            type="button"
            className="btn-primary py-1 text-[11px]"
            onClick={() => void handlePushCarryForward()}
          >
            Push rest to tomorrow
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost py-1 text-[11px]"
          onClick={() => navigate(viewPath('tasks'))}
        >
          Review tasks
        </button>
      </div>
    </Card>
  );
}
