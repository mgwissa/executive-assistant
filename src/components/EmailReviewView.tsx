import { useEffect, useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { EMAIL_CATEGORY_LABELS, EMAIL_REVIEW_MAILBOX, EMAIL_STATUS_LABELS, compareEmailCases, isOutlookMessageUrl, needsEmailReview } from '../lib/emailReview';
import type { EmailReviewCase, EmailReviewEvent, EmailReviewIntake, EmailReviewStatus } from '../lib/emailReview';
import { EmptyState } from './ui/EmptyState';

function stamp(value: string, timezone: string) {
  return formatInTimeZone(new Date(value), timezone, 'MMM d, yyyy · h:mm a zzz');
}
type Filter = 'needs_review' | 'open' | 'closed' | 'all';
type Props = {
  cases: EmailReviewCase[]; latestIntake: EmailReviewIntake | null; checkpoint: EmailReviewIntake | null;
  timezone: string; loading: boolean; truncated: boolean; error: string | null; savingId: string | null;
  history: Record<string, EmailReviewEvent[]>;
  onRefresh: () => void; onHistory: (caseId: string) => void;
  onReview: (item: EmailReviewCase, status: EmailReviewStatus, note: string) => Promise<string | null>;
};
const closed = (c: EmailReviewCase) => !needsEmailReview(c) && ['handled', 'no_action'].includes(c.review_status);

function Coverage({ latest, checkpoint, timezone }: { latest: EmailReviewIntake | null; checkpoint: EmailReviewIntake | null; timezone: string }) {
  return <section className="rounded-xl border border-border bg-surface-raised p-4 text-sm" aria-label="Saved mailbox coverage">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold text-text">Saved intake coverage</h2>
      <span className="text-xs text-text-muted">Mailbox read-only · decisions stay here</span>
    </div>
    <p className="mt-2 text-text-muted">{checkpoint
      ? <>Last complete checkpoint: <strong className="font-medium text-text">{stamp(checkpoint.covered_through, timezone)}</strong></>
      : 'No complete mailbox checkpoint has been saved here. Existing notes and briefing history are unchanged.'}</p>
    {latest && <>
      <p className="mt-1 text-xs text-text-muted">Latest saved interval: {stamp(latest.covered_from, timezone)} → {stamp(latest.covered_through, timezone)}.</p>
      <p className="mt-1 text-xs text-text-muted">{latest.complete ? 'Complete source processing' : 'Partial source processing — checkpoint not advanced'} · {latest.message_count} messages reviewed · {latest.customer_reply_count} customer replies · {latest.pages} page(s). These are this intake’s counts, not unanswered-request totals.</p>
      {!!latest.limitations.length && <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-text-muted">{latest.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul>}
    </>}
    <p className="mt-2 text-xs text-text-subtle">This is saved evidence, not a live inbox. Silence, read status and absent replies do not prove a request was handled.</p>
  </section>;
}

function DecisionForm({ item, saving, onReview }: { item: EmailReviewCase; saving: boolean; onReview: Props['onReview'] }) {
  const [status, setStatus] = useState<EmailReviewStatus>(item.review_status);
  const [note, setNote] = useState(item.decision_note);
  const [baseVersion, setBaseVersion] = useState(item.updated_at);
  const [saved, setSaved] = useState(false);
  const stale = baseVersion !== item.updated_at;
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = async () => {
    setLocalError(null); setSaved(false);
    if (stale) { setLocalError('Review the updated evidence before saving. Your draft is still here.'); return; }
    if (['handled', 'no_action'].includes(status) && !note.trim()) { setLocalError('Record what was handled or why no action is needed.'); return; }
    const version = await onReview({ ...item, updated_at: baseVersion }, status, note);
    if (version) { setBaseVersion(version); setSaved(true); }
  };
  return <section className="mt-6 border-t border-border pt-5">
    <h3 className="font-semibold text-text">Your decision</h3>
    <p className="mt-1 text-xs leading-relaxed text-text-muted">Saving records your review only. It does not reply, create a draft, unsubscribe, suppress dealer contact or change customer records. “Handled” is your report of action elsewhere.</p>
    {stale && <div className="mt-3 rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text" role="status">
      This case changed. Review its current evidence; your draft has been preserved.
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => { setBaseVersion(item.updated_at); setSaved(false); }}>Use latest version, keep my draft</button>
    </div>}
    <label className="mt-3 block text-xs font-medium text-text-muted" htmlFor="email-review-status">Review status</label>
    <select id="email-review-status" className="input mt-1 w-full" value={status} onChange={e => { setStatus(e.target.value as EmailReviewStatus); setSaved(false); }} disabled={saving}>
      {Object.entries(EMAIL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <label className="mt-3 block text-xs font-medium text-text-muted" htmlFor="email-decision-note">Decision / handling note</label>
    <textarea id="email-decision-note" className="input mt-1 min-h-28 w-full resize-y" maxLength={4000} value={note} disabled={saving}
      placeholder="What you decided, what a teammate confirmed, or what remains open."
      onChange={e => { setNote(e.target.value); setSaved(false); }} />
    {localError && <p role="alert" className="mt-2 text-sm text-text">{localError}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="btn-primary" disabled={saving || stale} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save review decision'}</button>
      {saved && <span role="status" className="text-xs text-text-muted">Decision saved. No mailbox action was taken.</span>}
    </div>
  </section>;
}

export function EmailReviewView(props: Props) {
  const { cases, timezone, onHistory } = props;
  const [filter, setFilter] = useState<Filter>('needs_review');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const counts = useMemo(() => ({ needs_review: cases.filter(needsEmailReview).length, open: cases.filter(c => !closed(c)).length,
    closed: cases.filter(closed).length, all: cases.length }), [cases]);
  const visible = useMemo(() => cases.filter(c => {
    if (filter === 'needs_review' && !needsEmailReview(c) || filter === 'open' && closed(c) || filter === 'closed' && !closed(c)) return false;
    return [c.customer_label, c.vehicle_context, c.request_summary, EMAIL_CATEGORY_LABELS[c.category]].join(' ').toLowerCase().includes(query.toLowerCase().trim());
  }).sort(compareEmailCases), [cases, filter, query]);
  // Keep the selected case after a decision, even if it leaves the current filter.
  const selected = cases.find(c => c.id === selectedId) ?? null;
  useEffect(() => { if (selected) onHistory(selected.id); }, [selected, onHistory]);
  return <div className="h-full overflow-y-auto bg-surface p-3 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">AutoFinder · customer requests</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text">Email review</h2>
          <p className="mt-1 text-sm text-text-muted">{EMAIL_REVIEW_MAILBOX} · Contact preferences first. People and requests stay separate.</p></div>
        <button type="button" className="btn-ghost" onClick={props.onRefresh} disabled={props.loading || !!props.savingId}>{props.loading ? 'Loading saved cases…' : 'Refresh saved cases'}</button>
      </div>
      <Coverage latest={props.latestIntake} checkpoint={props.checkpoint} timezone={timezone} />
      {props.error && <div role="alert" className="rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text">Could not load or save email review: {props.error}. Coverage is not established by this failure. {cases.length ? 'Previously loaded cases remain visible.' : ''}</div>}
      {props.truncated && <p role="status" className="text-sm text-text">Only the first 2,000 cases are loaded. Filters, search and counts below cover loaded cases only.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" aria-label="Filter customer cases">
          {([['needs_review', 'Needs review'], ['open', 'Open'], ['closed', 'Closed'], ['all', 'All']] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={filter === value ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>{label} <span className="ml-1 opacity-70">{counts[value]}</span></button>)}
        </div>
        <input className="input w-full sm:w-72" type="search" aria-label="Search loaded customer cases" placeholder="Search loaded cases…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.3fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-surface-raised" aria-label="Customer request cases">
          {visible.length ? <ul className="divide-y divide-border">{visible.map(c => <li key={c.id}>
            <button type="button" className={`w-full p-4 text-left transition-colors focus-ring hover:bg-surface-sunken ${selected?.id === c.id ? 'bg-surface-sunken ring-1 ring-inset ring-brand-500' : ''}`} aria-pressed={selected?.id === c.id} onClick={() => setSelectedId(c.id)}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-text">{c.customer_label}</span><span className="text-xs text-text-muted">{needsEmailReview(c) ? 'Needs review' : c.review_status === 'reviewed' ? 'Reviewed' : 'Closed'}</span></div>
              <p className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-300">{EMAIL_CATEGORY_LABELS[c.category]}</p>
              {c.vehicle_context && <p className="mt-1 text-sm text-text-muted">{c.vehicle_context}</p>}
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-text">{c.request_summary}</p>
              <p className="mt-2 text-xs text-text-subtle">Received {stamp(c.received_at, timezone)}</p>
              {c.reviewed_source_version && c.reviewed_source_version !== c.source_version && <p className="mt-1 text-xs font-medium text-text">New source version · earlier decision preserved</p>}
            </button>
          </li>)}</ul> : <EmptyState title={props.loading ? 'Loading saved cases…' : props.error ? 'Case coverage unavailable' : cases.length ? 'No cases match this view' : 'No cases saved here yet'}
            message={cases.length ? 'Try another filter or search. Closed cases remain in All.' : 'Historical notes are unchanged. An empty view does not establish that customers were answered or that the mailbox has no requests.'} />}
        </section>
        <section className="min-w-0 rounded-xl border border-border bg-surface-raised p-4 sm:p-5" aria-label="Case evidence and decision">
          {selected ? <>
            <p className="text-xs font-medium text-brand-700 dark:text-brand-300">{EMAIL_CATEGORY_LABELS[selected.category]}</p>
            <h2 className="mt-1 text-xl font-semibold text-text">{selected.customer_label}</h2>
            {selected.vehicle_context && <p className="mt-1 text-sm text-text-muted">{selected.vehicle_context}</p>}
            <p className="mt-2 text-xs text-text-subtle">Received {stamp(selected.received_at, timezone)}</p>
            {isOutlookMessageUrl(selected.source_url) ? <a className="mt-3 inline-block text-sm font-medium text-brand-700 underline underline-offset-4 dark:text-brand-300" href={selected.source_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open exact source in Outlook ↗</a> : <p className="mt-3 text-sm text-text">Source URL is unavailable or not a recognized Outlook message link.</p>}
            {selected.category === 'contact_preference' && <p className="mt-4 rounded-lg border border-border-strong bg-surface-sunken p-3 text-sm text-text">Human review first. A contact preference is not proof that suppression or dealer-contact changes have been made.</p>}
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">Customer request</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{selected.request_summary}</p>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Suggested next step · not assigned</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">{selected.suggested_next_step || 'No suggested action was saved.'}</p>
            <p className="mt-4 text-xs text-text-muted">{closed(selected) ? EMAIL_STATUS_LABELS[selected.review_status] : 'Handling unverified unless supporting correspondence or a human decision establishes otherwise.'}</p>
            {selected.decision_note && <div className="mt-3 border-l-2 border-brand-500 pl-3"><p className="text-xs font-semibold text-text-muted">Saved decision{needsEmailReview(selected) ? ' · newest source still needs review' : ''}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-text">{selected.decision_note}</p></div>}
            <DecisionForm key={selected.id} item={selected} saving={props.savingId === selected.id} onReview={props.onReview} />
            <details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-text-muted">Recent case history (up to 20 changes)</summary>
              <ol className="mt-3 space-y-3">{(props.history[selected.id] ?? []).map(e => <li key={e.id} className="text-xs text-text-muted">
                <p>{stamp(e.created_at, timezone)} · {e.kind === 'decision' ? 'Your recorded decision' : 'Saved source evidence'}</p>
                {e.kind === 'source_update' && typeof e.after.request_summary === 'string' && <p className="mt-1 whitespace-pre-wrap break-words text-text">{e.after.request_summary}</p>}
                {e.kind === 'decision' && typeof e.after.review_status === 'string' && <p className="mt-1 text-text">{EMAIL_STATUS_LABELS[e.after.review_status as EmailReviewStatus] ?? e.after.review_status}</p>}
                {e.kind === 'decision' && typeof e.after.decision_note === 'string' && <p className="mt-1 whitespace-pre-wrap break-words text-text">{e.after.decision_note}</p>}
              </li>)}</ol>
            </details>
          </> : <EmptyState title="Choose a customer request" message="Read the evidence, verify what is known, then record your decision. Nothing here sends or modifies email." />}
        </section>
      </div>
    </div>
  </div>;
}
