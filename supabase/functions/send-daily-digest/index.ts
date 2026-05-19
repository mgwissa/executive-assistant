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
  reschedule_count: number | null;
  priority_set_at: string | null;
  updated_at: string;
};

type Event = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
};

// ─── Priority helpers ────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  urgent: 'Important',
  high: 'Active',
  normal: 'Routine',
  low: 'Later',
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#dc2626',
  urgent: '#d97706',
  high: '#2563eb',
  normal: '#6b7280',
  low: '#9ca3af',
};

function priorityRank(p: string): number {
  return ['critical', 'urgent', 'high', 'normal', 'low'].indexOf(p) ?? 2;
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

// ─── Time-of-day mode ────────────────────────────────────────────────────────

type BriefingMode = 'morning' | 'midday' | 'afternoon' | 'evening';

function getBriefingMode(localHour: number): BriefingMode {
  if (localHour >= 6 && localHour < 10) return 'morning';
  if (localHour >= 10 && localHour < 14) return 'midday';
  if (localHour >= 14 && localHour < 18) return 'afternoon';
  return 'evening';
}

const MODE_META: Record<BriefingMode, { label: string; greeting: string; icon: string }> = {
  morning: { label: 'Morning Briefing', greeting: 'Good morning', icon: '☀️' },
  midday:  { label: 'Midday Pulse',     greeting: 'Hey',           icon: '⚡' },
  afternoon: { label: 'Afternoon Check-in', greeting: 'Good afternoon', icon: '🌤️' },
  evening: { label: 'Evening Prep',     greeting: 'Good evening',  icon: '🌙' },
};

// ─── Staleness detection ─────────────────────────────────────────────────────

const STALE_SLA_DAYS: Record<string, number> = {
  critical: 1,
  urgent: 3,
  high: 7,
  normal: 14,
  low: 30,
};

function daysBetween(a: string, b: Date): number {
  const ms = b.getTime() - new Date(a).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

type Insight = {
  kind: 'warning' | 'nudge' | 'info';
  text: string;
};

function buildInsights(tasks: Task[], events: Event[], now: Date, todayLocalDate: string, userTz: string): {
  watchList: Insight[];
  nudges: Insight[];
} {
  const watchList: Insight[] = [];
  const nudges: Insight[] = [];

  // ── Reschedule nudges (≥3 times) ─────────────────────────────────────────
  for (const t of tasks) {
    const count = t.reschedule_count ?? 0;
    if (count >= 3) {
      nudges.push({
        kind: 'nudge',
        text: `"${t.title}" has been rescheduled ${count} time${count === 1 ? '' : 's'}. Is this actually getting done?`,
      });
    }
  }

  // ── Stale high-priority tasks ─────────────────────────────────────────────
  for (const t of tasks) {
    const sla = STALE_SLA_DAYS[t.priority];
    if (!sla) continue;
    const ref = t.priority_set_at ?? t.updated_at;
    const age = daysBetween(ref, now);
    if (age > sla) {
      nudges.push({
        kind: 'nudge',
        text: `"${t.title}" is marked ${PRIORITY_LABEL[t.priority] ?? t.priority} but hasn't moved in ${age} days.`,
      });
    }
  }

  // ── Back-to-back meetings ─────────────────────────────────────────────────
  const todayEvents = events
    .filter((e) => localDateString(new Date(e.start_at), userTz) === todayLocalDate)
    .sort((a, b) => a.start_at < b.start_at ? -1 : 1);

  for (let i = 0; i < todayEvents.length - 1; i++) {
    const curr = todayEvents[i];
    const next = todayEvents[i + 1];
    if (!curr.end_at) continue;
    const gapMs = new Date(next.start_at).getTime() - new Date(curr.end_at).getTime();
    const gapMin = Math.floor(gapMs / 60000);
    if (gapMin >= 0 && gapMin < 10) {
      watchList.push({
        kind: 'warning',
        text: `Back-to-back: "${curr.title}" flows straight into "${next.title}" with only ${gapMin} min gap.`,
      });
    }
  }

  // ── Owed-to-me: waiting_on person appears in today's event titles ─────────
  const waitingTasks = tasks.filter((t) => t.waiting_on?.trim());
  for (const task of waitingTasks) {
    const person = (task.waiting_on ?? '').trim().toLowerCase();
    const inMeeting = todayEvents.some((e) => e.title.toLowerCase().includes(person));
    if (inMeeting) {
      watchList.push({
        kind: 'info',
        text: `You're meeting with ${task.waiting_on} today — still waiting on their input for "${task.title}". Good chance to follow up.`,
      });
    }
  }

  // ── Critical/urgent tasks with no due date ────────────────────────────────
  for (const t of tasks) {
    if ((t.priority === 'critical' || t.priority === 'urgent') && !t.due_date) {
      watchList.push({
        kind: 'warning',
        text: `"${t.title}" is ${PRIORITY_LABEL[t.priority]} but has no due date — when does it actually need to happen?`,
      });
    }
  }

  // ── Tomorrow events with no prep ──────────────────────────────────────────
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowLocalDate = localDateString(tomorrow, userTz);
  const tomorrowEvents = events.filter(
    (e) => localDateString(new Date(e.start_at), userTz) === tomorrowLocalDate,
  );
  for (const e of tomorrowEvents) {
    const titleWords = e.title.toLowerCase().split(/\s+/);
    const hasPrepTask = tasks.some((t) =>
      titleWords.some((w) => w.length > 3 && t.title.toLowerCase().includes(w)),
    );
    if (!hasPrepTask && tomorrowEvents.length <= 3) {
      watchList.push({
        kind: 'info',
        text: `"${e.title}" is on your calendar tomorrow — no prep task found. Worth adding one?`,
      });
    }
  }

  return { watchList, nudges };
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function chip(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.4px;padding:2px 8px;border-radius:20px;background:${bg};color:${color};margin-right:4px">${escapeHtml(label)}</span>`;
}

function renderStatStrip(args: {
  overdue: number;
  dueToday: number;
  meetings: number;
  waitingOn: number;
  openTasks: number;
}): string {
  const stat = (label: string, val: number, urgent: boolean) => {
    const color = urgent && val > 0 ? '#dc2626' : '#374151';
    const bg = urgent && val > 0 ? '#fee2e2' : '#f3f4f6';
    return `<div style="text-align:center;padding:10px 12px;background:${bg};border-radius:8px;min-width:60px">
      <div style="font-size:22px;font-weight:700;color:${color}">${val}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;white-space:nowrap">${escapeHtml(label)}</div>
    </div>`;
  };
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:16px 0">
    ${stat('Overdue', args.overdue, true)}
    ${stat('Due Today', args.dueToday, true)}
    ${stat('Meetings', args.meetings, false)}
    ${stat('Waiting On', args.waitingOn, false)}
    ${stat('Open Tasks', args.openTasks, false)}
  </div>`;
}

function renderTaskRow(t: Task, todayLocalDate: string): string {
  const priorityColor = PRIORITY_COLOR[t.priority] ?? '#6b7280';
  const priorityBg = t.priority === 'critical' ? '#fee2e2'
    : t.priority === 'urgent' ? '#fef3c7'
    : '#f3f4f6';
  const priorityLabel = PRIORITY_LABEL[t.priority] ?? 'Routine';
  const overdueFlag = t.due_date && t.due_date < todayLocalDate;
  const dueTodayFlag = t.due_date === todayLocalDate;
  const dueLabel = overdueFlag
    ? `<span style="color:#dc2626;font-size:12px;margin-left:6px">overdue (${t.due_date})</span>`
    : dueTodayFlag
    ? `<span style="color:#d97706;font-size:12px;margin-left:6px">due today</span>`
    : t.due_date
    ? `<span style="color:#6b7280;font-size:12px;margin-left:6px">due ${t.due_date}</span>`
    : '';
  const waitingChip = t.waiting_on?.trim()
    ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px">Waiting: ${escapeHtml(t.waiting_on.trim())}</span>`
    : '';
  const rescheduleFlag = (t.reschedule_count ?? 0) >= 3
    ? `<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;margin-left:6px">↻ ${t.reschedule_count}×</span>`
    : '';

  return `<li style="margin:10px 0;line-height:1.5;list-style:none;padding-left:0">
    <div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:2px">
      ${chip(priorityLabel, priorityColor, priorityBg)}
      <strong style="font-size:14px">${escapeHtml(t.title)}</strong>
      ${dueLabel}${waitingChip}${rescheduleFlag}
    </div>
  </li>`;
}

function renderEventRow(e: Event, userTz: string): string {
  const when = friendlyTimeLabel(new Date(e.start_at), userTz);
  return `<li style="margin:8px 0;line-height:1.45;list-style:none">
    <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:600;padding:2px 8px;border-radius:8px;margin-right:8px">${escapeHtml(when)}</span>
    ${escapeHtml(e.title)}
  </li>`;
}

function renderInsightRow(insight: Insight): string {
  const colors = {
    warning: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠️' },
    nudge:   { bg: '#faf5ff', border: '#a855f7', icon: '💡' },
    info:    { bg: '#eff6ff', border: '#3b82f6', icon: '👁' },
  };
  const c = colors[insight.kind];
  return `<li style="margin:10px 0;list-style:none;background:${c.bg};border-left:3px solid ${c.border};padding:8px 12px;border-radius:0 6px 6px 0;font-size:13px;line-height:1.5">
    ${c.icon} ${escapeHtml(insight.text)}
  </li>`;
}

function renderSection(title: string, subtitle: string, body: string): string {
  return `<section style="margin-top:28px">
    <h2 style="font-size:13px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#374151;margin:0 0 2px">${escapeHtml(title)}</h2>
    <p style="font-size:12px;color:#9ca3af;margin:0 0 12px">${escapeHtml(subtitle)}</p>
    ${body}
  </section>`;
}

function renderDigestHtml(args: {
  mode: BriefingMode;
  name: string;
  dateLabel: string;
  criticalTasks: Task[];
  dueTodayTasks: Task[];
  overdueTasks: Task[];
  waitingOnTasks: Task[];
  eventsToday: Event[];
  watchList: Insight[];
  nudges: Insight[];
  todayLocalDate: string;
  userTz: string;
  totalOpenTasks: number;
}): string {
  const meta = MODE_META[args.mode];

  // Nuts & Bolts: critical first, then overdue, then due today, then schedule
  const nutsTasksAll = sortTasks([
    ...args.criticalTasks,
    ...args.overdueTasks.filter((t) => t.priority !== 'critical'),
    ...args.dueTodayTasks,
  ]);
  // Deduplicate by id
  const seen = new Set<string>();
  const nutsTasks = nutsTasksAll.filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  const nutsTasksHtml = nutsTasks.length === 0
    ? '<p style="color:#6b7280;font-size:13px;margin:0">You\'re clear — no critical, overdue, or due-today tasks.</p>'
    : `<ul style="padding:0;margin:0">${nutsTasks.map((t) => renderTaskRow(t, args.todayLocalDate)).join('')}</ul>`;

  const nutsEventsHtml = args.eventsToday.length === 0
    ? '<p style="color:#6b7280;font-size:13px;margin:0">No events today.</p>'
    : `<ul style="padding:0;margin:0">${args.eventsToday.map((e) => renderEventRow(e, args.userTz)).join('')}</ul>`;

  const nutsSection = renderSection(
    'Nuts & Bolts',
    'What needs your attention right now.',
    `${nutsTasksHtml}
     <div style="margin-top:16px">
       <p style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px">Today's Schedule</p>
       ${nutsEventsHtml}
     </div>`,
  );

  // Watch List
  const watchHtml = args.watchList.length === 0
    ? '<p style="color:#6b7280;font-size:13px;margin:0">Nothing flagged for your radar today.</p>'
    : `<ul style="padding:0;margin:0">${args.watchList.map(renderInsightRow).join('')}</ul>`;

  const watchSection = renderSection(
    'Watch List',
    "Here's what I'd keep an eye on today…",
    watchHtml,
  );

  // The Nudge
  const nudgeHtml = args.nudges.length === 0
    ? '<p style="color:#6b7280;font-size:13px;margin:0">No nudges today — looking clean.</p>'
    : `<ul style="padding:0;margin:0">${args.nudges.map(renderInsightRow).join('')}</ul>`;

  const nudgeSection = renderSection(
    'The Nudge',
    "Honest check-ins you might not want to hear, but need to.",
    nudgeHtml,
  );

  // Waiting on section (always shown if non-empty)
  const waitingSection = args.waitingOnTasks.length > 0
    ? renderSection(
        'Waiting On',
        'Tasks blocked on someone else.',
        `<ul style="padding:0;margin:0">${args.waitingOnTasks.map((t) => renderTaskRow(t, args.todayLocalDate)).join('')}</ul>`,
      )
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">

      <!-- Header -->
      <div style="border-bottom:1px solid #f3f4f6;padding-bottom:20px;margin-bottom:4px">
        <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">${meta.icon} ${escapeHtml(meta.label)} · ${escapeHtml(args.dateLabel)}</p>
        <h1 style="margin:0;font-size:24px;font-weight:700">${escapeHtml(meta.greeting)}, ${escapeHtml(args.name)}.</h1>
      </div>

      <!-- Stat strip -->
      ${renderStatStrip({
        overdue: args.overdueTasks.length,
        dueToday: args.dueTodayTasks.length,
        meetings: args.eventsToday.length,
        waitingOn: args.waitingOnTasks.length,
        openTasks: args.totalOpenTasks,
      })}

      ${nutsSection}
      ${watchSection}
      ${nudgeSection}
      ${waitingSection}

      <!-- Footer -->
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px"/>
      <p style="margin:0;font-size:12px;color:#9ca3af">You're getting this because email notifications are enabled in your Notes profile. Disable any time on the Profile page.</p>
    </div>
  </body>
</html>`;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

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

  // Fetch all open tasks including reschedule_count and priority_set_at
  const { data: openTasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id, title, priority, due_date, waiting_on, reschedule_count, priority_set_at, updated_at')
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

  // Pull a generous UTC window for events (today + tomorrow for prep detection)
  const windowStart = new Date(now.getTime() - 36 * 3600 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 60 * 3600 * 1000).toISOString();
  const { data: rawEvents, error: eventsErr } = await admin
    .from('events')
    .select('id, title, start_at, end_at, timezone')
    .eq('user_id', profile.user_id)
    .gte('start_at', windowStart)
    .lt('start_at', windowEnd)
    .order('start_at', { ascending: true });
  if (eventsErr) throw eventsErr;
  const allEvents = (rawEvents ?? []) as Event[];

  const eventsToday = allEvents.filter(
    (e) => localDateString(new Date(e.start_at), userTz) === todayLocalDate,
  );

  const hasAnything =
    criticalTasks.length +
      dueTodayTasks.length +
      overdueTasks.length +
      waitingOnTasks.length +
      eventsToday.length >
    0;

  if (!hasAnything) {
    await admin
      .from('profiles')
      .update({ notify_email_last_digest_at: now.toISOString() })
      .eq('user_id', profile.user_id);
    return { status: 'skipped:nothing-to-send', userId: profile.user_id };
  }

  // Determine briefing mode from local hour
  const localHour = parseInt(localTimeString(now, userTz).split(':')[0], 10);
  const mode = getBriefingMode(localHour);

  // Build intelligence insights
  const { watchList, nudges } = buildInsights(tasks, allEvents, now, todayLocalDate, userTz);

  const name = profile.first_name?.trim() || 'there';
  const dateLabel = friendlyDateLabel(now, userTz);

  const html = renderDigestHtml({
    mode,
    name,
    dateLabel,
    criticalTasks,
    dueTodayTasks,
    overdueTasks,
    waitingOnTasks,
    eventsToday,
    watchList,
    nudges,
    todayLocalDate,
    userTz,
    totalOpenTasks: tasks.length,
  });

  const modeMeta = MODE_META[mode];
  await sendEmail({
    to: email,
    subject: `${modeMeta.label} — ${dateLabel}`,
    html,
  });

  await admin
    .from('profiles')
    .update({ notify_email_last_digest_at: now.toISOString() })
    .eq('user_id', profile.user_id);

  return { status: 'sent', userId: profile.user_id };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

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
