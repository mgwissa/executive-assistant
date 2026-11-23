import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as progressModule from '../src/lib/refinementProgress.ts';

const { refinementProgressKey, isRefinementProgressRow } = progressModule;
const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const target = { noteId: '00000000-0000-4000-8000-000000000003', sourceId: 'fictional:meeting', itemKind: 'action', itemId: 'follow-up' };
const stamp = '2026-11-23T17:30:00.123456+00:00';
const row = (status = 'in_progress', extra = {}) => ({ user_id: user, note_id: target.noteId, source_id: target.sourceId,
  item_kind: target.itemKind, item_id: target.itemId, status, updated_at: stamp, ...extra });
const nativeRequire = createRequire(import.meta.url);
const normalize = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function loadStore(read = async () => ({ data: [], error: null }), save = async () => ({ data: row('complete'), error: null })) {
  const queries = [], writes = [];
  const client = {
    from(table) {
      const query = { table, equals: [], orders: [] };
      const chain = {
        select(fields) { query.fields = fields; return chain; },
        eq(key, value) { query.equals.push([key, value]); return chain; },
        order(key) { query.orders.push(key); return chain; },
        range(start, end) { query.range = [start, end]; queries.push(query); return read(query); },
      };
      return chain;
    },
    rpc(name, args) { writes.push({ name, args }); return save(name, args); },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../src/store/useRefinementProgressStore.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => name.endsWith('/supabase') ? { supabase: client }
    : name.endsWith('/refinementProgress') ? progressModule : nativeRequire(name), module, module.exports);
  return { store: module.exports.useRefinementProgressStore, queries, writes };
}

test('identity is stable across note copies and distinct across source, kind and item', () => {
  const key = refinementProgressKey(target);
  assert.equal(refinementProgressKey({ ...target, noteId: 'another-copy' }), key);
  for (const change of [{ sourceId: 'another:meeting' }, { itemKind: 'story' }, { itemId: 'another-item' }])
    assert.notEqual(refinementProgressKey({ ...target, ...change }), key);
  assert.notEqual(refinementProgressKey({ ...target, sourceId: 'one:two', itemId: 'three' }),
    refinementProgressKey({ ...target, sourceId: 'one', itemId: 'two:three' }));
});

test('every saved progress page is owner filtered and status versions retain raw precision', async () => {
  const first = Array.from({ length: 200 }, (_, i) => row('complete', { item_id: `item-${i}` }));
  const { store, queries } = loadStore(async query => ({ data: query.range[0] === 0 ? first : [row('not_started')], error: null }));
  await store.getState().fetchAll(user);
  assert.equal(Object.keys(store.getState().progress).length, 201);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'not_started');
  assert.equal(store.getState().progress[refinementProgressKey(target)].updated_at, stamp);
  assert.deepEqual(normalize(queries.map(q => q.range)), [[0, 199], [200, 399]]);
  for (const query of queries) {
    assert.equal(query.table, 'refinement_item_progress');
    assert.deepEqual(normalize(query.equals), [['user_id', user]]);
    assert.deepEqual(normalize(query.orders), ['source_id', 'item_kind', 'item_id']);
  }
});

test('complete remains pending until an exact owner receipt, persists on reload, and reopens using raw CAS version', async () => {
  const pending = deferred(); let saved = [], calls = 0;
  const { store, writes } = loadStore(async () => ({ data: saved, error: null }), async (_, args) => {
    if (++calls === 1) { await pending.promise; saved = [row('complete')]; }
    else saved = [row(args.p_status, { updated_at: '2026-11-23T18:00:00.765432+00:00' })];
    return { data: saved, error: null };
  });
  await store.getState().fetchAll(user);
  const saving = store.getState().setProgress(user, target, 'complete');
  assert.equal(store.getState().progress[refinementProgressKey(target)], undefined);
  assert.equal(store.getState().savingKey, refinementProgressKey(target));
  const reads = writes.length;
  assert.equal(await store.getState().setProgress(user, target, 'in_progress'), false);
  assert.equal(writes.length, reads);
  pending.resolve(); assert.equal(await saving, true);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'complete');
  await store.getState().fetchAll(user);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'complete');
  assert.equal(await store.getState().setProgress(user, target, 'not_started'), true);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'not_started');
  assert.equal(writes[0].name, 'set_refinement_progress');
  assert.equal(writes[0].args.p_expected_updated_at, null);
  assert.equal(writes[1].args.p_expected_updated_at, stamp);
  assert.equal('p_user_id' in writes[0].args, false);
});

test('same-status selection is a no-op and never manufactures persistence rows on reads', async () => {
  const { store, writes } = loadStore();
  await store.getState().fetchAll(user);
  assert.equal(await store.getState().setProgress(user, target, 'not_started'), true);
  assert.equal(writes.length, 0);
  assert.deepEqual(normalize(store.getState().progress), {});
});

for (const failure of ['provider', 'throw', 'foreign-owner', 'wrong-item', 'wrong-note', 'wrong-status', 'missing', 'many']) {
  test(`failed or mismatched ${failure} receipt preserves prior status and requires refresh`, async () => {
    const { store, writes } = loadStore(async () => ({ data: [row()], error: null }), async () => {
      if (failure === 'throw') throw new Error('Network interrupted');
      if (failure === 'provider') return { data: null, error: { message: 'Progress changed; refresh' } };
      const data = failure === 'foreign-owner' ? row('complete', { user_id: other })
        : failure === 'wrong-item' ? row('complete', { item_id: 'other' })
          : failure === 'wrong-note' ? row('complete', { note_id: other })
            : failure === 'wrong-status' ? row('not_started') : failure === 'missing' ? null : [row('complete'), row('complete')];
      return { data, error: null };
    });
    await store.getState().fetchAll(user);
    assert.equal(await store.getState().setProgress(user, target, 'complete'), false);
    assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'in_progress');
    assert.equal(store.getState().savingKey, null);
    assert.match(store.getState().error, /Refresh saved reviews/);
    assert.equal(await store.getState().setProgress(user, target, 'complete'), false);
    assert.equal(writes.length, 1);
    await store.getState().fetchAll(user);
    assert.equal(store.getState().error, null);
  });
}

