import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { readRefinementProgress } from '../supabase/functions/_shared/refinementProgress.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const savedAt = '2026-11-23T15:00:00.123456+00:00';
const progress = (itemId, status = 'complete', userId = 'owner') => ({
  user_id: userId, note_id: 'older-source-note', source_id: 'fictional:refinement:2026-11-17',
  item_kind: 'action', item_id: itemId, status, created_at: savedAt, updated_at: savedAt,
});

// The actual helper/Edge handler run against an isolated transport. No network or
// owner progress RPC is available; any unexpected table or write fails the test.
function transport({ rows = [], scopes = ['context:read'], progressError = null,
  throwProgress = false, leakProgress = false, nullProgress = false } = {}) {
  const tables = {
    profiles: [{ user_id: 'owner', timezone: 'America/New_York', first_name: 'Test owner' }],
    tasks: [], events: [], notebooks: [], sections: [], workstreams: [], note_workstreams: [],
    agent_actions: [], agent_briefs: [],
    notes: [
      { id: 'current-source-copy', user_id: 'owner', title: 'Refinement 2026-11-17',
        content: 'Fictional source recap.', updated_at: savedAt, linked_event_id: null,
        linked_occurrence_start_at: null, triaged_at: null, scratch_at: null },
      { id: 'foreign-note', user_id: 'other', title: 'Refinement 2026-11-17', content: 'Foreign recap.', updated_at: savedAt },
    ],
    refinement_item_progress: rows,
    agent_connections: [{ id: 'connection', user_id: 'owner', oauth_client_id: 'client',
      auth_kind: 'oauth', name: 'Fictional agent', scopes, revoked_at: null }],
  };
  const queries = [];
  const writes = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    from(table) {
      assert.ok(table in tables, `Unexpected table ${table}`);
      const query = { table, fields: '*', equals: [], orders: [], limit: null, values: null };
      queries.push(query);
      const execute = () => {
        if (table === 'refinement_item_progress') {
          if (throwProgress) throw new Error('Fictional transport failure');
          if (progressError || nullProgress) return { data: null, error: progressError };
        }
        let selected = tables[table].filter(row => (table === 'refinement_item_progress' && leakProgress)
          || query.equals.every(([key, value]) => row[key] === value));
        if (query.values) {
          assert.equal(table, 'agent_connections', 'reads must not modify owner progress or workspace content');
          writes.push({ table, values: clone(query.values) });
          selected.forEach(row => Object.assign(row, query.values));
        }
        selected = [...selected].sort((a, b) => {
          for (const [field, ascending] of query.orders) {
            const difference = String(a[field]).localeCompare(String(b[field]));
            if (difference) return ascending ? difference : -difference;
          }
          return 0;
        });
        if (query.limit !== null) selected = selected.slice(0, query.limit);
        return { data: selected.map(row => query.fields === '*' ? clone(row)
          : Object.fromEntries(query.fields.split(',').map(field => [field, row[field]]))), error: null };
      };
      const chain = {
        select(fields) { query.fields = fields; return chain; },
        eq(key, value) { query.equals.push([key, value]); return chain; },
        is(key, value) { return chain.eq(key, value); },
        gte() { return chain; }, lte() { return chain; }, or() { return chain; },
        order(key, { ascending = true } = {}) { query.orders.push([key, ascending]); return chain; },
        limit(count) { query.limit = count; return chain; },
        update(values) { query.values = values; return chain; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return chain;
    },
  };
  return { db, queries, writes };
}

test('progress reader scopes all statuses to verified owner and uses stable source/item identity', async () => {
  const app = transport({ rows: [progress('completed'), progress('active', 'in_progress'),
    { ...progress('reopened', 'not_started'), item_kind: 'story' }, progress('foreign', 'complete', 'other')] });
  const result = await readRefinementProgress(app.db, 'owner');
  assert.deepEqual({ available: result.available, complete: result.complete, truncated: result.truncated },
    { available: true, complete: true, truncated: false });
  assert.deepEqual(result.items.map(row => row.status).sort(), ['complete', 'in_progress', 'not_started']);
  assert.equal(result.items.some(row => row.item_id === 'foreign'), false);
  assert.ok(result.items.every(row => !('user_id' in row) && !('note_id' in row) && !('created_at' in row)));
  const [query] = app.queries;
  assert.equal(query.table, 'refinement_item_progress');
  assert.equal(query.fields, 'user_id,source_id,item_kind,item_id,status,updated_at');
  assert.deepEqual(query.equals, [['user_id', 'owner']], 'an older note anchor must not hide stable source progress');
  assert.deepEqual(query.orders, [['updated_at', false], ['source_id', true], ['item_kind', true], ['item_id', true]]);
  assert.equal(query.limit, 501);
  assert.deepEqual(app.writes, []);
});

test('failed, thrown or null progress reads stay explicitly unavailable rather than complete and empty', async () => {
  for (const options of [{ progressError: { message: 'Fictional private database detail' } },
    { throwProgress: true }, { nullProgress: true }]) {
    const app = transport(options);
    const result = await readRefinementProgress(app.db, 'owner');
    assert.deepEqual({ available: result.available, complete: result.complete, truncated: result.truncated, items: result.items },
      { available: false, complete: false, truncated: false, items: [] });
    assert.match(result.limitation, /Do not assume not_started or replay/);
    assert.doesNotMatch(result.limitation, /private database detail/);
    assert.deepEqual(app.writes, []);
  }
  const app = transport();
  assert.equal((await readRefinementProgress(app.db, '')).available, false);
  assert.equal(app.queries.length, 0);
});

test('invalid identities, unknown statuses, duplicate keys and unexpected foreign rows fail closed', async () => {
  for (const rows of [
    [{ ...progress('bad-status'), status: 'done' }],
    [{ ...progress('bad-id'), item_id: 'https://example.invalid/item' }],
    [{ ...progress('bad-time'), updated_at: 'not-a-timestamp' }],
    [progress('duplicate'), progress('duplicate', 'not_started')],
    [progress('foreign', 'complete', 'other')],
  ]) {
    const app = transport({ rows, leakProgress: true });
    const result = await readRefinementProgress(app.db, 'owner');
    assert.equal(result.available, false);
    assert.equal(result.complete, false);
    assert.deepEqual(result.items, []);
  }
});

for (const extraRow of [false, true]) {
  test(`bounded progress coverage is ${extraRow ? 'partial with' : 'complete without'} the sentinel row`, async () => {
    const rows = Array.from({ length: extraRow ? 501 : 500 }, (_, index) => progress(`item-${String(index).padStart(4, '0')}`));
    const result = await readRefinementProgress(transport({ rows }).db, 'owner');
    assert.equal(result.available, true);
    assert.equal(result.complete, !extraRow);
    assert.equal(result.truncated, extraRow);
    assert.equal(result.items.length, 500);
    assert.equal(result.items.some(row => row.item_id === 'item-0500'), false);
    if (extraRow) assert.match(result.limitation, /Missing items are unknown/);
    else assert.equal(result.limitation, undefined);
  });
}

const compile = source => ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const edgeSource = readFileSync(new URL('../supabase/functions/codex-api/index.ts', import.meta.url), 'utf8');
const edgeJs = compile(edgeSource);
function handler(options) {
  const app = transport(options);
  let serve;
  let calendarReads = 0;
  vm.runInNewContext(edgeJs, {
    Deno: { env: { get: () => 'test-placeholder' }, serve(fn) { serve = fn; } },
    createClient: () => app.db, Response, atob,
    localDateString: () => '2026-11-23', parseDayPlan: () => ({ meetingChoices: [], questions: [] }),
    whoopDiscovery: async () => ({ available: false }), readRefinementProgress,
    refreshOutlookCalendar: async (_db, owner) => {
      assert.equal(owner, 'owner'); calendarReads++;
      return { status: 'not_authorized', message: 'Fictional saved calendar only.' };
    },
  });
  const token = `test.${Buffer.from(JSON.stringify({ client_id: 'client' })).toString('base64url')}.test`;
  return { ...app, calendarReads: () => calendarReads, async request(body, authenticated = true) {
    const response = await serve(new Request('https://example.invalid/codex-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test('actual workspace and note-search responses include owned progress without replaying or changing it', async () => {
  const app = handler({ rows: [progress('completed'), progress('foreign', 'complete', 'other')] });
  const context = await app.request({ action: 'context', userId: 'other' });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.refinementProgress.complete, true);
  assert.deepEqual(context.body.context.refinementProgress.items.map(row => row.item_id), ['completed']);
  assert.equal(app.calendarReads(), 1);
  const search = await app.request({ action: 'notes.search', query: 'Refinement', userId: 'other' });
  assert.equal(search.status, 200);
  assert.deepEqual(search.body.notes.map(note => note.id), ['current-source-copy']);
  assert.equal(search.body.refinementProgress.items[0].item_id, 'completed');
  assert.equal(search.body.refinementProgress.items[0].status, 'complete');
  assert.equal(app.calendarReads(), 1, 'note search must not trigger another calendar refresh');
  for (const query of app.queries.filter(query => query.table === 'refinement_item_progress')) {
    assert.deepEqual(query.equals, [['user_id', 'owner']]);
    assert.equal(query.values, null);
  }
  assert.ok(app.writes.every(write => write.table === 'agent_connections'));
});

test('progress unavailability is visible alongside otherwise readable workspace and source notes', async () => {
  const app = handler({ progressError: { message: 'Fictional table unavailable' } });
  const context = await app.request({ action: 'context' });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.calendarSync.status, 'not_authorized');
  assert.equal(context.body.context.refinementProgress.available, false);
  assert.equal(context.body.context.refinementProgress.complete, false);
  const search = await app.request({ action: 'notes.search', query: 'Refinement' });
  assert.equal(search.status, 200);
  assert.equal(search.body.notes.length, 1);
  assert.equal(search.body.refinementProgress.available, false);
  assert.equal(search.body.refinementProgress.complete, false);
});

test('existing context read scope gates both progress surfaces before any progress read', async () => {
  for (const body of [{ action: 'context' }, { action: 'notes.search', query: 'Refinement' }]) {
    const app = handler({ scopes: ['workspace:write'], rows: [progress('completed')] });
    assert.equal((await app.request(body)).status, 403);
    assert.equal(app.queries.some(query => query.table === 'refinement_item_progress'), false);
    assert.equal(app.calendarReads(), 0);
    assert.equal((await app.request(body, false)).status, 401);
  }
});

test('MCP discovery explains owner precedence, reopen and unavailable coverage without exposing progress writes', () => {
  const source = readFileSync(new URL('../supabase/functions/executive-assistant-mcp/index.ts', import.meta.url), 'utf8');
  const tools = vm.runInNewContext(`${compile(source)}\nTOOLS;`, { Deno: { serve() {} } });
  for (const name of ['get_workspace_context', 'search_notes']) {
    const description = tools.find(tool => tool.name === name).description;
    assert.match(description, /exact source_id, item_kind and item_id/);
    assert.match(description, /not_started is an explicit reopen/);
    assert.match(description, /missing progress is unknown/);
    assert.match(description, /does not complete linked tasks, change ADO/);
  }
  assert.equal(tools.some(tool => /refinement|progress/.test(tool.name)), false);
  assert.match(source, /instructions:[^\r\n]+REFINEMENT_PROGRESS_GUIDANCE/);
});
