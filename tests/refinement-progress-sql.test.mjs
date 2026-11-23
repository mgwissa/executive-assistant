import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const ownerNote = '00000000-0000-4000-8000-000000000011';
const ownerCopy = '00000000-0000-4000-8000-000000000012';
const otherNote = '00000000-0000-4000-8000-000000000021';
const migration = await readFile(new URL('../supabase/migrations/2026-11-23_058_refinement_progress.sql', import.meta.url), 'utf8');
const sql = async (query, values = []) => (await db.query(query, values)).rows;
const rows = () => sql('select *, updated_at::text as updated_at, created_at::text as created_at from public.refinement_item_progress order by user_id,source_id,item_kind,item_id');
async function role(name, callback) {
  await db.exec(`set role ${name}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
async function session(user = owner, client = null) {
  await sql("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user ?? '', JSON.stringify(client === null ? {} : { client_id: client })]);
}
async function save(patch = {}) {
  const input = { noteId: ownerNote, sourceId: 'manual:refinement:2026-11-17', kind: 'action', itemId: 'confirm-routing',
    status: 'in_progress', expected: null, ...patch };
  return role('authenticated', async () => (await sql(`select p.*, p.updated_at::text as updated_at, p.created_at::text as created_at
    from public.set_refinement_progress($1,$2,$3,$4,$5,$6) p`,
  [input.noteId, input.sourceId, input.kind, input.itemId, input.status, input.expected]))[0]);
}
const conflict = error => error.code === '40001' && /changed; refresh/.test(error.message);

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.notes(id uuid primary key, user_id uuid not null references auth.users on delete cascade,
      title text not null, content text not null, updated_at timestamptz not null default clock_timestamp());
    create table public.tasks(id integer primary key, title text not null, done boolean not null default false);`);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users cascade; truncate public.tasks;');
  await sql('insert into auth.users values ($1),($2)', [owner, other]);
  for (const [id, user, title] of [[ownerNote, owner, 'Refinement 2026-11-17'], [ownerCopy, owner, 'Refinement source copy'], [otherNote, other, 'Other owner refinement']]) {
    await sql('insert into public.notes(id,user_id,title,content) values($1,$2,$3,$4)', [id, user, title, 'Preserved source evidence and original ownership.']);
  }
  await db.exec("insert into public.tasks values(1,'Unrelated task',false)");
  await session();
});
after(() => db.close());

test('real migration is repeatable; progress is absent until an owner explicitly saves', async () => {
  await db.exec(migration);
  assert.deepEqual(await role('authenticated', rows), []);
  const saved = await save();
  assert.equal(saved.user_id, owner);
  assert.equal(saved.note_id, ownerNote);
  assert.equal(saved.source_id, 'manual:refinement:2026-11-17');
  assert.equal(saved.item_kind, 'action');
  assert.equal(saved.item_id, 'confirm-routing');
  assert.equal(saved.status, 'in_progress');
  assert.ok(saved.updated_at);
  assert.equal((await rows()).length, 1);
});

test('owner can complete and reopen without deleting progress or changing source notes and tasks', async () => {
  const beforeNotes = await sql('select *,updated_at::text as updated_at from public.notes order by id');
  const beforeTasks = await sql('select * from public.tasks');
  const started = await save();
  const completed = await save({ status: 'complete', expected: started.updated_at });
  assert.equal(completed.status, 'complete');
  assert.notEqual(completed.updated_at, started.updated_at);
  const reopened = await save({ status: 'in_progress', expected: completed.updated_at });
  const reset = await save({ status: 'not_started', expected: reopened.updated_at });
  assert.equal(reset.status, 'not_started');
  assert.equal(reset.created_at, started.created_at);
  assert.equal((await rows()).length, 1);
  assert.deepEqual(await sql('select *,updated_at::text as updated_at from public.notes order by id'), beforeNotes);
  assert.deepEqual(await sql('select * from public.tasks'), beforeTasks);
});

