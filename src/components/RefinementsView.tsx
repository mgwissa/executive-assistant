import { useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatInTimeZone } from 'date-fns-tz';
import { refinementStoryUrl } from '../lib/refinementReview';
import type { RefinementAction, RefinementMeeting, RefinementReviewModel, RefinementStory } from '../lib/refinementReview';
import { BookIcon, CalendarIcon, CheckSquareIcon, NoteIcon, RefreshIcon, SearchIcon } from './icons';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';

type Props = {
  model: RefinementReviewModel;
  timezone: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  loadedAt: string | null;
  onRefresh: () => void;
  onOpenNote?: (noteId: string) => void;
};

type Tab = 'followups' | 'stories' | 'notes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'followups', label: 'Your follow-ups' },
  { id: 'stories', label: 'Stories' },
  { id: 'notes', label: 'Meeting notes' },
];

function savedTime(value: string, timezone: string): string {
  try { return formatInTimeZone(new Date(value), timezone, 'MMM d, yyyy · h:mm a zzz'); }
  catch { return 'Time unavailable'; }
}

function meetingDate(meeting: RefinementMeeting, timezone: string): string {
  if (!meeting.date) return 'Undated meeting';
  try {
    return /^\d{4}-\d{2}-\d{2}$/.test(meeting.date)
      ? formatInTimeZone(new Date(`${meeting.date}T12:00:00Z`), 'UTC', 'EEE, MMM d, yyyy')
      : savedTime(meeting.date, timezone);
  } catch { return 'Date unavailable'; }
}

