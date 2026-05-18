import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorizedInternalCall } from '../_shared/auth.ts';
import {
  compareTimeStrings,
  friendlyDateLabel,
  friendlyTimeLabel,
  localDateString,
  localTimeString,
  trimSeconds,
} from '../_shared/datetime.ts';
import { escapeHtml, sendEmail } from '../_shared/resend.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const DEFAULT_TIMEZONE = 'UTC';

type Profile = {
  user_id: string;
  first_name: string | null;
  timezone: string | null;
  notify_email_enabled: boolean;
  notify_email_digest_enabled: boolean;
  notify_email_digest_local_time: string;
  notify_email_last_digest_at: string | null;
  notify_email_address: string | null;
};

type Task = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  waiting_on: string | null;
};

type Event = {
  id: string;
  title: string;
  start_at: string;
  timezone: string;
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  urgent: 'Important',
  high: 'Active',
  normal: 'Routine',
  low: 'Later',
};

function priorityRank(p: string): number {
  const order = ['critical', 'urgent', 'high', 'normal', 'low'];
  const i = order.indexOf(p);
  return i === -1 ? 2 : i;
}

function compareDueDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const p = priorityRank(a.priority) - priorityRank(b.priority);
    if (p !== 0) return p;
    return compareDueDate(a.due_date, b.due_date);
  });
}

function formatDueLabel(dueDate: string | null, todayLocalDate: string): string {
  if (!dueDate) return '';
  if (dueDate === todayLocalDate) return 'due today';
  if (dueDate < todayLocalDate) return `overdue (was due ${dueDate})`;
  return `due ${dueDate}`;
}

function renderTaskList(tasks: Task[], todayLocalDate: string): string {
  if (tasks.length === 0) return '<p style="margin:0;color:#6b7280">Nothing.</p>';
  const items = tasks
    .map((t) => {
      const due = formatDueLabel(t.due_date, todayLocalDate);
      const dueSpan = due
        ? ` <span style="color:#6b7280;font-size:13px">— ${escapeHtml(due)}</span>`
        : '';
      const priorityChip = `<span style="display:inline-block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-right:6px">${escapeHtml(PRIORITY_LABEL[t.priority] ?? 'Routine')}</span>`;
      const waitingChip = t.waiting_on?.trim()
        ? ` <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px">Waiting on ${escapeHtml(t.waiting_on.trim())}</span>`
        : '';
      return `<li style="margin:8px 0;line-height:1.45">${priorityChip}<strong>${escapeHtml(t.title)}</strong>${dueSpan}${waitingChip}</li>`;
    })
    .join('');
  return `<ul style="padding-left:18px;margin:0">${items}</ul>`;
}

function renderEventList(events: Event[], userTz: string): string {
  if (events.length === 0) return '<p style="margin:0;color:#6b7280">No events today.</p>';
  const items = events
    .map((e) => {
      const when = friendlyTimeLabel(new Date(e.start_at), userTz);
      return `<li style="margin:6px 0;line-height:1.45"><strong>${escapeHtml(when)}</strong> — ${escapeHtml(e.title)}</li>`;
    })
    .join('');
  return `<ul style="padding-left:18px;margin:0">${items}</ul>`;
}

function renderDigestHtml(args: {
  greeting: string;
  dateLabel: string;
  criticalTasks: Task[];
  dueTodayTasks: Task[];
  overdueTasks: Task[];
  waitingOnTasks: Task[];
  eventsToday: Event[];
  todayLocalDate: string;
  userTz: string;
}): string {
  const section = (title: string, count: number, body: string) => `
    <section style="margin-top:24px">
      <h2 style="font-size:13px;letter-spacing:0.6px;text-transform:uppercase;color:#374151;margin:0 0 10px">${escapeHtml(title)} <span style="color:#9ca3af;font-weight:500">${count}</span></h2>
      ${body}
    </section>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
      <p style="margin:0;color:#6b7280;font-size:13px">${escapeHtml(args.dateLabel)}</p>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:600">Good morning, ${escapeHtml(args.greeting)}.</h1>
      ${section('Critical', args.criticalTasks.length, renderTaskList(args.criticalTasks, args.todayLocalDate))}
      ${section('Due today', args.dueTodayTasks.length, renderTaskList(args.dueTodayTasks, args.todayLocalDate))}
      ${section('Overdue', args.overdueTasks.length, renderTaskList(args.overdueTasks, args.todayLocalDate))}
      ${section('Waiting on', args.waitingOnTasks.length, renderTaskList(args.waitingOnTasks, args.todayLocalDate))}
      ${section("Today's events", args.eventsToday.length, renderEventList(args.eventsToday, args.userTz))}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px"/>
      <p style="margin:0;font-size:12px;color:#9ca3af">You're getting this because email notifications are enabled in your Notes profile. Disable any time on the Profile page.</p>
    </div>
  </body>
</html>`;
}

