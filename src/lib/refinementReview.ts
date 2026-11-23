/** Projects saved refinement evidence only; never reads providers or mutates work. */
export const REFINEMENT_MARKER = '<!-- executive-assistant-refinement:v1 -->';
export type RefinementNote = { id: string; title: string; content: string; updated_at: string };
export type RefinementAction = {
  id: string; title: string; owner: string; nextAction: string; evidence: string;
  status: 'follow_up' | 'decision' | 'delegated' | 'done'; taskId?: string;
};
export type RefinementStory = {
  id: string; title: string; summary: string; evidence: string; workItemId?: number;
  state?: string; points?: number; disposition: 'update' | 'clarify' | 'already_updated' | 'new_story' | 'verify';
  description?: string; acceptanceCriteria?: string;
};
export type RefinementRecord = {
  version: 1; sourceId: string; meetingDate: string; reviewedAt: string; summary: string;
  source: {
    fileName: string; sha256: string; firstTimestamp: string; lastTimestamp: string;
    timezoneCaveat: string; paragraphs: number; transcriptionComplete: boolean;
  };
  actions: RefinementAction[]; stories: RefinementStory[]; decisions: string[]; questions: string[];
};
export type RefinementMeeting = {
  noteId: string; title: string; updatedAt: string; recap: string; date: string | null; record: RefinementRecord | null;
};
export type RefinementReviewModel = { meetings: RefinementMeeting[]; warnings: string[] };

const markerPattern = /<!-- executive-assistant-refinement[^\r\n]*?(?:-->|(?=\r?\n|$))/g;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string'
  && (empty || v.trim().length > 0) && v.length <= max && [...v].every(char => { const code = char.charCodeAt(0); return (code >= 32 && code !== 127) || [9, 10, 13].includes(code); });
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(v);
const positiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const iso = (v: unknown): v is string => typeof v === 'string' && date(v.slice(0, 10))
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)
  && Number.isFinite(Date.parse(v));
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 100;
const strings = (v: unknown): v is string[] => list(v) && v.every(s => text(s, 4000));
const optionalText = (v: unknown, max: number) => v === undefined || text(v, max);
const unique = (values: string[]) => new Set(values).size === values.length;

function elapsed(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function action(value: unknown): RefinementAction {
  if (!object(value) || !id(value.id) || !text(value.title, 500) || !text(value.owner, 200)
    || !text(value.nextAction, 4000) || !text(value.evidence, 4000)
    || typeof value.status !== 'string' || !['follow_up', 'decision', 'delegated', 'done'].includes(value.status)
    || !(value.taskId === undefined || id(value.taskId))) throw new Error('Invalid action or ownership status.');
  return { id: value.id, title: value.title, owner: value.owner, nextAction: value.nextAction, evidence: value.evidence,
    status: value.status as RefinementAction['status'], ...(value.taskId === undefined ? {} : { taskId: value.taskId }) };
}

function story(value: unknown): RefinementStory {
  if (!object(value) || !id(value.id) || !text(value.title, 500) || !text(value.summary, 8000)
    || !text(value.evidence, 4000) || !(value.workItemId === undefined || positiveInteger(value.workItemId))
    || !optionalText(value.state, 100) || !optionalText(value.description, 20_000)
    || !optionalText(value.acceptanceCriteria, 20_000)
    || !(value.points === undefined || typeof value.points === 'number' && Number.isFinite(value.points) && value.points >= 0 && value.points <= 1000)
    || typeof value.disposition !== 'string' || !['update', 'clarify', 'already_updated', 'new_story', 'verify'].includes(value.disposition)) {
    throw new Error('Invalid story, work item ID or disposition.');
  }
  return { id: value.id, title: value.title, summary: value.summary, evidence: value.evidence,
    disposition: value.disposition as RefinementStory['disposition'],
    ...(value.workItemId === undefined ? {} : { workItemId: value.workItemId }),
    ...(value.state === undefined ? {} : { state: value.state as string }),
    ...(value.points === undefined ? {} : { points: value.points as number }),
    ...(value.description === undefined ? {} : { description: value.description as string }),
    ...(value.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: value.acceptanceCriteria as string }) };
}

function record(value: unknown): RefinementRecord {
  if (!object(value) || value.version !== 1 || !id(value.sourceId) || !date(value.meetingDate)
    || !iso(value.reviewedAt) || !text(value.summary, 12_000) || !object(value.source)
    || !list(value.actions) || !list(value.stories) || !strings(value.decisions) || !strings(value.questions)) {
    throw new Error('Invalid refinement record fields or version.');
  }
  const source = value.source;
  const first = elapsed(source.firstTimestamp);
  const last = elapsed(source.lastTimestamp);
  if (!text(source.fileName, 500) || typeof source.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(source.sha256)
    || first === null || last === null || first > last || !text(source.timezoneCaveat, 2000, true)
    || !positiveInteger(source.paragraphs) || source.paragraphs > 100_000 || typeof source.transcriptionComplete !== 'boolean') {
    throw new Error('Invalid source provenance or transcript interval.');
  }
  const actions = value.actions.map(action);
  const stories = value.stories.map(story);
  const workIds = stories.flatMap(s => s.workItemId === undefined ? [] : [String(s.workItemId)]);
  if (!unique(actions.map(a => a.id)) || !unique(stories.map(s => s.id)) || !unique(workIds)) {
    throw new Error('Duplicate action, story or work item IDs.');
  }
  return { version: 1, sourceId: value.sourceId, meetingDate: value.meetingDate, reviewedAt: value.reviewedAt, summary: value.summary,
    source: { fileName: source.fileName, sha256: source.sha256.toLowerCase(), firstTimestamp: source.firstTimestamp as string,
      lastTimestamp: source.lastTimestamp as string, timezoneCaveat: source.timezoneCaveat, paragraphs: source.paragraphs,
      transcriptionComplete: source.transcriptionComplete }, actions, stories, decisions: [...value.decisions], questions: [...value.questions] };
}

