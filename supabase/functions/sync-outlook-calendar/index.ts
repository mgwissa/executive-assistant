import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { addWeeks, startOfDay, startOfWeek } from 'npm:date-fns@3';
import { fromZonedTime, toZonedTime } from 'npm:date-fns-tz@3';
import ICAL from 'npm:ical.js@2.0.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_ICS_HOSTS = [
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
  'attachments.office.net',
];

function isAllowedIcsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_ICS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function durationMinutes(ev: InstanceType<typeof ICAL.Event>): number {
  try {
    const end = ev.endDate;
    const start = ev.startDate;
    if (end && start) {
      const ms = end.toJSDate().getTime() - start.toJSDate().getTime();
      if (Number.isFinite(ms) && ms > 0) return Math.max(5, Math.round(ms / 60000));
    }
    const dur = ev.duration;
    if (dur) {
      const secs = dur.toSeconds();
      if (Number.isFinite(secs) && secs > 0) return Math.max(5, Math.round(secs / 60));
    }
  } catch {
    /* ignore */
  }
  return 30;
}

function isCancelled(vevent: ICAL.Component): boolean {
  const st = vevent.getFirstPropertyValue('status');
  return typeof st === 'string' && st.toUpperCase() === 'CANCELLED';
}

/** Only persist Outlook rows in the current Mon–Sun week (profile TZ). */
function weekImportBoundsUtc(calendarTz: string): { fromUtc: Date; toExclusiveUtc: Date } {
  const z = toZonedTime(new Date(), calendarTz);
  const thisMondayZ = startOfDay(startOfWeek(z, { weekStartsOn: 1 }));
  const nextMondayZ = addWeeks(thisMondayZ, 1);
  return {
    fromUtc: fromZonedTime(thisMondayZ, calendarTz),
    toExclusiveUtc: fromZonedTime(nextMondayZ, calendarTz),
  };
}

function occurrenceStarts(vevent: ICAL.Component, ev: InstanceType<typeof ICAL.Event>): Date[] {
  const out: Date[] = [];
  if (!ev.isRecurring()) {
    out.push(ev.startDate.toJSDate());
    return out;
  }
  const dtstart = vevent.getFirstPropertyValue('dtstart');
  if (!dtstart) {
    out.push(ev.startDate.toJSDate());
    return out;
  }
  const expand = new ICAL.RecurExpansion({
    component: vevent,
    dtstart,
  });
  const max = 400;
  let n = 0;
  while (n < max) {
    const next = expand.next() as ICAL.Time | null;
    if (!next) break;
    out.push(next.toJSDate());
    n++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase env on Edge Function' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: userErr?.message ?? 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('outlook_ics_url, timezone')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profErr) {
      return new Response(JSON.stringify({ error: profErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const icsUrl = (profile?.outlook_ics_url as string | null | undefined)?.trim();
    if (!icsUrl) {
      return new Response(JSON.stringify({ error: 'No ICS URL saved. Paste your Outlook .ics link on Profile and save.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isAllowedIcsUrl(icsUrl)) {
      return new Response(
        JSON.stringify({
          error:
            'ICS URL host is not allowed. Use your published Outlook HTTPS link (office365 / outlook.live).',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const icsRes = await fetch(icsUrl, {
      headers: { 'User-Agent': 'NotesApp/1.0 (Supabase Edge; ICS sync)' },
    });
    if (!icsRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch ICS: HTTP ${icsRes.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const icsText = await icsRes.text();
    const jcal = ICAL.parse(icsText);
    const root = new ICAL.Component(jcal);
    const vevents = root.getAllSubcomponents('vevent');

    const tz = (profile?.timezone as string | null | undefined)?.trim() || 'UTC';
    const { fromUtc, toExclusiveUtc } = weekImportBoundsUtc(tz);

    const rows: {
      user_id: string;
      title: string;
      start_at: string;
      duration_minutes: number;
      timezone: string;
      recurrence: string;
      interval: number;
      by_weekday: null;
      until_at: null;
      count: null;
      source: string;
    }[] = [];

    for (const vevent of vevents) {
      if (isCancelled(vevent)) continue;
      let ev: InstanceType<typeof ICAL.Event>;
      try {
        ev = new ICAL.Event(vevent);
      } catch {
        continue;
      }
      const title = (ev.summary && String(ev.summary).trim()) || 'Untitled';
      const dm = durationMinutes(ev);
      const starts = occurrenceStarts(vevent, ev);
      for (const start of starts) {
        const t = start.getTime();
        if (t < fromUtc.getTime() || t >= toExclusiveUtc.getTime()) continue;
        rows.push({
          user_id: user.id,
          title,
          start_at: start.toISOString(),
          duration_minutes: dm,
          timezone: tz,
          recurrence: 'none',
          interval: 1,
          by_weekday: null,
          until_at: null,
          count: null,
          source: 'outlook_ics',
        });
      }
    }

    const { error: delErr } = await admin.from('events').delete().eq('user_id', user.id).eq('source', 'outlook_ics');
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const { error: insErr } = await admin.from('events').insert(chunk);
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const nowIso = new Date().toISOString();
    const { error: upErr } = await admin
      .from('profiles')
      .update({ outlook_ics_last_synced_at: nowIso })
      .eq('user_id', user.id);
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, imported: rows.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
