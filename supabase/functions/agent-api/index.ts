/**
 * agent-api — the surface a scheduled agent session talks to.
 *
 * Why this exists: agent runs start as fresh sessions with no memory and no
 * guaranteed access to the owner's machine. Everything they need has to be
 * fetchable over plain HTTP, and everything they learn has to be written back.
 * That means this function is both the agent's eyes (`context`) and its hands
 * (`act`).
 *
 * Auth: an `x-agent-secret` header matched against the `AGENT_SECRET` env var,
 * following the same pattern as the cron-driven functions. The target user is
 * pinned by the `AGENT_USER_ID` env var rather than taken from the request, so
 * a leaked secret can never be pointed at somebody else's data.
 *
 * The invariant that makes this safe: every mutation writes an `agent_actions`
 * row containing the prior value of each column it touched. That row is what
 * powers Undo in the app. A mutation that cannot be logged is not performed.
 *
 * Deployed with `verify_jwt = false` (see config.toml) — the gateway can't
 * validate ES256 tokens, and this function does its own auth anyway.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { localDateString } from '../_shared/datetime.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-agent-secret, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Columns the agent may write on `tasks`. Anything outside this list is
 * dropped rather than rejected, so a slightly-wrong payload still does the
 * useful part of its job instead of failing wholesale.
 */
const TASK_WRITABLE = new Set([
  'title',
  'done',
  'priority',
  'priority_set_at',
  'due_date',
  'due_time',
  'tags',
  'estimated_minutes',
  'description',
  'waiting_on',
  'linked_event_id',
  'chase_snoozed_until',
  'last_chased_at',
]);

function pickWritable(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (TASK_WRITABLE.has(k)) out[k] = v;
  }
  return out;
}

/** The prior value of exactly the keys we are about to write — the undo contract. */
function priorValues(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const k of keys) before[k] = row[k] ?? null;
  return before;
}

type ActionInput = {
  kind: string;
  title?: unknown;
  rationale?: unknown;
  effects?: unknown;
  category?: unknown;
  dedupeKey?: unknown;
  taskId?: unknown;
  task?: unknown;
  patch?: unknown;
  message?: unknown;
  focusQueue?: unknown;
  key?: unknown;
  content?: unknown;
  memoryKind?: unknown;
  confidence?: unknown;
  pinned?: unknown;
};

type ActionResult = {
  ok: boolean;
  kind: string;
  actionId?: string;
  targetId?: string;
  skipped?: 'duplicate';
  error?: string;
};

async function logAction(
  admin: SupabaseClient,
  userId: string,
  runId: string | null,
  input: ActionInput,
  fields: {
    target: Record<string, unknown>;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
): Promise<{ id: string } | { error: string }> {
  const effects = Array.isArray(input.effects)
    ? input.effects.filter((e): e is string => typeof e === 'string')
    : [];

  const { data, error } = await admin
    .from('agent_actions')
    .insert({
      user_id: userId,
      run_id: runId,
      kind: input.kind,
      title: str(input.title) ?? input.kind,
      rationale: str(input.rationale),
      effects,
      target: fields.target,
      before: fields.before,
      after: fields.after,
      category: str(input.category) ?? 'general',
      status: 'applied',
      dedupe_key: str(input.dedupeKey),
    })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message ?? 'Could not write the audit entry' };
  return { id: data.id };
}

