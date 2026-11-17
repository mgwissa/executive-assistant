import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSitemapReviewModel, formatSitemapRecord, isSitemapPageUrl, parseSitemapRecord, sitemapRunMarkdown, sitemapUrlHash, SITEMAP_RECORD_MARKER, SITEMAP_SOURCE } from '../src/lib/sitemapReview.ts';

const first = '2026-11-16T21:29:22Z';
const second = '2026-11-17T14:10:13Z';
const third = '2026-11-18T12:30:00Z';
const a = 'https://autofinder.com/cars/Example/?a=1&b=2';
const b = 'https://autofinder.com/insights/old';
const c = 'https://autofinder.com/insights/new';
const note = (id, content) => ({ id, title: 'AutoFinder sitemap check — ' + id, content, updated_at: second });
const recordNote = r => note(r.runId + '-part-' + r.partIndex, formatSitemapRecord(r));
const nativeRequire = createRequire(import.meta.url);
function loadStore(respond) {
  const queries = [];
  const client = { from(table) {
    const query = { table, equals: [], orders: [] };
    const chain = { select(fields) { query.fields = fields; return chain; },
      eq(key, value) { query.equals.push([key, value]); return chain; },
      ilike(key, value) { query.prefix = [key, value]; return chain; },
      order(key) { query.orders.push(key); return chain; },
      range(start, end) { query.range = [start, end]; queries.push(query); return respond(query); } };
    return chain;
  } };
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../src/store/useSitemapReviewStore.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => name.endsWith('/supabase') ? { supabase: client }
    : name.endsWith('/sitemapReview') ? { buildSitemapReviewModel } : nativeRequire(name), module, module.exports);
  return { store: module.exports.useSitemapReviewStore, queries };
}
async function fixture() {
  const urls = [a, b];
  const oldHash = await sitemapUrlHash(urls);
  const partHash = await sitemapUrlHash(urls);
  const baselinePart = note('baseline-part', `Source: ${SITEMAP_SOURCE}\nPart 1 of 1 contains 2 URLs.\n## Baseline URLs\n${urls.map(u => '- ' + u).join('\n')}\n## Verification receipt\nPart URL-set SHA-256: ${partHash}\nFull URL-set SHA-256: ${oldHash}`);
  const baseline = { version: 1, sourceUrl: SITEMAP_SOURCE, runId: 'baseline', kind: 'baseline', complete: true,
    checkedAtUtc: first, previousAtUtc: null, hash: oldHash, previousHash: null, urlCount: 2, previousUrlCount: null,
    addedCount: null, removedCount: null, partIndex: 1, partCount: 1, addedUrls: [], removedUrls: [],
    baselineNoteIds: ['baseline-part'], limitations: [], httpStatus: 200 };
  const comparison = { ...baseline, runId: 'changed', kind: 'comparison', checkedAtUtc: second, previousAtUtc: first,
    previousHash: oldHash, hash: await sitemapUrlHash([a, c]), previousUrlCount: 2, addedCount: 1, removedCount: 1,
    baselineNoteIds: [], addedUrls: [c], removedUrls: [b] };
  return { baselinePart, baseline, comparison, notes: [baselinePart, recordNote(baseline)] };
}

test('baseline is not additions; complete exact changes reconstruct the verified set', async () => {
  const f = await fixture();
  const baseline = await buildSitemapReviewModel(f.notes);
  assert.equal(baseline.checkpoint.kind, 'baseline');
  assert.equal(baseline.runs[0].addedCount, null);
  assert.deepEqual(baseline.currentUrls, [a, b].sort());
  const model = await buildSitemapReviewModel([...f.notes, recordNote(f.comparison)]);
  assert.equal(model.checkpoint.runId, 'changed');
  assert.deepEqual(model.currentUrls, [a, c].sort());
  assert.deepEqual(model.runs[0].addedUrls, [c]);
  assert.deepEqual(model.runs[0].removedUrls, [b]);
  assert.equal(model.warnings.length, 0);
});

test('no-change captures are real checks, not fabricated URL additions', async () => {
  const f = await fixture();
  const unchanged = { ...f.comparison, runId: 'unchanged', addedUrls: [], removedUrls: [], addedCount: 0, removedCount: 0, hash: f.baseline.hash };
  const model = await buildSitemapReviewModel([...f.notes, recordNote(unchanged)]);
  assert.equal(model.checkpoint.checkedAtUtc, second);
  assert.equal(model.runs[0].verified, true);
  assert.deepEqual(model.currentUrls, [a, b].sort());
});

