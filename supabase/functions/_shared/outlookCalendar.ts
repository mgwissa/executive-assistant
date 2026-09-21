import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { addWeeks, startOfWeek } from 'npm:date-fns@3';
import { fromZonedTime, toZonedTime } from 'npm:date-fns-tz@3';
import ICAL from 'npm:ical.js@2.0.1';

const ALLOWED_HOSTS = ['outlook.office365.com', 'outlook.office.com', 'outlook.live.com', 'attachments.office.net'];
const MAX_BYTES = 5_000_000;
const MAX_ROWS = 3000;

export type CalendarSyncResult = {
  status: 'synced' | 'failed' | 'not_configured' | 'not_authorized' | 'superseded';
  lastSyncedAt: string | null;
  message: string;
  imported?: number;
  coverageStart?: string;
  coverageEnd?: string;
};

type CalendarPrincipal = { connectionId: string; scopes: string[] };
export type OutlookRow = { outlook_source_key: string; title: string; start_at: string; duration_minutes: number; timezone: string };

export function importBounds(timezone: string, now = new Date()) {
  const monday = startOfWeek(toZonedTime(now, timezone), { weekStartsOn: 1 });
  return {
    from: fromZonedTime(addWeeks(monday, -1), timezone),
    to: fromZonedTime(addWeeks(monday, 3), timezone),
  };
}

export function allowedIcsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ALLOWED_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

