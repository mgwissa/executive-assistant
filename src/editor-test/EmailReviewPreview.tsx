import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmailReviewView } from '../components/EmailReviewView';
import type { EmailReviewCase, EmailReviewIntake } from '../lib/emailReview';
import '../index.css';

// Explicit fictional fixtures. No store, Supabase, provider client or real source.
const received = '2026-11-12T14:35:00Z';
const template: EmailReviewCase = { id: 'sample-1', user_id: 'sample-owner', mailbox: 'hello@autofinder.com',
  message_id: 'sample-message-1', request_key: 'contact', source_version: 'sample-v1',
  source_url: 'https://outlook.office.com/mail/inbox/id/FICTIONAL-SAMPLE', received_at: received, source_observed_at: received,
  category: 'contact_preference', customer_label: 'Example customer A', vehicle_context: 'Example crossover',
  request_summary: 'Please do not share my information with dealerships or have them call me.',
  suggested_next_step: 'Human review of contact preferences. Do not claim suppression until verified.',
  review_status: 'needs_review', decision_note: '', reviewed_source_version: null, reviewed_at: null,
  created_at: received, updated_at: received };
const fixtures: EmailReviewCase[] = [template,
  { ...template, id: 'sample-2', message_id: 'sample-message-2', request_key: 'vehicle', category: 'vehicle_correction', customer_label: 'Example customer B',
    vehicle_context: 'Used 2025–2026 SUV', request_summary: 'The email lists a new model. I am looking for a used one instead.', suggested_next_step: 'Review the new-versus-used mismatch. Inventory and handling are unverified.' },
  { ...template, id: 'sample-3', message_id: 'sample-message-3', request_key: 'price', category: 'buying_question', customer_label: 'Example customer C',
    vehicle_context: 'Example pickup · trim unclear', request_summary: 'How much more is the turbo version?', suggested_next_step: 'Confirm the comparison trims before supplying any pricing.' },
  { ...template, id: 'sample-4', message_id: 'sample-message-4', request_key: 'feedback', category: 'purchase_feedback', customer_label: 'Example customer D',
    vehicle_context: 'Example sedan', request_summary: 'I bought a car. Thanks for your help.', suggested_next_step: 'Keep purchase feedback distinct from a global opt-out.',
    review_status: 'reviewed', reviewed_source_version: 'sample-v1', reviewed_at: received, decision_note: 'Purchase feedback noted; no contact-preference change inferred.' },
];
const intake: EmailReviewIntake = { id: 'sample-intake', user_id: 'sample-owner', mailbox: 'hello@autofinder.com', run_key: 'fictional-preview',
  covered_from: '2026-11-05T14:00:00Z', covered_through: '2026-11-12T15:00:00Z', complete: true,
  message_count: 5, customer_reply_count: 4, pages: 1, limitations: ['Fictional preview only. No mailbox or production data is connected.'], seen_messages: [], created_at: received };
function Preview() {
  const [cases, setCases] = useState(fixtures);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="flex h-dvh flex-col bg-surface text-text">
    <div className="flex flex-wrap items-center gap-3 border-b border-border-strong bg-surface-sunken px-4 py-2 text-xs">
      <strong>FICTIONAL SAMPLE — local UI only</strong>
      <button className="btn-ghost text-xs" onClick={() => document.documentElement.classList.toggle('dark')}>Light / dark</button>
      <button className="btn-ghost text-xs" onClick={() => setPartial(p => !p)}>Toggle partial coverage</button>
      <button className="btn-ghost text-xs" onClick={() => setError(e => e ? null : 'Simulated connection failure')}>Toggle load failure</button>
      <button className="btn-ghost text-xs" onClick={() => setCases([])}>Empty state</button>
      <button className="btn-ghost text-xs" onClick={() => setCases(c => c.map(x => x.id === 'sample-1' ? { ...x, source_version: 'sample-v2', updated_at: new Date().toISOString(), request_summary: 'Updated fictional customer request; prior decisions must be retained.' } : x))}>New evidence version</button>
    </div>
    <div className="min-h-0 flex-1"><EmailReviewView cases={cases} latestIntake={{ ...intake, complete: !partial }} checkpoint={intake}
      timezone="America/New_York" loading={false} truncated={false} error={error} savingId={null} history={{}}
      onRefresh={() => setError(null)} onHistory={() => {}}
      onReview={async (item, status, note) => {
        const version = new Date().toISOString();
        setCases(c => c.map(x => x.id === item.id ? { ...x, review_status: status, decision_note: note, reviewed_source_version: x.source_version, reviewed_at: version, updated_at: version } : x));
        return version;
      }} /></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
