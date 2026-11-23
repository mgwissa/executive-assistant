import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RefinementsView } from '../components/RefinementsView';
import { refinementProgressKey } from '../lib/refinementProgress';
import type { RefinementProgressRow, RefinementProgressStatus, RefinementProgressTarget } from '../lib/refinementProgress';
import type { RefinementRecord, RefinementReviewModel } from '../lib/refinementReview';
import '../index.css';

// Fictional local UI fixtures only. No account, Supabase, recording or ADO fetch.
const reviewedAt = '2026-11-23T15:15:00Z';
const empty: RefinementReviewModel = { meetings: [], warnings: [] };
const record: RefinementRecord = {
  version: 1,
  sourceId: 'fictional-supplied-refinement-nov19',
  meetingDate: '2026-11-19',
  reviewedAt,
  summary: 'Clarified dealer coverage, separated the reporting follow-up, and prepared a story draft for review.',
  source: {
    fileName: 'Fictional refinement transcript.docx', sha256: 'a'.repeat(64),
    firstTimestamp: '00:00', lastTimestamp: '42:18', timezoneCaveat: 'Fictional meeting time for the local preview.',
    paragraphs: 183, transcriptionComplete: true,
  },
  actions: [
    { id: 'fictional-contact', title: 'Confirm the technical contact for the dealer handoff', owner: 'Mike',
      nextAction: 'Record the technical contact and the agreed next step before defining implementation work.',
      evidence: '12:40–13:18 · paragraphs 48–53. Mike agreed to confirm the contact.', status: 'follow_up' },
    { id: 'fictional-definition', title: 'Choose the conversion definition for the report', owner: 'Mike',
      nextAction: 'Confirm whether the report should count an offer click or a completed action after the click.',
      evidence: '21:06–22:14 · paragraphs 91–97. The definition remained open.', status: 'decision' },
    { id: 'fictional-team', title: 'Check the existing dealer lookup behavior', owner: 'Alex',
      nextAction: 'Bring the confirmed lookup behavior back to the team. No replacement algorithm was selected.',
      evidence: '17:20–18:05 · paragraphs 72–76. Alex agreed to check the existing implementation.', status: 'delegated' },
    { id: 'fictional-done', title: 'Confirm the planned review slot', owner: 'Mike',
      nextAction: 'The review slot was confirmed during this meeting. No additional scheduling follow-up was recorded.',
      evidence: '35:12 · paragraph 151.', status: 'done' },
  ],
  stories: [
    { id: 'fictional-story-one', title: 'Example App // Support dealer quotes', workItemId: 12345, state: 'In Development', points: 5,
      disposition: 'update', summary: 'Add the agreed inventory-based coverage and preserve the existing delivery flow.',
      evidence: '06:30–19:10 · paragraphs 22–86. The final explanation corrected the earlier live-ping assumption.',
      description: '**As a** lead seller\n**I want** matching dealers available in the quote flow\n**So that** I can submit a make/model request without choosing a VIN first\n\n**Context**\nThe existing flow supports inventory leads. This draft adds the agreed quote flow while retaining the existing delivery path.',
      acceptanceCriteria: 'AC1: A quote request returns distinct dealers with matching inventory within the configured radius.\n\nAC2: The selected dealer receives the lead through the existing delivery flow.\n\nAC3: Existing inventory requests continue to work.' },
    { id: 'fictional-story-two', title: 'Example App // Add conversion reporting', disposition: 'clarify',
      summary: 'The intended conversion event is still open. Keep the draft separate from the existing offer-click metric.',
      evidence: '21:06–22:14 · paragraphs 91–97. No conversion definition was agreed.' },
    { id: 'fictional-story-three', title: 'Example App // Preserve report filters', workItemId: 12346, state: 'New', points: 2,
      disposition: 'already_updated', summary: 'The reviewed work item already includes the confirmed filter behavior.',
      evidence: '28:02–29:14 · paragraphs 119–124.' },
  ],
  decisions: ['Use inventory to establish coverage for the quote response.', 'Keep the report definition separate from pixel meeting scheduling.'],
  questions: ['Which event should count as a completed conversion?'],
};

