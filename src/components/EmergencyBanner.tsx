import type { EmergencyReason } from '../hooks/useCriticalOverload';
import { useEmergencyStore } from '../store/useEmergencyStore';

export function EmergencyBanner({ reason }: { reason: EmergencyReason }) {
  const setBypass = useEmergencyStore((s) => s.setBypass);

  const both = reason.hasOverdue && reason.hasCriticalOverload;
  const overdueOnly = reason.hasOverdue && !reason.hasCriticalOverload;

  const overdueCount = reason.overdueTasks.length + reason.overdueNoteItems.length;
  const message = both
    ? 'You have overdue items and multiple Critical items.'
    : overdueOnly
      ? `You have ${overdueCount === 1 ? 'an overdue item' : 'overdue items'} past ${overdueCount === 1 ? 'its' : 'their'} due date.`
      : 'You still have multiple must-do Critical items.';

  const detail = both
    ? 'Emergency mode is paused \u2014 re-enter to handle overdue deadlines and critical work.'
    : overdueOnly
      ? 'Emergency mode is paused \u2014 re-enter to complete or reschedule them.'
      : 'Emergency mode is paused \u2014 re-enter to focus on finishing them, or knock them out from Tasks and notes.';

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-red-500/45 bg-gradient-to-r from-red-950 via-zinc-900 to-red-950 px-4 py-2.5 text-red-50"
      role="status"
    >
      <p className="min-w-0 text-sm leading-snug text-red-100/95">
        <span className="font-semibold text-red-50">{message}</span>{' '}
        {detail}
      </p>
      <button
        type="button"
        onClick={() => setBypass(false)}
        className="shrink-0 rounded-lg border border-red-400/50 bg-red-600/20 px-3 py-1.5 text-xs font-semibold text-red-50 shadow-sm hover:bg-red-600/30"
      >
        Enter emergency mode
      </button>
    </div>
  );
}
