import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { buildRefinementReviewModel } from '../src/lib/refinementReview.ts';

const nativeRequire = createRequire(import.meta.url);
const normalize = value => JSON.parse(JSON.stringify(value));
const note = (id, date = '2026-11-17') => ({
  id,
  title: `Refinement ${date}`,
  content: 'Fictional saved recap remains readable.',
  updated_at: '2026-11-23T15:00:00Z',
});
const meetingIds = store => normalize(store.getState().model.meetings.map(meeting => meeting.noteId)).sort();
const snapshot = store => {
  const { userId, model, loading, error, truncated, loadedAt } = store.getState();
  return normalize({ userId, model, loading, error, truncated, loadedAt });
};
function deferred() {
  let resolve;
  const promise = new Promise(finish => { resolve = finish; });
  return { promise, resolve };
}

// Execute the actual store module; only the Supabase transport is replaced.
// Normalize VM-created arrays/objects before structural assertions.
function loadStore(respond) {
  const queries = [];
  const client = { from(table) {
    const query = { table, equals: [], orders: [] };
    const chain = {
      select(fields) { query.fields = fields; return chain; },
      eq(key, value) { query.equals.push([key, value]); return chain; },
      ilike(key, value) { query.titleFilter = [key, value]; return chain; },
      order(key) { query.orders.push(key); return chain; },
      range(start, end) {
        query.range = [start, end];
        queries.push(query);
        return respond(query);
      },
    };
    return chain;
  } };
  const module = { exports: {} };
  const source = ts.transpileModule(
    readFileSync(new URL('../src/store/useRefinementsStore.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name =>
    name.endsWith('/supabase') ? { supabase: client }
      : name.endsWith('/refinementReview') ? { buildRefinementReviewModel }
        : nativeRequire(name), module, module.exports);
  return { store: module.exports.useRefinementsStore, queries };
}

test('every refinement page is owner scoped and includes all paginated saved meetings', async () => {
  const firstPage = Array.from({ length: 200 }, (_, index) => note(`page-one-${index}`));
  const lastPage = [note('last-page', '2026-11-19')];
  const { store, queries } = loadStore(async query => ({
    data: query.range[0] === 0 ? firstPage : lastPage,
    error: null,
  }));
  await store.getState().fetchAll('owner-a');

  assert.equal(store.getState().error, null);
  assert.equal(store.getState().loading, false);
  assert.equal(store.getState().truncated, false);
  assert.ok(store.getState().loadedAt);
  assert.deepEqual(meetingIds(store), [...firstPage, ...lastPage].map(row => row.id).sort());
  assert.deepEqual(normalize(queries.map(query => query.range)), [[0, 199], [200, 399]]);
  for (const query of queries) {
    assert.equal(query.table, 'notes');
    assert.equal(query.fields, 'id,title,content,updated_at');
    assert.deepEqual(normalize(query.equals), [['user_id', 'owner-a']]);
    assert.deepEqual(normalize(query.titleFilter), ['title', '%refinement%']);
    assert.deepEqual(normalize(query.orders), ['created_at', 'id']);
  }
});

for (const hasSentinel of [false, true]) {
  test(`10,000-note boundary uses a sentinel and marks truncation ${hasSentinel ? 'with' : 'without'} an extra row`, async () => {
    const { store, queries } = loadStore(async query => {
      const start = query.range[0];
      return {
        data: start === 10_000
          ? hasSentinel ? [note('sentinel-must-not-be-included', '2099-12-31')] : []
          : Array.from({ length: 200 }, (_, index) => note(`bounded-${start + index}`)),
        error: null,
      };
    });
    await store.getState().fetchAll('owner-a');

    assert.equal(store.getState().error, null);
    assert.equal(queries.length, 51);
    assert.deepEqual(normalize(queries.at(-1).range), [10_000, 10_000]);
    assert.equal(store.getState().truncated, hasSentinel);
    assert.equal(store.getState().model.meetings.length, 10_000);
    assert.equal(meetingIds(store).includes('sentinel-must-not-be-included'), false);
    for (const query of queries) {
      assert.deepEqual(normalize(query.equals), [['user_id', 'owner-a']]);
      assert.deepEqual(normalize(query.titleFilter), ['title', '%refinement%']);
      assert.deepEqual(normalize(query.orders), ['created_at', 'id']);
    }
  });
}

test('a later-page failure retains the last complete model and its loaded-at receipt', async () => {
  let mode = 'seed';
  const { store, queries } = loadStore(async query => {
    if (mode === 'seed') return { data: [note('last-complete')], error: null };
    return query.range[0] === 0
      ? { data: Array.from({ length: 200 }, (_, index) => note(`partial-${index}`)), error: null }
      : { data: null, error: { message: 'Second page unavailable' } };
  });
  await store.getState().fetchAll('owner-a');
  const savedModel = normalize(store.getState().model);
  const savedLoadedAt = store.getState().loadedAt;
  assert.ok(savedLoadedAt);
  mode = 'fail-later';
  await store.getState().fetchAll('owner-a');

  assert.deepEqual(normalize(queries.slice(1).map(query => query.range)), [[0, 199], [200, 399]]);
  assert.equal(store.getState().error, 'Second page unavailable');
  assert.equal(store.getState().loading, false);
  assert.equal(store.getState().loadedAt, savedLoadedAt);
  assert.equal(store.getState().truncated, false);
  assert.deepEqual(normalize(store.getState().model), savedModel);
  assert.deepEqual(meetingIds(store), ['last-complete']);
});

for (const outcome of ['success', 'error']) {
  test(`an account switch clears old evidence immediately and ignores a stale owner ${outcome}`, async () => {
    let deferOld = false;
    const oldRead = deferred();
    const newRead = deferred();
    const { store } = loadStore(query => {
      const owner = query.equals.find(([key]) => key === 'user_id')[1];
      if (owner === 'owner-b') return newRead.promise;
      return deferOld ? oldRead.promise : Promise.resolve({ data: [note('owner-a-evidence')], error: null });
    });
    await store.getState().fetchAll('owner-a');
    assert.deepEqual(meetingIds(store), ['owner-a-evidence']);
    deferOld = true;
    const oldRequest = store.getState().fetchAll('owner-a');
    const newRequest = store.getState().fetchAll('owner-b');

    assert.equal(store.getState().userId, 'owner-b');
    assert.deepEqual(meetingIds(store), []);
    assert.equal(store.getState().loadedAt, null);
    assert.equal(store.getState().error, null);
    assert.equal(store.getState().loading, true);

    newRead.resolve({ data: [note('owner-b-evidence')], error: null });
    await newRequest;
    const newOwnerState = snapshot(store);
    oldRead.resolve(outcome === 'success'
      ? { data: [note('late-owner-a-evidence')], error: null }
      : { data: null, error: { message: 'Old owner denied' } });
    await oldRequest;

    assert.deepEqual(snapshot(store), newOwnerState);
    assert.deepEqual(meetingIds(store), ['owner-b-evidence']);
    assert.equal(store.getState().error, null);
  });
}

test('sign-out clear invalidates pending reads and prevents evidence resurrection', async () => {
  const read = deferred();
  const { store } = loadStore(() => read.promise);
  const pending = store.getState().fetchAll('owner-a');
  store.getState().clear();
  const cleared = snapshot(store);
  assert.equal(cleared.userId, null);
  assert.equal(cleared.loadedAt, null);
  assert.equal(cleared.loading, false);
  assert.equal(cleared.error, null);
  assert.equal(cleared.truncated, false);
  assert.deepEqual(cleared.model, { meetings: [], warnings: [] });

  read.resolve({ data: [note('late-after-sign-out')], error: null });
  await pending;
  assert.deepEqual(snapshot(store), cleared);
});

for (const outcome of ['success', 'error']) {
  test(`overlapping same-owner refreshes keep the newest result after an older ${outcome}`, async () => {
    const oldRead = deferred();
    let requests = 0;
    const { store } = loadStore(() => ++requests === 1 ? oldRead.promise
      : Promise.resolve({ data: [note('newest-evidence', '2026-11-19')], error: null }));
    const older = store.getState().fetchAll('owner-a');
    await store.getState().fetchAll('owner-a');
    const newest = snapshot(store);
    assert.deepEqual(meetingIds(store), ['newest-evidence']);
    assert.equal(newest.loading, false);
    assert.equal(newest.error, null);
    oldRead.resolve(outcome === 'success'
      ? { data: [note('outdated-evidence')], error: null }
      : { data: null, error: { message: 'Outdated request failed' } });
    await older;
    assert.deepEqual(snapshot(store), newest);
  });
}


test('a malformed success response preserves saved meeting history instead of resetting it', async () => {
  for (const malformed of [null, undefined, {}, 'not-an-array']) {
    let fail = false;
    const { store } = loadStore(async () => ({ data: fail ? malformed : [note('preserved-meeting')], error: null }));
    await store.getState().fetchAll('owner-a');
    const before = normalize(store.getState().model), loadedAt = store.getState().loadedAt;
    fail = true; await store.getState().fetchAll('owner-a');
    assert.deepEqual(normalize(store.getState().model), before);
    assert.equal(store.getState().loadedAt, loadedAt);
    assert.match(store.getState().error, /incomplete/);
  }
});