/** A later incomplete append must never silently resurrect an earlier decision. */
function readContent(content: string): { recap: string; record: RefinementRecord | null } {
  const latestMarker = [...content.matchAll(markerPattern)].at(-1);
  if (!latestMarker) return { recap: content.trim(), record: null };
  if (latestMarker[0] !== REFINEMENT_MARKER) throw new Error('Unsupported latest record marker.');
  const latest = content.slice(latestMarker.index + latestMarker[0].length)
    .match(/^\s*```json\s*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/);
  if (!latest || latest[1].length > 200_000) throw new Error('Latest record has no complete bounded JSON block.');
  return { recap: plainRecap(content), record: record(JSON.parse(latest[1])) };
}

function plainRecap(content: string): string {
  // Preserve prose between appends, but do not expose broken machine JSON as a recap.
  let cursor = 0;
  let recap = '';
  for (const marker of content.matchAll(markerPattern)) {
    if (marker.index < cursor) continue;
    recap += content.slice(cursor, marker.index);
    const block = content.slice(marker.index + marker[0].length)
      .match(/^\s*```json\s*\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/);
    if (!block) return recap.trim();
    cursor = marker.index + marker[0].length + block[0].length;
  }
  return (recap + content.slice(cursor)).trim();
}

function legacyDate(note: RefinementNote): string | null {
  const candidate = `${note.title}\n${note.content.slice(0, 1000)}`.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  return date(candidate) ? candidate : null;
}

export function buildRefinementReviewModel(notes: readonly RefinementNote[]): RefinementReviewModel {
  const warnings: string[] = [];
  const meetings: RefinementMeeting[] = [];
  const byNote = new Map<string, RefinementNote>();
  const conflictingNotes = new Set<string>();
  for (const note of notes) {
    if (!id(note.id) || !text(note.title, 1000) || typeof note.content !== 'string' || note.content.length > 1_000_000 || !iso(note.updated_at)) {
      warnings.push('A saved refinement note has invalid or oversized fields and could not be displayed.');
      continue;
    }
    const prior = byNote.get(note.id);
    if (prior && (prior.title !== note.title || prior.content !== note.content || prior.updated_at !== note.updated_at)) {
      conflictingNotes.add(note.id);
      if (Date.parse(prior.updated_at) > Date.parse(note.updated_at)) continue;
    }
    byNote.set(note.id, note);
  }
  for (const note of byNote.values()) {
    if (!note.content.match(markerPattern) && !/\brefinement\b/i.test(note.title)) continue;
    const meeting: RefinementMeeting = { noteId: note.id, title: note.title, updatedAt: note.updated_at,
      recap: plainRecap(note.content), date: legacyDate(note), record: null };
    try {
      if (conflictingNotes.has(note.id)) throw new Error('Conflicting copies of this note.');
      const parsed = readContent(note.content);
      meeting.recap = parsed.recap;
      meeting.record = parsed.record;
      meeting.date = parsed.record?.meetingDate ?? meeting.date;
      if (parsed.record && !parsed.record.source.transcriptionComplete) {
        warnings.push(`“${note.title}” has an incomplete transcript; saved findings are partial.`);
      }
    } catch {
      warnings.push(`“${note.title}” has an invalid, incomplete, unsupported or conflicting latest review record; structured actions and stories are unavailable.`);
    }
    meetings.push(meeting);
  }
  const sources = new Map<string, RefinementMeeting[]>();
  for (const meeting of meetings) {
    if (meeting.record) sources.set(meeting.record.sourceId, [...(sources.get(meeting.record.sourceId) ?? []), meeting]);
  }
  const duplicates = new Set<string>();
  for (const copies of sources.values()) {
    if (copies.length < 2) continue;
    if (!copies.every(copy => JSON.stringify(copy.record) === JSON.stringify(copies[0].record))) {
      copies.forEach(copy => { copy.record = null; });
      warnings.push('Conflicting saved reviews identify the same source; their recaps remain available, but no combined actions or stories are inferred.');
      continue;
    }
    copies.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.noteId.localeCompare(b.noteId));
    copies.slice(1).forEach(copy => duplicates.add(copy.noteId));
  }
  return { meetings: meetings.filter(meeting => !duplicates.has(meeting.noteId)).sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '') || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.noteId.localeCompare(b.noteId)),
  warnings: [...new Set(warnings)] };
}

/** Only verified numeric IDs can produce the fixed organization's work-item link. */
export function refinementStoryUrl(workItemId: number): string | null {
  return positiveInteger(workItemId)
    ? `https://dev.azure.com/detroittrading/Application%20Development/_workitems/edit/${workItemId}` : null;
}

export function refinementStoryDraft(story: RefinementStory): string {
  return `Title: ${story.title}\n\nDescription\n${story.description ?? story.summary}\n\nAcceptance Criteria\n${story.acceptanceCriteria ?? ''}`;
}
