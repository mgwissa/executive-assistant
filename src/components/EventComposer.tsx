import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import type { Event } from '../types';
import { generateOccurrences } from '../lib/recurrence';
import { DEFAULT_ALLOW_BACK_TO_BACK, DEFAULT_DEBRIEF_REQUIRED, DEFAULT_PREP_REQUIRED } from '../lib/meetingTemperament';
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
  prep_required: boolean;
  allow_back_to_back: boolean;
  debrief_required: boolean;
};

function defaultComposerValue(now: Date): ComposerValue {
  const today = now.toISOString().slice(0, 10);
  const timeNow = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    title: '',
    date: today,
    time: timeNow,
    duration_minutes: 30,
    recurrence: 'none',
    interval: 1,
    endMode: 'never',
    untilDate: today,
    count: 10,
    prep_required: DEFAULT_PREP_REQUIRED,
    allow_back_to_back: DEFAULT_ALLOW_BACK_TO_BACK,
    debrief_required: DEFAULT_DEBRIEF_REQUIRED,
  };
}

function valueFromEvent(event: Event, timezone: string): ComposerValue {
  const untilDate = event.until_at
    ? formatInTimeZone(event.until_at, timezone, 'yyyy-MM-dd')
    : formatInTimeZone(event.start_at, timezone, 'yyyy-MM-dd');
  return {
    title: event.title,
    date: formatInTimeZone(event.start_at, timezone, 'yyyy-MM-dd'),
    time: formatInTimeZone(event.start_at, timezone, 'HH:mm'),
    duration_minutes: event.duration_minutes,
    recurrence: (event.recurrence as ComposerValue['recurrence']) ?? 'none',
    interval: event.interval ?? 1,
    endMode: event.count != null ? 'count' : event.until_at ? 'until' : 'never',
    untilDate,
    count: event.count ?? 10,
    prep_required: event.prep_required ?? DEFAULT_PREP_REQUIRED,
    allow_back_to_back: event.allow_back_to_back ?? DEFAULT_ALLOW_BACK_TO_BACK,
    debrief_required: event.debrief_required ?? DEFAULT_DEBRIEF_REQUIRED,
  };
}

export function EventComposer({
  open,
  timezone,
  initialEvent = null,
  onClose,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  timezone: string;
  initialEvent?: Event | null;
  onClose: () => void;
  onCreate: (
    payload: Omit<Event, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'source'>,
  ) => Promise<void>;
  onUpdate?: (id: string, patch: Partial<Event>) => Promise<void>;
}) {
  const isEdit = !!initialEvent;
  const flagsOnly = initialEvent?.source === 'outlook_ics';

  const [v, setV] = useState<ComposerValue>(() => defaultComposerValue(new Date()));

  useEffect(() => {
    if (!open) return;
    setV(initialEvent ? valueFromEvent(initialEvent, timezone) : defaultComposerValue(new Date()));
  }, [open, initialEvent, timezone]);

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
      prep_required: v.prep_required,
      allow_back_to_back: v.allow_back_to_back,
      debrief_required: v.debrief_required,
      created_at: startAtIso,
      updated_at: startAtIso,
    };

    const from = new Date(startAtIso);
    const to = new Date(from.getTime() + 1000 * 60 * 60 * 24 * 14);
    return generateOccurrences(fake, from, to, { limit: 5 });
  }, [
    v.title,
    v.duration_minutes,
    v.recurrence,
    v.interval,
    v.endMode,
    v.untilDate,
    v.count,
    v.prep_required,
    v.allow_back_to_back,
    v.debrief_required,
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
            <h2 className="text-lg font-semibold tracking-tight text-text">
              {isEdit ? 'Edit event' : 'New event'}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Timezone: {timezone}
              {flagsOnly ? ' · Outlook sync — schedule fields are read-only' : ''}
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
            if (!title && !flagsOnly) return;

            if (isEdit && initialEvent && onUpdate) {
              if (flagsOnly) {
                await onUpdate(initialEvent.id, {
                  prep_required: v.prep_required,
                  allow_back_to_back: v.allow_back_to_back,
                  debrief_required: v.debrief_required,
                });
              } else {
                await onUpdate(initialEvent.id, {
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
                  prep_required: v.prep_required,
                  allow_back_to_back: v.allow_back_to_back,
                  debrief_required: v.debrief_required,
                });
              }
            } else {
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
                prep_required: v.prep_required,
                allow_back_to_back: v.allow_back_to_back,
                debrief_required: v.debrief_required,
              });
            }
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
              autoFocus={!flagsOnly}
              disabled={flagsOnly}
            />
          </div>

          {!flagsOnly && (
            <>
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
            </>
          )}

          <Card tone="sunken" padded="sm" className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Assistant
            </p>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={v.prep_required}
                onChange={(e) => setV((p) => ({ ...p, prep_required: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-text">Prep required</span>
                <span className="block text-xs text-text-muted">
                  When off, the assistant won&apos;t nag you to prep before this meeting.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={v.allow_back_to_back}
                onChange={(e) => setV((p) => ({ ...p, allow_back_to_back: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-text">Back-to-back OK</span>
                <span className="block text-xs text-text-muted">
                  When on, no warning if the next meeting starts within 10 minutes.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={v.debrief_required}
                onChange={(e) => setV((p) => ({ ...p, debrief_required: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-text">Debrief required</span>
                <span className="block text-xs text-text-muted">
                  When off, the assistant won&apos;t prompt for outcomes after this meeting.
                </span>
              </span>
            </label>
          </Card>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {isEdit ? 'Save changes' : 'Create event'}
            </button>
          </div>
        </form>
        </Card>
      </div>
    </div>
  );
}
