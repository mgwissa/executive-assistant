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
  notify_email_reminder_enabled: boolean;
  notify_email_address: string | null;
};

type DueTask = {
  id: string;
  title: string;
  due_date: string;
  due_time: string;
};

function renderReminderHtml(args: {
  greeting: string;
  taskTitle: string;
  dueTimeLabel: string;
  dateLabel: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05);border-top:4px solid #4f46e5">
      <p style="margin:0;color:#4f46e5;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px">Due now</p>
      <h1 style="margin:6px 0 14px;font-size:20px;font-weight:600">Hi ${escapeHtml(args.greeting)}, this task is due.</h1>
      <p style="margin:0 0 6px;font-size:16px;font-weight:600">${escapeHtml(args.taskTitle)}</p>
      <p style="margin:0 0 16px;color:#6b7280">Scheduled for ${escapeHtml(args.dueTimeLabel)}.</p>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px">${escapeHtml(args.dateLabel)}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px"/>
      <p style="margin:0;font-size:12px;color:#9ca3af">Disable due-time reminders in Profile → Email notifications.</p>
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
): Promise<{ status: string; userId: string; sent?: number }> {
  if (!profile.notify_email_enabled || !profile.notify_email_reminder_enabled) {
    return { status: 'skipped:disabled', userId: profile.user_id };
  }

  const userTz = profile.timezone?.trim() || DEFAULT_TIMEZONE;
  const todayLocal = localDateString(now, userTz);
  const localTime = localTimeString(now, userTz);

  const { data: tasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id, title, due_date, due_time')
    .eq('user_id', profile.user_id)
    .eq('done', false)
    .eq('due_date', todayLocal)
    .not('due_time', 'is', null)
    .is('reminder_sent_at', null);
  if (tasksErr) throw tasksErr;

  const dueNow = ((tasks ?? []) as DueTask[]).filter(
    (t) => compareTimeStrings(localTime, trimSeconds(t.due_time)) >= 0,
  );
  if (dueNow.length === 0) {
    return { status: 'skipped:none-due', userId: profile.user_id };
  }

  const override = profile.notify_email_address?.trim();
  const email = override && override.length > 0
    ? override
    : await fetchUserEmail(admin, profile.user_id);
  if (!email) return { status: 'skipped:no-email', userId: profile.user_id };

  const greeting = profile.first_name?.trim() || 'there';
  const dateLabel = friendlyDateLabel(now, userTz);
  let sent = 0;

  for (const task of dueNow) {
    const dueTimeLabel = friendlyTimeLabel(
      new Date(`${todayLocal}T${trimSeconds(task.due_time)}:00`),
      userTz,
    );
    try {
      await sendEmail({
        to: email,
        subject: `Due now: ${task.title}`,
        html: renderReminderHtml({
          greeting,
          taskTitle: task.title,
          dueTimeLabel,
          dateLabel,
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`reminder send failed task ${task.id}:`, msg);
      continue;
    }

    const { error: markErr } = await admin
      .from('tasks')
      .update({ reminder_sent_at: now.toISOString() })
      .eq('id', task.id)
      .is('reminder_sent_at', null);
    if (markErr) {
      console.error(`reminder mark failed task ${task.id}:`, markErr.message);
      continue;
    }
    sent += 1;
  }

  return { status: sent > 0 ? 'sent' : 'skipped:send-failed', userId: profile.user_id, sent };
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
  const now = new Date();

  const { data: profiles, error } = await admin
    .from('profiles')
    .select(
      'user_id, first_name, timezone, notify_email_enabled, notify_email_reminder_enabled, notify_email_address',
    )
    .eq('notify_email_enabled', true)
    .eq('notify_email_reminder_enabled', true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: { status: string; userId: string; sent?: number; error?: string }[] = [];
  for (const p of (profiles ?? []) as Profile[]) {
    try {
      results.push(await processProfile(admin, p, now));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`send-due-time-reminders failed for user ${p.user_id}:`, msg);
      results.push({ status: 'error', userId: p.user_id, error: msg });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
