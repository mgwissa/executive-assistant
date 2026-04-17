import { useEffect, useMemo, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { useAuthStore } from '../store/useAuthStore';
import { useEventsStore } from '../store/useEventsStore';
import { useProfileStore } from '../store/useProfileStore';
import { generateOccurrences } from '../lib/recurrence';
import { getCurrentWeekScope, resolveCalendarTimeZone } from '../lib/calendarWeek';
import { eventsFetchIsoRange } from '../lib/eventQueries';
import { EventComposer } from './EventComposer';
import { CalendarIcon, ClockIcon } from './icons';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { IconBadge } from './ui/IconBadge';
import { Badge } from './ui/Badge';

export function Calendar() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const { events, loading, error, createEvent, deleteEvent, fetchRange } = useEventsStore();

  const tz = useMemo(() => resolveCalendarTimeZone(profile?.timezone), [profile?.timezone]);

  useEffect(() => {
    if (!user) return;
    const { fromIso, toIso } = eventsFetchIsoRange(profile?.timezone);
    void fetchRange(user.id, fromIso, toIso);
  }, [user, fetchRange, profile?.timezone]);

  const requestDelete = (eventId: string, title: string) => {
    if (!window.confirm(`Delete “${title}”? This removes it from the app.`)) return;
    void deleteEvent(eventId);
  };

  const [composerOpen, setComposerOpen] = useState(false);

  const week = useMemo(() => getCurrentWeekScope(tz), [tz]);

  const occurrences = useMemo(() => {
    const all = events.flatMap((e) =>
      generateOccurrences(e, week.rangeStartUtc, week.rangeEndExclusiveUtc),
    );
    all.sort((a, b) => a.start.getTime() - b.start.getTime());
    return all;
  }, [events, week.rangeStartUtc, week.rangeEndExclusiveUtc]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, typeof occurrences>();
    for (const occ of occurrences) {
      const key = formatInTimeZone(occ.start, tz, 'yyyy-MM-dd');
      const arr = byDay.get(key) ?? [];
      arr.push(occ);
      byDay.set(key, arr);
    }
    const mondayWall = startOfDay(toZonedTime(week.rangeStartUtc, tz));
    const days: { date: string; anchorUtc: Date; items: (typeof occurrences)[number][] }[] = [];
    for (let i = 0; i < 7; i++) {
      const dayWall = addDays(mondayWall, i);
      const anchorUtc = fromZonedTime(startOfDay(dayWall), tz);
      const date = formatInTimeZone(anchorUtc, tz, 'yyyy-MM-dd');
      days.push({ date, anchorUtc, items: byDay.get(date) ?? [] });
    }
    return days;
  }, [occurrences, tz, week.rangeStartUtc]);

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <IconBadge tone="blue" size="md" className="mt-0.5">
              <ClockIcon className="h-5 w-5" />
            </IconBadge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">Calendar</h1>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">
                <span className="font-medium text-text">This week</span>
                {' · '}
                {week.labelShort}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Full week Monday–Sunday in {tz}. Sync Outlook from Profile when you want a fresh
                pull (e.g. Monday mornings).
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="max-w-[14rem] truncate rounded-full bg-purple-600/10 px-2.5 py-1 text-xs font-medium text-purple-800 dark:bg-purple-400/10 dark:text-purple-200" title={tz}>
              {tz}
            </span>
            <button type="button" className="btn-primary" onClick={() => setComposerOpen(true)}>
              New event
            </button>
          </div>
        </header>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <Card padded="none" className="card-pop card-pop-blue overflow-hidden">
          {loading ? (
            <EmptyState
              icon={<ClockIcon className="h-5 w-5" />}
              title="Loading…"
              message="Fetching this week’s events."
            />
          ) : !loading && occurrences.length === 0 && events.length === 0 ? (
            <EmptyState
              icon={<CalendarIcon className="h-5 w-5" />}
              title="No events this week"
              message="Add one with New event, or sync Outlook from Profile → Outlook calendar."
            />
          ) : (
            <div>
              {grouped.map(({ date, anchorUtc, items }) => {
                const dayNum = formatInTimeZone(anchorUtc, tz, 'd');
                const weekday = formatInTimeZone(anchorUtc, tz, 'EEEE');
                const monthLine = formatInTimeZone(anchorUtc, tz, 'MMMM yyyy');
                return (
                  <section key={date} className="border-b border-border last:border-b-0">
                    <div className="flex items-end gap-3 bg-surface-raised/40 px-5 py-4 sm:px-6">
                      <span className="text-3xl font-semibold tabular-nums leading-none text-text">
                        {dayNum}
                      </span>
                      <div className="pb-0.5">
                        <p className="text-sm font-semibold text-text">{weekday}</p>
                        <p className="text-xs text-text-muted">{monthLine}</p>
                      </div>
                      {items.length > 0 ? (
                        <span className="ml-auto rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-200">
                          {items.length} {items.length === 1 ? 'event' : 'events'}
                        </span>
                      ) : (
                        <span className="ml-auto text-xs font-medium text-text-muted">—</span>
                      )}
                    </div>
                    <ul className="divide-y divide-border/70">
                      {items.length === 0 ? (
                        <li className="px-5 py-4 text-sm text-text-muted sm:px-6">
                          Nothing scheduled
                        </li>
                      ) : null}
                      {items.map((o) => {
                        const startLabel = formatInTimeZone(o.start, tz, 'h:mm a');
                        const endLabel = formatInTimeZone(o.end, tz, 'h:mm a');
                        return (
                          <li
                            key={`${o.eventId}:${o.start.toISOString()}`}
                            className="flex items-start gap-3 px-5 py-3.5 sm:gap-4 sm:px-6"
                          >
                            <div className="w-[5.5rem] shrink-0 pt-0.5 text-right font-mono text-xs leading-5 text-text-muted sm:w-24 sm:text-sm">
                              <div>{startLabel}</div>
                              <div className="text-[10px] opacity-80 sm:text-xs">to {endLabel}</div>
                            </div>
                            <div className="min-w-0 flex-1 border-l border-border/80 pl-3 sm:pl-4">
                              <div className="flex items-start gap-2">
                                <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-text">
                                  {o.title}
                                </p>
                                {o.source === 'outlook_ics' ? (
                                  <span
                                    className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500"
                                    title="Outlook"
                                    aria-label="Outlook"
                                  />
                                ) : (
                                  <Badge variant="purple" className="shrink-0 py-0 text-[10px]">
                                    App
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-danger mt-0.5 h-8 shrink-0 px-2.5 text-xs"
                              onClick={() => requestDelete(o.eventId, o.title)}
                              title="Delete event"
                            >
                              Delete
                            </button>
                          </li>
                        );
                      })}
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
        timezone={tz}
        onClose={() => setComposerOpen(false)}
        onCreate={async (payload) => {
          if (!user) return;
          await createEvent(user.id, payload);
          const { fromIso, toIso } = eventsFetchIsoRange(profile?.timezone);
          void fetchRange(user.id, fromIso, toIso);
        }}
      />
    </div>
  );
}