test('case, query strings, escaped characters and trailing slashes remain exact', async () => {
  const urls = ['https://autofinder.com/A', 'https://autofinder.com/a', 'https://autofinder.com/a/', 'https://autofinder.com/a?x=1', 'https://autofinder.com/%61'];
  assert.equal(new Set(await Promise.all(urls.map(u => sitemapUrlHash([u])))).size, urls.length);
  assert.equal(await sitemapUrlHash([...urls].reverse()), await sitemapUrlHash(urls));
  assert.equal(await sitemapUrlHash([a, a]), await sitemapUrlHash([a]));
});

test('failed attempts never advance coverage or manufacture mass removals', async () => {
  const f = await fixture();
  const failed = { ...f.baseline, runId: 'failure', kind: 'attempt', complete: false, checkedAtUtc: second,
    previousAtUtc: first, hash: null, urlCount: null, baselineNoteIds: [], limitations: ['HTTP request failed; prior baseline retained.'], httpStatus: 503 };
  const model = await buildSitemapReviewModel([...f.notes, recordNote(failed)]);
  assert.equal(model.runs[0].complete, false);
  assert.equal(model.checkpoint.checkedAtUtc, first);
  assert.deepEqual(model.currentUrls, [a, b].sort());
  assert.throws(() => parseSitemapRecord(recordNote({ ...failed, removedCount: 2, removedUrls: [a, b] })), /Incomplete/);
});

test('missing or altered baseline notes are incomplete evidence, not an empty site', async () => {
  const f = await fixture();
  for (const notes of [[recordNote(f.baseline)], [recordNote(f.baseline), { ...f.baselinePart, content: f.baselinePart.content.replace(a, 'https://autofinder.com/altered') }]]) {
    const model = await buildSitemapReviewModel(notes);
    assert.equal(model.checkpoint, null);
    assert.equal(model.runs[0].verified, false);
    assert.ok(model.runs[0].problems.length);
  }
});

test('multipart reports require every part and retain all individual URLs', async () => {
  const f = await fixture();
  const p1 = { ...f.comparison, partCount: 2, removedUrls: [] };
  const p2 = { ...f.comparison, partCount: 2, partIndex: 2, addedUrls: [] };
  const partial = await buildSitemapReviewModel([...f.notes, recordNote(p1)]);
  assert.equal(partial.checkpoint.runId, 'baseline');
  assert.ok(partial.runs[0].problems.some(s => s.includes('every report part')));
  const complete = await buildSitemapReviewModel([...f.notes, recordNote(p2), recordNote(p1)]);
  assert.equal(complete.checkpoint.runId, 'changed');
  assert.deepEqual(complete.runs[0].addedUrls, [c]);
  assert.deepEqual(complete.runs[0].removedUrls, [b]);
});

test('duplicate source copies deduplicate; conflicting versions cannot become complete', async () => {
  const f = await fixture();
  const duplicate = await buildSitemapReviewModel([...f.notes, recordNote(f.comparison), { ...recordNote(f.comparison), id: 'copy' }]);
  assert.equal(duplicate.checkpoint.runId, 'changed');
  const conflict = await buildSitemapReviewModel([...f.notes, recordNote(f.comparison), recordNote({ ...f.comparison, hash: 'a'.repeat(64) })]);
  assert.equal(conflict.checkpoint.runId, 'baseline');
  assert.ok(conflict.runs[0].problems.length);
});

test('unsafe URLs, unsupported sources, malformed JSON and fake baselines are rejected', async () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'https://user:password@example.com', 'https://autofinder.com/a\nb']) assert.equal(isSitemapPageUrl(value), false);
  assert.equal(isSitemapPageUrl(a), true);
  const f = await fixture();
  for (const r of [{ ...f.comparison, sourceUrl: 'https://evil.example/sitemap.xml' }, { ...f.baseline, addedCount: 2, addedUrls: [a, b] }, { ...f.comparison, addedUrls: ['javascript:alert(1)'] }]) assert.throws(() => parseSitemapRecord(recordNote(r)));
  const bad = note('bad', `${SITEMAP_RECORD_MARKER}\n\`\`\`json\n{bad}\n\`\`\``);
  const result = await buildSitemapReviewModel([...f.notes, bad]);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.checkpoint.runId, 'baseline');
});

