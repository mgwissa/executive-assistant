import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { planUndo } from '../src/lib/agentDesk.ts';

// Execute the real Edge handler with an isolated Supabase double. No network,
// credentials, or production tasks are used, including for rollback tests.
const source = await readFile(new URL('../supabase/functions/codex-api/index.ts', import.meta.url), 'utf8');
const compile = (text) => ts.transpileModule(text.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const edgeJs = compile(source);
const now = '2026-09-22T14:30:00.000Z';
const previousPriorityAt = '2026-09-08T19:23:10.375Z';
const priorities = ['critical', 'urgent', 'high', 'normal', 'low'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function setup({ task = {}, scopes = ['workspace:write'], revoked = false, validUser = true, failAudit = false, failTaskWrite = false, rpcResult = null } = {}) {
  const original = {
    id: 'task', user_id: 'owner', title: 'Build Strikeouts report', done: false,
    deleted_at: null, restored_at: null,
    priority: 'normal', priority_set_at: previousPriorityAt,
    due_date: null, due_time: null, review_date: null,
    reminder_sent_at: null, description: 'Preserve the report requirements.',
    waiting_on: null, tags: ['analytics'], ...task,
  };
  const tables = {
    tasks: [clone(original), { ...clone(original), id: 'foreign-task', user_id: 'other' }],
    agent_actions: [], agent_runs: [],
    email_review_cases: [], email_review_intakes: [],
    agent_connections: [{ id: 'connection', user_id: 'owner', oauth_client_id: 'client',
      auth_kind: 'oauth', name: 'Test agent', scopes, revoked_at: revoked ? now : null }],
  };
  const writes = [];
  const rpcCalls = [];
  let handler;
  let serial = 0;
  const db = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: clone(args) });
      return rpcResult ?? { data: { ok: true, kind: args.p_input.kind, targetId: args.p_input.taskId, actionId: 'lifecycle-audit' }, error: null };
    },
    auth: { getUser: async () => ({ data: { user: validUser ? { id: 'owner' } : null }, error: validUser ? null : { message: 'Invalid token' } }) },
    from(table) {
      assert.ok(table in tables, `Unexpected table: ${table}`);
      let op = 'select';
      let values;
      const filters = [];
      const nonNull = [];
      const orders = [];
      let bounds;
      let columns = '*';
      const execute = () => {
        const rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value) && nonNull.every(key => row[key] != null));
        if (op !== 'select') writes.push({ table, op, values: clone(values ?? {}), filters: clone(filters) });
        if (op === 'insert' && table === 'agent_actions' && failAudit) return { data: null, error: { message: 'Audit unavailable' } };
        if (op === 'update' && table === 'tasks' && failTaskWrite) return { data: null, error: { message: 'Task write failed' } };
        let result = rows;
        if (op === 'insert') {
          const row = { id: `${table}-${++serial}`, ...clone(values) };
          tables[table].push(row);
          result = [row];
        } else if (op === 'update') {
          rows.forEach(row => Object.assign(row, clone(values)));
        } else if (op === 'delete') {
          tables[table] = tables[table].filter(row => !rows.includes(row));
        }
        if (op === 'select') {
          result.sort((a, b) => {
            for (const [key, ascending] of orders) {
              const comparison = String(a[key]).localeCompare(String(b[key]));
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          if (bounds) result = result.slice(bounds[0], bounds[1] + 1);
        }
        return { data: result.map(row => columns === '*' ? clone(row) : Object.fromEntries(columns.split(',').map(key => [key, row[key]]))), error: null };
      };
      const query = {
        select(value) { columns = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        not(key, operator, value) { assert.equal(operator, 'is'); assert.equal(value, null); nonNull.push(key); return query; },
        order(key, { ascending = true } = {}) { orders.push([key, ascending]); return query; },
        range(start, end) { bounds = [start, end]; return query; },
        limit(count) { bounds = [0, count - 1]; return query; },
        insert(value) { op = 'insert'; values = value; return query; },
        update(value) { op = 'update'; values = value; return query; },
        delete() { op = 'delete'; return query; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
        async single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  vm.runInNewContext(edgeJs, {
    Deno: {
      env: { get: key => ({ SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'anon-placeholder', SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder' })[key] },
      serve: fn => { handler = fn; },
    },
    createClient: () => db, Response, atob, Date: TestDate,
  });
  const token = `test.${Buffer.from(JSON.stringify({ client_id: 'client' })).toString('base64url')}.test`;
  return {
    original, tables, writes, db, rpcCalls,
    async request(body) {
      const response = await handler(new Request('https://test.invalid/codex-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }));
      return { status: response.status, ...await response.json() };
    },
    async apply(action, { authenticated = true } = {}) {
      const response = await handler(new Request('https://test.invalid/codex-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'mutate', actions: [action], userId: 'other' }),
      }));
      return { status: response.status, ...await response.json() };
    },
  };
}

const update = (priority, extra = {}) => ({ kind: 'task_update', taskId: 'task', patch: { priority }, ...extra });

test('all five explicit priorities update with a server timestamp, ownership and undoable audit', async () => {
  for (const priority of priorities) {
    const app = setup({ task: { priority: priority === 'normal' ? 'high' : 'normal' } });
    const result = await app.apply(update(priority, { rationale: 'User explicitly chose this priority' }));
    assert.equal(result.status, 200);
    assert.equal(result.applied, 1);
    assert.deepEqual(app.tables.tasks[0], { ...app.original, priority, priority_set_at: now });
    const [audit] = app.tables.agent_actions;
    assert.equal(audit.user_id, 'owner');
    assert.equal(audit.agent_connection_id, 'connection');
    assert.equal(audit.actor_name, 'Test agent');
    assert.equal(audit.rationale, 'User explicitly chose this priority');
    assert.deepEqual(audit.before, { priority: app.original.priority, priority_set_at: previousPriorityAt });
    assert.deepEqual(audit.after, { priority, priority_set_at: now });
    const undo = planUndo(audit);
    assert.deepEqual(undo, { op: 'patch_task', taskId: 'task', patch: audit.before });
    await app.db.from('tasks').update(undo.patch).eq('id', undo.taskId).eq('user_id', 'owner');
    assert.deepEqual(app.tables.tasks[0], app.original);
  }
});

test('low priority without a deadline stays undated; existing schedules are unchanged', async () => {
  for (const task of [{}, { due_date: '2026-09-25', due_time: '17:00', review_date: '2026-09-24', reminder_sent_at: now }]) {
    const app = setup({ task });
    await app.apply(update('low'));
    assert.deepEqual(app.tables.tasks[0], { ...app.original, priority: 'low', priority_set_at: now });
  }
});

test('an explicit combined priority and date-clear patch is fully audited and reversible', async () => {
  const app = setup({ task: { due_date: '2026-09-09', due_time: '17:00', review_date: '2026-09-24', reminder_sent_at: now } });
  await app.apply(update('low', { patch: { priority: 'low', due_date: null } }));
  assert.deepEqual(app.tables.tasks[0], { ...app.original, priority: 'low', priority_set_at: now, due_date: null, due_time: null, reminder_sent_at: null });
  const undo = planUndo(app.tables.agent_actions[0]);
  await app.db.from('tasks').update(undo.patch).eq('id', undo.taskId);
  assert.deepEqual(app.tables.tasks[0], app.original);
});

test('invalid priorities reject the entire update or creation before a task write', async () => {
  for (const priority of [null, '', 'later', 'LOW', ' low ', 'P4', 4, false, [], {}]) {
    for (const action of [update(priority, { patch: { description: 'Must not be saved', priority } }),
      { kind: 'task_create', task: { title: 'Must not be created', priority } }]) {
      const app = setup();
      const result = await app.apply(action);
      assert.equal(result.ok, false);
      assert.match(result.results[0].error, /priority must be/);
      assert.deepEqual(app.tables.tasks[0], app.original);
      assert.equal(app.writes.filter(w => w.table === 'tasks').length, 0);
      assert.equal(app.tables.agent_actions.length, 0);
    }
  }
});

test('same-priority retries do not reset priority age or create an audit action', async () => {
  const app = setup({ task: { priority: 'low' } });
  const result = await app.apply(update('low'));
  assert.equal(result.results[0].skipped, 'unchanged');
  assert.equal(result.applied, 0);
  assert.deepEqual(app.tables.tasks[0], app.original);
  assert.equal(app.tables.agent_actions.length, 0);
  assert.equal(app.writes.filter(w => w.table === 'tasks').length, 0);
  await app.apply(update('low', { patch: { priority: 'low', description: 'Keep this change' } }));
  assert.deepEqual(app.tables.agent_actions[0].after, { description: 'Keep this change' });
  assert.equal(app.tables.tasks[0].priority_set_at, previousPriorityAt);
});

test('ordinary edits and completion preserve priority; client timestamps are never writable', async () => {
  const app = setup({ task: { priority: 'high' } });
  await app.apply(update(undefined, { patch: { description: 'Updated context', priority_set_at: '2000-01-01', user_id: 'other' } }));
  assert.deepEqual(app.tables.agent_actions[0].after, { description: 'Updated context' });
  await app.apply({ kind: 'task_complete', taskId: 'task' });
  assert.equal(app.tables.tasks[0].done, true);
  assert.equal(app.tables.tasks[0].priority, 'high');
  assert.equal(app.tables.tasks[0].priority_set_at, previousPriorityAt);
  await app.apply(update('low', { patch: { priority: 'low', priority_set_at: '2000-01-01' } }));
  assert.equal(app.tables.tasks[0].priority_set_at, now);
});

test('task creation honors explicit priority and keeps normal as the omitted default', async () => {
  for (const priority of [undefined, ...priorities]) {
    const app = setup();
    const result = await app.apply({ kind: 'task_create', task: { title: 'New report', priority, priority_set_at: '2000-01-01', user_id: 'other' } });
    assert.equal(result.ok, true);
    const created = app.tables.tasks.find(t => t.id === result.results[0].targetId);
    assert.equal(created.priority, priority ?? 'normal');
    assert.equal(created.priority_set_at, now);
    assert.equal(created.user_id, 'owner');
    assert.equal(created.done, false);
    assert.equal(created.due_date, undefined);
    assert.deepEqual(app.tables.agent_actions[0].after, created);
  }
});

test('foreign or missing tasks cannot be changed', async () => {
  for (const taskId of ['foreign-task', 'missing']) {
    const app = setup();
    const before = clone(app.tables.tasks);
    const result = await app.apply(update('low', { taskId }));
    assert.equal(result.ok, false);
    assert.match(result.results[0].error, /task not found/);
    assert.deepEqual(app.tables.tasks, before);
    assert.equal(app.tables.agent_actions.length, 0);
  }
});

test('missing login, invalid login, revoked clients and read-only scope cannot update priority', async () => {
  for (const [options, requestOptions, status] of [[{}, { authenticated: false }, 401],
    [{ validUser: false }, {}, 401], [{ revoked: true }, {}, 401], [{ scopes: ['context:read'] }, {}, 403]]) {
    const app = setup(options);
    const result = await app.apply(update('low'), requestOptions);
    assert.equal(result.status, status);
    assert.equal(app.writes.filter(w => w.table === 'tasks').length, 0);
    assert.equal(app.tables.agent_actions.length, 0);
  }
});

test('audit failure rolls back priority, its timestamp and all accompanying edits', async () => {
  const app = setup({ failAudit: true, task: { due_date: '2026-09-09', due_time: '17:00', reminder_sent_at: now } });
  const result = await app.apply(update('low', { patch: { priority: 'low', due_date: null, description: 'Updated context' } }));
  assert.equal(result.ok, false);
  assert.equal(result.results[0].error, 'Audit unavailable');
  assert.deepEqual(app.tables.tasks[0], app.original);
  assert.equal(app.tables.agent_actions.length, 0);
});

test('task write failure does not leave a successful audit', async () => {
  const app = setup({ failTaskWrite: true });
  const result = await app.apply(update('low'));
  assert.equal(result.ok, false);
  assert.deepEqual(app.tables.tasks[0], app.original);
  assert.equal(app.tables.agent_actions.length, 0);
});

test('a dedupe retry cannot reapply a later-reversed priority change', async () => {
  const app = setup();
  const action = update('low', { dedupeKey: 'explicit-low-task' });
  await app.apply(action);
  const undo = planUndo(app.tables.agent_actions[0]);
  await app.db.from('tasks').update(undo.patch).eq('id', undo.taskId);
  const result = await app.apply(action);
  assert.equal(result.results[0].skipped, 'duplicate');
  assert.deepEqual(app.tables.tasks[0], app.original);
  assert.equal(app.tables.agent_actions.length, 1);
});

test('MCP discovery advertises priority for create/update and keeps unrelated patch fields available', async () => {
  const mcpSource = await readFile(new URL('../supabase/functions/executive-assistant-mcp/index.ts', import.meta.url), 'utf8');
  const tools = vm.runInNewContext(`${compile(mcpSource)}\nTOOLS;`, { Deno: { serve() {} } });
  const tool = tools.find(t => t.name === 'apply_workspace_actions');
  const fields = tool.inputSchema.properties.actions.items.properties;
  for (const key of ['task', 'patch']) {
    assert.deepEqual(clone(fields[key].properties.priority.enum), priorities);
    assert.equal(fields[key].additionalProperties, true);
  }
  assert.match(tool.description, /explicit priority changes/);
  assert.doesNotMatch(tool.description, /cannot.*change legacy priority/);
  assert.ok(tools.some(t => t.name === 'list_trashed_tasks' && t.annotations.readOnlyHint));
  assert.equal(fields.expectedUpdatedAt.format, 'date-time');
  assert.match(tool.description, /Permanent deletion/);
});

test('Trash and Restore delegate to the atomic RPC with verified identity, never body-supplied identity', async () => {
  const app = setup();
  for (const kind of ['task_delete','task_restore']) {
    const response = await app.apply({ kind, taskId:'task', expectedUpdatedAt:now, userId:'other' });
    assert.equal(response.results[0].ok,true);
    const call = app.rpcCalls.at(-1);
    assert.equal(call.name,'apply_task_trash_action');
    assert.equal(call.args.p_user_id,'owner');
    assert.equal(call.args.p_connection_id,'connection');
    assert.equal(call.args.p_input.kind,kind);
  }
  assert.equal(app.writes.filter(w=>w.table==='tasks').length,0);
});

test('lifecycle requests require a fresh explicit version and write scope; errors are surfaced', async () => {
  for (const expectedUpdatedAt of [undefined,null,'not-a-date']) {
    const app = setup();
    const response = await app.apply({kind:'task_delete',taskId:'task',expectedUpdatedAt});
    assert.equal(response.results[0].ok,false);
    assert.equal(app.rpcCalls.length,0);
  }
  const readOnly = setup({scopes:['context:read']});
  assert.equal((await readOnly.apply({kind:'task_delete',taskId:'task',expectedUpdatedAt:now})).status,403);
  assert.equal(readOnly.rpcCalls.length,0);
  const failure = setup({rpcResult:{data:null,error:{message:'Task changed since it was read'}}});
  const response = await failure.apply({kind:'task_delete',taskId:'task',expectedUpdatedAt:now});
  assert.equal(response.results[0].ok,false);
  assert.match(response.results[0].error,/changed since/);
});

test('ordinary MCP edits cannot change or revive a task in Trash', async () => {
  const app = setup({task:{deleted_at:now}});
  const response = await app.apply({kind:'task_update',taskId:'task',patch:{title:'Revived',deleted_at:null}});
  assert.equal(response.results[0].ok,false);
  assert.equal(app.writes.filter(w=>w.table==='tasks').length,0);
});

test('Trash inventory is owned, paginated, read-scoped and excludes active tasks', async () => {
  const app = setup({ scopes: ['context:read'] });
  for (let i = 0; i < 51; i += 1) app.tables.tasks.push({ ...app.original,
    id: `trash-${String(i).padStart(3, '0')}`, deleted_at: now, updated_at: now });
  app.tables.tasks.push({ ...app.original, id: 'foreign-trash', user_id: 'other', deleted_at: now });
  const first = await app.request({ action: 'tasks.trash', userId: 'other' });
  assert.equal(first.status, 200);
  assert.equal(first.tasks.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.tasks[0].id, 'trash-000');
  assert.ok(first.tasks.every(task => task.deleted_at && !('description' in task)));
  const second = await app.request({ action: 'tasks.trash', offset: first.nextOffset });
  assert.equal(second.tasks.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextOffset, null);
  for (const offset of [-1, 1.5, '50', 10001]) {
    assert.equal((await app.request({ action: 'tasks.trash', offset })).status, 400);
  }
  assert.equal((await setup().request({ action: 'tasks.trash' })).status, 403);
  assert.equal(app.writes.filter(write => write.table !== 'agent_connections').length, 0);
});

test('multiple lifecycle targets are refused before creating a run or writing anything', async () => {
  const app = setup();
  const result = await app.request({ action: 'mutate', actions: [
    { kind: 'task_delete', taskId: 'task', expectedUpdatedAt: now },
    { kind: 'task_restore', taskId: 'another-task', expectedUpdatedAt: now },
  ] });
  assert.equal(result.status, 400);
  assert.match(result.error, /one explicitly identified task/);
  assert.equal(app.writes.filter(write => write.table !== 'agent_connections').length, 0);
  assert.equal(app.rpcCalls.length, 0);
});

test('email intake delegates atomically with verified principal and write scope', async () => {
  const app = setup({ rpcResult: { data: { ok: true, kind: 'email_review_intake', targetId: 'receipt', actionId: 'audit' }, error: null } });
  const payload = { kind: 'email_review_intake', dedupeKey: 'email-test', intake: { mailbox: 'hello@autofinder.com' }, cases: [], userId: 'foreign' };
  assert.equal((await app.apply(payload)).status, 200);
  const [call] = app.rpcCalls;
  assert.equal(call.name, 'apply_agent_email_review_intake');
  assert.equal(call.args.p_user_id, 'owner'); assert.equal(call.args.p_connection_id, 'connection');
  assert.equal(call.args.p_input.userId, 'foreign'); // untrusted payload never selects the principal
  assert.equal((await setup({ scopes: ['context:read'] }).apply(payload)).status, 403);
  const failure = setup({ rpcResult: { data: null, error: { message: 'Audit rolled back' } } });
  assert.equal((await failure.apply(payload)).results[0].ok, false);
});

test('saved email context is owned, paginated and read-scoped, never a mailbox operation', async () => {
  const app = setup({ scopes: ['context:read'] });
  for (let i = 0; i < 51; i++) app.tables.email_review_cases.push({ id: `case-${String(i).padStart(3,'0')}`, user_id: 'owner', received_at: now });
  app.tables.email_review_cases.push({ id: 'foreign', user_id: 'other', received_at: now });
  app.tables.email_review_intakes.push({ id: 'complete', user_id: 'owner', created_at: now, covered_through: now, complete: true });
  const first = await app.request({ action: 'email.review', userId: 'other' });
  assert.equal(first.status, 200); assert.equal(first.cases.length, 50); assert.equal(first.hasMore, true);
  assert.equal(first.lastCompleteIntake.id, 'complete');
  const second = await app.request({ action: 'email.review', offset: first.nextOffset });
  assert.equal(second.cases.length, 1); assert.equal(second.hasMore, false); assert.equal(second.nextOffset, null);
  assert.equal((await setup().request({ action: 'email.review' })).status, 403);
  assert.equal((await app.request({ action: 'email.review', offset: -1 })).status, 400);
  assert.equal(app.writes.filter(w => w.table !== 'agent_connections').length, 0);
});
