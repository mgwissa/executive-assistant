import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as savedPlan from '../supabase/functions/_shared/dayPlan.ts';
import { planUndo } from '../src/lib/agentDesk.ts';

// Load the actual pure TS graph in memory; no emitted files or production I/O.
const nativeRequire = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();
function loadTs(path) {
  path = resolve(root, path);
  if (!existsSync(path)) path += '.ts';
  if (cache.has(path)) return cache.get(path).exports;
  const module = { exports: {} };
  cache.set(path, module);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require, module, exports) { ${js}\n})`, { filename: path })(
    (name) => name.startsWith('.') ? loadTs(resolve(dirname(path), name)) : nativeRequire(name), module, module.exports,
  );
  return module.exports;
}
const { buildTodayViewModel } = loadTs('src/lib/today.ts');
const { computeCapacitySnapshot } = loadTs('src/lib/taskCapacity.ts');
const now = new Date('2026-10-07T12:00:00Z');
const dayEnd = new Date('2026-10-07T21:00:00Z');
const a = { eventId: 'a', title: 'Data validation', startAt: '2026-10-07T17:00:00Z', endAt: '2026-10-07T17:30:00Z' };
const b = { eventId: 'b', title: 'MaryEllen 1:1', startAt: '2026-10-07T17:00:00+00:00', endAt: '2026-10-07T18:00:00Z' };
const choice = { meetings: [a, b], selectedEventId: 'a' };
const plan = { meetingChoices: [choice], questions: [] };
const event = (m, extra = {}) => ({ id: m.eventId, title: m.title, start_at: m.startAt,
  duration_minutes: (Date.parse(m.endAt) - Date.parse(m.startAt)) / 60000,
  recurrence: 'none', source: 'outlook_ics', outlook_cancelled_at: null, timezone: 'America/New_York', ...extra });
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, done: false, due_date: null, review_date: null,
  due_time: null, waiting_on: null, estimated_minutes: null, ...extra });
const model = (extra = {}) => buildTodayViewModel({ now, timezone: 'America/New_York', events: [event(a), event(b)],
  tasks: [], notes: [], focusPrefs: { stack: [], snoozedUntil: {} }, dayPlan: plan, calendarVerified: true, ...extra });

test('a saved answer suppresses the question without mutating either invitation', () => {
  const events = [event(a), event(b)];
  const original = structuredClone(events);
  const view = model({ events });
  assert.equal(view.decision, null);
  assert.equal(view.agenda.length, 2);
  assert.equal(view.agenda.find(x => x.eventId === 'a').attendance, 'selected');
  assert.equal(view.agenda.find(x => x.eventId === 'b').attendance, 'not_attending');
  assert.ok(view.openWindows.some(x => x.start.toISOString() === a.endAt.replace('Z', '.000Z')));
  assert.deepEqual(events, original);
});

test('reschedule, changed title/duration, or missing occurrence invalidate a saved answer', () => {
  for (const patch of [{ start_at: '2026-10-07T17:10:00Z' }, { title: 'Changed purpose' }, { duration_minutes: 45 }]) {
    const view = model({ events: [event(a, patch), event(b)] });
    assert.equal(view.decision.kind, 'meeting');
    assert.ok(view.agenda.every(x => !x.attendance));
  }
  assert.equal(model({ events: [event(a), event(b, { outlook_cancelled_at: now.toISOString() })] }).agenda.length, 1);
  assert.equal(model({ events: [event(a)] }).agenda[0].attendance, undefined);
});

test('only unresolved future overlaps interrupt; nested conflicts are not missed', () => {
  assert.equal(model({ dayPlan: savedPlan.parseDayPlan(null) }).decision.kind, 'meeting');
  assert.equal(model({ now: new Date('2026-10-07T18:00:00Z'), dayPlan: savedPlan.parseDayPlan(null) }).decision, null);
  const long = { ...a, endAt: '2026-10-07T20:00:00Z' };
  const short = { ...b, endAt: '2026-10-07T17:15:00Z' };
  const later = { ...a, eventId: 'c', title: 'Later', startAt: '2026-10-07T19:00:00Z', endAt: '2026-10-07T19:30:00Z' };
  assert.equal(model({ events: [event(long), event(short), event(later)], dayPlan: savedPlan.parseDayPlan(null), now: new Date('2026-10-07T18:00:00Z') }).decision.kind, 'meeting');
});

test('unknown or unverified calendars never establish open windows', () => {
  assert.deepEqual(model({ calendarVerified: false }).openWindows, []);
  assert.deepEqual(model({ calendarVerified: false, events: [] }).openWindows, []);
});

test('focus follows the saved queue, not overdue backlog; done, waiting and snoozed stay out', () => {
  const tasks = [task('overdue', { due_date: '2026-10-02' }), task('first'), task('second'), task('done', { done: true }),
    task('waiting', { waiting_on: 'Layne' }), task('snoozed'), task('future', { due_date: '2026-11-01' })];
  const view = model({ tasks, focusPrefs: { stack: ['first', 'second', 'done', 'waiting', 'snoozed'].map(taskId => ({ kind: 'task', taskId,
    reason: 'User chose this', nextAction: 'Concrete next action' })), snoozedUntil: { 'task:snoozed': '2026-10-08' } } });
  assert.deepEqual(view.focus.map(x => x.taskId), ['first', 'second']);
  assert.equal(view.focus[0].nextAction, 'Concrete next action');
  assert.equal(view.summary.overdueCount, 1);
  assert.deepEqual(model({ tasks }).focus, []);
});

test('resolved questions and questions linked to completed or waiting tasks do not interrupt', () => {
  const questions = [{ id: 'answered', prompt: 'Already answered?', status: 'resolved' },
    { id: 'done', prompt: 'Completed?', status: 'open', taskId: 'done' },
    { id: 'next', prompt: 'Actual question?', status: 'open' }];
  const view = model({ tasks: [task('done', { done: true })], dayPlan: { ...plan, questions } });
  assert.equal(view.decision.id, 'next');
  assert.equal(model({ tasks: [task('done', { waiting_on: 'External owner' })], dayPlan: { ...plan, questions } }).decision.id, 'next');
});

test('brief reruns preserve decisions, partial writes preserve questions, explicit [] clears', () => {
  const previous = { calendarRefreshStatus: 'synced', dayPlan: plan };
  assert.deepEqual(savedPlan.mergeBriefStats(previous, { due: 2 }).dayPlan, plan);
  assert.deepEqual(savedPlan.mergeBriefStats(previous, { dayPlan: { questions: [] } }).dayPlan.meetingChoices, [choice]);
  assert.deepEqual(savedPlan.mergeBriefStats(previous, { dayPlan: { meetingChoices: [] } }).dayPlan.meetingChoices, []);
  assert.throws(() => savedPlan.mergeBriefStats(previous, { dayPlan: null }), /object/);
  const question = { id: 'q', prompt: 'Answered?', status: 'resolved' };
  const answered = savedPlan.mergeBriefStats({ dayPlan: { ...plan, questions: [question] } },
    { dayPlan: { questions: [{ ...question, status: 'open' }] } });
  assert.equal(answered.dayPlan.questions[0].status, 'resolved');
});

test('bad, duplicate, nonoverlapping and contradictory choices fail closed', () => {
  for (const raw of [null, { meetingChoices: [], questions: {} },
    { ...plan, meetingChoices: [{ ...choice, selectedEventId: 'foreign' }] },
    { ...plan, meetingChoices: [choice, choice] },
    { ...plan, meetingChoices: [{ ...choice, meetings: [a, { ...b, startAt: a.endAt }] }] },
    { ...plan, questions: [{ id: 'q', prompt: 'Q?', status: 'maybe' }] }]) {
    assert.ok(savedPlan.validateDayPlan(raw));
    assert.deepEqual(savedPlan.parseDayPlan(raw), { meetingChoices: [], questions: [] });
  }
  const c = { ...b, eventId: 'c' };
  assert.match(savedPlan.validateDayPlan({ ...plan, meetingChoices: [choice, { meetings: [a, c], selectedEventId: 'c' }] }), /contradict/);
});

test('capacity counts suggested work once and overlapping meetings as a union', () => {
  const ref = { kind: 'task', taskId: 'task' };
  const timeline = [
    { id: 'suggested', kind: 'task', suggested: true, ref, start: now, end: new Date(+now + 30 * 60000) },
    ...[a, b].map(x => ({ id: x.eventId, kind: 'meeting', start: new Date(x.startAt), end: new Date(x.endAt) })),
  ];
  const capacity = computeCapacitySnapshot({ now, dayEnd, timeline, gaps: [{ kind: 'untimed_today', ref }], tasks: [task('task')] });
  assert.equal(capacity.meetingMinutes, 60);
  assert.equal(capacity.scheduledWorkMinutes, 30);
  assert.equal(capacity.unscheduledWorkMinutes, 0);
  assert.equal(capacity.bookedMinutes, 90);
});

// Exercise real audited brief writes with an isolated database double.
const edgeSource = readFileSync(resolve(root, 'supabase/functions/codex-api/index.ts'), 'utf8');
const edgeJs = ts.transpileModule(edgeSource.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function edge({ failAudit = false, scopes = ['workspace:write'], existing = true } = {}) {
  const original = { id: 'brief', user_id: 'owner', kind: 'morning', brief_date: '2026-10-07', body: 'Saved brief', stats: { dayPlan: plan }, run_id: null, read_at: null };
  const tables = { agent_briefs: existing ? [structuredClone(original)] : [], agent_actions: [], agent_runs: [],
    events: [event(a, { user_id: 'owner' }), event(b, { user_id: 'owner' }), event({ ...a, eventId: 'foreign' }, { user_id: 'other' })],
    tasks: [task('owned', { user_id: 'owner' }), task('foreign', { user_id: 'other' })],
    agent_connections: [{ id: 'connection', user_id: 'owner', oauth_client_id: 'client', auth_kind: 'oauth', name: 'Test agent', scopes, revoked_at: null }] };
  let handler;
  let serial = 0;
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) }, from(table) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    let op = 'select', values, columns = '*';
    const filters = [];
    const execute = () => {
      let rows = tables[table].filter(row => filters.every(fn => fn(row)));
      if (op === 'insert' && table === 'agent_actions' && failAudit) return { data: null, error: { message: 'Audit unavailable' } };
      if (op === 'upsert') {
        const found = tables[table].find(row => row.user_id === values.user_id && row.kind === values.kind && row.brief_date === values.brief_date);
        if (found) Object.assign(found, structuredClone(values));
        else tables[table].push({ id: `brief-${++serial}`, ...structuredClone(values) });
        rows = [found ?? tables[table].at(-1)];
      } else if (op === 'insert') {
        const row = { id: `${table}-${++serial}`, ...structuredClone(values) };
        tables[table].push(row); rows = [row];
      } else if (op === 'update') rows.forEach(row => Object.assign(row, structuredClone(values)));
      else if (op === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
      return { data: rows.map(row => columns === '*' ? structuredClone(row) : Object.fromEntries(columns.split(',').map(key => [key, row[key]]))), error: null };
    };
    const q = { select(v) { columns = v; return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      is(k, v) { return q.eq(k, v); }, in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      insert(v) { op = 'insert'; values = v; return q; }, upsert(v) { op = 'upsert'; values = v; return q; },
      update(v) { op = 'update'; values = v; return q; }, delete() { op = 'delete'; return q; },
      async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
      single() { return q.maybeSingle(); }, then(ok, fail) { return Promise.resolve(execute()).then(ok, fail); } };
    return q;
  } };
  vm.runInNewContext(edgeJs, { Deno: { env: { get: key => ({ SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] }, serve: fn => { handler = fn; } },
    createClient: () => db, ...savedPlan, Response, atob, Date });
  const token = `test.${Buffer.from(JSON.stringify({ client_id: 'client' })).toString('base64url')}.test`;
  return { tables, original, async apply(stats, { auth = true, key } = {}) {
    const response = await handler(new Request('https://test.invalid/codex-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'mutate', actions: [{ kind: 'brief_write', dedupeKey: key,
        brief: { kind: 'morning', brief_date: original.brief_date, body: 'Updated brief', stats } }] }),
    }));
    return { status: response.status, ...await response.json() };
  } };
}

test('audited brief writes preserve answers across reruns and support retries/undo', async () => {
  const app = edge();
  assert.equal((await app.apply({ due: 3 }, { key: 'rerun' })).applied, 1);
  assert.deepEqual(app.tables.agent_briefs[0].stats.dayPlan, plan);
  assert.equal(app.tables.agent_actions[0].user_id, 'owner');
  assert.deepEqual(app.tables.agent_actions[0].before, app.original);
  assert.deepEqual(planUndo(app.tables.agent_actions[0]), { op: 'restore_brief', row: app.original });
  assert.equal((await app.apply({ due: 4 }, { key: 'rerun' })).results[0].skipped, 'duplicate');
  assert.equal(app.tables.agent_actions.length, 1);
});

test('failed audits restore an existing brief or remove a newly created brief', async () => {
  for (const existing of [true, false]) {
    const app = edge({ failAudit: true, existing });
    assert.equal((await app.apply({ dayPlan: plan })).ok, false);
    assert.deepEqual(app.tables.agent_briefs, existing ? [app.original] : []);
    assert.equal(app.tables.agent_actions.length, 0);
  }
});

test('foreign references, malformed plans, missing auth and readonly scopes cannot write', async () => {
  for (const stats of [{ dayPlan: { ...plan, meetingChoices: [{ ...choice, meetings: [{ ...a, eventId: 'foreign' }, b], selectedEventId: 'foreign' }] } },
    { dayPlan: { questions: [{ id: 'foreign', prompt: 'Foreign?', taskId: 'foreign', status: 'open' }] } },
    { dayPlan: null }]) {
    const app = edge(); assert.equal((await app.apply(stats)).ok, false); assert.deepEqual(app.tables.agent_briefs, [app.original]);
  }
  assert.equal((await edge().apply({}, { auth: false })).status, 401);
  assert.equal((await edge({ scopes: ['context:read'] }).apply({})).status, 403);
});

test('Codex sync refreshes on first observation and retries a failed refresh', async () => {
  const source = readFileSync(resolve(root, 'src/hooks/useCodexSync.ts'), 'utf8');
  const js = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const calls = new Map();
  const stores = {};
  for (const name of ['Agent', 'Notes', 'Notebooks', 'Profile', 'Tasks', 'Workstreams', 'Events', 'MeetingDebrief']) {
    const state = { error: null, profile: { timezone: 'America/New_York' }, fetchAll: async () => {}, fetchProfile: async () => {}, fetchRange: async () => {} };
    for (const method of ['fetchAll', 'fetchProfile', 'fetchRange']) state[method] = async () => calls.set(name, (calls.get(name) ?? 0) + 1);
    stores[`use${name}Store`] = { getState: () => state };
  }
  let actions = [{ id: 'first', kind: 'brief_write' }];
  let clock = 2000;
  let poll;
  const context = { ...stores, exports: {}, useCallback: fn => fn, useRef: current => ({ current }), useEffect: fn => fn(),
    supabase: { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit: async () => ({ data: actions, error: null }) }) },
    eventsFetchIsoRange: () => ({ fromIso: '2026-10-01', toIso: '2026-10-14' }),
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { setInterval(fn) { poll = fn; return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    Date: { now: () => clock }, console: { warn() {} } };
  vm.runInNewContext(js, context);
  context.useCodexSync('owner');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(calls.get('Agent'), 1);
  assert.equal(calls.get('Tasks'), 1);
  assert.equal(calls.get('Profile'), 1);
  assert.equal(calls.get('Events'), 1);
  for (const [name, kind] of [['Tasks', 'task_update'], ['Notes', 'note_append'], ['Workstreams', 'note_workstream'], ['MeetingDebrief', 'calendar_sync']]) {
    actions = [{ id: `new-${name}`, kind }, ...actions];
    const state = stores[`use${name}Store`].getState();
    state.error = 'Failed refresh';
    clock += 2000; poll(); await flush();
    const attempts = calls.get(name);
    state.error = null;
    clock += 2000; poll(); await flush();
    assert.equal(calls.get(name), attempts + 1, `${name} failed refresh must retry`);
    clock += 2000; poll(); await flush();
    assert.equal(calls.get(name), attempts + 1, 'successful cursor should avoid unchanged polling reloads');
  }
});

test('MCP discovery exposes the same saved-plan capture contract', async () => {
  const source = readFileSync(resolve(root, 'supabase/functions/executive-assistant-mcp/index.ts'), 'utf8');
  const js = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let handler;
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    from: () => ({ select() { return this; }, eq() { return this; }, is() { return this; }, maybeSingle: async () => ({ data: { id: 'connection' } }) }),
  });
  vm.runInNewContext(js, { Deno: { env: { get: () => 'test-only' }, serve: fn => { handler = fn; } }, createClient, Response, URL, atob });
  const token = `test.${Buffer.from(JSON.stringify({ client_id: 'test-client' })).toString('base64url')}.test`;
  const call = async (method) => (await handler(new Request('https://test.invalid/mcp', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  }))).json();
  const init = await call('initialize');
  assert.match(init.result.instructions, /stats.dayPlan/);
  assert.match(init.result.instructions, /never modifies Outlook invitations/);
  const tools = (await call('tools/list')).result.tools;
  const apply = tools.find(tool => tool.name === 'apply_workspace_actions');
  assert.match(apply.description, /Omitted decision fields survive/);
  assert.equal(apply.inputSchema.properties.actions.items.properties.brief.properties.stats.type, 'object');
  assert.match(tools.find(tool => tool.name === 'get_workspace_context').description, /context.dayPlan/);
});