// Bound both the request and body download. Never follow a redirect outside the
// published-calendar hosts, and never expose the secret subscription URL in errors.
export async function fetchOutlookFeed(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const signal = AbortSignal.timeout(12_000);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (!allowedIcsUrl(url)) throw new Error('Use a published Outlook HTTPS calendar link in Profile.');
      const response = await fetcher(url, { redirect: 'manual', signal, cache: 'no-store' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Outlook returned an invalid redirect.');
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Outlook calendar returned HTTP ${response.status}.`);
      }
      if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error('Outlook calendar is too large to sync safely.');
      }
      if (!response.body) throw new Error('Outlook returned an empty response.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error('Outlook calendar is too large to sync safely.');
          text += decoder.decode(value, { stream: true });
        }
        return text + decoder.decode();
      } finally { await reader.cancel(); }
    }
    throw new Error('Outlook redirected too many times.');
  } catch (error) {
    // Only our messages are safe: fetch exceptions can include the subscription URL.
    if (error instanceof Error && /^(Outlook |Use a published)/.test(error.message)) throw error;
    throw new Error(signal.aborted ? 'Outlook calendar refresh timed out.' : 'Could not download the Outlook calendar.');
  }
}

/** Complete snapshot or an error. Partial parsing must never retire saved meetings. */
export function parseOutlookFeed(text: string, timezone: string, now = new Date()) {
  const clean = text.trim();
  if (!clean.startsWith('BEGIN:VCALENDAR') || !clean.endsWith('END:VCALENDAR')) throw new Error('Invalid calendar document.');
  const root = new ICAL.Component(ICAL.parse(clean));
  if (root.name !== 'vcalendar' || ![null, 'PUBLISH'].includes(root.getFirstPropertyValue('method') as string | null)) {
    throw new Error('Expected a complete published calendar.');
  }
  const bounds = importBounds(timezone, now);
  if (!Number.isFinite(bounds.from.getTime())) throw new Error('Invalid profile timezone.');
  const inside = (date: Date) => date >= bounds.from && date < bounds.to;
  const utc = (time: ICAL.Time): Date => {
    if (!time) throw new Error('Missing event time.');
    const date = time.isDate || time.zone.tzid === 'floating'
      ? fromZonedTime(time.toString().replace(/Z$/, '') + (time.isDate ? 'T00:00:00' : ''), timezone)
      : time.toJSDate();
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid event time.');
    return date;
  };
  const identity = (time: ICAL.Time) => time.isDate ? `date:${time.toString()}` : utc(time).toISOString();
  const cancelled = (component: ICAL.Component) => component.getFirstPropertyValue('status') === 'CANCELLED';
  const groups = new Map<string, Map<string, ICAL.Component>>();
  const components = root.getAllSubcomponents('vevent');
  if (components.length > 10_000) throw new Error('Too many calendar events.');
  for (const component of components) {
    const uid = component.getFirstPropertyValue('uid');
    if (typeof uid !== 'string' || !uid.trim() || new TextEncoder().encode(uid).length > 512) throw new Error('Missing or invalid event UID.');
    for (const prop of component.getAllProperties()) {
      const tzid = prop.getParameter('tzid');
      if (tzid && tzid !== 'UTC' && !root.getTimeZoneByID(String(tzid))) throw new Error('Calendar timezone definition is missing.');
    }
    if (component.getFirstProperty('recurrence-id')?.getParameter('range')) throw new Error('Range exceptions need explicit support before importing.');
    for (const rule of component.getAllProperties('rrule')) {
      const recur = rule.getFirstValue() as ICAL.Recur;
      if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(recur.freq)) throw new Error('Unsupported recurrence frequency.');
    }
    const recurrenceId = component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
    const key = recurrenceId ? identity(recurrenceId) : 'master';
    const group = groups.get(uid) ?? new Map<string, ICAL.Component>();
    const previous = group.get(key);
    if (previous && previous.toString() !== component.toString()) {
      const rank = (c: ICAL.Component) => [Number(c.getFirstPropertyValue('sequence') ?? 0),
        String(c.getFirstPropertyValue('last-modified') ?? c.getFirstPropertyValue('dtstamp') ?? '')] as const;
      const a = rank(previous), b = rank(component);
      if (a[0] === b[0] && a[1] === b[1]) throw new Error('Ambiguous duplicate event identity.');
      if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) continue;
    }
    group.set(key, component);
    groups.set(uid, group);
  }
  const rows = new Map<string, OutlookRow>();
  const began = Date.now();
  let expanded = 0;
  for (const [uid, group] of groups) {
    const master = group.get('master');
    if (master && cancelled(master)) continue;
    const add = (component: ICAL.Component, start: ICAL.Time, end: ICAL.Time, recurrenceId: ICAL.Time | null) => {
      if (cancelled(component)) return;
      const startDate = utc(start);
      if (!inside(startDate) && !(recurrenceId && inside(utc(recurrenceId)))) return;
      const duration = Math.round((utc(end).getTime() - startDate.getTime()) / 60_000);
      if (duration < 0 || duration > 525600) throw new Error('Invalid event duration.');
      const key = JSON.stringify([uid, recurrenceId ? identity(recurrenceId) : null]);
      rows.set(key, {
        outlook_source_key: key,
        title: String(component.getFirstPropertyValue('summary') || 'Untitled').trim(),
        start_at: startDate.toISOString(), duration_minutes: Math.max(1, duration), timezone,
      });
      if (rows.size > MAX_ROWS) throw new Error('Too many occurrences to import safely.');
    };
    if (master) {
      const event = new ICAL.Event(master, { exceptions: [] });
      if (!event.startDate) throw new Error('Missing event start.');
      if (!event.isRecurring()) add(master, event.startDate, event.endDate, null);
      else {
        const iterator = event.iterator();
        let next: ICAL.Time | null;
        while ((next = iterator.next())) {
          if (++expanded > 50_000 || (expanded % 100 === 0 && Date.now() - began > 2000)) throw new Error('Calendar recurrence expansion limit reached.');
          if (utc(next) >= bounds.to) break;
          if (group.has(identity(next))) continue; // Exception is authoritative, including cancellation.
          const end = next.clone();
          end.addDuration(event.duration);
          add(master, next, end, next);
        }
      }
    }
    // Process detached exceptions too, including those moved into the window from
    // an original slot outside it. Identity always uses the ORIGINAL recurrence ID.
    for (const [key, component] of group) {
      if (key === 'master' || cancelled(component)) continue;
      const event = new ICAL.Event(component, { exceptions: [] });
      add(component, event.startDate, event.endDate, event.recurrenceId);
    }
  }
  return { rows: [...rows.values()], from: bounds.from.toISOString(), to: bounds.to.toISOString() };
}

export async function refreshOutlookCalendar(
  admin: SupabaseClient, userId: string, principal?: CalendarPrincipal,
): Promise<CalendarSyncResult> {
  const startedAt = new Date().toISOString();
  const { data: profile, error } = await admin.from('profiles')
    .select('outlook_ics_url,outlook_ics_last_synced_at,timezone').eq('user_id', userId).maybeSingle();
  const lastSyncedAt = profile?.outlook_ics_last_synced_at ?? null;
  if (error || !profile) return { status: 'failed', lastSyncedAt, message: 'Could not read calendar settings. Treat the schedule as unverified.' };
  const url = profile.outlook_ics_url?.trim();
  if (!url) return { status: 'not_configured', lastSyncedAt, message: 'No Outlook feed is configured. Only saved calendar events are available.' };
  if (principal && !principal.scopes.includes('workspace:write')) return {
    status: 'not_authorized', lastSyncedAt, message: 'This connection can read saved events but cannot refresh them. Calendar is unverified.',
  };
  try {
    const text = await fetchOutlookFeed(url);
    let snapshot: ReturnType<typeof parseOutlookFeed>;
    try { snapshot = parseOutlookFeed(text, profile.timezone || 'UTC'); }
    catch { throw new Error('Outlook returned a calendar that could not be fully parsed safely.'); }
    const { data, error: applyError } = await admin.rpc('apply_outlook_calendar_snapshot', {
      p_user_id: userId, p_connection_id: principal?.connectionId ?? null,
      p_expected_url: profile.outlook_ics_url, p_timezone: profile.timezone || 'UTC',
      p_started_at: startedAt, p_from: snapshot.from, p_to: snapshot.to, p_rows: snapshot.rows,
    });
    if (applyError) throw new Error('Calendar changes could not be saved safely.');
    if (!data || !['synced', 'superseded'].includes(data.status) ||
      (data.status === 'synced' && typeof data.lastSyncedAt !== 'string')) {
      throw new Error('Calendar refresh was not confirmed.');
    }
    if (data.status === 'superseded') return {
      status: 'superseded', lastSyncedAt: data.lastSyncedAt, message: 'Another sync or settings change superseded this attempt. Read saved events as unverified; retry if needed.',
    };
    return { status: 'synced', lastSyncedAt: data.lastSyncedAt, imported: snapshot.rows.length,
      coverageStart: snapshot.from, coverageEnd: snapshot.to,
      message: 'Refreshed the published Outlook feed before reading the workspace. Outlook publication may lag recent calendar edits.' };
  } catch (error) {
    return { status: 'failed', lastSyncedAt, message: `${error instanceof Error ? error.message : 'Calendar refresh failed.'} Saved events were retained; do not interpret missing meetings as free time.` };
  }
}
