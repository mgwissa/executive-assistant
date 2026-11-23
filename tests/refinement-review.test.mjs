import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REFINEMENT_MARKER, buildRefinementReviewModel, refinementStoryDraft, refinementStoryUrl } from '../src/lib/refinementReview.ts';

const savedAt = '2026-11-23T15:00:00.123456+00:00';
const fixture = () => ({
  version: 1, sourceId: 'manual:refinement:2026-11-17', meetingDate: '2026-11-17', reviewedAt: savedAt,
  summary: 'Discussed coverage and an unresolved business decision.',
  source: { fileName: 'Fictional refinement.docx', sha256: 'a'.repeat(64), firstTimestamp: '0:15', lastTimestamp: '59:18',
    timezoneCaveat: 'Recording header timezone is unspecified.', paragraphs: 421, transcriptionComplete: true },
  actions: [{ id: 'confirm-routing', title: 'Confirm routing', owner: 'Mike', nextAction: 'Ask which route is in use.',
    evidence: '46:58, paragraph 337', status: 'decision', taskId: 'task-routing' }],
  stories: [{ id: 'dealer-quote', workItemId: 68081, title: 'Lead Engine // Add dealer quotes',
    summary: 'Use existing matching behavior.', evidence: '20:30, paragraph 143', points: 5, state: 'Ready for Refinement',
    disposition: 'update', description: '**As a** buyer\n**I want** a quote\n**So that** I can compare options.\n\n**Context**\nUse existing coverage.',
    acceptanceCriteria: 'AC1: Matching dealers are returned.\n\nAC2: Existing inventory requests still work.' }],
  decisions: ['Final estimate is five; the earlier number was superseded.'], questions: ['Does the campaign need pixels?'],
});
const block = record => `${REFINEMENT_MARKER}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
const note = (id, content, title = 'Refinement 2026-11-17', updated_at = savedAt) => ({ id, title, content, updated_at });
const reviewed = (record = fixture(), id = 'meeting-note') => note(id, `Original recap.\n\n${block(record)}\n\nAdditional owner context.`);
const reject = record => {
  const model = buildRefinementReviewModel([reviewed(record)]);
  assert.equal(model.meetings.length, 1, 'source recap remains accessible');
  assert.equal(model.meetings[0].record, null, 'invalid evidence cannot expose actionable records');
  assert.equal(model.warnings.length, 1);
};

test('complete saved review preserves provenance, decisions, drafts and plain recap without mutating notes', () => {
  const input = [reviewed()];
  const before = JSON.stringify(input);
  const model = buildRefinementReviewModel(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(model.warnings, []);
  const meeting = model.meetings[0];
  assert.equal(meeting.noteId, 'meeting-note');
  assert.equal(meeting.date, '2026-11-17');
  assert.match(meeting.recap, /Original recap\.[\s\S]*Additional owner context\./);
  assert.doesNotMatch(meeting.recap, /sourceId|executive-assistant-refinement/);
  assert.deepEqual(meeting.record, fixture());
  assert.equal(meeting.record.actions[0].owner, 'Mike');
  assert.equal(meeting.record.actions[0].status, 'decision');
});

test('legacy refinement notes remain readable and sort by meeting date rather than edit date', () => {
  const model = buildRefinementReviewModel([
    note('old', 'An older recap.', 'Refinement 2026-11-03', '2026-11-24T12:00:00Z'),
    note('unknown', 'No known meeting date.', 'Refinement notes'),
    note('new', 'Latest meeting recap.', 'Refinement 2026-11-20', '2026-11-21T12:00:00Z'),
    note('unrelated', 'Contains a passing mention of refinement.', 'Project agenda'),
  ]);
  assert.deepEqual(model.meetings.map(m => m.noteId), ['new', 'old', 'unknown']);
  assert.equal(model.meetings[0].recap, 'Latest meeting recap.');
  assert.ok(model.meetings.every(m => m.record === null));
  assert.equal(model.meetings[2].date, null);
  assert.deepEqual(model.warnings, []);
  assert.equal(buildRefinementReviewModel([note('bad-date', 'Recap.', 'Refinement 2026-02-30')]).meetings[0].date, null);
});

test('the last complete record supersedes earlier records without replaying their actions', () => {
  const old = fixture();
  const latest = { ...fixture(), actions: [], summary: 'Owner closed the previous action.', questions: [] };
  const input = note('history', `Initial prose.\n${block(old)}\nOwner correction.\n${block(latest)}\nFinal context.`);
  const model = buildRefinementReviewModel([input]);
  assert.deepEqual(model.meetings[0].record, latest);
  assert.equal(model.meetings[0].record.actions.length, 0);
  assert.match(model.meetings[0].recap, /Initial prose\.[\s\S]*Owner correction\.[\s\S]*Final context\./);
});

test('malformed or unfinished latest appends fail closed and do not resurrect older decisions', () => {
  for (const tail of [
    `${REFINEMENT_MARKER}\n\`\`\`json\n{broken}\n\`\`\``,
    `${REFINEMENT_MARKER}\n\`\`\`json\n{"version":1`,
    REFINEMENT_MARKER,
    '<!-- executive-assistant-refinement:v1',
    '<!-- executive-assistant-refinement:v',
    '<!-- executive-assistant-refinement',
  ]) {
    const model = buildRefinementReviewModel([note('history', `Initial recap.\n${block(fixture())}\nSaved correction.\n${tail}`)]);
    assert.equal(model.meetings[0].record, null);
    assert.match(model.meetings[0].recap, /Initial recap\.[\s\S]*Saved correction\./);
    assert.doesNotMatch(model.meetings[0].recap, /sourceId|broken|"version"/);
    assert.equal(model.warnings.length, 1);
  }
});

