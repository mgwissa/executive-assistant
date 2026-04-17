import { useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useProfileStore } from '../store/useProfileStore';
import { generateOccurrences } from '../lib/recurrence';
import { EventComposer } from './EventComposer';
import { CalendarIcon, ClockIcon } from './icons';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { Badge } from './ui/Badge';

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
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-4xl px-8 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <IconBadge tone="blue" size="md">
              <ClockIcon className="h-5 w-5" />
            </IconBadge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">Calendar</h1>
              <p className="mt-1 text-sm text-text-muted">
                Agenda view for the next {RANGE_DAYS} days.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="purple">Timezone: {timezone}</Badge>
            <button className="btn-primary" onClick={() => setComposerOpen(true)}>
              New event
            </button>
          </div>
        </header>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <Card padded="none" className="card-pop card-pop-blue">
          {loading ? (
            <EmptyState
              icon={<ClockIcon className="h-5 w-5" />}
              title="Loading…"
              message="Fetching your events."
            />
          ) : grouped.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon className="h-5 w-5" />}
              title="No events yet"
              message="Create your first one."
            />
          ) : (
            <div className="divide-y divide-border">
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
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        {label}
                      </h2>
                      <Badge variant="blue">{items.length}</Badge>
                    </div>
                    <ul className="space-y-2">
                      {items.map((o) => (
                        <li key={`${o.eventId}:${o.start.toISOString()}`}>
                          <Card
                            tone="sunken"
                            padded="sm"
                            className="flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-text">
                                {o.title}
                              </p>
                              <p className="mt-0.5 text-xs text-text-muted">
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
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </Card>
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

