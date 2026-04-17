import { useMemo, useState } from 'react';
import type { Event } from '../types';
import { generateOccurrences } from '../lib/recurrence';
import { Card } from './ui/Card';

export type ComposerValue = {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  duration_minutes: number;
  recurrence: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  interval: number;
  endMode: 'never' | 'until' | 'count';
  untilDate: string; // YYYY-MM-DD
  count: number;
};

export function EventComposer({
  open,
  timezone,
  onClose,
  onCreate,
}: {
  open: boolean;
  timezone: string;
  onClose: () => void;
  onCreate: (
    payload: Omit<Event, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'source'>,
  ) => Promise<void>;
}) {
  const now = useMemo(() => new Date(), []);
  const today = now.toISOString().slice(0, 10);
  const timeNow = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const [v, setV] = useState<ComposerValue>({
    title: '',
    date: today,
    time: timeNow,
    duration_minutes: 30,
    recurrence: 'none',
    interval: 1,
    endMode: 'never',
    untilDate: today,
    count: 10,
  });

  const startAtIso = useMemo(() => {
    const d = new Date(`${v.date}T${v.time}:00`);
    return d.toISOString();
  }, [v.date, v.time]);

  const previewOccurrences = useMemo(() => {
    const fake: Event = {
      id: 'preview',
      user_id: 'preview',
      title: v.title || 'Untitled',
      start_at: startAtIso,
      duration_minutes: v.duration_minutes,
      timezone,
      recurrence: v.recurrence,
      interval: v.interval,
      by_weekday: null,
      until_at:
        v.endMode === 'until' && v.untilDate
          ? new Date(`${v.untilDate}T23:59:59`).toISOString()
          : null,
      count: v.endMode === 'count' ? v.count : null,
      source: 'manual',
      created_at: startAtIso,
      updated_at: startAtIso,
    };

    const from = new Date(startAtIso);
    const to = new Date(from.getTime() + 1000 * 60 * 60 * 24 * 14); // 2 weeks preview
    return generateOccurrences(fake, from, to, { limit: 5 });
  }, [
    v.title,
    v.duration_minutes,
    v.recurrence,
    v.interval,
    v.endMode,
    v.untilDate,
    v.count,
    startAtIso,
    timezone,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/30"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl">
        <Card tone="raised" className="rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-text">New event</h2>
            <p className="mt-1 text-xs text-text-muted">
              Timezone: {timezone}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost h-9 px-3">
            Close
          </button>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const title = v.title.trim();
            if (!title) return;

            await onCreate({
              title,
              start_at: startAtIso,
              duration_minutes: v.duration_minutes,
              timezone,
              recurrence: v.recurrence,
              interval: Math.max(1, v.interval),
              by_weekday: null,
              until_at:
                v.endMode === 'until' && v.untilDate
                  ? new Date(`${v.untilDate}T23:59:59`).toISOString()
                  : null,
              count: v.endMode === 'count' ? Math.max(1, v.count) : null,
            });
            onClose();
          }}
        >
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text">
              Title
            </label>
            <input
              value={v.title}
              onChange={(e) => setV((p) => ({ ...p, title: e.target.value }))}
              className="input"
              placeholder="Standup"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">
                Date
              </label>
              <input
                type="date"
                value={v.date}
                onChange={(e) => setV((p) => ({ ...p, date: e.target.value }))}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">
                Time
              </label>
              <input
                type="time"
                value={v.time}
                onChange={(e) => setV((p) => ({ ...p, time: e.target.value }))}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">
                Duration (min)
              </label>
              <input
                type="number"
                value={v.duration_minutes}
                onChange={(e) =>
                  setV((p) => ({ ...p, duration_minutes: Number(e.target.value) }))
                }
                className="input"
                min={5}
                max={1440}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-sm font-medium text-text">
                Repeat
              </label>
              <select
                value={v.recurrence}
                onChange={(e) =>
                  setV((p) => ({
                    ...p,
                    recurrence: e.target.value as ComposerValue['recurrence'],
                  }))
                }
                className="input"
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">
                Interval
              </label>
              <input
                type="number"
                value={v.interval}
                onChange={(e) => setV((p) => ({ ...p, interval: Number(e.target.value) }))}
                className="input"
                min={1}
                max={365}
                disabled={v.recurrence === 'none'}
              />
            </div>
          </div>

          {v.recurrence !== 'none' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <label className="block text-sm font-medium text-text">
                  Ends
                </label>
                <select
                  value={v.endMode}
                  onChange={(e) =>
                    setV((p) => ({ ...p, endMode: e.target.value as ComposerValue['endMode'] }))
                  }
                  className="input"
                >
                  <option value="never">Never</option>
                  <option value="until">Until date</option>
                  <option value="count">After N times</option>
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                {v.endMode === 'until' ? (
                  <>
                    <label className="block text-sm font-medium text-text">
                      Until
                    </label>
                    <input
                      type="date"
                      value={v.untilDate}
                      onChange={(e) => setV((p) => ({ ...p, untilDate: e.target.value }))}
                      className="input"
                    />
                  </>
                ) : v.endMode === 'count' ? (
                  <>
                    <label className="block text-sm font-medium text-text">
                      Count
                    </label>
                    <input
                      type="number"
                      value={v.count}
                      onChange={(e) => setV((p) => ({ ...p, count: Number(e.target.value) }))}
                      className="input"
                      min={1}
                      max={999}
                    />
                  </>
                ) : (
                  <div className="pt-7 text-xs text-text-muted">
                    This will repeat forever.
                  </div>
                )}
              </div>
            </div>
          )}

          <Card tone="sunken" padded="sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Preview
            </p>
            <ul className="mt-2 space-y-1 text-sm text-text">
              {previewOccurrences.length === 0 ? (
                <li className="text-xs text-text-muted">
                  No occurrences in the next two weeks.
                </li>
              ) : (
                previewOccurrences.map((o) => (
                  <li key={o.start.toISOString()} className="flex items-center justify-between gap-3">
                    <span className="truncate">{o.title}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {o.start.toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create event
            </button>
          </div>
        </form>
        </Card>
      </div>
    </div>
  );
}

