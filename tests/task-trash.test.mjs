import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { planUndo } from '../src/lib/agentDesk.ts';
import { sameTaskForTrash } from '../src/lib/taskTrash.ts';

// Real SQL in an isolated database; no production credentials or data.
const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const task = '00000000-0000-4000-8000-000000000003';
const connection = '00000000-0000-4000-8000-000000000004';
const run = '00000000-0000-4000-8000-000000000005';
const migration = await readFile(new URL('../supabase/migrations/2026-10-19_054_task_trash.sql', import.meta.url), 'utf8');
const sql = async (text, values = []) => (await db.query(text, values)).rows;
const current = async () => (await sql('select * from public.tasks where id = $1', [task]))[0];
const audits = () => sql('select * from public.agent_actions order by created_at, id');
async function asRole(role, callback) {
  await db.exec(`set role ${role}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
async function ownerChange(trashed, version, owner = user) {
  const expected = version ?? (await current()).updated_at;
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  return asRole('authenticated', async () => (await sql('select public.set_task_trashed($1, $2, $3) as result',
    [task, trashed, expected]))[0].result);
}
async function agentChange(kind, extra = {}, owner = user) {
  return asRole('service_role', async () => (await sql('select public.apply_task_trash_action($1,$2,$3,$4,$5) as result',
    [owner, run, connection, 'Test agent', { kind, taskId: task, expectedUpdatedAt: (await current()).updated_at, ...extra }]))[0].result);
}
async function undo(id, owner = user) {
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  return asRole('authenticated', () => sql('select public.undo_agent_task_lifecycle_action($1)', [id]));
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.profiles (user_id uuid primary key references auth.users, timezone text, focus_queue jsonb);
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = clock_timestamp(); return new; end $$;
  `);
  for (const name of ['2026-04-17_003_tasks.sql','2026-08-10_041_agent_desk.sql',
    '2026-08-17_045_agent_connections.sql','2026-08-17_046_oauth_agent_connections.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    alter table public.tasks add description text not null default '', add priority text default 'normal',
      add priority_set_at timestamptz default now(), add due_date date, add review_date date,
      add due_time time, add reminder_sent_at timestamptz, add waiting_on text, add tags text[] default '{}';
    create table public.memory_chunks (user_id uuid, source_type text, source_id text, content text);
    create table public.time_entries (id int primary key, task_id uuid references public.tasks on delete set null);
    create table public.routine_item_states (id int primary key, task_id uuid references public.tasks on delete set null);
    grant select, insert, update, delete on public.tasks to authenticated;
    grant select on public.tasks to service_role;
  `);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; truncate public.memory_chunks;
    drop trigger if exists reject_audit on public.agent_actions;
    drop trigger if exists reject_audit_update on public.agent_actions;`);
  await sql("select set_config('request.jwt.claim.sub', '', false)");
  await sql('insert into auth.users values ($1), ($2)', [user, other]);
  await sql("insert into public.agent_connections(id,user_id,name) values ($1,$2,'Test agent')", [connection, user]);
  await sql('insert into public.agent_runs(id,user_id,agent_connection_id) values ($1,$2,$3)', [run, user, connection]);
  await sql("insert into public.tasks(id,user_id,title,description,tags) values($1,$2,'Keep the source context','Full requirements',array['seo'])", [task,user]);
  await sql("insert into public.profiles values ($1,'America/New_York',$2)", [user, { stack: [{kind:'task',taskId:task}, {kind:'task',taskId:other}], managedBy:'user', snoozedUntil:{keep:'2026-11-01'} }]);
  await sql("insert into public.memory_chunks values($1,'task',$2,'Old embedding'),($1,'note','note','Keep')", [user,task]);
  await sql('insert into public.time_entries values(1,$1)', [task]);
  await sql('insert into public.routine_item_states values(1,$1)', [task]);
});
after(() => db.close());

