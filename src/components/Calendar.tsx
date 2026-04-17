import { useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useProfileStore } from '../store/useProfileStore';
import { generateOccurrences } from '../lib/recurrence';
import { EventComposer } from './EventComposer';
import { ClockIcon } from './icons';

const RANGE_DAYS = 30;

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function Calendar() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const { events, loading, error, createEvent, deleteEvent } = useEventsStore();

  const timezone =
    profile?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    'UTC';

  const [composerOpen, setComposerOpen] = useState(false);

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const rangeEnd = useMemo(() => addDays(rangeStart, RANGE_DAYS), [rangeStart]);

  const occurrences = useMemo(() => {
    const all = events.flatMap((e) => generateOccurrences(e, rangeStart, rangeEnd));
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    return all;
  }, [events, rangeStart, rangeEnd]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof occurrences>();
    for (const occ of occurrences) {
      const key = occ.start.toISOString().slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(occ);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items }));
  }, [occurrences]);

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
              <ClockIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Calendar
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Agenda view for the next {RANGE_DAYS} days.
              </p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => setComposerOpen(true)}>
            New event
          </button>
        </header>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40">
          {loading ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Loading…
            </div>
          ) : grouped.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No events yet. Create your first one.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {grouped.map(({ date, items }) => {
                const day = new Date(`${date}T00:00:00`);
                const label = day.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                });
                return (
                  <section key={date} className="px-4 py-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {label}
                      </h2>
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {items.length}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {items.map((o) => (
                        <li
                          key={`${o.eventId}:${o.start.toISOString()}`}
                          className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                              {o.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
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
                          <button
                            className="btn-ghost h-8 px-2 text-xs"
                            onClick={() => deleteEvent(o.eventId)}
                            title="Delete event"
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <EventComposer
        open={composerOpen}
        timezone={timezone}
        onClose={() => setComposerOpen(false)}
        onCreate={async (payload) => {
          if (!user) return;
          await createEvent(user.id, payload);
        }}
      />
    </div>
  );
}

