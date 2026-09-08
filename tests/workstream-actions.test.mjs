import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { actionKindMeta, planUndo } from '../src/lib/agentDesk.ts';

// Real PostgreSQL and real migrations, without connecting to a user's database.
const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
const connection = '00000000-0000-4000-8000-000000000003';
const run = '00000000-0000-4000-8000-000000000004';
const note = '00000000-0000-4000-8000-000000000005';
const foreignNote = '00000000-0000-4000-8000-000000000006';
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sql = async (query, params = []) => (await db.query(query, params)).rows;
async function asRole(role, callback) {
  await db.exec(`set role ${role}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
const apply = (input, overrides = {}) => asRole('service_role', async () => {
  const rows = await sql('select public.apply_agent_workstream_action($1, $2, $3, $4, $5) as result',
    [overrides.user ?? user, overrides.run ?? run, overrides.connection ?? connection, 'Test agent', input]);
  return rows[0].result;
});
const create = (name = 'Click Engine', extra = {}) => apply({ kind: 'workstream_create', workstream: { name }, ...extra });
const assign = (workstreamId, assigned = true, extra = {}) => apply({ kind: 'note_workstream', noteId: note, workstreamId, assigned, ...extra });
async function undo(actionId, owner = user) {
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  return asRole('authenticated', () => sql('select public.undo_agent_workstream_action($1)', [actionId]));
}
const actions = () => sql('select * from public.agent_actions order by created_at, id');
const links = () => sql('select * from public.note_workstreams order by workstream_id');
let latestMigration;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.profiles (user_id uuid primary key references auth.users);
    create table public.notes (id uuid primary key, user_id uuid references auth.users,
      content text, content_blocks jsonb, notebook_id uuid, section_id uuid,
      scratch_at timestamptz, triaged_at timestamptz, updated_at timestamptz default now());
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;
  `);
  for (const name of ['2026-08-10_041_agent_desk.sql', '2026-08-17_045_agent_connections.sql',
    '2026-08-17_046_oauth_agent_connections.sql', '2026-08-18_047_note_workstreams.sql']) {
    await db.exec(await migration(name));
  }
  latestMigration = await migration('2026-09-08_052_workstream_actions.sql');
  await db.exec(latestMigration);
});
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade;
    drop trigger if exists reject_insert on public.agent_actions;
    drop trigger if exists reject_update on public.agent_actions;`);
  await sql('insert into auth.users values ($1), ($2)', [user, otherUser]);
  await sql("insert into public.agent_connections (id, user_id, name) values ($1, $2, 'Test agent')", [connection, user]);
  await sql('insert into public.agent_runs (id, user_id, agent_connection_id) values ($1, $2, $3)', [run, user, connection]);
  await sql(`insert into public.notes (id, user_id, content, content_blocks, scratch_at, triaged_at)
    values ($1, $2, 'Keep this content', '[{"type":"paragraph"}]', now(), now()), ($3, $4, 'Private', null, null, null)`,
    [note, user, foreignNote, otherUser]);
});
after(() => db.close());

test('migration is repeatable; creation records principal, effects and raw state', async () => {
  await db.exec(latestMigration);
  const result = await create(' Click Engine ', { rationale: 'Keep completed reference', effects: ['Created workstream', 12] });
  const [audit] = await actions();
  assert.equal(result.actionId, audit.id);
  assert.equal(result.targetId, audit.after.id);
  assert.equal(audit.before, null);
  assert.equal(audit.after.name, 'Click Engine');
  assert.equal(audit.user_id, user);
  assert.equal(audit.agent_connection_id, connection);
  assert.equal(audit.actor_name, 'Test agent');
  assert.deepEqual(audit.effects, ['Created workstream']);
});

test('duplicate names reuse the ID without changing existing metadata or auditing a no-op', async () => {
  const first = await create('Click Engine', { dedupeKey: 'create-click-engine' });
  const retry = await create('Ignored retry payload', { dedupeKey: 'create-click-engine' });
  const sameName = await create('CLICK ENGINE', { workstream: { name: 'CLICK ENGINE', description: 'Do not overwrite' } });
  assert.equal(retry.skipped, 'duplicate');
  assert.equal(sameName.skipped, 'unchanged');
  assert.equal(sameName.targetId, first.targetId);
  assert.equal(retry.targetId, first.targetId);
  assert.equal((await actions()).length, 1);
  assert.equal((await sql('select description from public.workstreams'))[0].description, '');
});

test('explicit assign/unassign preserves other links and every note field', async () => {
  const first = await create();
  const second = await create('Analytics');
  const notesBefore = await sql('select * from public.notes order by id');
  await assign(first.targetId, true, { dedupeKey: 'assign-first' });
  await assign(second.targetId);
  assert.equal((await assign(first.targetId)).skipped, 'unchanged');
  assert.equal((await assign(first.targetId, true, { dedupeKey: 'assign-first' })).skipped, 'duplicate');
  const removal = await assign(first.targetId, false);
  assert.equal((await assign(first.targetId, false)).skipped, 'unchanged');
  assert.deepEqual((await links()).map(x => x.workstream_id), [second.targetId]);
  await undo(removal.actionId);
  assert.equal((await links()).length, 2);
  assert.deepEqual(await sql('select * from public.notes order by id'), notesBefore);
});

test('validates names, IDs and actual booleans before changing anything', async () => {
  for (const name of ['', '   ', 'a'.repeat(101), 5, null]) await assert.rejects(create(name));
  await assert.rejects(create('Valid', { workstream: { name: 'Valid', description: 2 } }));
  const stream = await create();
  for (const assigned of ['true', null, 1, undefined]) await assert.rejects(assign(stream.targetId, assigned, { assigned }));
  await assert.rejects(assign('not-a-uuid'));
  await assert.rejects(assign(stream.targetId, true, { noteId: null }));
  assert.equal((await links()).length, 0);
});

test('rejects foreign notes, foreign workstreams, forged identity and invalid connections', async () => {
  const stream = await create();
  await assert.rejects(assign(stream.targetId, true, { noteId: foreignNote }), /Note not found/);
  const [foreign] = await sql("insert into public.workstreams (user_id, name) values ($1, 'Private') returning id", [otherUser]);
  await assert.rejects(assign(foreign.id), /Workstream not found/);
  const input = { kind: 'workstream_create', workstream: { name: 'Forbidden' } };
  await assert.rejects(apply(input, { user: otherUser }), /active owned/);
  await assert.rejects(apply(input, { run: otherUser }), /active owned/);
  for (const patch of ["revoked_at = now()", "expires_at = now() - interval '1 day'", "scopes = array['context:read']"]) {
    await db.exec(`update public.agent_connections set revoked_at = null, expires_at = null, scopes = array['workspace:write'];
      update public.agent_connections set ${patch}`);
    await assert.rejects(create('Forbidden'), /active owned/);
  }
  assert.equal((await actions()).length, 1);
  assert.equal((await links()).length, 0);
});

test('RPC grants forbid client apply and anonymous undo; authenticated undo is owner-only', async () => {
  const result = await create();
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asRole(role, () => sql('select public.apply_agent_workstream_action($1,$2,$3,$4,$5)',
      [user, run, connection, 'Test agent', { kind: 'workstream_create', workstream: { name: 'No' } }])), /permission denied/);
  }
  await assert.rejects(asRole('anon', () => sql('select public.undo_agent_workstream_action($1)', [result.actionId])), /permission denied/);
  await assert.rejects(undo(result.actionId, otherUser), /Action not found/);
  assert.equal((await sql('select * from public.workstreams')).length, 1);
});

async function failAudit(event) {
  await db.exec(`create or replace function public.reject_test_audit() returns trigger language plpgsql as
    $$ begin raise exception 'Simulated audit failure'; end $$;
    create trigger reject_${event} before ${event} on public.agent_actions for each row execute function public.reject_test_audit();`);
}

test('audit insert failure rolls back both creation and link changes', async () => {
  const stream = await create();
  await failAudit('insert');
  await assert.rejects(create('Rolled back'), /Simulated audit failure/);
  await assert.rejects(assign(stream.targetId), /Simulated audit failure/);
  assert.equal((await sql('select * from public.workstreams')).length, 1);
  assert.equal((await links()).length, 0);
  await sql('insert into public.note_workstreams (user_id, workstream_id, note_id) values ($1,$2,$3)', [user, stream.targetId, note]);
  await assert.rejects(assign(stream.targetId, false), /Simulated audit failure/);
  assert.equal((await links()).length, 1);
  assert.equal((await actions()).length, 1);
});

test('undo rejects populated/edited workstreams, then safely removes an untouched empty creation', async () => {
  const stream = await create();
  const membership = await assign(stream.targetId);
  await assert.rejects(undo(stream.actionId), /contains notes/);
  await undo(membership.actionId);
  await undo(stream.actionId);
  await undo(stream.actionId); // idempotent repeated undo
  assert.equal((await sql('select * from public.workstreams')).length, 0);
  assert.ok((await actions()).every(action => action.status === 'undone'));
  const edited = await create('Edited');
  await sql("update public.workstreams set description = 'Later edit' where id = $1", [edited.targetId]);
  await assert.rejects(undo(edited.actionId), /changed since/);
});

test('undo refuses a changed membership and leaves newer user decisions alone', async () => {
  const stream = await create();
  const added = await assign(stream.targetId);
  await assign(stream.targetId, false);
  await assert.rejects(undo(added.actionId), /membership changed/);
  const again = await assign(stream.targetId);
  const removed = await assign(stream.targetId, false);
  await assign(stream.targetId);
  await assert.rejects(undo(removed.actionId), /membership changed/);
  await assert.rejects(undo(again.actionId), /membership changed/);
});

test('audit update failure during undo restores data and leaves action applied', async () => {
  const stream = await create();
  const membership = await assign(stream.targetId);
  await failAudit('update');
  await assert.rejects(undo(membership.actionId), /Simulated audit failure/);
  assert.equal((await links()).length, 1);
  assert.ok((await actions()).every(action => action.status === 'applied'));
});

test('dedupe retries do not reapply undone work; cross-kind key collisions are refused', async () => {
  const stream = await create('Click Engine', { dedupeKey: 'create' });
  await assert.rejects(assign(stream.targetId, true, { dedupeKey: 'create' }), /different action/);
  const link = await assign(stream.targetId, true, { dedupeKey: 'link' });
  await undo(link.actionId);
  assert.equal((await assign(stream.targetId, true, { dedupeKey: 'link' })).skipped, 'duplicate');
  assert.equal((await links()).length, 0);
});

test('UI recognizes both action types and sends undo through the atomic RPC', () => {
  for (const kind of ['workstream_create', 'note_workstream']) {
    const action = { id: run, kind, status: 'applied', target: {}, before: null, after: null };
    assert.deepEqual(planUndo(action), { op: 'undo_workstream_action', actionId: run });
    assert.notEqual(actionKindMeta(kind).label, 'Change');
    assert.equal(planUndo({ ...action, status: 'undone' }).reason, 'Already undone');
  }
});