async function fetchUserEmail(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function processProfile(
  admin: SupabaseClient,
  profile: Profile,
  now: Date,
): Promise<{ status: string; userId: string }> {
  if (!profile.notify_email_enabled || !profile.notify_email_digest_enabled) {
    return { status: 'skipped:disabled', userId: profile.user_id };
  }
  const userTz = profile.timezone?.trim() || DEFAULT_TIMEZONE;
  const localTime = localTimeString(now, userTz);
  const digestTime = trimSeconds(profile.notify_email_digest_local_time);

  if (compareTimeStrings(localTime, digestTime) < 0) {
    return { status: 'skipped:too-early', userId: profile.user_id };
  }

  const todayLocalDate = localDateString(now, userTz);
  if (profile.notify_email_last_digest_at) {
    const lastLocalDate = localDateString(
      new Date(profile.notify_email_last_digest_at),
      userTz,
    );
    if (lastLocalDate === todayLocalDate) {
      return { status: 'skipped:already-sent-today', userId: profile.user_id };
    }
  }

  const override = profile.notify_email_address?.trim();
  const email = override && override.length > 0
    ? override
    : await fetchUserEmail(admin, profile.user_id);
  if (!email) return { status: 'skipped:no-email', userId: profile.user_id };

  const { data: openTasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id, title, priority, due_date, waiting_on')
    .eq('user_id', profile.user_id)
    .eq('done', false);
  if (tasksErr) throw tasksErr;
  const tasks = (openTasks ?? []) as Task[];

  const criticalTasks = sortTasks(tasks.filter((t) => t.priority === 'critical'));
  const dueTodayTasks = sortTasks(
    tasks.filter((t) => t.priority !== 'critical' && t.due_date === todayLocalDate),
  );
  const overdueTasks = sortTasks(
    tasks.filter(
      (t) =>
        t.priority !== 'critical' &&
        t.due_date !== null &&
        t.due_date < todayLocalDate,
    ),
  );
  const waitingOnTasks = sortTasks(
    tasks.filter((t) => t.waiting_on && t.waiting_on.trim().length > 0),
  );

  // Pull a generous UTC window around today's local date and filter in JS so
  // we don't have to reason about tz arithmetic in SQL.
  const windowStart = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 36 * 3600 * 1000).toISOString();
  const { data: rawEvents, error: eventsErr } = await admin
    .from('events')
    .select('id, title, start_at, timezone')
    .eq('user_id', profile.user_id)
    .gte('start_at', windowStart)
    .lt('start_at', windowEnd)
    .order('start_at', { ascending: true });
  if (eventsErr) throw eventsErr;
  const eventsToday = (rawEvents ?? []).filter(
    (e) => localDateString(new Date(e.start_at), userTz) === todayLocalDate,
  ) as Event[];

  const hasAnything =
    criticalTasks.length +
      dueTodayTasks.length +
      overdueTasks.length +
      waitingOnTasks.length +
      eventsToday.length >
    0;
  if (!hasAnything) {
    // Still record that today's digest "ran" so we don't keep retrying every
    // 15 minutes for the rest of the day.
    await admin
      .from('profiles')
      .update({ notify_email_last_digest_at: now.toISOString() })
      .eq('user_id', profile.user_id);
    return { status: 'skipped:nothing-to-send', userId: profile.user_id };
  }

  const greeting = profile.first_name?.trim() || 'there';
  const html = renderDigestHtml({
    greeting,
    dateLabel: friendlyDateLabel(now, userTz),
    criticalTasks,
    dueTodayTasks,
    overdueTasks,
    waitingOnTasks,
    eventsToday,
    todayLocalDate,
    userTz,
  });

  await sendEmail({
    to: email,
    subject: `Your day — ${friendlyDateLabel(now, userTz)}`,
    html,
  });

  await admin
    .from('profiles')
    .update({ notify_email_last_digest_at: now.toISOString() })
    .eq('user_id', profile.user_id);

  return { status: 'sent', userId: profile.user_id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!isAuthorizedInternalCall(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: profiles, error } = await admin
    .from('profiles')
    .select(
      'user_id, first_name, timezone, notify_email_enabled, notify_email_digest_enabled, notify_email_digest_local_time, notify_email_last_digest_at, notify_email_address',
    )
    .eq('notify_email_enabled', true)
    .eq('notify_email_digest_enabled', true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const results: { status: string; userId: string; error?: string }[] = [];
  for (const p of (profiles ?? []) as Profile[]) {
    try {
      results.push(await processProfile(admin, p, now));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ status: 'error', userId: p.user_id, error: msg });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