const model: RefinementReviewModel = {
  meetings: [
    { noteId: 'fictional-note-nov19', title: 'Refinement · Dealer quotes and reporting', date: '2026-11-19', updatedAt: reviewedAt, record,
      recap: '## Meeting recap\n\nThe team agreed to extend the existing dealer flow rather than introduce a separate delivery path. Inventory supplies the coverage response; implementation details should follow the existing reference.\n\n### Follow-up context\n\nMike will confirm the technical contact. Alex will check the current lookup behavior. The report conversion definition is still open.\n\nNo new delivery date was agreed.' },
    { noteId: 'fictional-note-nov17', title: 'Refinement · Campaign setup', date: '2026-11-17', updatedAt: '2026-11-18T15:00:00Z',
      record: { ...record, sourceId: 'fictional-supplied-refinement-nov17', meetingDate: '2026-11-17', reviewedAt: '2026-11-18T15:00:00Z',
        summary: 'Reviewed the campaign setup and captured the remaining configuration questions.', actions: [], stories: [], decisions: [], questions: [] },
      recap: '## Campaign setup\n\nThe meeting reviewed the existing configuration. No separate follow-up or story draft was recorded in this fictional example.' },
    { noteId: 'fictional-legacy-note', title: 'Refinement notes · Earlier recap', date: '2026-11-10', updatedAt: '2026-11-10T18:00:00Z', record: null,
      recap: '## Earlier refinement recap\n\nThis fictional note predates the structured review format. The original discussion remains available here.\n\n- Keep the current delivery behavior.\n- Revisit the report definition when more context is available.' },
  ],
  warnings: [],
};

function Preview() {
  const [showEmpty, setShowEmpty] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [sourceMessage, setSourceMessage] = useState('');
  const [progress, setProgress] = useState<Record<string, RefinementProgressRow>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [failProgressSave, setFailProgressSave] = useState(false);
  const [progressUnavailable, setProgressUnavailable] = useState(false);
  const changeProgress = (target: RefinementProgressTarget, status: RefinementProgressStatus) => {
    if (savingKey !== null) return;
    const key = refinementProgressKey(target);
    setSavingKey(key);
    setProgressError(null);
    // Simulate a confirmed save. This fixture never writes to a provider or account.
    window.setTimeout(() => {
      if (failProgressSave) setProgressError('Simulated progress save failed. Your previous status is unchanged.');
      else setProgress(previous => ({ ...previous, [key]: {
        user_id: 'fictional-preview-owner', note_id: target.noteId, source_id: target.sourceId,
        item_kind: target.itemKind, item_id: target.itemId, status, updated_at: new Date().toISOString(),
      } }));
      setSavingKey(null);
    }, 500);
  };
  const visibleModel = showEmpty ? empty : partial ? { ...model,
    meetings: model.meetings.map((meeting, index) => index !== 0 || !meeting.record ? meeting : { ...meeting,
      record: { ...meeting.record, source: { ...meeting.record.source, transcriptionComplete: false, lastTimestamp: '18:05' } } }),
    warnings: ['Fictional incomplete source: the last transcript section was not supplied.'],
  } : model;

  return <div className="flex h-dvh flex-col bg-surface text-text">
    <div className="flex flex-wrap items-center gap-2 border-b border-border-strong bg-surface-sunken px-4 py-2 text-sm">
      <strong>FICTIONAL SAMPLE · local UI only</strong>
      <span>Progress changes stay in this demo.</span>
      <button type="button" className="btn-ghost text-sm" onClick={() => document.documentElement.classList.toggle('dark')}>Light / dark</button>
      <button type="button" className="btn-ghost text-sm" onClick={() => setPartial(value => !value)}>Toggle partial transcript</button>
      <button type="button" className="btn-ghost text-sm" onClick={() => setError(value => value ? null : 'Simulated connection failure')}>Toggle load failure</button>
      <button type="button" className="btn-ghost text-sm" onClick={() => setShowEmpty(value => !value)}>Toggle empty state</button>
      <button type="button" className="btn-ghost text-sm" onClick={() => setTruncated(value => !value)}>Toggle partial history</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={failProgressSave} disabled={savingKey !== null} onClick={() => setFailProgressSave(value => !value)}>Toggle progress save failure</button>
      <button type="button" className="btn-ghost text-sm" aria-pressed={progressUnavailable} disabled={savingKey !== null} onClick={() => setProgressUnavailable(value => !value)}>Toggle progress unavailable</button>
      <button type="button" className="btn-ghost text-sm" disabled={savingKey !== null} onClick={() => { setProgress({}); setProgressError(null); }}>Reset demo progress</button>
      <span role="status" aria-live="polite">{sourceMessage}</span>
    </div>
    <div className="min-h-0 flex-1"><RefinementsView model={visibleModel} timezone="America/New_York" loading={false} error={error} truncated={truncated}
      loadedAt={reviewedAt} onRefresh={() => setError(null)} onOpenNote={() => setSourceMessage('Preview only: the selected source note would open in Notes.')}
      progress={progress} progressReady={!progressUnavailable} progressLoading={false} savingKey={savingKey}
      progressError={progressUnavailable ? 'Simulated progress loading failure. Meeting evidence remains available.' : progressError}
      onProgressChange={changeProgress} /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