test('owner-only RLS hides other users and same-uid OAuth clients', async () => {
  const first = await save();
  await session(other);
  assert.deepEqual(await role('authenticated', rows), []);
  await assert.rejects(save({ noteId: ownerNote, expected: first.updated_at }), /Owned refinement note not found/);
  const second = await save({ noteId: otherNote });
  assert.equal(second.user_id, other);
  assert.equal((await role('authenticated', rows)).length, 1);
  await session(owner, 'oauth-client');
  assert.deepEqual(await role('authenticated', rows), []);
  await assert.rejects(save({ status: 'complete', expected: first.updated_at }), /owner session/);
  await session();
  assert.equal((await role('authenticated', rows))[0].user_id, owner);
});

test('missing sessions, anonymous callers and service-role RPC calls are denied', async () => {
  await session(null);
  await assert.rejects(save(), /owner session/);
  for (const name of ['anon', 'service_role']) {
    await assert.rejects(role(name, () => sql('select public.set_refinement_progress($1,$2,$3,$4,$5)',
      [ownerNote, 'source', 'action', 'item', 'complete'])), /permission denied/);
  }
  await assert.rejects(role('anon', rows), /permission denied/);
  assert.equal((await rows()).length, 0);
});

test('all direct DML is denied, including service-role writes; only scoped service reads are granted', async () => {
  await save();
  for (const client of [null, 'oauth-client']) {
    await session(owner, client);
    for (const query of [
      'insert into public.refinement_item_progress(user_id,note_id,source_id,item_kind,item_id,status) values($1,$2,\'source\',\'story\',\'item\',\'complete\')',
      "update public.refinement_item_progress set status='complete' where user_id=$1 and note_id=$2",
      'delete from public.refinement_item_progress where user_id=$1 and note_id=$2',
    ]) await assert.rejects(role('authenticated', () => sql(query, [owner, ownerNote])), /permission denied/);
  }
  assert.equal((await role('service_role', rows)).length, 1);
  await assert.rejects(role('service_role', () => sql("update public.refinement_item_progress set status='complete'")), /permission denied/);
  assert.equal((await rows())[0].status, 'in_progress');
});

test('null, missing and foreign note anchors cannot create or update progress', async () => {
  const first = await save();
  for (const noteId of [null, otherNote, '00000000-0000-4000-8000-000000000099']) {
    await assert.rejects(save({ noteId, itemId: 'new-item' }), /Owned refinement note not found/);
    await assert.rejects(save({ noteId, status: 'complete', expected: first.updated_at }), /Owned refinement note not found/);
  }
  assert.equal((await rows()).length, 1);
  assert.equal((await rows())[0].status, 'in_progress');
});

test('status, kind and safe identity token validation rejects invalid input', async () => {
  for (const status of [null, '', 'done', 'completed', 'COMPLETE', ' complete ']) await assert.rejects(save({ status }), /Unsupported refinement progress status/);
  for (const kind of [null, '', 'task', 'Action']) await assert.rejects(save({ kind }), /Unsupported refinement item kind/);
  for (const value of [null, '', ' ', 'source/with/path', 'https://example.com', '-starts-with-dash', 'a'.repeat(201), 'item\nnext']) {
    await assert.rejects(save({ sourceId: value }), /safe tokens/);
    await assert.rejects(save({ itemId: value }), /safe tokens/);
  }
  assert.equal((await rows()).length, 0);
  const boundary = await save({ sourceId: 'a'.repeat(200), itemId: 'b'.repeat(200) });
  assert.equal(boundary.source_id.length, 200);
  assert.equal(boundary.item_id.length, 200);
});

