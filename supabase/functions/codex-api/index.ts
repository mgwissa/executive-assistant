/**
 * codex-api — explicit, audited workspace operations behind the hosted MCP server.
 *
 * Auth uses Supabase OAuth access tokens issued to MCP clients. The token's
 * verified user and client_id claims identify both the workspace owner and the
 * agent connection. This endpoint is deliberately narrower than the dormant
 * scheduled agent: no polling, task deletion, legacy priority mutation, or
 * arbitrary rich-note rewriting.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { localDateString } from '../_shared/datetime.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const TASK_WRITABLE = new Set([
  'title',
  'done',
  'due_date',
  'review_date',
  'due_time',
  'tags',
  'estimated_minutes',
  'description',
  'waiting_on',
]);

type JsonRecord = Record<string, unknown>;

type AgentPrincipal = {
  userId: string;
  connectionId: string | null;
  actorName: string;
  scopes: string[];
};

type MutationInput = {
  kind: string;
  title?: unknown;
  rationale?: unknown;
  effects?: unknown;
  dedupeKey?: unknown;
  taskId?: unknown;
  task?: unknown;
  patch?: unknown;
  taskIds?: unknown;
  focusItems?: unknown;
  noteId?: unknown;
  triaged?: unknown;
  sectionId?: unknown;
  content?: unknown;
  linkedEventId?: unknown;
  linkedOccurrenceStartAt?: unknown;
  brief?: unknown;
};

type MutationResult = {
  ok: boolean;
  kind: string;
  actionId?: string;
  targetId?: string;
  skipped?: 'duplicate';
  error?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function dateOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function timeOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ? value.slice(0, 5) : undefined;
}

function truncate(value: unknown, length: number): string {
  const text = typeof value === 'string' ? value : '';
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

function sanitizeNoteText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/gi, '[embedded image omitted]')
    .replace(/<img\b[^>]*\bsrc=["']data:image\/[^"']+["'][^>]*>/gi, '[embedded image omitted]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi, '[embedded image omitted]');
}

function noteTextBlock(type: string, text: string, extraProps: JsonRecord = {}): JsonRecord {
  return {
    id: crypto.randomUUID(),
    type,
    props: {
      textColor: 'default',
      backgroundColor: 'default',
      textAlignment: 'left',
      ...extraProps,
    },
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    children: [],
  };
}

/**
 * Convert the deliberately small Markdown surface accepted by note_append to
 * BlockNote-compatible blocks. Existing canonical blocks are never parsed or
 * rewritten; these blocks are added to the end of the stored document.
 */
function appendMarkdownBlocks(markdown: string): JsonRecord[] | { error: string } {
  const blocks: JsonRecord[] = [];
  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(noteTextBlock('heading', heading[2], { level: Math.min(heading[1].length, 3) }));
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push(noteTextBlock('bulletListItem', bullet[1]));
      continue;
    }

    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      blocks.push(noteTextBlock('numberedListItem', numbered[1]));
      continue;
    }

    blocks.push(noteTextBlock('paragraph', line));
  }

  if (blocks.length === 0) return { error: 'content must contain visible text' };
  if (blocks.length > 500) return { error: 'content contains too many blocks' };
  return blocks;
}

