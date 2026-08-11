#!/usr/bin/env node
/**
 * The executive-assistant agent runner.
 *
 * Runs on a GitHub Actions cron. Reads a context snapshot from the `agent-api`
 * Edge Function, thinks with the Anthropic API, then writes changes back
 * through the same function — where each one is logged with its prior state so
 * Mike can undo it from `/agent`.
 *
 * Why here and not in a Cowork session: scheduled Cowork sessions run behind an
 * egress allowlist that does not include *.supabase.co, so they cannot reach
 * this workspace at all. Actions runners have unrestricted network.
 *
 * Zero dependencies on purpose — Node 20+ has everything this needs, and a
 * scheduled job that breaks on a transitive dependency update is worse than no
 * scheduled job.
 *
 * Env:
 *   ANTHROPIC_API_KEY  required
 *   AGENT_API_URL      required, .../functions/v1/agent-api
 *   AGENT_SECRET       required, matches the function's AGENT_SECRET
 *   AGENT_RUN_KIND     morning_brief | midday_triage | evening_closeout | chase_sweep | adhoc
 *   AGENT_MODEL        optional, defaults to claude-sonnet-5
 *   AGENT_DRY_RUN      optional, "1" to think and log but skip all writes
 */

const API_URL = requireEnv('AGENT_API_URL');
const AGENT_SECRET = requireEnv('AGENT_SECRET');
const ANTHROPIC_API_KEY = requireEnv('ANTHROPIC_API_KEY');
const RUN_KIND = process.env.AGENT_RUN_KIND || 'adhoc';
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-5';
const DRY_RUN = process.env.AGENT_DRY_RUN === '1';

const MAX_TURNS = 10;
const MAX_TOKENS = 8000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

// ---------------------------------------------------------------------------
// agent-api
// ---------------------------------------------------------------------------

async function api(action, payload = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-agent-secret': AGENT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`agent-api ${action} returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`agent-api ${action} failed (${res.status}): ${json.error ?? text.slice(0, 300)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Context trimming
//
// The raw snapshot can run to hundreds of rows. Sending all of it costs money
// and buries the signal, so pass only the fields that actually inform a
// decision.
// ---------------------------------------------------------------------------

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null) out[k] = obj[k];
  return out;
}

const TASK_FIELDS = [
  'id', 'title', 'done', 'priority', 'due_date', 'due_time', 'tags',
  'estimated_minutes', 'waiting_on', 'last_chased_at', 'chase_snoozed_until',
  'reschedule_count', 'linked_event_id', 'created_at', 'updated_at',
];

const EVENT_FIELDS = [
  'id', 'title', 'start_at', 'end_at', 'source', 'prep_required',
  'debrief_required', 'allow_back_to_back', 'location',
];

function slimContext(ctx) {
  return {
    now: ctx.now,
    today: ctx.today,
    timezone: ctx.timezone,
    profile: ctx.profile,
    tasks: (ctx.tasks ?? []).map((t) => {
      const slim = pick(t, TASK_FIELDS);
      if (t.description) slim.description = String(t.description).slice(0, 300);
      return slim;
    }),
    events: (ctx.events ?? []).map((e) => pick(e, EVENT_FIELDS)),
    debriefStates: ctx.debriefStates ?? [],
    memory: (ctx.memory ?? []).map((m) => pick(m, ['key', 'kind', 'content', 'confidence', 'pinned', 'updated_at'])),
    recentRuns: (ctx.recentRuns ?? []).map((r) => pick(r, ['kind', 'status', 'summary', 'started_at'])),
    recentActions: ctx.recentActions ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'act',
    description:
      'Apply a batch of changes to the workspace. Each change is recorded with its prior state so it can be undone from the app. Set dedupeKey on every action so reruns do not repeat work. Returns a per-action result including any that were skipped as duplicates.',
    input_schema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Up to 50 changes to apply, in order.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'task_create', 'task_update', 'task_complete', 'task_delete',
                  'focus_reorder', 'chase_logged', 'memory_write',
                ],
              },
              title: { type: 'string', description: 'Scannable one-line summary, e.g. "Bumped Q3 forecast to Important".' },
              rationale: { type: 'string', description: 'One sentence justifying the change.' },
              effects: {
                type: 'array',
                items: { type: 'string' },
                description: 'Mechanical detail, e.g. ["Priority: Routine -> Important"].',
              },
              category: { type: 'string' },
              dedupeKey: { type: 'string', description: 'Stable for once-only work; time-bucketed (e.g. chase:<id>:2026-W33) for recurring.' },
              taskId: { type: 'string' },
              task: {
                type: 'object',
                description: 'For task_create. Raw column names: title, priority, due_date, due_time, tags, estimated_minutes, description, waiting_on, linked_event_id.',
              },
              patch: {
                type: 'object',
                description: 'For task_update. Raw column names only.',
              },
              message: { type: 'string', description: 'For chase_logged: the drafted chase text, ready to send as-is.' },
              focusQueue: { type: 'object', description: 'For focus_reorder: full replacement { stack: [...], snoozedUntil: {...} }.' },
              key: { type: 'string', description: 'For memory_write: stable slug.' },
              content: { type: 'string', description: 'For memory_write: what to remember.' },
              memoryKind: { type: 'string', enum: ['preference', 'pattern', 'fact', 'observation', 'correction'] },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
              pinned: { type: 'boolean' },
            },
            required: ['kind', 'title'],
          },
        },
      },
      required: ['actions'],
    },
  },
  {
    name: 'write_brief',
    description: 'Write the morning brief or evening close-out. Markdown. Lead with the answer; no preamble.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['morning', 'evening'] },
        body: { type: 'string' },
      },
      required: ['kind', 'body'],
    },
  },
  {
    name: 'finish_run',
    description: 'End the run. Call this exactly once, last.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One or two sentences shown above this run in the activity log.' },
        stats: { type: 'object' },
      },
      required: ['summary'],
    },
  },
];

