import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { SITEMAP_SOURCE, sitemapChangeStreak, sitemapRunMarkdown } from '../lib/sitemapReview';
import type { SitemapReviewModel, SitemapRun } from '../lib/sitemapReview';
import { EmptyState } from './ui/EmptyState';

type Props = {
  model: SitemapReviewModel; timezone: string; loading: boolean; error: string | null;
  truncated: boolean; loadedAt: string | null; onRefresh: () => void;
  onOpenNote?: (noteId: string) => void;
};
type Tab = 'added' | 'removed' | 'current';
const time = (v: string, tz: string) => formatInTimeZone(new Date(v), tz, 'MMM d, yyyy · h:mm:ss a zzz');
const verified = (r: SitemapRun) => r.complete && r.verified && !r.problems.length;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SitemapReviewView({ model, timezone, loading, error, truncated, loadedAt, onRefresh, onOpenNote }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'changes' | 'incomplete'>('all');
  const [tab, setTab] = useState<Tab>('added');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const selected = model.runs.find(r => r.runId === selectedId) ?? model.runs[0] ?? null;
  const latest = model.runs[0];
  const checkpoint = model.checkpoint;
  const streak = sitemapChangeStreak(model, timezone);
  const uncertain = !!error || truncated || model.warnings.length > 0 || !!latest && !verified(latest);
  const history = model.runs.filter(r => historyFilter === 'all' || historyFilter === 'changes'
    && r.kind === 'comparison' && !!((r.addedCount ?? 0) + (r.removedCount ?? 0)) || historyFilter === 'incomplete' && !verified(r));
  const urls = tab === 'current' ? model.currentUrls : tab === 'removed' ? selected?.removedUrls ?? [] : selected?.addedUrls ?? [];
  const visible = urls.filter(u => u.toLowerCase().includes(query.trim().toLowerCase()));
  const changeTab = (next: Tab) => { setTab(next); setLimit(100); };
  const selectRun = (run: SitemapRun) => { setSelectedId(run.runId); setTab('added'); setQuery(''); setLimit(100); };

  return <div className="h-full overflow-y-auto bg-surface px-3 py-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">AutoFinder · website changes</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text">Sitemap review</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Every added and removed URL, with the saved evidence behind each check. This panel does not change the website.</p>
          <a className="mt-2 inline-block break-all text-xs text-brand-700 underline dark:text-brand-300" href={SITEMAP_SOURCE} target="_blank" rel="noopener noreferrer">{SITEMAP_SOURCE}</a>
        </div>
        <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:items-end">
          <button type="button" className="btn-ghost shrink-0" onClick={onRefresh} disabled={loading}>{loading ? 'Loading saved reports…' : 'Refresh saved reports'}</button>
          <section className="rounded-lg border border-dashed border-border bg-surface-raised px-4 py-3 text-left sm:text-right" aria-label="Days since last change">
            <p className="text-xs font-medium text-text-muted">Days since last change</p>
            <output className="mt-2 block font-mono text-3xl font-semibold leading-none tabular-nums text-brand-700 dark:text-brand-300" aria-label="Day count">{streak?.days ?? '—'}</output>
            <p className="mt-2 text-xs text-text-subtle">{streak ? <>{streak.fromBaseline ? 'Since tracking began' : 'Since last detected change'}<br />Through {formatInTimeZone(new Date(streak.throughUtc), timezone, 'MMM d, yyyy')}</> : 'Awaiting a verified check'}</p>
          </section>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5" aria-label="Saved sitemap coverage">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-text">Saved coverage</h3>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">{uncertain ? 'Coverage needs attention' : latest ? 'Complete saved check' : 'Awaiting saved check'}</span></div>
        <p className="mt-2 text-sm text-text-muted">{checkpoint ? <>Last verified URL set: <strong className="font-medium text-text">{time(checkpoint.checkedAtUtc, timezone)}</strong></> : 'No complete, hash-verified URL set is available in saved notes.'}</p>
        {latest && !verified(latest) && <p className="mt-2 text-sm font-medium text-text">Latest attempt: {time(latest.checkedAtUtc, timezone)}. Incomplete evidence has not advanced the verified URL set.</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Verified URLs', checkpoint ? model.currentUrls.length.toLocaleString() : '—'],
            ['Added in latest check', !uncertain && latest && verified(latest) && latest.kind === 'comparison' ? latest.addedCount : '—'],
            ['Removed in latest check', !uncertain && latest && verified(latest) && latest.kind === 'comparison' ? latest.removedCount : '—'],
            ['Saved checks', model.runs.length]].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-surface-sunken px-3 py-3">
              <p className="text-xs text-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-text">{value}</p></div>)}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-text-subtle">Net sitemap membership changes between captures—not exact publication/deletion times, traffic, or proof a page is healthy. Refresh reloads saved notes; it does not run another crawler.</p>
        {loadedAt && <p className="mt-1 text-xs text-text-subtle">Saved notes loaded {time(loadedAt, timezone)}.</p>}
      </section>

      {error && <p role="alert" className="rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text">Saved reports could not be refreshed: {error}. {model.runs.length ? 'Previously loaded evidence remains visible; it is not a fresh check.' : 'Coverage is unavailable, not zero changes.'}</p>}
      {truncated && <p role="alert" className="rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text">Only the first 10,000 matching notes were loaded. History, search and counts cover loaded evidence only; full coverage is not established.</p>}
      {!!model.warnings.length && <section className="rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text" aria-label="Evidence warnings"><h3 className="font-semibold">Some saved evidence could not be read</h3><ul className="mt-2 list-inside list-disc space-y-1">{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.6fr)]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Sitemap check history">
          <div className="border-b border-border p-4"><h3 className="font-semibold text-text">Check history</h3>
            <div className="mt-3 flex flex-wrap gap-1" aria-label="Filter saved checks">{([['all', 'All checks'], ['changes', 'Changes'], ['incomplete', 'Incomplete']] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={historyFilter === value} className={historyFilter === value ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setHistoryFilter(value)}>{label}</button>)}</div></div>
          {history.length ? <ul className="max-h-[38rem] divide-y divide-border overflow-y-auto">{history.map(run => <li key={run.runId}>
            <button type="button" onClick={() => selectRun(run)} aria-pressed={selected?.runId === run.runId}
              className={`w-full p-4 text-left transition-colors focus-ring hover:bg-surface-sunken ${selected?.runId === run.runId ? 'bg-surface-sunken ring-1 ring-inset ring-brand-500' : ''}`}>
              <p className="text-sm font-semibold text-text">{time(run.checkedAtUtc, timezone)}</p>
              <p className="mt-1 text-xs text-text-muted">{run.kind === 'baseline' ? 'Initial baseline · not newly added URLs' : !verified(run) ? 'Incomplete / unverified evidence' : run.addedCount || run.removedCount ? `+${run.addedCount} added · −${run.removedCount} removed` : 'No URL changes'}</p>
              <p className="mt-2 text-xs text-text-subtle">{run.partCount > 1 ? `${run.partCount} report parts · ` : ''}{run.httpStatus ? `HTTP ${run.httpStatus}` : 'Response unavailable'}</p>
            </button></li>)}</ul> : <EmptyState title={loading ? 'Loading check history…' : 'No saved checks in this view'} message={model.runs.length ? 'Try All checks to include baselines and no-change runs.' : 'Existing baseline notes are preserved. A compatible check record is needed; an empty panel is not proof of no changes.'} />}
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-raised" aria-label="Sitemap URL evidence">
          {selected ? <>
            <div className="border-b border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold text-text">{selected.kind === 'baseline' ? 'Initial baseline' : 'URL comparison'}</h3>
                <p className="mt-1 text-xs text-text-muted">{selected.previousAtUtc ? `${time(selected.previousAtUtc, timezone)} → ` : ''}{time(selected.checkedAtUtc, timezone)}</p></div>
                <button type="button" className="btn-ghost text-xs" onClick={() => download(`autofinder-sitemap-${selected.checkedAtUtc.slice(0, 10)}.md`, sitemapRunMarkdown(selected))}>Download full comparison</button></div>
              {selected.kind === 'baseline' && <p className="mt-3 text-sm text-text-muted">{selected.urlCount?.toLocaleString()} URLs were present at the first capture. They are not counted as additions. Browse the latest verified set below.</p>}
              {!verified(selected) && <p className="mt-3 text-sm font-medium text-text">Partial or unverified evidence. Any displayed URL list is a saved sample, not a complete total or all-clear.</p>}
              {!!(selected.limitations.length + selected.problems.length) && <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-text-muted">{[...selected.limitations, ...selected.problems].map((p, i) => <li key={i}>{p}</li>)}</ul>}
              <details className="mt-3 text-xs text-text-subtle"><summary className="cursor-pointer">Provenance and source notes</summary><div className="mt-2 space-y-1 break-all"><p>Run: {selected.runId}</p><p>URL-set SHA-256: {selected.hash ?? 'Unavailable'}</p><p>Source note IDs: {selected.noteIds.join(', ')}</p>
                {onOpenNote && <div className="flex flex-wrap gap-1">{[...new Set([...selected.noteIds, ...selected.baselineNoteIds])].map((id, i) => <button key={id} type="button" className="btn-ghost text-xs" onClick={() => onOpenNote(id)}>Open source note {i + 1}</button>)}</div>}
              </div></details>
            </div>
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap gap-1" aria-label="Choose URL list">{([['added', 'Added', selected.addedUrls.length], ['removed', 'Removed', selected.removedUrls.length], ['current', 'Latest verified URLs', model.currentUrls.length]] as const).map(([value, label, total]) =>
                <button key={value} type="button" aria-pressed={tab === value} className={tab === value ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => changeTab(value)}>{label} <span className="ml-1 opacity-70">{total.toLocaleString()}</span></button>)}</div>
              {tab === 'current' && <p className="mt-3 text-xs text-text-muted">Latest verified set{checkpoint ? ` through ${time(checkpoint.checkedAtUtc, timezone)}` : ' unavailable'}; independent of the historical comparison selected.</p>}
              <label className="sr-only" htmlFor="sitemap-url-search">Search every URL in this list</label>
              <input id="sitemap-url-search" type="search" className="input mt-4 w-full" value={query} placeholder="Search every URL in this list…" onChange={e => { setQuery(e.target.value); setLimit(100); }} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"><p>{visible.length.toLocaleString()} matching URL{visible.length === 1 ? '' : 's'} · {urls.length.toLocaleString()} in this saved list</p>
                {!!urls.length && <button type="button" className="btn-ghost text-xs" onClick={() => download(`autofinder-sitemap-${tab}.md`, urls.map(u => '- ' + u).join('\n') + '\n')}>Download all {urls.length.toLocaleString()} URLs</button>}</div>
              {visible.length ? <ul className="mt-3 divide-y divide-border rounded-lg border border-border">{visible.slice(0, limit).map(url => <li key={url} className="px-3 py-2.5"><a className="break-all text-sm text-brand-700 underline-offset-2 hover:underline focus-ring dark:text-brand-300" href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
                : <EmptyState title={query ? 'No URLs match your search' : tab === 'current' ? 'No verified URL set available' : selected.kind === 'baseline' ? 'Baseline—not an additions/removals report' : verified(selected) ? `No ${tab} URLs` : 'No URLs listed in the available evidence'} message={query ? 'Search covers the entire saved list, not only the visible page.' : verified(selected) ? 'All saved URL changes are retained; none are hidden behind a top-N summary.' : 'Missing evidence does not establish zero changes.'} />}
              {visible.length > limit && <button type="button" className="btn-ghost mt-4 w-full" onClick={() => setLimit(n => n + 100)}>Show next {Math.min(100, visible.length - limit)} URLs · {visible.length - limit} remaining</button>}
            </div>
          </> : <EmptyState title={loading ? 'Loading saved evidence…' : 'Choose a saved check'} message="Baselines, changes and incomplete attempts will appear here when the morning check saves review records. Existing notes are not modified by this panel." />}
        </section>
      </div>
    </div>
  </div>;
}