test('unsupported JSON and marker versions are warnings, including after a supported older record', () => {
  reject({ ...fixture(), version: 2 });
  const future = block(fixture()).replace(REFINEMENT_MARKER, '<!-- executive-assistant-refinement:v2 -->');
  for (const content of [`Readable recap.\n${future}`, `Readable recap.\n${block(fixture())}\nLater context.\n${future}`]) {
    const model = buildRefinementReviewModel([note('future', content, 'Saved meeting')]);
    assert.equal(model.meetings[0].record, null);
    assert.match(model.warnings[0], /unsupported/);
    assert.match(model.meetings[0].recap, /Readable recap/);
    assert.doesNotMatch(model.meetings[0].recap, /sourceId|sha256|```/);
  }
});

test('partial transcripts retain explicit limitations and never become complete through projection', () => {
  const partial = fixture();
  partial.source.transcriptionComplete = false;
  partial.source.lastTimestamp = '30:00';
  partial.questions = ['The supplied transcript ends before the final estimate.'];
  const model = buildRefinementReviewModel([reviewed(partial)]);
  assert.equal(model.meetings[0].record.source.transcriptionComplete, false);
  assert.equal(model.meetings[0].record.source.lastTimestamp, '30:00');
  assert.deepEqual(model.meetings[0].record.questions, partial.questions);
  assert.match(model.warnings[0], /incomplete transcript.*partial/);
});

test('invalid provenance, dates, required context, enums and bounds cannot become actionable evidence', () => {
  const changes = [
    r => { delete r.summary; }, r => { r.meetingDate = '2026-02-30'; },
    r => { r.reviewedAt = '2026-11-23T10:00:00'; }, r => { r.reviewedAt = '2026-11-23T24:00:00Z'; },
    r => { r.source.sha256 = 'unverified'; }, r => { r.source.firstTimestamp = '60:00'; },
    r => { r.source.lastTimestamp = '59:99'; }, r => { r.source.paragraphs = 0; },
    r => { r.actions[0].owner = ''; }, r => { r.actions[0].evidence = ''; },
    r => { r.actions[0].status = ['done']; }, r => { r.actions[0].status = 'completed'; },
    r => { r.stories[0].disposition = ['update']; }, r => { r.stories[0].points = -1; },
    r => { r.stories[0].points = Infinity; }, r => { r.stories[0].title = 'x'.repeat(501); },
    r => { r.questions = Array(101).fill('Question'); }, r => { r.actions[0].taskId = 'https://evil.example/task'; },
  ];
  for (const change of changes) { const candidate = fixture(); change(candidate); reject(candidate); }
});

test('duplicate action, story and numeric work item identities fail closed', () => {
  const duplicateAction = fixture(); duplicateAction.actions.push({ ...duplicateAction.actions[0] }); reject(duplicateAction);
  const duplicateStory = fixture(); duplicateStory.stories.push({ ...duplicateStory.stories[0], workItemId: 99 }); reject(duplicateStory);
  const duplicateWorkItem = fixture(); duplicateWorkItem.stories.push({ ...duplicateWorkItem.stories[0], id: 'other-story' }); reject(duplicateWorkItem);
});

test('work item links require a positive integer and never use a source-supplied URL', () => {
  for (const value of [0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '68081', 'https://evil.example', 'javascript:alert(1)', null, ['68081']]) {
    assert.equal(refinementStoryUrl(value), null);
  }
  assert.equal(refinementStoryUrl(68081), 'https://dev.azure.com/detroittrading/Application%20Development/_workitems/edit/68081');
  for (const value of ['68081', 'https://evil.example', 0, -1, 1.5]) {
    const candidate = fixture(); candidate.stories[0].workItemId = value; reject(candidate);
  }
  const source = fixture(); source.stories[0].url = 'javascript:alert(1)';
  const story = buildRefinementReviewModel([reviewed(source)]).meetings[0].record.stories[0];
  assert.equal('url' in story, false);
  assert.equal(refinementStoryUrl(story.workItemId), 'https://dev.azure.com/detroittrading/Application%20Development/_workitems/edit/68081');
});

test('consistent duplicate sources deduplicate to the most recently saved note deterministically', () => {
  const a = reviewed(fixture(), 'a');
  const b = { ...reviewed(fixture(), 'b'), updated_at: '2026-11-24T12:00:00Z' };
  const model = buildRefinementReviewModel([a, b, a]);
  assert.equal(model.meetings.length, 1);
  assert.equal(model.meetings[0].noteId, 'b');
  assert.equal(model.warnings.length, 0);
  assert.equal(buildRefinementReviewModel([b, a]).meetings[0].noteId, 'b');
});

test('same source ID with changed fingerprint or inconsistent review cannot merge confident actions', () => {
  for (const mutate of [r => { r.source.sha256 = 'b'.repeat(64); }, r => { r.summary = 'A conflicting conclusion.'; }]) {
    const other = fixture(); mutate(other);
    const model = buildRefinementReviewModel([reviewed(fixture(), 'a'), reviewed(other, 'b')]);
    assert.equal(model.meetings.length, 2);
    assert.ok(model.meetings.every(m => m.record === null));
    assert.ok(model.meetings.every(m => m.recap.includes('Original recap.')));
    assert.match(model.warnings[0], /Conflicting saved reviews/);
  }
});

test('conflicting copies of one note do not choose an actionable record by fetch order', () => {
  const first = reviewed();
  const changed = { ...first, content: first.content.replace('Use existing matching behavior.', 'Different scope.'), updated_at: '2026-11-24T12:00:00Z' };
  for (const notes of [[first, changed], [changed, first]]) {
    const model = buildRefinementReviewModel(notes);
    assert.equal(model.meetings.length, 1);
    assert.equal(model.meetings[0].record, null);
    assert.equal(model.warnings.length, 1);
  }
});

test('copyable story preserves saved Description and AC text through JSON roundtrip without inventing requirements', () => {
  const story = buildRefinementReviewModel([reviewed()]).meetings[0].record.stories[0];
  assert.equal(refinementStoryDraft(story), `Title: ${story.title}\n\nDescription\n${story.description}\n\nAcceptance Criteria\n${story.acceptanceCriteria}`);
  const undrafted = { id: 'open-question', title: 'CDP // Confirm routing', summary: 'A business decision remains open.',
    evidence: '46:58', disposition: 'clarify' };
  assert.equal(refinementStoryDraft(undrafted), 'Title: CDP // Confirm routing\n\nDescription\nA business decision remains open.\n\nAcceptance Criteria\n');
  assert.doesNotMatch(refinementStoryDraft(undrafted), /AC1:|deadline|owner/i);
});

test('oversized notes are refused visibly instead of silently displaying incomplete evidence', () => {
  const model = buildRefinementReviewModel([note('oversized', 'x'.repeat(1_000_001))]);
  assert.equal(model.meetings.length, 0);
  assert.match(model.warnings[0], /oversized/);
});
