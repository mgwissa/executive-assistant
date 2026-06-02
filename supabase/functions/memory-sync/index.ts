import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { embedTexts } from '../_shared/openai.ts';
import {
  buildDebriefDocument,
  buildNoteDocument,
  buildTaskDocument,
  toChunkInputs,
  type MemoryChunkInput,
  type MemorySourceType,
} from '../_shared/memoryIndex.ts';
import { handleOptions, jsonResponse, requireMemoryAddon, requireUser } from '../_shared/userAuth.ts';

type SyncBody =
  | { mode: 'full' }
  | { sourceType: MemorySourceType; sourceId: string }
  | { mode: 'delete'; sourceType: MemorySourceType; sourceId: string };

async function deleteSourceChunks(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
  sourceType: MemorySourceType,
  sourceId: string,
): Promise<void> {
  const { error } = await admin
    .from('memory_chunks')
    .delete()
    .eq('user_id', userId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);
  if (error) throw new Error(error.message);
}

async function upsertChunks(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
  inputs: MemoryChunkInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;

  const { sourceType, sourceId } = inputs[0];
  await deleteSourceChunks(admin, userId, sourceType, sourceId);

  const embeddings = await embedTexts(inputs.map((c) => c.content));
  const rows = inputs.map((chunk, i) => ({
    user_id: userId,
    source_type: chunk.sourceType,
    source_id: chunk.sourceId,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    embedding: embeddings[i],
    metadata: chunk.metadata,
    source_updated_at: chunk.sourceUpdatedAt,
  }));

  const { error } = await admin.from('memory_chunks').insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

async function indexNote(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
  noteId: string,
): Promise<number> {
  const { data: note, error } = await admin
    .from('notes')
    .select('id, title, content, updated_at')
    .eq('id', noteId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!note) {
    await deleteSourceChunks(admin, userId, 'note', noteId);
    return 0;
  }

  const doc = buildNoteDocument(note.title ?? '', note.content ?? '');
  const inputs = toChunkInputs('note', note.id, doc, { title: note.title ?? 'Untitled' }, note.updated_at);
  if (inputs.length === 0) {
    await deleteSourceChunks(admin, userId, 'note', noteId);
    return 0;
  }
  return upsertChunks(admin, userId, inputs);
}

async function indexTask(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
  taskId: string,
): Promise<number> {
  const { data: task, error } = await admin
    .from('tasks')
    .select('id, title, description, waiting_on, priority, due_date, done, tags, updated_at')
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) {
    await deleteSourceChunks(admin, userId, 'task', taskId);
    return 0;
  }
  if (task.done) {
    await deleteSourceChunks(admin, userId, 'task', taskId);
    return 0;
  }

  const doc = buildTaskDocument(task);
  const inputs = toChunkInputs(
    'task',
    task.id,
    doc,
    { title: task.title ?? 'Untitled task' },
    task.updated_at,
  );
  if (inputs.length === 0) {
    await deleteSourceChunks(admin, userId, 'task', taskId);
    return 0;
  }
  return upsertChunks(admin, userId, inputs);
}

async function indexDebrief(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
  debriefId: string,
): Promise<number> {
  const { data: debrief, error } = await admin
    .from('meeting_debrief_states')
    .select('id, event_id, occurrence_start_at, notes, updated_at')
    .eq('id', debriefId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!debrief || !debrief.notes?.trim()) {
    await deleteSourceChunks(admin, userId, 'debrief', debriefId);
    return 0;
  }

  const { data: event } = await admin
    .from('events')
    .select('title')
    .eq('id', debrief.event_id)
    .maybeSingle();

  const doc = buildDebriefDocument(
    event?.title ?? 'Meeting',
    debrief.occurrence_start_at,
    debrief.notes,
  );
  const inputs = toChunkInputs(
    'debrief',
    debrief.id,
    doc,
    {
      title: event?.title ?? 'Meeting debrief',
      eventId: debrief.event_id,
      occurrenceStartAt: debrief.occurrence_start_at,
    },
    debrief.updated_at,
  );
  return upsertChunks(admin, userId, inputs);
}

async function fullSync(
  admin: Awaited<ReturnType<typeof requireUser>> extends infer R
    ? R extends { admin: infer A }
      ? A
      : never
    : never,
  userId: string,
): Promise<{ notes: number; tasks: number; debriefs: number; chunks: number }> {
  let chunkCount = 0;

  const { data: notes, error: notesErr } = await admin
    .from('notes')
    .select('id')
    .eq('user_id', userId);
  if (notesErr) throw new Error(notesErr.message);
  for (const n of notes ?? []) {
    chunkCount += await indexNote(admin, userId, n.id);
  }

  const { data: tasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('done', false);
  if (tasksErr) throw new Error(tasksErr.message);
  for (const t of tasks ?? []) {
    chunkCount += await indexTask(admin, userId, t.id);
  }

  const { data: debriefs, error: debriefErr } = await admin
    .from('meeting_debrief_states')
    .select('id, notes')
    .eq('user_id', userId);
  if (debriefErr) throw new Error(debriefErr.message);
  let debriefIndexed = 0;
  for (const d of debriefs ?? []) {
    if (!d.notes?.trim()) continue;
    chunkCount += await indexDebrief(admin, userId, d.id);
    debriefIndexed += 1;
  }

  const nowIso = new Date().toISOString();
  await admin.from('profiles').update({ memory_last_synced_at: nowIso }).eq('user_id', userId);

  return {
    notes: notes?.length ?? 0,
    tasks: tasks?.length ?? 0,
    debriefs: debriefIndexed,
    chunks: chunkCount,
  };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const addonErr = await requireMemoryAddon(auth.admin, auth.user.id);
  if (addonErr) return addonErr;

  let body: SyncBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  try {
    if ('mode' in body && body.mode === 'delete' && body.sourceType && body.sourceId) {
      await deleteSourceChunks(auth.admin, auth.user.id, body.sourceType, body.sourceId);
      return jsonResponse({ ok: true, deleted: true });
    }

    if ('mode' in body && body.mode === 'full') {
      const stats = await fullSync(auth.admin, auth.user.id);
      return jsonResponse({ ok: true, ...stats });
    }

    if ('sourceType' in body && body.sourceId) {
      let chunks = 0;
      if (body.sourceType === 'note') chunks = await indexNote(auth.admin, auth.user.id, body.sourceId);
      else if (body.sourceType === 'task') chunks = await indexTask(auth.admin, auth.user.id, body.sourceId);
      else if (body.sourceType === 'debrief') {
        chunks = await indexDebrief(auth.admin, auth.user.id, body.sourceId);
      } else {
        return jsonResponse({ error: 'Invalid sourceType' }, 400);
      }
      await auth.admin
        .from('profiles')
        .update({ memory_last_synced_at: new Date().toISOString() })
        .eq('user_id', auth.user.id);
      return jsonResponse({ ok: true, chunks });
    }

    return jsonResponse({ error: 'Expected { mode: "full" } or { sourceType, sourceId }' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    return jsonResponse({ error: msg }, 500);
  }
});