test('migration is repeatable; Trash preserves task, time/routine links, metadata and focus siblings', async () => {
  await db.exec(migration);
  const original = await current();
  const result = await ownerChange(true);
  const trashed = await current();
  assert.ok(trashed.deleted_at);
  for (const key of ['id','user_id','title','description','done','tags','created_at','due_date','review_date']) assert.deepEqual(trashed[key],original[key]);
  assert.equal((await sql('select task_id from public.time_entries'))[0].task_id,task);
  assert.equal((await sql('select task_id from public.routine_item_states'))[0].task_id,task);
  const focus = (await sql('select focus_queue from public.profiles'))[0].focus_queue;
  assert.deepEqual(focus.stack,[{kind:'task',taskId:other}]);
  assert.equal(focus.snoozedUntil.keep,'2026-11-01');
  assert.equal((await sql('select count(*)::int n from public.memory_chunks'))[0].n,1);
  const [audit] = await audits();
  assert.equal(audit.id,result.actionId);
  assert.equal(audit.actor_name,'You');
  assert.equal(audit.before.task.description,'Full requirements');
  assert.equal(audit.after.task.id,task);
  assert.equal(planUndo(audit).op,'undo_task_lifecycle_action');
});

test('Restore retains dates and context without focus or immediate old timed reminders', async () => {
  await sql("update public.tasks set due_date=current_date-1,due_time='09:00' where id=$1",[task]);
  await ownerChange(true);
  const deleted = await current();
  await ownerChange(false);
  const restored = await current();
  assert.equal(restored.deleted_at,null);
  assert.ok(restored.restored_at);
  assert.ok(restored.reminder_sent_at);
  assert.deepEqual(restored.due_date,deleted.due_date);
  assert.equal(restored.description,deleted.description);
  assert.equal((await sql('select focus_queue from public.profiles'))[0].focus_queue.stack.length,1);
  assert.equal((await audits()).length,2);
});

test('same-state operations are no-ops; agent retries dedupe and cannot reuse a key on another action', async () => {
  const first = await agentChange('task_delete',{dedupeKey:'trash-once'});
  assert.equal((await agentChange('task_delete',{dedupeKey:'trash-once'})).actionId,first.actionId);
  assert.equal((await agentChange('task_delete')).skipped,'unchanged');
  await assert.rejects(agentChange('task_restore',{dedupeKey:'trash-once'}),/another action/);
  assert.equal((await audits()).length,1);
});