/** Saved prose is evidence. Do not render HTML, remote images or executable URLs. */
function safeMarkdownUrl(value: string): string {
  if (!/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    return !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function SavedMarkdown({ content }: { content: string }) {
  return <div className="notes-prose min-w-0 break-words text-base leading-relaxed text-text">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl} components={{
      a: ({ href, children }) => href
        ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-brand-700 underline underline-offset-2 focus-ring dark:text-brand-300">{children}</a>
        : <span>{children}</span>,
      img: ({ alt }) => <span className="text-text-muted">{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
    }}>{content}</ReactMarkdown>
  </div>;
}

function Evidence({ text }: { text: string }) {
  return text.trim() ? <details className="mt-4 text-sm text-text-muted">
    <summary className="w-fit cursor-pointer rounded focus-ring">Meeting evidence</summary>
    <p className="mt-2 whitespace-pre-wrap leading-relaxed">{text}</p>
  </details> : null;
}

const actionLabels: Record<RefinementAction['status'], string> = {
  follow_up: 'Follow-up', decision: 'Decision', delegated: 'With the team', done: 'Recorded done',
};

function ActionCard({ action }: { action: RefinementAction }) {
  return <article className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant={action.status === 'done' ? 'success' : action.status === 'delegated' ? 'blue' : action.status === 'decision' ? 'purple' : 'amber'}>{actionLabels[action.status]}</Badge>
      <p className="text-sm text-text-muted">{action.owner || 'Owner not recorded'}</p>
    </div>
    <h4 className="mt-3 text-base font-semibold leading-snug text-text">{action.title}</h4>
    <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text-muted">{action.nextAction}</p>
    <Evidence text={action.evidence} />
  </article>;
}

const storyLabels: Record<RefinementStory['disposition'], string> = {
  update: 'Update draft', clarify: 'Clarify first', already_updated: 'Already updated',
  new_story: 'New story proposal', verify: 'Verify current item',
};

function StoryCard({ story, reviewedAt, timezone }: { story: RefinementStory; reviewedAt: string; timezone: string }) {
  const [copyStatus, setCopyStatus] = useState<{ error: boolean; message: string } | null>(null);
  const url = story.workItemId === undefined ? null : refinementStoryUrl(story.workItemId);
  const description = story.description?.trim() ? story.description : null;
  const acceptanceCriteria = story.acceptanceCriteria?.trim() ? story.acceptanceCriteria : null;
  const copy = async (text: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyStatus({ error: false, message: `${label} copied.` });
    } catch {
      setCopyStatus({ error: true, message: 'Copy is unavailable. Open the draft below, select the text, and copy it manually.' });
    }
  };

  return <article className="overflow-hidden rounded-xl border border-border bg-surface-raised">
    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={story.disposition === 'already_updated' ? 'success' : story.disposition === 'clarify' ? 'warning' : story.disposition === 'new_story' ? 'purple' : 'brand'}>{storyLabels[story.disposition]}</Badge>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-ring dark:text-brand-300">ADO {story.workItemId}</a>}
      </div>
      <h4 className="mt-3 text-lg font-semibold leading-snug text-text">{story.title}</h4>
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text-muted">{story.summary}</p>
      {(story.state !== undefined || story.points !== undefined) && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        {story.state !== undefined && <span>Recorded state: <strong className="font-medium text-text">{story.state}</strong></span>}
        {story.points !== undefined && <span>{story.points} {story.points === 1 ? 'point' : 'points'}</span>}
        <span>As of {savedTime(reviewedAt, timezone)}</span>
      </div>}
      <Evidence text={story.evidence} />
    </div>
    {description || acceptanceCriteria ? <div className="border-t border-border bg-surface-sunken/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {description && <button type="button" className="btn-ghost text-sm" onClick={() => void copy(description, 'Description')}>Copy description</button>}
        {acceptanceCriteria && <button type="button" className="btn-ghost text-sm" onClick={() => void copy(acceptanceCriteria, 'Acceptance criteria')}>Copy acceptance criteria</button>}
      </div>
      <div role="status" aria-live="polite" className={copyStatus ? `mt-3 text-sm ${copyStatus.error ? 'text-amber-800 dark:text-amber-200' : 'text-text-muted'}` : 'sr-only'}>{copyStatus?.message ?? ''}</div>
      <details className="mt-3">
        <summary className="w-fit cursor-pointer rounded text-sm font-medium text-text focus-ring">Review draft</summary>
        <div className="mt-4 space-y-6">
          {description && <section aria-label="Draft description"><h5 className="mb-3 text-sm font-semibold text-text">Description</h5><SavedMarkdown content={description} /></section>}
          {acceptanceCriteria && <section aria-label="Draft acceptance criteria"><h5 className="mb-3 text-sm font-semibold text-text">Acceptance criteria</h5><SavedMarkdown content={acceptanceCriteria} /></section>}
        </div>
      </details>
    </div> : <p className="border-t border-border bg-surface-sunken/60 px-4 py-3 text-sm leading-relaxed text-text-muted sm:px-5">No draft text was saved for this item. Review its meeting evidence and current work item.</p>}
  </article>;
}

function MeetingSources({ meeting, timezone }: { meeting: RefinementMeeting; timezone: string }) {
  const record = meeting.record;
  return <details className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
    <summary className="w-fit cursor-pointer rounded text-sm font-medium text-text focus-ring">Source and review details</summary>
    <div className="mt-4 space-y-3 text-sm leading-relaxed text-text-muted">
      {record ? <>
        <p><span className="font-medium text-text">Supplied file:</span> {record.source.fileName}</p>
        <p><span className="font-medium text-text">Transcript:</span> {record.source.transcriptionComplete ? 'Complete supplied transcript' : 'Partial supplied transcript'} · {record.source.paragraphs} paragraphs · {record.source.firstTimestamp} to {record.source.lastTimestamp}</p>
        {record.source.timezoneCaveat && <p>{record.source.timezoneCaveat}</p>}
        <p><span className="font-medium text-text">Reviewed:</span> {savedTime(record.reviewedAt, timezone)}</p>
        <p className="break-all"><span className="font-medium text-text">Source SHA-256:</span> {record.source.sha256}</p>
      </> : <p>This older recap is preserved in its original note. A separate follow-up or story breakdown has not been saved for it.</p>}
      <p>Source note last updated {savedTime(meeting.updatedAt, timezone)}.</p>
    </div>
  </details>;
}

export function RefinementsView({ model, timezone, loading, error, truncated, loadedAt, onRefresh, onOpenNote }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('followups');
  const instanceId = useId();
  const history = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return model.meetings.filter(meeting => !needle || [meeting.title, meeting.date ?? '', meeting.record?.summary ?? '',
      ...meeting.record?.actions.map(action => `${action.title} ${action.owner} ${action.nextAction}`) ?? [],
      ...meeting.record?.stories.map(story => `${story.title} ${story.workItemId ?? ''}`) ?? [],
    ].join(' ').toLowerCase().includes(needle));
  }, [model.meetings, query]);
  const selected = history.find(meeting => meeting.noteId === selectedId) ?? history[0] ?? null;
  const record = selected?.record;
  const ownActions = record?.actions.filter(action => action.status !== 'delegated') ?? [];
  const delegatedActions = record?.actions.filter(action => action.status === 'delegated') ?? [];
  const selectMeeting = (meeting: RefinementMeeting) => { setSelectedId(meeting.noteId); setTab('followups'); };
  const tabCount = (id: Tab) => !record ? null : id === 'followups' ? record.actions.length : id === 'stories' ? record.stories.length : null;

  return <div className="h-full overflow-y-auto bg-surface px-3 py-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-text-muted">Meeting workspace</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">Refinements</h2>
          <p className="mt-2 text-base leading-relaxed text-text-muted">Follow-ups, story changes, and the decisions behind them. Keep each meeting’s context together.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <button type="button" className="btn-ghost gap-2" onClick={onRefresh} disabled={loading}><RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />{loading ? 'Loading reviews…' : 'Refresh saved reviews'}</button>
          {loadedAt && <p className="text-sm text-text-subtle">Loaded {savedTime(loadedAt, timezone)}</p>}
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-border-strong bg-surface-sunken p-4 text-sm leading-relaxed text-text"><p className="font-medium">Saved reviews could not be refreshed.</p><p className="mt-1">{error}</p>{model.meetings.length > 0 && <p className="mt-1 text-text-muted">Previously loaded meetings remain visible.</p>}</div>}
      {truncated && <p role="alert" className="rounded-xl border border-border-strong bg-surface-sunken p-4 text-sm leading-relaxed text-text">Only part of the saved meeting history was loaded. Search and counts cover the loaded reviews.</p>}
      {model.warnings.length > 0 && <details className="rounded-xl border border-border-strong bg-surface-sunken p-4 text-sm text-text"><summary className="w-fit cursor-pointer rounded font-medium focus-ring">Some saved review details need attention</summary><ul className="mt-3 list-inside list-disc space-y-2 leading-relaxed text-text-muted">{model.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,2fr)]">
        <aside className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-raised lg:sticky lg:top-0" aria-label="Refinement meeting history">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold text-text">Meeting history</h3><Badge>{model.meetings.length}</Badge></div>
            <label htmlFor={`${instanceId}-search`} className="sr-only">Search saved refinement meetings</label>
            <div className="relative mt-4"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" /><input id={`${instanceId}-search`} type="search" className="input w-full pl-9 text-base" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search meetings or stories" /></div>
          </div>
          {history.length > 0 ? <ul className="max-h-[24rem] divide-y divide-border overflow-y-auto lg:max-h-[calc(100vh-20rem)]">{history.map(meeting => <li key={meeting.noteId}>
            <button type="button" aria-pressed={selected?.noteId === meeting.noteId} onClick={() => selectMeeting(meeting)} className={`w-full border-l-2 p-4 text-left transition-colors hover:bg-surface-sunken focus-ring ${selected?.noteId === meeting.noteId ? 'border-brand-500 bg-surface-sunken' : 'border-transparent'}`}>
              <p className={`text-sm font-medium ${selected?.noteId === meeting.noteId ? 'text-brand-700 dark:text-brand-300' : 'text-text-muted'}`}>{meetingDate(meeting, timezone)}</p>
              <p className="mt-2 text-base font-semibold leading-snug text-text">{meeting.title}</p>
              {meeting.record ? <><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-text-muted">{meeting.record.summary}</p><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-subtle"><span>{meeting.record.actions.length} follow-ups</span><span>{meeting.record.stories.length} stories</span>{!meeting.record.source.transcriptionComplete && <span>Partial transcript</span>}</div></> : <p className="mt-2 text-sm text-text-subtle">Earlier recap · original note</p>}
            </button>
          </li>)}</ul> : <EmptyState icon={<CalendarIcon className="h-5 w-5" />} title={loading ? 'Loading meeting history…' : query ? 'No matching meetings' : 'No saved refinements yet'} message={query ? 'Try a meeting date, a story number, or a shorter search.' : 'Reviewed transcripts and earlier refinement recaps will appear here.'} />}
        </aside>

        <section className="min-w-0 space-y-4" aria-label="Selected refinement meeting">
          {selected ? <>
            <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
              <header className="p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-text-muted"><CalendarIcon className="h-4 w-4" aria-hidden="true" />{meetingDate(selected, timezone)}</p>
                  {onOpenNote && <button type="button" className="btn-ghost gap-2 text-sm" onClick={() => onOpenNote(selected.noteId)}><NoteIcon className="h-4 w-4" aria-hidden="true" />Open source note</button>}
                </div>
                <h3 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-text sm:text-2xl">{selected.title}</h3>
                {record ? <p className="mt-3 text-base leading-relaxed text-text-muted">{record.summary}</p> : <p className="mt-3 text-base leading-relaxed text-text-muted">This earlier recap is preserved in its original form. Open Meeting notes to read it.</p>}
                {record && !record.source.transcriptionComplete && <div className="mt-4"><Badge variant="warning">Partial supplied transcript</Badge></div>}
              </header>
              <div className="flex flex-wrap gap-1 border-t border-border bg-surface-sunken/50 p-2" role="tablist" aria-label="Refinement details">{TABS.map(item => <button key={item.id} type="button" id={`${instanceId}-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`${instanceId}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={event => {
                  const index = TABS.findIndex(candidate => candidate.id === item.id);
                  const nextIndex = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  setTab(TABS[nextIndex].id);
                  document.getElementById(`${instanceId}-tab-${TABS[nextIndex].id}`)?.focus();
                }}
                onClick={() => setTab(item.id)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-ring sm:px-4 ${tab === item.id ? 'bg-surface-raised text-text shadow-card ring-1 ring-border' : 'text-text-muted hover:bg-surface-raised hover:text-text'}`}>{item.label}{tabCount(item.id) !== null && <span className="rounded bg-surface-sunken px-1.5 py-0.5 tabular-nums text-text-muted">{tabCount(item.id)}</span>}</button>)}</div>
            </div>

            <div id={`${instanceId}-panel-${tab}`} role="tabpanel" aria-labelledby={`${instanceId}-tab-${tab}`} tabIndex={0} className="min-w-0 rounded-xl focus-ring">
              {tab === 'followups' && (record ? <div className="space-y-5">
                {ownActions.length > 0 && <section aria-label="Follow-ups and decisions"><div className="mb-3 flex items-center gap-2"><CheckSquareIcon className="h-4 w-4 text-text-subtle" aria-hidden="true" /><h4 className="text-base font-semibold text-text">Follow-ups and decisions</h4></div><div className="space-y-3">{ownActions.map(action => <ActionCard key={`${selected.noteId}-${action.id}`} action={action} />)}</div></section>}
                {delegatedActions.length > 0 && <section aria-label="Follow-ups with the team"><h4 className="mb-3 text-base font-semibold text-text">With the team</h4><div className="space-y-3">{delegatedActions.map(action => <ActionCard key={`${selected.noteId}-${action.id}`} action={action} />)}</div></section>}
                {record.actions.length === 0 && <div className="rounded-xl border border-border bg-surface-raised"><EmptyState title="No follow-ups recorded" message="This saved review has no separate follow-up items. Its recap and decisions remain available in Meeting notes." /></div>}
              </div> : <div className="rounded-xl border border-border bg-surface-raised"><EmptyState title="This meeting has an earlier recap" message="A separate follow-up list has not been saved for this note. Read the original recap to see its context." action={<button type="button" className="btn-ghost" onClick={() => setTab('notes')}>Read meeting notes</button>} /></div>)}

              {tab === 'stories' && (record ? <div className="space-y-4">
                {record.stories.length > 0 ? record.stories.map(story => <StoryCard key={`${selected.noteId}-${story.id}`} story={story} reviewedAt={record.reviewedAt} timezone={timezone} />) : <div className="rounded-xl border border-border bg-surface-raised"><EmptyState icon={<BookIcon className="h-5 w-5" />} title="No story changes recorded" message="This saved review has no separate story-change entries. Read Meeting notes for the full recap." /></div>}
              </div> : <div className="rounded-xl border border-border bg-surface-raised"><EmptyState title="No separate story breakdown" message="This earlier note is available as a recap. No story drafts have been extracted into this view." action={<button type="button" className="btn-ghost" onClick={() => setTab('notes')}>Read meeting notes</button>} /></div>)}

              {tab === 'notes' && <div className="space-y-4">
                <article className="rounded-xl border border-border bg-surface-raised p-4 sm:p-6">{selected.recap.trim() ? <SavedMarkdown content={selected.recap} /> : record ? <SavedMarkdown content={record.summary} /> : <EmptyState title="Recap text is unavailable" message="Open the source note to review the saved meeting." />}</article>
                {!!record?.decisions.length && <section className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5" aria-label="Recorded meeting decisions"><h4 className="text-base font-semibold text-text">Decisions</h4><ul className="mt-3 list-disc space-y-3 pl-5 text-base leading-relaxed text-text-muted">{record.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul></section>}
                {!!record?.questions.length && <section className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5" aria-label="Open meeting questions"><h4 className="text-base font-semibold text-text">Open questions</h4><ul className="mt-3 list-disc space-y-3 pl-5 text-base leading-relaxed text-text-muted">{record.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></section>}
              </div>}
            </div>
            <MeetingSources meeting={selected} timezone={timezone} />
          </> : <div className="rounded-xl border border-border bg-surface-raised"><EmptyState icon={<BookIcon className="h-5 w-5" />} title={loading ? 'Loading saved refinements…' : query ? 'Choose another search' : 'Your meeting context, together'} message={query ? 'No meetings match the current search.' : 'Select a meeting to review its follow-ups, story changes, and notes.'} /></div>}
        </section>
      </div>
    </div>
  </div>;
}