test('stale or absent update versions cannot overwrite progress, even for the same requested status', async () => {
  const first = await save();
  const completed = await save({ status: 'complete', expected: first.updated_at });
  await assert.rejects(save({ status: 'not_started', expected: first.updated_at }), conflict);
  await assert.rejects(save({ status: 'complete' }), conflict);
  await assert.rejects(save({ itemId: 'missing-row', expected: completed.updated_at }), conflict);
  assert.equal((await rows()).length, 1);
  assert.equal((await rows())[0].status, 'complete');
  assert.equal((await rows())[0].updated_at, completed.updated_at);
});

test('two initial-save intents cannot overwrite the first saved decision', async () => {
  // Both forms read an absent row and retain expected=null; the later save must conflict.
  const first = await save({ status: 'complete' });
  await assert.rejects(save({ status: 'in_progress' }), conflict);
  assert.deepEqual(await rows(), [first]);
  const defaults = await role('authenticated', () => sql('select (public.set_refinement_progress($1,$2,$3,$4,$5)).status as status',
    [ownerNote, 'other-source', 'action', 'item', 'not_started']));
  assert.equal(defaults[0].status, 'not_started');
});

test('exact timestamp versions preserve microseconds and same-status saves are no-ops after CAS', async () => {
  await save();
  await db.exec("update public.refinement_item_progress set updated_at='2026-11-23T15:00:00.123456Z'");
  const precise = (await rows())[0];
  await assert.rejects(save({ status: 'complete', expected: '2026-11-23T15:00:00.123Z' }), conflict);
  const unchanged = await save({ noteId: ownerCopy, expected: precise.updated_at });
  assert.equal(unchanged.updated_at, precise.updated_at);
  assert.equal(unchanged.created_at, precise.created_at);
  assert.equal(unchanged.note_id, ownerNote, 'no-op preserves the original anchor');
  const changed = await save({ status: 'complete', expected: precise.updated_at });
  assert.equal(changed.status, 'complete');
  assert.notEqual(changed.updated_at, precise.updated_at);
});

test('source and item kind are part of identity while owned source copies preserve progress', async () => {
  const first = await save({ status: 'complete' });
  await save({ sourceId: 'different-meeting', status: 'not_started' });
  await save({ kind: 'story', status: 'not_started' });
  assert.equal((await rows()).length, 3);
  const reopened = await save({ noteId: ownerCopy, status: 'in_progress', expected: first.updated_at });
  assert.equal(reopened.note_id, ownerCopy);
  assert.equal(reopened.created_at, first.created_at);
  assert.equal((await rows()).length, 3);
  await sql('update public.notes set content=$1 where id=$2', ['A new source review version.', ownerCopy]);
  const preserved = (await rows()).find(row => row.source_id === first.source_id && row.item_kind === 'action');
  assert.equal(preserved.status, 'in_progress');
  assert.equal(preserved.updated_at, reopened.updated_at);
});

test('deleting source note anchors preserves human progress and allows reopening from an owned copy', async () => {
  const first = await save({ status: 'complete' });
  await sql('delete from public.notes where id=$1', [ownerNote]);
  const preserved = (await rows())[0];
  assert.equal((await rows()).length, 1);
  assert.equal(preserved.note_id, null);
  assert.equal(preserved.status, 'complete');
  assert.equal(preserved.updated_at, first.updated_at);
  assert.equal(preserved.created_at, first.created_at);
  assert.equal((await role('authenticated', rows))[0].status, 'complete');
  const reopened = await save({ noteId: ownerCopy, status: 'not_started', expected: first.updated_at });
  assert.equal(reopened.note_id, ownerCopy);
  assert.equal(reopened.status, 'not_started');
  assert.equal(reopened.created_at, first.created_at);
  await sql('delete from public.notes where id=$1', [ownerCopy]);
  const orphaned = (await rows())[0];
  assert.equal(orphaned.note_id, null);
  assert.equal(orphaned.status, 'not_started');
  assert.equal(orphaned.updated_at, reopened.updated_at);
  await sql('delete from auth.users where id=$1', [owner]);
  assert.equal((await rows()).length, 0, 'account deletion still removes that owner progress');
});