test('count, hash, prior membership and delayed-history conflicts preserve the checkpoint', async () => {
  const f = await fixture();
  const invalid = [
    { ...f.comparison, hash: 'a'.repeat(64) },
    { ...f.comparison, previousHash: 'b'.repeat(64) },
    { ...f.comparison, addedUrls: [a] },
    { ...f.comparison, addedUrls: [c, c] },
  ];
  for (const record of invalid) {
    const model = await buildSitemapReviewModel([...f.notes, recordNote(record)]);
    assert.equal(model.checkpoint.runId, 'baseline');
    assert.ok(model.runs[0].problems.length);
  }
  const delayed = { ...f.comparison, runId: 'delayed', checkedAtUtc: third, previousAtUtc: first,
    previousHash: f.comparison.hash, hash: f.comparison.hash, addedCount: 0, removedCount: 0, addedUrls: [], removedUrls: [] };
  const model = await buildSitemapReviewModel([...f.notes, recordNote(f.comparison), recordNote(delayed)]);
  assert.equal(model.checkpoint.runId, 'changed');
});

test('large changes export every URL, not only the first visual page', async () => {
  const f = await fixture();
  const all = Array.from({ length: 2536 }, (_, i) => `https://autofinder.com/insights/article-${i}`);
  const r = { ...f.comparison, verified: true, problems: [], noteIds: ['note'], addedUrls: all, addedCount: all.length };
  const output = sitemapRunMarkdown(r);
  for (const url of all) assert.ok(output.includes('- ' + url + '\n'));
  assert.equal((output.match(/^- https:/gm) ?? []).length, 2537);
  assert.ok(output.includes('Net sitemap membership'));
});

test('store explicitly scopes every paginated query to owner and sitemap title prefix', async () => {
  const padding = Array.from({ length: 200 }, (_, i) => note('other-' + i, 'ordinary note'));
  const f = await fixture();
  const { store, queries } = loadStore(async q => ({ data: q.range[0] === 0 ? padding : f.notes, error: null }));
  await store.getState().fetchAll('owner-a');
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.equal(q.table, 'notes');
    assert.deepEqual(q.equals, [['user_id', 'owner-a']]);
    assert.deepEqual(q.prefix, ['title', 'AutoFinder sitemap%']);
    assert.deepEqual(q.orders, ['created_at', 'id']);
  }
  assert.deepEqual(queries.map(q => q.range), [[0, 199], [200, 399]]);
  assert.equal(store.getState().model.checkpoint.runId, 'baseline');
  assert.equal(store.getState().truncated, false);
});

test('a failed refresh retains saved evidence; account switches and sign-out reject stale reads', async () => {
  const f = await fixture();
  let response = () => Promise.resolve({ data: f.notes, error: null });
  const { store } = loadStore(q => response(q));
  await store.getState().fetchAll('owner-a');
  response = () => Promise.resolve({ data: null, error: { message: 'read denied' } });
  await store.getState().fetchAll('owner-a');
  assert.equal(store.getState().error, 'read denied');
  assert.equal(store.getState().model.checkpoint.runId, 'baseline');
  let finish;
  response = () => new Promise(resolve => { finish = resolve; });
  const pending = store.getState().fetchAll('owner-a');
  store.getState().clear();
  finish({ data: f.notes, error: null });
  await pending;
  assert.equal(store.getState().userId, null);
  assert.equal(store.getState().model.checkpoint, null);
  const old = store.getState().fetchAll('owner-a');
  const finishOld = finish;
  response = () => Promise.resolve({ data: [], error: null });
  await store.getState().fetchAll('owner-b');
  finishOld({ data: f.notes, error: null });
  await old;
  assert.equal(store.getState().userId, 'owner-b');
  assert.equal(store.getState().model.runs.length, 0);
});

test('note result cap performs a sentinel read and explicitly marks loaded coverage partial', async () => {
  const { store, queries } = loadStore(async q => ({ data: Array.from({ length: q.range[1] - q.range[0] + 1 },
    (_, i) => note('padding-' + (q.range[0] + i), 'ordinary note')), error: null }));
  await store.getState().fetchAll('owner-a');
  assert.equal(queries.length, 51);
  assert.deepEqual(queries.at(-1).range, [10000, 10000]);
  assert.equal(store.getState().truncated, true);
  assert.equal(store.getState().model.checkpoint, null);
});

test('app route, sign-out cleanup, audited-write refresh and owner-scoped note opening stay wired', () => {
  const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(read('src/App.tsx'), /path="\/?sitemap-review"/);
  assert.match(read('src/App.tsx'), /clearSitemapReview\(\)/);
  assert.match(read('src/hooks/useCodexSync.ts'), /useSitemapReviewStore\.getState\(\)\.fetchAll\(userId\)/);
  assert.match(read('src/components/SitemapReviewPage.tsx'), /eq\('user_id', userId\)/);
  assert.match(read('src/components/SitemapReviewPage.tsx'), /useAuthStore\.getState\(\)\.user\?\.id !== userId/);
  assert.match(read('src/lib/optionalFeatures.ts'), /sitemap-review/);
});