test('owner and write-scope gates reject foreign tasks, forged identity, anonymous calls and revoked connections', async () => {
  await assert.rejects(ownerChange(true,undefined,other),/Task not found/);
  await sql("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(asRole('anon',()=>sql('select public.set_task_trashed($1,true,now())',[task])),/permission denied/);
  await assert.rejects(asRole('authenticated',()=>sql('select public.apply_task_trash_action($1,$2,$3,$4,$5)',[user,run,connection,'Fake',{kind:'task_delete',taskId:task}])) ,/permission denied/);
  await assert.rejects(agentChange('task_delete',{},other),/active owned/);
  for (const patch of ["revoked_at=now()","expires_at=now()-interval '1 day'","scopes=array['context:read']"]) {
    await db.exec("update public.agent_connections set revoked_at=null,expires_at=null,scopes=array['workspace:write']; update public.agent_connections set "+patch);
    await assert.rejects(agentChange('task_delete'),/active owned/);
  }
  assert.equal((await current()).deleted_at,null);
  assert.equal((await audits()).length,0);
});

test('stale versions and missing explicit versions refuse changes', async () => {
  const old = await current();
  await sql("update public.tasks set description='Newer context' where id=$1",[task]);
  await assert.rejects(ownerChange(true,old.updated_at),/changed since/);
  await assert.rejects(agentChange('task_delete',{expectedUpdatedAt:null}),/changed since/);
  assert.equal((await current()).deleted_at,null);
});

test('direct client hard-deletes, lifecycle patches and edits in Trash are forbidden', async () => {
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await assert.rejects(asRole('authenticated',()=>sql('delete from public.tasks where id=$1',[task])),/permission denied/);
  await assert.rejects(asRole('authenticated',()=>sql('update public.tasks set deleted_at=now() where id=$1',[task])),/permission denied/);
  await ownerChange(true);
  await asRole('authenticated',()=>sql("update public.tasks set title='Must not change' where id=$1",[task]));
  assert.equal((await current()).title,'Keep the source context');
});

test('audit failure rolls back Trash, focus and derived-memory cleanup together', async () => {
  await db.exec(`create function public.reject_trash_audit() returns trigger language plpgsql as
    $$ begin raise exception 'Audit unavailable'; end $$;
    create trigger reject_audit before insert on public.agent_actions for each row execute function public.reject_trash_audit();`);
  await assert.rejects(ownerChange(true),/Audit unavailable/);
  assert.equal((await current()).deleted_at,null);
  assert.equal((await sql('select focus_queue from public.profiles'))[0].focus_queue.stack.length,2);
  assert.equal((await sql('select count(*)::int n from public.memory_chunks'))[0].n,2);
});

test('Activity undo is atomic, owner-only, retry-safe and refuses changed/restored tasks', async () => {
  const deletion = await ownerChange(true);
  await assert.rejects(undo(deletion.actionId,other),/Action not found/);
  await undo(deletion.actionId);
  await undo(deletion.actionId);
  assert.equal((await current()).deleted_at,null);
  assert.equal((await audits()).find(a=>a.id===deletion.actionId).status,'undone');
  const second = await ownerChange(true);
  await ownerChange(false);
  await assert.rejects(undo(second.actionId),/changed since/);
  const restoration = (await audits()).find(a=>a.kind==='task_restore'&&a.rationale==='Explicit task action in the app');
  await sql("update public.tasks set description='Later change' where id=$1",[task]);
  await assert.rejects(undo(restoration.id),/changed since/);
});

test('failure marking an undo rolls back restoration and its new audit too', async () => {
  const deletion = await ownerChange(true);
  await db.exec(`create or replace function public.reject_trash_audit() returns trigger language plpgsql as
    $$ begin raise exception 'Audit unavailable'; end $$;
    create trigger reject_audit_update before update on public.agent_actions for each row execute function public.reject_trash_audit();`);
  await assert.rejects(undo(deletion.actionId),/Audit unavailable/);
  assert.ok((await current()).deleted_at);
  assert.equal((await audits()).length,1);
});

test('client content checks allow optimistic timestamp formatting but reject newer requirements', async () => {
  const original = await current();
  const normalized = JSON.parse(JSON.stringify(original));
  assert.ok(sameTaskForTrash(normalized,{...normalized,updated_at:'2099-01-01T00:00:00Z'}));
  assert.equal(sameTaskForTrash(normalized,{...normalized,description:'New requirements'}),false);
  assert.equal(sameTaskForTrash(normalized,{...normalized,deleted_at:'2026-10-19T14:00:00Z'}),false);
});

test('undoing pristine task creation moves it to Trash; newer edits refuse the undo', async () => {
  const [snapshot] = await sql('select to_jsonb(t) snapshot from public.tasks t where id=$1',[task]);
  const [action] = await sql(`insert into public.agent_actions(user_id,kind,title,target,after)
    values($1,'task_create','Created',$2,$3) returning id`,[user,{type:'task',id:task},snapshot.snapshot]);
  await sql("update public.tasks set title='Later edit' where id=$1",[task]);
  await assert.rejects(undo(action.id),/changed since/);
  const [newSnapshot] = await sql('select to_jsonb(t) snapshot from public.tasks t where id=$1',[task]);
  await sql('update public.agent_actions set after=$1 where id=$2',[newSnapshot.snapshot,action.id]);
  await undo(action.id);
  assert.ok((await current()).deleted_at);
  assert.equal((await sql('select task_id from public.time_entries'))[0].task_id,task);
});

test('future timed reminders stay eligible on restore, and a failed restore leaves the task in Trash', async () => {
  await sql("update public.tasks set due_date=current_date+1,due_time='17:00' where id=$1",[task]);
  await ownerChange(true);
  await db.exec(`create or replace function public.reject_trash_audit() returns trigger language plpgsql as
    $$ begin raise exception 'Audit unavailable'; end $$;
    create trigger reject_audit before insert on public.agent_actions for each row execute function public.reject_trash_audit();`);
  await assert.rejects(ownerChange(false),/Audit unavailable/);
  assert.ok((await current()).deleted_at);
  await db.exec('drop trigger reject_audit on public.agent_actions');
  await ownerChange(false);
  assert.equal((await current()).reminder_sent_at,null);
});

test('legacy permanent-deletion logs are refused rather than blindly reinserted', async () => {
  const [action] = await sql(`insert into public.agent_actions(user_id,kind,title,target,before)
    values($1,'task_delete','Legacy',$2,$3) returning *`,[user,{type:'task',id:task},{id:task}]);
  assert.match(planUndo(action).reason,/manual recovery/);
  await assert.rejects(undo(action.id),/Legacy permanent/);
  assert.equal((await current()).deleted_at,null);
});
