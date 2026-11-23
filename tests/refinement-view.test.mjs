import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as review from '../src/lib/refinementReview.ts';
import * as progress from '../src/lib/refinementProgress.ts';

const nativeRequire = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
function view({ tab = 'followups', filter = 'active' } = {}) {
  const cache = new Map();
  const load = filename => {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(name => {
      if (name === 'react') return { ...React, useState(initial) {
        return React.useState(initial === 'followups' ? tab : initial === 'active' ? filter : initial);
      } };
      if (name === 'react-markdown') return { default: ReactMarkdown, __esModule: true };
      if (name === 'remark-gfm') return { default: remarkGfm, __esModule: true };
      if (name.endsWith('/refinementReview')) return review;
      if (name.endsWith('/refinementProgress')) return progress;
      if (name.startsWith('.')) {
        const path = resolve(dirname(filename), name);
        return load(existsSync(`${path}.tsx`) ? `${path}.tsx` : `${path}.ts`);
      }
      return nativeRequire(name);
    }, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  };
  return load(new URL('src/components/RefinementsView.tsx', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')).RefinementsView;
}
const noteId = '00000000-0000-4000-8000-000000000003';
const sourceId = 'fictional:source';
const actions = [
  { id: 'active', title: 'Unfinished follow-up', owner: 'Mike', nextAction: 'Check the existing behavior.', evidence: 'Fictional source', status: 'follow_up' },
  { id: 'recorded-done', title: 'Recorded done evidence', owner: 'Mike', nextAction: 'Recorded at the meeting.', evidence: 'Fictional source', status: 'done' },
];
const story = { id: 'story', title: 'Fictional story', summary: 'Preserve recorded ADO state.', evidence: 'Fictional source',
  workItemId: 12345, state: 'In Development', disposition: 'already_updated', description: 'A copyable fictional draft' };
const model = { warnings: [], meetings: [{ noteId, title: 'Fictional meeting', date: '2026-11-19', updatedAt: '2026-11-23T17:00:00Z', recap: 'Fictional recap.',
  record: { version: 1, sourceId, meetingDate: '2026-11-19', reviewedAt: '2026-11-23T17:00:00Z', summary: 'Fictional summary.',
    source: { fileName: 'Fictional.docx', sha256: 'a'.repeat(64), firstTimestamp: '0:00', lastTimestamp: '1:00', paragraphs: 2, transcriptionComplete: true, timezoneCaveat: '' },
    actions, stories: [story], decisions: [], questions: [] } }] };
const target = (itemKind = 'action', itemId = 'active') => ({ noteId, sourceId, itemKind, itemId });
const saved = (status, itemKind = 'action', itemId = 'active') => ({
  [progress.refinementProgressKey(target(itemKind, itemId))]: { user_id: 'owner', note_id: noteId, source_id: sourceId, item_kind: itemKind, item_id: itemId, status, updated_at: '2026-11-23T17:00:00Z' },
});
function render(props = {}, state = {}) {
  return renderToStaticMarkup(React.createElement(view(state), { model, timezone: 'America/New_York', loading: false, error: null,
    truncated: false, loadedAt: null, onRefresh() {}, progressReady: true, onProgressChange() {}, ...props }));
}

test('source done and already-updated labels do not mark owner progress complete', () => {
  const html = render();
  assert.match(html, /0 of 3 complete/);
  assert.match(html, /aria-label="Mark complete: Recorded done evidence"/);
  const stories = render({}, { tab: 'stories' });
  assert.match(stories, /Already updated/);
  assert.match(stories, /In Development/);
  assert.match(stories, /Copy description/);
  assert.match(stories, /aria-label="Mark complete: Fictional story"/);
});

test('saved completion updates counts and leaves only active items by default', () => {
  const html = render({ progress: saved('complete') });
  assert.match(html, /1 of 3 complete/);
  assert.doesNotMatch(html, /aria-label="Mark complete: Unfinished follow-up"/);
  assert.match(html, /aria-label="Mark complete: Recorded done evidence"/);
});

test('completed filter exposes the saved item with Reopen and preserves evidence labels', () => {
  const html = render({ progress: saved('complete') }, { filter: 'completed' });
  assert.match(html, /aria-label="Reopen: Unfinished follow-up"/);
  assert.doesNotMatch(html, /aria-label="Mark complete: Recorded done evidence"/);
  assert.match(html, /Meeting evidence/);
});

test('all filter and in-progress state preserve every item and recorded ADO state', () => {
  const html = render({ progress: { ...saved('complete'), ...saved('in_progress', 'story', 'story') } }, { tab: 'stories', filter: 'all' });
  assert.match(html, /1 of 3 complete · 1 in progress/);
  assert.match(html, /option value="in_progress" selected=""/);
  assert.match(html, /In Development/);
  assert.match(html, /Already updated/);
});

test('unknown progress and failed saves remain visible with disabled persistence controls', () => {
  const html = render({ progressReady: false, progressError: 'Refresh before retrying.', progress: saved('complete') });
  assert.match(html, /Saved progress unavailable/);
  assert.match(html, /Refresh before retrying/);
  assert.match(html, /aria-label="Reopen: Unfinished follow-up"/);
  assert.match(html, /disabled="" aria-label="Reopen: Unfinished follow-up"/);
  assert.match(html, /aria-label="Mark complete: Recorded done evidence"/);
});

test('pending completion stays visible and all progress writes are disabled until the save resolves', () => {
  const html = render({ savingKey: progress.refinementProgressKey(target()) });
  assert.match(html, /Saving…/);
  assert.match(html, /aria-label="Mark complete: Unfinished follow-up"/);
  assert.match(html, /disabled="" aria-label="Mark complete: Recorded done evidence"/);
});