const FALLBACK_PLAYBOOK = `You are Mike's executive assistant. No playbook has been saved yet, so be
conservative: observe and write memory, and make only changes you could defend
in one sentence. Mention in your run summary that the playbook is empty and
should be filled in at /agent -> Playbook.`;

function buildSystemPrompt(playbook, runKind) {
  return `${playbook || FALLBACK_PLAYBOOK}

---

## This run

Run kind: **${runKind}**.

- \`morning_brief\` — triage the day ahead, then write the morning brief.
- \`midday_triage\` — catch drift: overcommitment, missing estimates, meetings without prep.
- \`evening_closeout\` — what slipped, what carries forward, then write the evening brief.
- \`chase_sweep\` — focus on owed-to-me items that have gone stale.
- \`adhoc\` — use judgement.

## How to work

1. Read the context. It includes \`recentActions\` — everything you recently did.
2. **Check for undone actions.** Status \`undone\` means Mike reversed you. That is
   the most valuable signal you get: do not redo it, and write a \`memory_write\`
   with kind \`correction\` recording what you learned.
3. Batch your changes into as few \`act\` calls as possible.
4. Set \`dedupeKey\` on every single action.
5. Call \`finish_run\` once, at the end, with a summary Mike can read in two seconds.

Quality bar: one good change beats five mediocre ones. A noisy log is an ignored
log. If nothing genuinely needs doing, change nothing and say so in the summary —
that is a perfectly good run.${DRY_RUN ? '\n\n**DRY RUN**: writes are disabled. Describe what you would do.' : ''}`;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function callClaude(system, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: TOOLS,
      messages,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function runTool(name, input, runId) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${name}`, JSON.stringify(input).slice(0, 500));
    return { ok: true, dryRun: true };
  }

  switch (name) {
    case 'act': {
      const actions = Array.isArray(input.actions) ? input.actions : [];
      if (actions.length === 0) return { ok: true, applied: 0, results: [] };
      return await api('act', { runId, actions });
    }
    case 'write_brief':
      return await api('brief.write', { runId, kind: input.kind, body: input.body });
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Starting ${RUN_KIND} run with ${MODEL}${DRY_RUN ? ' (dry run)' : ''}`);

  const { context } = await api('context');
  console.log(
    `Context: ${context.tasks?.length ?? 0} tasks, ${context.events?.length ?? 0} events, ` +
      `${context.memory?.length ?? 0} memories, playbook ${context.playbook ? 'present' : 'EMPTY'}`,
  );

  const { runId } = await api('run.start', { kind: RUN_KIND, triggerSource: 'scheduled' });
  console.log(`Run ${runId}`);

  let summary = 'Run ended without a summary.';
  let stats = {};
  let status = 'ok';

  try {
    const system = buildSystemPrompt(context.playbook, RUN_KIND);
    const messages = [
      {
        role: 'user',
        content: `Here is the current state of the workspace.\n\n\`\`\`json\n${JSON.stringify(
          slimContext(context),
          null,
          1,
        )}\n\`\`\`\n\nWork this ${RUN_KIND} run.`,
      },
    ];

    let finished = false;

    for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
      const reply = await callClaude(system, messages);
      messages.push({ role: 'assistant', content: reply.content });

      for (const block of reply.content) {
        if (block.type === 'text' && block.text.trim()) {
          console.log(`[thinking] ${block.text.trim().slice(0, 400)}`);
        }
      }

      if (reply.stop_reason !== 'tool_use') {
        // Model stopped without calling finish_run — take its last words.
        const lastText = reply.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
        if (lastText) summary = lastText.slice(0, 500);
        break;
      }

      const toolResults = [];
      for (const block of reply.content) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'finish_run') {
          summary = block.input.summary ?? summary;
          stats = block.input.stats ?? {};
          finished = true;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'ok' });
          continue;
        }

        try {
          const result = await runTool(block.name, block.input, runId);
          console.log(`[${block.name}] ${JSON.stringify(result).slice(0, 400)}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        } catch (e) {
          // Hand the failure back so the model can adapt rather than die.
          console.error(`[${block.name}] failed: ${e.message}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${e.message}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  } catch (e) {
    status = 'error';
    summary = `Run failed: ${e.message}`;
    console.error(e);
  }

  await api('run.finish', {
    runId,
    status,
    summary,
    stats,
    error: status === 'error' ? summary : null,
  });

  console.log(`Finished (${status}): ${summary}`);
  if (status === 'error') process.exit(1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