test('later-page read failures preserve the last complete progress snapshot', async () => {
  let fail = false;
  const { store } = loadStore(async query => !fail ? { data: [row('complete')], error: null }
    : query.range[0] === 0 ? { data: Array.from({ length: 200 }, (_, i) => row('not_started', { item_id: `item-${i}` })), error: null }
      : { data: null, error: { message: 'Page unavailable' } });
  await store.getState().fetchAll(user);
  const before = normalize(store.getState().progress), loadedAt = store.getState().loadedAt;
  fail = true; await store.getState().fetchAll(user);
  assert.deepEqual(normalize(store.getState().progress), before);
  assert.equal(store.getState().loadedAt, loadedAt);
  assert.match(store.getState().error, /Page unavailable/);
});

test('foreign, malformed and duplicate read rows fail closed', async () => {
  for (const rows of [[row('complete', { user_id: other })], [row('invalid')], [row(), row()], [row('complete', { updated_at: 'unknown' })]]) {
    const { store } = loadStore(async () => ({ data: rows, error: null }));
    await store.getState().fetchAll(user);
    assert.ok(store.getState().error);
    assert.equal(store.getState().loadedAt, null);
    assert.deepEqual(normalize(store.getState().progress), {});
  }
  assert.equal(isRefinementProgressRow(row('complete'), user), true);
});

test('sign-out and account switches invalidate in-flight reads and saves without leaking prior status', async () => {
  const read = deferred();
  const { store } = loadStore(async query => query.equals[0][1] === user ? read.promise : { data: [], error: null });
  const old = store.getState().fetchAll(user);
  await store.getState().fetchAll(other);
  read.resolve({ data: [row('complete')], error: null }); await old;
  assert.equal(store.getState().userId, other);
  assert.deepEqual(normalize(store.getState().progress), {});
  const save = deferred();
  const next = loadStore(undefined, () => save.promise).store;
  await next.getState().fetchAll(user);
  const pending = next.getState().setProgress(user, target, 'complete');
  next.getState().clear();
  save.resolve({ data: row('complete'), error: null });
  assert.equal(await pending, false);
  assert.equal(next.getState().userId, null);
  assert.deepEqual(normalize(next.getState().progress), {});
});

test('refresh during a save cannot replace its confirmed status with an older snapshot', async () => {
  const pending = deferred();
  const { store, queries } = loadStore(undefined, () => pending.promise);
  await store.getState().fetchAll(user);
  const save = store.getState().setProgress(user, target, 'complete');
  await store.getState().fetchAll(user);
  assert.equal(queries.length, 1);
  pending.resolve({ data: row('complete'), error: null }); await save;
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'complete');
});

test('unready, foreign-user and invalid selections never call persistence', async () => {
  const { store, writes } = loadStore();
  assert.equal(await store.getState().setProgress(user, target, 'complete'), false);
  await store.getState().fetchAll(user);
  assert.equal(await store.getState().setProgress(other, target, 'complete'), false);
  assert.equal(await store.getState().setProgress(user, { ...target, itemKind: 'anything' }, 'complete'), false);
  assert.equal(writes.length, 0);
});


test('missing or malformed success data cannot reset saved completions to an empty ledger', async () => {
  for (const malformed of [null, undefined, {}, 'not-an-array']) {
    let fail = false;
    const { store } = loadStore(async () => ({ data: fail ? malformed : [row('complete')], error: null }));
    await store.getState().fetchAll(user);
    const prior = normalize(store.getState().progress), loadedAt = store.getState().loadedAt;
    fail = true; await store.getState().fetchAll(user);
    assert.deepEqual(normalize(store.getState().progress), prior);
    assert.equal(store.getState().loadedAt, loadedAt);
    assert.match(store.getState().error, /incomplete/);
    assert.equal(await store.getState().setProgress(user, target, 'not_started'), false);
  }
});

test('a capped history fails closed rather than treating unseen completions as not started', async () => {
  const { store, queries } = loadStore(async query => ({ data: query.range[0] === 10_000 ? [row('complete')]
    : Array.from({ length: 200 }, (_, i) => row('complete', { item_id: `item-${query.range[0] + i}` })), error: null }));
  await store.getState().fetchAll(user);
  assert.deepEqual(normalize(queries.at(-1).range), [10_000, 10_000]);
  assert.match(store.getState().error, /history limit/);
  assert.equal(store.getState().loadedAt, null);
  assert.deepEqual(normalize(store.getState().progress), {});
  assert.equal(await store.getState().setProgress(user, target, 'complete'), false);
});


test('a removed source-note anchor preserves completion and can reopen from an owned source copy', async () => {
  const { store, writes } = loadStore(async () => ({ data: [row('complete', { note_id: null })], error: null }),
    async () => ({ data: row('not_started'), error: null }));
  await store.getState().fetchAll(user);
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'complete');
  assert.equal(await store.getState().setProgress(user, target, 'not_started'), true);
  assert.equal(writes[0].args.p_expected_updated_at, stamp);
  assert.equal(writes[0].args.p_note_id, target.noteId);
  assert.equal(store.getState().progress[refinementProgressKey(target)].status, 'not_started');
});