function localClock(now: Date, timezone: string): { weekday: string; hour: number; minute: number; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: 'weekday' | 'hour' | 'minute') => parts.find((entry) => entry.type === type)?.value ?? '';
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));
  return {
    weekday: part('weekday'),
    hour,
    minute,
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function priorValues(row: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
}

function taskPatch(raw: unknown): JsonRecord | { error: string } {
  if (!isRecord(raw)) return { error: 'patch must be an object' };
  const patch: JsonRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TASK_WRITABLE.has(key)) continue;
    if (key === 'title') {
      const title = str(value);
      if (!title || title.length > 200) return { error: 'title must be 1–200 characters' };
      patch.title = title;
      continue;
    }
    if (key === 'due_date' || key === 'review_date') {
      const parsed = dateOrNull(value);
      if (parsed === undefined) return { error: `${key} must be YYYY-MM-DD or null` };
      patch[key] = parsed;
      continue;
    }
    if (key === 'due_time') {
      const parsed = timeOrNull(value);
      if (parsed === undefined) return { error: 'due_time must be HH:MM or null' };
      patch.due_time = parsed;
      continue;
    }
    if (key === 'done') {
      if (typeof value !== 'boolean') return { error: 'done must be boolean' };
      patch.done = value;
      continue;
    }
    if (key === 'estimated_minutes') {
      if (value !== null && (typeof value !== 'number' || value < 1 || value > 480)) {
        return { error: 'estimated_minutes must be 1–480 or null' };
      }
      patch.estimated_minutes = value;
      continue;
    }
    if (key === 'tags') {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
        return { error: 'tags must be a string array' };
      }
      patch.tags = value.slice(0, 20).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    if (key === 'description' && typeof value === 'string' && value.length > 50_000) {
      return { error: 'description is too large' };
    }
    if (key === 'waiting_on' && typeof value === 'string' && value.length > 120) {
      return { error: 'waiting_on must be at most 120 characters' };
    }
    if (value === null || typeof value === 'string') patch[key] = value;
  }
  if ('due_date' in patch && patch.due_date === null) {
    patch.due_time = null;
    patch.reminder_sent_at = null;
  }
  return patch;
}

async function logAction(
  admin: SupabaseClient,
  principal: AgentPrincipal,
  runId: string,
  input: MutationInput,
  fields: { target: JsonRecord; before: JsonRecord | null; after: JsonRecord | null },
): Promise<{ id: string } | { error: string }> {
  const effects = Array.isArray(input.effects)
    ? input.effects.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
    : [];
  const { data, error } = await admin
    .from('agent_actions')
    .insert({
      user_id: principal.userId,
      run_id: runId,
      agent_connection_id: principal.connectionId,
      actor_name: principal.actorName,
      kind: input.kind,
      title: str(input.title) ?? input.kind,
      rationale: str(input.rationale),
      effects,
      target: fields.target,
      before: fields.before,
      after: fields.after,
      category: 'codex',
      status: 'applied',
      dedupe_key: str(input.dedupeKey),
    })
    .select('id')
    .single();
  return error || !data ? { error: error?.message ?? 'Could not write audit entry' } : { id: data.id };
}