async function performAction(
  admin: SupabaseClient,
  userId: string,
  runId: string | null,
  input: ActionInput,
): Promise<ActionResult> {
  const kind = input.kind;

  // Dedupe first: never mutate for something we would then refuse to log.
  const dedupeKey = str(input.dedupeKey);
  if (dedupeKey) {
    const { data: existing } = await admin
      .from('agent_actions')
      .select('id')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing) return { ok: true, kind, skipped: 'duplicate' };
  }

  switch (kind) {
    case 'task_create': {
      const task = isRecord(input.task) ? input.task : null;
      const title = task ? str(task.title) : null;
      if (!title) return { ok: false, kind, error: 'task.title is required' };

      const insert = { ...pickWritable(task ?? {}), title, user_id: userId };
      const { data, error } = await admin.from('tasks').insert(insert).select('*').single();
      if (error || !data) {
        return { ok: false, kind, error: error?.message ?? 'Insert failed' };
      }

      const logged = await logAction(admin, userId, runId, input, {
        target: { type: 'task', id: data.id },
        before: null,
        after: data as Record<string, unknown>,
      });
      if ('error' in logged) {
        // Roll back rather than leave an unlogged, un-undoable change behind.
        await admin.from('tasks').delete().eq('id', data.id);
        return { ok: false, kind, error: logged.error };
      }
      return { ok: true, kind, actionId: logged.id, targetId: data.id };
    }

    case 'task_update':
    case 'task_complete':
    case 'chase_logged': {
      const taskId = str(input.taskId);
      if (!taskId) return { ok: false, kind, error: 'taskId is required' };

      let patch: Record<string, unknown>;
      if (kind === 'task_complete') {
        patch = { done: true };
      } else if (kind === 'chase_logged') {
        patch = { last_chased_at: new Date().toISOString() };
      } else {
        patch = pickWritable(isRecord(input.patch) ? input.patch : {});
      }
      if (Object.keys(patch).length === 0) {
        return { ok: false, kind, error: 'nothing writable in patch' };
      }

      const { data: row, error: readErr } = await admin
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .maybeSingle();
      if (readErr) return { ok: false, kind, error: readErr.message };
      if (!row) return { ok: false, kind, error: 'task not found' };

      const before = priorValues(row as Record<string, unknown>, Object.keys(patch));

      const { error: updErr } = await admin
        .from('tasks')
        .update(patch)
        .eq('id', taskId)
        .eq('user_id', userId);
      if (updErr) return { ok: false, kind, error: updErr.message };

      // The drafted chase text is not a column — it lives in the log so the
      // owner can read and copy it.
      const after: Record<string, unknown> = { ...patch };
      const message = str(input.message);
      if (kind === 'chase_logged' && message) after.message = message;

      const logged = await logAction(admin, userId, runId, input, {
        target: { type: 'task', id: taskId },
        before,
        after,
      });
      if ('error' in logged) {
        await admin.from('tasks').update(before).eq('id', taskId);
        return { ok: false, kind, error: logged.error };
      }
      return { ok: true, kind, actionId: logged.id, targetId: taskId };
    }

    case 'task_delete': {
      const taskId = str(input.taskId);
      if (!taskId) return { ok: false, kind, error: 'taskId is required' };

      const { data: row, error: readErr } = await admin
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .maybeSingle();
      if (readErr) return { ok: false, kind, error: readErr.message };
      if (!row) return { ok: false, kind, error: 'task not found' };

      // Log before deleting: the whole row is the only way back.
      const logged = await logAction(admin, userId, runId, input, {
        target: { type: 'task', id: taskId },
        before: row as Record<string, unknown>,
        after: null,
      });
      if ('error' in logged) return { ok: false, kind, error: logged.error };

      const { error: delErr } = await admin
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .eq('user_id', userId);
      if (delErr) {
        await admin.from('agent_actions').delete().eq('id', logged.id);
        return { ok: false, kind, error: delErr.message };
      }
      return { ok: true, kind, actionId: logged.id, targetId: taskId };
    }

    case 'focus_reorder': {
      const focusQueue = input.focusQueue;
      if (!isRecord(focusQueue)) {
        return { ok: false, kind, error: 'focusQueue must be an object' };
      }

      const { data: profile, error: readErr } = await admin
        .from('profiles')
        .select('focus_queue')
        .eq('user_id', userId)
        .maybeSingle();
      if (readErr) return { ok: false, kind, error: readErr.message };

      const before = { focus_queue: profile?.focus_queue ?? null };

      const { error: updErr } = await admin
        .from('profiles')
        .update({ focus_queue: focusQueue })
        .eq('user_id', userId);
      if (updErr) return { ok: false, kind, error: updErr.message };

      const logged = await logAction(admin, userId, runId, input, {
        target: { type: 'profile' },
        before,
        after: { focus_queue: focusQueue },
      });
      if ('error' in logged) {
        await admin.from('profiles').update(before).eq('user_id', userId);
        return { ok: false, kind, error: logged.error };
      }
      return { ok: true, kind, actionId: logged.id };
    }

    case 'memory_write': {
      const key = str(input.key);
      const content = str(input.content);
      if (!key || !content) return { ok: false, kind, error: 'key and content are required' };

      const { data: existing } = await admin
        .from('agent_memory')
        .select('*')
        .eq('user_id', userId)
        .eq('key', key)
        .maybeSingle();

      const memoryKind = str(input.memoryKind) ?? 'observation';
      const confidence = str(input.confidence) ?? 'medium';
      const row = {
        user_id: userId,
        key,
        content,
        kind: memoryKind,
        confidence,
        pinned: input.pinned === true,
        source_run_id: runId,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await admin
        .from('agent_memory')
        .upsert(row, { onConflict: 'user_id,key' });
      if (upsertErr) return { ok: false, kind, error: upsertErr.message };

      const logged = await logAction(admin, userId, runId, input, {
        target: { type: 'memory', key },
        before: (existing as Record<string, unknown> | null) ?? null,
        after: row,
      });
      if ('error' in logged) return { ok: false, kind, error: logged.error };
      return { ok: true, kind, actionId: logged.id };
    }

    default:
      return { ok: false, kind, error: `unknown action kind "${kind}"` };
  }
}

// ---------------------------------------------------------------------------
// Context snapshot
// ---------------------------------------------------------------------------

