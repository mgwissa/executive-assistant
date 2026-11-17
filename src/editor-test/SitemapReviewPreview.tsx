import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SitemapReviewView } from '../components/SitemapReviewView';
import { buildSitemapReviewModel, formatSitemapRecord, sitemapUrlHash, SITEMAP_SOURCE } from '../lib/sitemapReview';
import type { SitemapNote, SitemapRecord, SitemapReviewModel } from '../lib/sitemapReview';
import '../index.css';

// Fictional local UI fixtures only: no account, Supabase or website fetch.
const first = '2026-11-16T21:30:00Z';
const checked = '2026-11-17T12:30:00Z';
const empty: SitemapReviewModel = { runs: [], checkpoint: null, currentUrls: [], warnings: [] };
const note = (id: string, content: string): SitemapNote => ({ id, title: 'AutoFinder sitemap sample ' + id, content, updated_at: checked });
async function fixture(partial: boolean) {
  const old = ['https://autofinder.com/example/retired'];
  const urls = Array.from({ length: 2536 }, (_, i) => `https://autofinder.com/example/vehicle-${String(i + 1).padStart(4, '0')}`);
  const oldHash = await sitemapUrlHash(old);
  const part = note('sample-part', `Part 1 of 1 contains 1 URLs.\n## Baseline URLs\n- ${old[0]}\n## Verification receipt\nPart URL-set SHA-256: ${oldHash}\nFull URL-set SHA-256: ${oldHash}`);
  const baseline: SitemapRecord = { version: 1, sourceUrl: SITEMAP_SOURCE, runId: 'fictional-baseline', kind: 'baseline', complete: true,
    checkedAtUtc: first, previousAtUtc: null, hash: oldHash, previousHash: null, urlCount: 1, previousUrlCount: null,
    addedCount: null, removedCount: null, partIndex: 1, partCount: 1, addedUrls: [], removedUrls: [],
    baselineNoteIds: [part.id], limitations: ['Fictional preview only.'], httpStatus: 200 };
  const comparison: SitemapRecord = { ...baseline, kind: 'comparison', runId: 'fictional-comparison', checkedAtUtc: checked,
    previousAtUtc: first, previousHash: oldHash, hash: await sitemapUrlHash(urls), urlCount: urls.length, previousUrlCount: 1,
    addedCount: urls.length, removedCount: 1, addedUrls: urls, removedUrls: old, baselineNoteIds: [] };
  const notes = [part, note('sample-baseline', formatSitemapRecord(baseline)), note('sample-check', formatSitemapRecord(comparison))];
  if (partial) notes.push(note('sample-attempt', formatSitemapRecord({ ...comparison, runId: 'fictional-failed-attempt',
    kind: 'attempt', checkedAtUtc: '2026-11-18T12:30:00Z', previousAtUtc: checked, complete: false, httpStatus: 503,
    hash: null, urlCount: null, previousHash: comparison.hash, previousUrlCount: urls.length,
    addedCount: null, removedCount: null, addedUrls: [], removedUrls: [], limitations: ['Simulated HTTP 503. Prior complete URL set retained.'] })));
  return buildSitemapReviewModel(notes);
}
function Preview() {
  const [model, setModel] = useState(empty);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  useEffect(() => { let active = true; void fixture(partial).then(m => { if (active) setModel(m); }); return () => { active = false; }; }, [partial]);
  return <div className="flex h-dvh flex-col bg-surface text-text">
    <div className="flex flex-wrap items-center gap-2 border-b border-border-strong bg-surface-sunken px-4 py-2 text-xs">
      <strong>FICTIONAL SAMPLE — local UI only</strong>
      <button className="btn-ghost text-xs" onClick={() => document.documentElement.classList.toggle('dark')}>Light / dark</button>
      <button className="btn-ghost text-xs" onClick={() => setPartial(p => !p)}>Toggle incomplete attempt</button>
      <button className="btn-ghost text-xs" onClick={() => setError(e => e ? null : 'Simulated connection failure')}>Toggle load failure</button>
      <button className="btn-ghost text-xs" onClick={() => setShowEmpty(e => !e)}>Toggle empty state</button>
    </div>
    <div className="min-h-0 flex-1"><SitemapReviewView model={showEmpty ? empty : model} timezone="America/New_York"
      loading={false} truncated={false} error={error} loadedAt={checked} onRefresh={() => setError(null)} /></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