async function mutate(
  admin: SupabaseClient,
  principal: AgentPrincipal,
  runId: string,
  input: MutationInput,
): Promise<MutationResult> {
  const userId = principal.userId;
  const kind = input.kind;
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

  if (kind === 'task_create') {
    const source = isRecord(input.task) ? input.task : {};
    const title = str(source.title);
    if (!title || title.length > 200) return { ok: false, kind, error: 'task.title must be 1–200 characters' };
    const patchResult = taskPatch(source);
    if ('error' in patchResult) return { ok: false, kind, error: patchResult.error };
    const now = new Date().toISOString();
    if (patchResult.due_time && !patchResult.due_date) {
      return { ok: false, kind, error: 'due_time requires due_date' };
    }
    const insert = {
      ...patchResult,
      user_id: userId,
      title,
      done: false,
      priority: 'normal',
      priority_set_at: now,
    };
    const { data, error } = await admin.from('tasks').insert(insert).select('*').single();
    if (error || !data) return { ok: false, kind, error: error?.message ?? 'Task insert failed' };
    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'task', id: data.id },
      before: null,
      after: data as JsonRecord,
    });
    if ('error' in logged) {
      await admin.from('tasks').delete().eq('id', data.id);
      return { ok: false, kind, error: logged.error };
    }
    return { ok: true, kind, actionId: logged.id, targetId: data.id };
  }

  if (kind === 'task_update' || kind === 'task_complete') {
    const taskId = str(input.taskId);
    if (!taskId) return { ok: false, kind, error: 'taskId is required' };
    const patchResult = kind === 'task_complete' ? { done: true } : taskPatch(input.patch);
    if ('error' in patchResult) return { ok: false, kind, error: patchResult.error };
    if (Object.keys(patchResult).length === 0) return { ok: false, kind, error: 'nothing writable in patch' };
    const { data: row, error: readError } = await admin
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .maybeSingle();
    if (readError || !row) return { ok: false, kind, error: readError?.message ?? 'task not found' };
    const before = priorValues(row as JsonRecord, Object.keys(patchResult));
    const effectiveDueDate = 'due_date' in patchResult ? patchResult.due_date : row.due_date;
    if (patchResult.due_time && !effectiveDueDate) {
      return { ok: false, kind, error: 'due_time requires due_date' };
    }
    const { error: updateError } = await admin
      .from('tasks')
      .update(patchResult)
      .eq('id', taskId)
      .eq('user_id', userId);
    if (updateError) return { ok: false, kind, error: updateError.message };
    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'task', id: taskId },
      before,
      after: patchResult,
    });
    if ('error' in logged) {
      await admin.from('tasks').update(before).eq('id', taskId).eq('user_id', userId);
      return { ok: false, kind, error: logged.error };
    }
    return { ok: true, kind, actionId: logged.id, targetId: taskId };
  }

  if (kind === 'focus_reorder') {
    const focusItems: Array<{
      kind: 'task';
      taskId: string;
      reason?: string;
      nextAction?: string;
      mode?: 'deep_work' | 'quick_follow_up' | 'waiting';
    }> = [];

    if (Array.isArray(input.focusItems)) {
      for (const raw of input.focusItems) {
        if (!isRecord(raw)) return { ok: false, kind, error: 'each focus item must be an object' };
        const taskId = str(raw.taskId);
        if (!taskId) return { ok: false, kind, error: 'each focus item requires taskId' };
        if (raw.reason != null && typeof raw.reason !== 'string') {
          return { ok: false, kind, error: 'focus reason must be text' };
        }
        if (raw.nextAction != null && typeof raw.nextAction !== 'string') {
          return { ok: false, kind, error: 'focus nextAction must be text' };
        }
        const reason = str(raw.reason);
        const nextAction = str(raw.nextAction);
        if (reason && reason.length > 280) return { ok: false, kind, error: 'focus reason is too long' };
        if (nextAction && nextAction.length > 240) return { ok: false, kind, error: 'focus nextAction is too long' };
        const mode = raw.mode;
        if (mode != null && mode !== 'deep_work' && mode !== 'quick_follow_up' && mode !== 'waiting') {
          return { ok: false, kind, error: 'focus mode must be deep_work, quick_follow_up, or waiting' };
        }
        focusItems.push({
          kind: 'task',
          taskId,
          ...(reason ? { reason } : {}),
          ...(nextAction ? { nextAction } : {}),
          ...(mode ? { mode } : {}),
        });
      }
    } else if (Array.isArray(input.taskIds) && input.taskIds.every((id) => typeof id === 'string')) {
      focusItems.push(...input.taskIds.map((taskId) => ({ kind: 'task' as const, taskId })));
    } else {
      return { ok: false, kind, error: 'focusItems or taskIds must be an array' };
    }

    const uniqueFocusItems = [...new Map(focusItems.map((item) => [item.taskId, item])).values()].slice(0, 6);
    const taskIds = uniqueFocusItems.map((item) => item.taskId);
    if (taskIds.length > 0) {
      const { data: owned, error } = await admin
        .from('tasks')
        .select('id')
        .eq('user_id', userId)
        .eq('done', false)
        .in('id', taskIds);
      if (error) return { ok: false, kind, error: error.message };
      if ((owned ?? []).length !== taskIds.length) return { ok: false, kind, error: 'focus contains an unknown or completed task' };
    }
    const { data: profile, error: readError } = await admin
      .from('profiles')
      .select('focus_queue')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) return { ok: false, kind, error: readError.message };
    const existing = isRecord(profile?.focus_queue) ? profile.focus_queue : {};
    const focusQueue = {
      stack: uniqueFocusItems,
      snoozedUntil: isRecord(existing.snoozedUntil) ? existing.snoozedUntil : {},
      managedBy: 'codex',
      updatedAt: new Date().toISOString(),
    };
    const before = { focus_queue: profile?.focus_queue ?? null };
    const { error: updateError } = await admin
      .from('profiles')
      .update({ focus_queue: focusQueue })
      .eq('user_id', userId);
    if (updateError) return { ok: false, kind, error: updateError.message };
    const logged = await logAction(admin, principal, runId, input, {
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

  if (kind === 'note_create') {
    const sectionId = str(input.sectionId);
    const title = str(input.title);
    const content = str(input.content);
    if (!sectionId || !title || !content) return { ok: false, kind, error: 'sectionId, title, and content are required' };
    if (title.length > 200 || content.length > 50_000) return { ok: false, kind, error: 'note is too large' };
    const { data: section } = await admin
      .from('sections')
      .select('id')
      .eq('id', sectionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!section) return { ok: false, kind, error: 'section not found' };
    const linkedEventId = str(input.linkedEventId);
    if (linkedEventId) {
      const { data: event } = await admin
        .from('events')
        .select('id')
        .eq('id', linkedEventId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!event) return { ok: false, kind, error: 'linked event not found' };
    }
    const insert = {
      user_id: userId,
      section_id: sectionId,
      title,
      content,
      content_blocks: null,
      linked_event_id: linkedEventId,
      linked_occurrence_start_at: str(input.linkedOccurrenceStartAt),
    };
    const { data, error } = await admin.from('notes').insert(insert).select('*').single();
    if (error || !data) return { ok: false, kind, error: error?.message ?? 'Note insert failed' };
    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'note', id: data.id },
      before: null,
      after: data as JsonRecord,
    });
    if ('error' in logged) {
      await admin.from('notes').delete().eq('id', data.id);
      return { ok: false, kind, error: logged.error };
    }
    return { ok: true, kind, actionId: logged.id, targetId: data.id };
  }

  if (kind === 'note_append') {
    const noteId = str(input.noteId);
    const content = str(input.content);
    if (!noteId || !content) return { ok: false, kind, error: 'noteId and content are required' };
    if (content.length > 20_000) return { ok: false, kind, error: 'append content is too large' };
    if (sanitizeNoteText(content) !== content) {
      return { ok: false, kind, error: 'embedded image data is not supported in note appends' };
    }

    const appendedBlocks = appendMarkdownBlocks(content);
    if ('error' in appendedBlocks) return { ok: false, kind, error: appendedBlocks.error };

    const { data: existing, error: readError } = await admin
      .from('notes')
      .select('id,content,content_blocks,updated_at')
      .eq('id', noteId)
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) return { ok: false, kind, error: readError.message };
    if (!existing) return { ok: false, kind, error: 'note not found' };

    const currentContent = typeof existing.content === 'string' ? existing.content.trimEnd() : '';
    const nextContent = currentContent ? `${currentContent}\n\n${content}` : content;
    if (nextContent.length > 50_000) return { ok: false, kind, error: 'resulting note is too large' };

    const currentBlocks = Array.isArray(existing.content_blocks) ? existing.content_blocks : null;
    const nextBlocks = currentBlocks && currentBlocks.length > 0
      ? [...currentBlocks, ...appendedBlocks]
      : existing.content_blocks;
    const before = {
      content: existing.content,
      content_blocks: existing.content_blocks,
    };
    const patch = { content: nextContent, content_blocks: nextBlocks };
    const { data, error } = await admin
      .from('notes')
      .update(patch)
      .eq('id', noteId)
      .eq('user_id', userId)
      .eq('updated_at', existing.updated_at)
      .select('content,content_blocks,updated_at')
      .maybeSingle();
    if (error) return { ok: false, kind, error: error.message };
    if (!data) {
      return { ok: false, kind, error: 'note changed while context was being appended; reload it and try again' };
    }

    const after = {
      content: data.content,
      content_blocks: data.content_blocks,
      updated_at: data.updated_at,
    };
    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'note', id: noteId },
      before,
      after,
    });
    if ('error' in logged) {
      const { error: rollbackError } = await admin
        .from('notes')
        .update(before)
        .eq('id', noteId)
        .eq('user_id', userId)
        .eq('updated_at', data.updated_at);
      const suffix = rollbackError ? `; rollback also failed: ${rollbackError.message}` : '';
      return { ok: false, kind, error: `${logged.error}${suffix}` };
    }
    return { ok: true, kind, actionId: logged.id, targetId: noteId };
  }

  if (kind === 'note_triage') {
    const noteId = str(input.noteId);
    if (!noteId || typeof input.triaged !== 'boolean') {
      return { ok: false, kind, error: 'noteId and boolean triaged are required' };
    }
    const { data: existing, error: readError } = await admin
      .from('notes')
      .select('id,linked_event_id,triaged_at,updated_at')
      .eq('id', noteId)
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) return { ok: false, kind, error: readError.message };
    if (!existing?.linked_event_id) return { ok: false, kind, error: 'owned meeting note not found' };

    const triagedAt = input.triaged ? new Date().toISOString() : null;
    const before = { triaged_at: existing.triaged_at };
    const { data, error } = await admin
      .from('notes')
      .update({ triaged_at: triagedAt })
      .eq('id', noteId)
      .eq('user_id', userId)
      .eq('updated_at', existing.updated_at)
      .select('triaged_at,updated_at')
      .maybeSingle();
    if (error) return { ok: false, kind, error: error.message };
    if (!data) return { ok: false, kind, error: 'note changed while triage was being updated; reload it and try again' };

    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'note', id: noteId },
      before,
      after: { triaged_at: data.triaged_at, updated_at: data.updated_at },
    });
    if ('error' in logged) {
      const { error: rollbackError } = await admin
        .from('notes')
        .update(before)
        .eq('id', noteId)
        .eq('user_id', userId)
        .eq('updated_at', data.updated_at);
      const suffix = rollbackError ? `; rollback also failed: ${rollbackError.message}` : '';
      return { ok: false, kind, error: `${logged.error}${suffix}` };
    }
    return { ok: true, kind, actionId: logged.id, targetId: noteId };
  }

  if (kind === 'brief_write') {
    const source = isRecord(input.brief) ? input.brief : {};
    const briefKind = str(source.kind);
    const briefDate = dateOrNull(source.brief_date);
    const body = str(source.body);
    if (briefKind !== 'morning' && briefKind !== 'evening') {
      return { ok: false, kind, error: 'brief.kind must be morning or evening' };
    }
    if (!briefDate) return { ok: false, kind, error: 'brief.brief_date must be YYYY-MM-DD' };
    if (!body || body.length > 20_000) return { ok: false, kind, error: 'brief.body must be 1–20,000 characters' };
    const stats = isRecord(source.stats) ? source.stats : {};
    const { data: existing, error: readError } = await admin
      .from('agent_briefs')
      .select('*')
      .eq('user_id', userId)
      .eq('kind', briefKind)
      .eq('brief_date', briefDate)
      .maybeSingle();
    if (readError) return { ok: false, kind, error: readError.message };
    const payload = {
      user_id: userId,
      run_id: runId,
      kind: briefKind,
      brief_date: briefDate,
      body,
      stats,
      read_at: null,
    };
    const { data, error } = await admin
      .from('agent_briefs')
      .upsert(payload, { onConflict: 'user_id,kind,brief_date' })
      .select('*')
      .single();
    if (error || !data) return { ok: false, kind, error: error?.message ?? 'Brief write failed' };
    const logged = await logAction(admin, principal, runId, input, {
      target: { type: 'brief', id: data.id },
      before: existing ? existing as JsonRecord : null,
      after: data as JsonRecord,
    });
    if ('error' in logged) {
      if (existing) {
        await admin.from('agent_briefs').upsert(existing, { onConflict: 'user_id,kind,brief_date' });
      } else {
        await admin.from('agent_briefs').delete().eq('id', data.id).eq('user_id', userId);
      }
      return { ok: false, kind, error: logged.error };
    }
    return { ok: true, kind, actionId: logged.id, targetId: data.id };
  }

  return { ok: false, kind, error: `unsupported mutation kind "${kind}"` };
}