async function buildContext(admin: SupabaseClient, userId: string) {
  const { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const timezone = (profile?.timezone as string | null) ?? 'UTC';
  const now = new Date();
  const today = localDateString(now, timezone);

  // Calendar window: from the start of today through a week out.
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  // Recently-done tasks give the agent a sense of momentum without pulling
  // the entire history.
  const doneSince = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const [tasksRes, eventsRes, debriefRes, memoryRes, runsRes, actionsRes] = await Promise.all([
    admin
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .or(`done.eq.false,updated_at.gte.${doneSince}`)
      .order('updated_at', { ascending: false })
      .limit(400),
    admin
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .gte('start_at', windowStart)
      .lte('start_at', windowEnd)
      .order('start_at', { ascending: true })
      .limit(200),
    admin
      .from('meeting_debrief_states')
      .select('*')
      .eq('user_id', userId)
      .gte('occurrence_start_at', windowStart)
      .limit(100),
    admin
      .from('agent_memory')
      .select('*')
      .eq('user_id', userId)
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(200),
    admin
      .from('agent_runs')
      .select('id, kind, status, summary, stats, started_at, finished_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(10),
    // What the agent already did recently, so it does not repeat itself.
    admin
      .from('agent_actions')
      .select('kind, title, dedupe_key, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(80),
  ]);

  return {
    now: now.toISOString(),
    today,
    timezone,
    playbook: (profile?.agent_playbook as string | null) ?? null,
    profile: profile
      ? {
          first_name: profile.first_name,
          timezone: profile.timezone,
          enabled_addons: profile.enabled_addons,
          focus_queue: profile.focus_queue,
          meeting_rules: profile.meeting_rules,
          agent_last_run_at: profile.agent_last_run_at,
        }
      : null,
    tasks: tasksRes.data ?? [],
    events: eventsRes.data ?? [],
    debriefStates: debriefRes.data ?? [],
    memory: memoryRes.data ?? [],
    recentRuns: runsRes.data ?? [],
    recentActions: actionsRes.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('AGENT_SECRET');
  const userId = Deno.env.get('AGENT_USER_ID');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!expectedSecret || !userId || !supabaseUrl || !serviceKey) {
    return jsonResponse(
      {
        error:
          'Server misconfigured. Needs AGENT_SECRET, AGENT_USER_ID, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      500,
    );
  }

  const presented = req.headers.get('x-agent-secret');
  if (!presented || presented !== expectedSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const action = str(body.action) ?? 'context';

  try {
    switch (action) {
      case 'context': {
        return jsonResponse({ ok: true, context: await buildContext(admin, userId) });
      }

      case 'run.start': {
        const kind = str(body.kind) ?? 'adhoc';
        const triggerSource = str(body.triggerSource) ?? 'scheduled';
        const { data, error } = await admin
          .from('agent_runs')
          .insert({ user_id: userId, kind, trigger_source: triggerSource, status: 'running' })
          .select('id')
          .single();
        if (error || !data) {
          return jsonResponse({ error: error?.message ?? 'Could not start run' }, 500);
        }
        await admin
          .from('profiles')
          .update({ agent_last_run_at: new Date().toISOString() })
          .eq('user_id', userId);
        return jsonResponse({ ok: true, runId: data.id });
      }

      case 'run.finish': {
        const runId = str(body.runId);
        if (!runId) return jsonResponse({ error: 'runId is required' }, 400);
        const status = str(body.status) === 'error' ? 'error' : 'ok';
        const { error } = await admin
          .from('agent_runs')
          .update({
            status,
            summary: str(body.summary),
            stats: isRecord(body.stats) ? body.stats : {},
            error: str(body.error),
            finished_at: new Date().toISOString(),
          })
          .eq('id', runId)
          .eq('user_id', userId);
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      }

      case 'act': {
        const runId = str(body.runId);
        const raw = Array.isArray(body.actions) ? body.actions : [];
        if (raw.length === 0) return jsonResponse({ error: 'actions must be a non-empty array' }, 400);
        if (raw.length > 50) return jsonResponse({ error: 'at most 50 actions per call' }, 400);

        const results: ActionResult[] = [];
        for (const entry of raw) {
          if (!isRecord(entry) || typeof entry.kind !== 'string') {
            results.push({ ok: false, kind: 'unknown', error: 'each action needs a kind' });
            continue;
          }
          // Sequential on purpose: dedupe checks and before-state reads must
          // see the effects of earlier actions in the same batch.
          results.push(
            await performAction(admin, userId, runId, entry as ActionInput),
          );
        }
        const applied = results.filter((r) => r.ok && !r.skipped).length;
        return jsonResponse({ ok: true, applied, results });
      }

      case 'brief.write': {
        const kind = str(body.kind);
        const bodyText = str(body.body);
        if (kind !== 'morning' && kind !== 'evening') {
          return jsonResponse({ error: "kind must be 'morning' or 'evening'" }, 400);
        }
        if (!bodyText) return jsonResponse({ error: 'body is required' }, 400);

        const { data: profile } = await admin
          .from('profiles')
          .select('timezone')
          .eq('user_id', userId)
          .maybeSingle();
        const tz = (profile?.timezone as string | null) ?? 'UTC';
        const briefDate = str(body.briefDate) ?? localDateString(new Date(), tz);

        const { error } = await admin.from('agent_briefs').upsert(
          {
            user_id: userId,
            run_id: str(body.runId),
            kind,
            brief_date: briefDate,
            body: bodyText,
            stats: isRecord(body.stats) ? body.stats : {},
          },
          { onConflict: 'user_id,kind,brief_date' },
        );
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: `Unknown action "${action}"` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed';
    return jsonResponse({ error: msg }, 500);
  }
});
