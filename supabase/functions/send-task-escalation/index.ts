import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorizedInternalCall } from '../_shared/auth.ts';
import { friendlyDateLabel } from '../_shared/datetime.ts';
import { escapeHtml, sendEmail } from '../_shared/resend.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const DEFAULT_TIMEZONE = 'UTC';

type Body = { task_id?: string };

function renderEscalationHtml(args: {
  greeting: string;
  taskTitle: string;
  dueLabel: string | null;
  dateLabel: string;
}): string {
  const dueLine = args.dueLabel
    ? `<p style="margin:0 0 16px;color:#6b7280">Due ${escapeHtml(args.dueLabel)}.</p>`
    : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05);border-top:4px solid #dc2626">
      <p style="margin:0;color:#dc2626;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px">Critical priority</p>
      <h1 style="margin:6px 0 14px;font-size:20px;font-weight:600">Hi ${escapeHtml(args.greeting)}, a task just escalated.</h1>
      <p style="margin:0 0 6px;font-size:16px;font-weight:600">${escapeHtml(args.taskTitle)}</p>
      ${dueLine}
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px">${escapeHtml(args.dateLabel)}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px"/>
      <p style="margin:0;font-size:12px;color:#9ca3af">You're getting this because critical-task alerts are enabled in your Notes profile. Disable any time on the Profile page.</p>
    </div>
  </body>
</html>`;
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

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const taskId = body.task_id?.trim();
  if (!taskId) {
    return new Response(JSON.stringify({ error: 'task_id is required' }), {
      status: 400,
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

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('id, user_id, title, due_date, priority, done')
    .eq('id', taskId)
    .maybeSingle();
  if (taskErr) {
    return new Response(JSON.stringify({ error: taskErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!task) {
    return new Response(JSON.stringify({ status: 'task-not-found' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Defensive: skip if state shifted between trigger fire and our read.
  if (task.priority !== 'critical' || task.done) {
    return new Response(JSON.stringify({ status: 'state-changed' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select(
      'first_name, timezone, notify_email_enabled, notify_email_escalation_enabled, notify_email_address',
    )
    .eq('user_id', task.user_id)
    .maybeSingle();
  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (
    !profile ||
    !profile.notify_email_enabled ||
    !profile.notify_email_escalation_enabled
  ) {
    return new Response(JSON.stringify({ status: 'disabled' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const override = profile.notify_email_address?.trim();
  let email: string | null = override && override.length > 0 ? override : null;
  if (!email) {
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(
      task.user_id,
    );
    if (userErr || !userRes?.user?.email) {
      return new Response(JSON.stringify({ status: 'no-email' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    email = userRes.user.email;
  }

  const userTz = profile.timezone?.trim() || DEFAULT_TIMEZONE;
  const html = renderEscalationHtml({
    greeting: profile.first_name?.trim() || 'there',
    taskTitle: task.title,
    dueLabel: task.due_date,
    dateLabel: friendlyDateLabel(new Date(), userTz),
  });

  try {
    await sendEmail({
      to: email,
      subject: `Critical: ${task.title}`,
      html,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ status: 'sent' }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