async function buildContext(admin: SupabaseClient, userId: string) {
  const { data: profile } = await admin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  const timezone = (profile?.timezone as string | null) ?? 'UTC';
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const doneSince = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const [tasksRes, eventsRes, notebooksRes, sectionsRes, notesRes, workstreamsRes, noteWorkstreamsRes, actionsRes, briefsRes] = await Promise.all([
    admin.from('tasks').select('*').eq('user_id', userId).or(`done.eq.false,updated_at.gte.${doneSince}`).order('updated_at', { ascending: false }).limit(400),
    admin.from('events').select('*').eq('user_id', userId).gte('start_at', windowStart).lte('start_at', windowEnd).order('start_at').limit(250),
    admin.from('notebooks').select('id,name,position').eq('user_id', userId).order('position'),
    admin.from('sections').select('id,notebook_id,name,position').eq('user_id', userId).order('position'),
    admin.from('notes').select('id,title,content,linked_event_id,linked_occurrence_start_at,triaged_at,updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(80),
    admin.from('workstreams').select('id,name,description,status,position').eq('user_id', userId).order('position'),
    admin.from('note_workstreams').select('workstream_id,note_id').eq('user_id', userId),
    admin.from('agent_actions').select('id,kind,title,rationale,effects,status,actor_name,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    admin.from('agent_briefs').select('id,kind,brief_date,body,stats,created_at').eq('user_id', userId).order('brief_date', { ascending: false }).limit(14),
  ]);

  const events = eventsRes.data ?? [];
  const eventIds = new Set(events.map((event) => event.id));
  const notes = (notesRes.data ?? []).map((note) => {
    const safeContent = sanitizeNoteText(note.content);
    return {
      ...note,
      content: eventIds.has(note.linked_event_id) ? truncate(safeContent, 12_000) : undefined,
      excerpt: truncate(safeContent, 800),
    };
  });
  const today = localDateString(now, timezone);
  const clock = localClock(now, timezone);
  const isWeekday = !['Sat', 'Sun'].includes(clock.weekday);
  const morningEligible = isWeekday && (clock.hour > 7 || (clock.hour === 7 && clock.minute >= 30));
  const morningComplete = (briefsRes.data ?? []).some(
    (brief) => brief.kind === 'morning' && brief.brief_date === today,
  );
  const pendingChecks = morningEligible && !morningComplete
    ? [{
      id: `morning_brief:${today}`,
      kind: 'morning_brief',
      localDate: today,
      eligibleAfter: '07:30',
      timezone,
      status: 'pending',
      instruction: 'Create today\'s morning brief and refresh the focus plan before responding to the user.',
    }]
    : [];
  const meetingNotesNeedingTriage = notes
    .filter((note) =>
      note.linked_event_id &&
      note.linked_occurrence_start_at &&
      !note.triaged_at &&
      note.excerpt.trim() !== '' &&
      new Date(note.linked_occurrence_start_at).getTime() + 30 * 60 * 1000 <= now.getTime()
    )
    .map((note) => ({
      id: note.id,
      title: note.title,
      occurrenceStartAt: note.linked_occurrence_start_at,
      excerpt: note.excerpt,
    }));

  return {
    now: now.toISOString(),
    today,
    timezone,
    checkIn: {
      localTime: clock.label,
      pendingChecks,
    },
    profile: profile ? { first_name: profile.first_name, timezone, focus_queue: profile.focus_queue, meeting_rules: profile.meeting_rules } : null,
    tasks: tasksRes.data ?? [],
    events,
    notebooks: notebooksRes.data ?? [],
    sections: sectionsRes.data ?? [],
    notes,
    meetingNotesNeedingTriage,
    workstreams: workstreamsRes.data ?? [],
    noteWorkstreams: noteWorkstreamsRes.data ?? [],
    recentBriefs: briefsRes.data ?? [],
    recentCodexActions: actionsRes.data ?? [],
  };
}

async function searchNotes(admin: SupabaseClient, userId: string, query: string) {
  const { data, error } = await admin
    .from('notes')
    .select('id,title,content,linked_event_id,linked_occurrence_start_at,triaged_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const needle = query.toLocaleLowerCase();
  return (data ?? [])
    .filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(needle))
    .slice(0, 20)
    .map((note) => ({ ...note, content: truncate(sanitizeNoteText(note.content), 12_000) }));
}

function jwtClaims(token: string): JsonRecord | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function authenticateAgent(
  req: Request,
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
): Promise<AgentPrincipal | null> {
  const authorization = req.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const auth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization ?? '' } },
  });
  const { data: { user }, error } = await auth.auth.getUser(token);
  const claims = jwtClaims(token);
  const clientId = claims && typeof claims.client_id === 'string' ? claims.client_id : null;
  if (error || !user || !clientId) return null;

  const { data: connection } = await admin
    .from('agent_connections')
    .select('id,name,scopes,revoked_at')
    .eq('user_id', user.id)
    .eq('oauth_client_id', clientId)
    .eq('auth_kind', 'oauth')
    .maybeSingle();
  if (!connection || connection.revoked_at) return null;

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from('agent_connections')
    .update({ last_used_at: now })
    .eq('id', connection.id)
    .is('revoked_at', null);
  if (updateError) return null;

  return {
    userId: user.id,
    connectionId: connection.id,
    actorName: connection.name,
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (Number(req.headers.get('content-length') ?? 0) > 200_000) return jsonResponse({ error: 'Request too large' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse({ error: 'Server is not configured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey);
  const principal = await authenticateAgent(req, admin, supabaseUrl, anonKey);
  if (!principal) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: JsonRecord;
  try {
    const parsed = await req.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const action = str(body.action) ?? 'context';
  try {
    if ((action === 'context' || action === 'notes.search') && !principal.scopes.includes('context:read')) {
      return jsonResponse({ error: 'Connection cannot read workspace context' }, 403);
    }
    if (action === 'mutate' && !principal.scopes.includes('workspace:write')) {
      return jsonResponse({ error: 'Connection cannot change the workspace' }, 403);
    }

    if (action === 'context') return jsonResponse({ ok: true, context: await buildContext(admin, principal.userId) });
    if (action === 'notes.search') {
      const query = str(body.query);
      if (!query || query.length < 2) return jsonResponse({ error: 'query must contain at least 2 characters' }, 400);
      return jsonResponse({ ok: true, notes: await searchNotes(admin, principal.userId, query) });
    }
    if (action === 'mutate') {
      const raw = Array.isArray(body.actions) ? body.actions : [];
      if (raw.length === 0 || raw.length > 25) return jsonResponse({ error: 'actions must contain 1–25 entries' }, 400);
      const { data: run, error: runError } = await admin
        .from('agent_runs')
        .insert({
          user_id: principal.userId,
          agent_connection_id: principal.connectionId,
          actor_name: principal.actorName,
          kind: 'adhoc',
          trigger_source: 'manual',
          status: 'running',
        })
        .select('id')
        .single();
      if (runError || !run) return jsonResponse({ error: runError?.message ?? 'Could not start audit run' }, 500);

      const results: MutationResult[] = [];
      for (const entry of raw) {
        if (!isRecord(entry) || typeof entry.kind !== 'string') {
          results.push({ ok: false, kind: 'unknown', error: 'each action needs a kind' });
        } else {
          results.push(await mutate(admin, principal, run.id, entry as MutationInput));
        }
      }
      const failures = results.filter((result) => !result.ok).length;
      const applied = results.filter((result) => result.ok && !result.skipped).length;
      await admin.from('agent_runs').update({
        status: failures > 0 ? 'error' : 'ok',
        summary: str(body.summary) ?? `Codex applied ${applied} change${applied === 1 ? '' : 's'}.`,
        stats: { requested: raw.length, applied, failures },
        error: failures > 0 ? `${failures} mutation${failures === 1 ? '' : 's'} failed` : null,
        finished_at: new Date().toISOString(),
      }).eq('id', run.id).eq('user_id', principal.userId);
      return jsonResponse({ ok: failures === 0, runId: run.id, applied, results }, failures > 0 ? 207 : 200);
    }
    return jsonResponse({ error: `Unknown action "${action}"` }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Request failed' }, 500);
  }
});
