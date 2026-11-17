/** Saved, owner-only evidence. This module never fetches or modifies a website. */
export const SITEMAP_SOURCE = 'https://autofinder.com/sitemap.xml';
export const SITEMAP_RECORD_MARKER = '<!-- autofinder-sitemap-review:v1 -->';
export type SitemapNote = { id: string; title: string; content: string; updated_at: string };
export type SitemapRecord = {
  version: 1; sourceUrl: string; runId: string; kind: 'baseline' | 'comparison' | 'attempt';
  complete: boolean; checkedAtUtc: string; previousAtUtc: string | null;
  hash: string | null; previousHash: string | null;
  urlCount: number | null; previousUrlCount: number | null;
  addedCount: number | null; removedCount: number | null;
  partIndex: number; partCount: number; addedUrls: string[]; removedUrls: string[];
  baselineNoteIds: string[]; limitations: string[]; httpStatus: number | null;
};
export type SitemapRun = SitemapRecord & {
  noteIds: string[]; verified: boolean; problems: string[];
};
export type SitemapReviewModel = {
  runs: SitemapRun[]; currentUrls: string[]; checkpoint: SitemapRun | null; warnings: string[];
};
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 100_000;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const strings = (v: unknown, max: number, length: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(s => typeof s === 'string' && s.length > 0 && s.length <= length);

export function isSitemapPageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)
    || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export async function sitemapUrlHash(urls: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...new Set(urls)].sort().join('\n') + '\n');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Reject malformed evidence instead of rendering it as an empty/healthy check. */
export function parseSitemapRecord(note: SitemapNote): SitemapRecord | null {
  if (!note.content.includes(SITEMAP_RECORD_MARKER)) return null;
  const match = note.content.match(/<!-- autofinder-sitemap-review:v1 -->\s*\r?\n```json\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) throw new Error('Record marker has no complete JSON block.');
  const v: unknown = JSON.parse(match[1]);
  if (!isObject(v) || v.version !== 1 || v.sourceUrl !== SITEMAP_SOURCE
    || typeof v.runId !== 'string' || v.runId.length < 1 || v.runId.length > 200
    || !['baseline', 'comparison', 'attempt'].includes(String(v.kind))
    || typeof v.complete !== 'boolean' || !iso(v.checkedAtUtc)
    || !(v.previousAtUtc === null || iso(v.previousAtUtc))
    || !(v.hash === null || hash(v.hash)) || !(v.previousHash === null || hash(v.previousHash))
    || !['urlCount', 'previousUrlCount', 'addedCount', 'removedCount'].every(k => v[k] === null || count(v[k]))
    || !count(v.partIndex) || !count(v.partCount) || v.partIndex < 1 || v.partCount < v.partIndex || v.partCount > 100
    || !strings(v.addedUrls, 100_000, 4096) || !v.addedUrls.every(isSitemapPageUrl)
    || !strings(v.removedUrls, 100_000, 4096) || !v.removedUrls.every(isSitemapPageUrl)
    || !strings(v.baselineNoteIds, 100, 200) || !strings(v.limitations, 50, 2000)
    || !(v.httpStatus === null || Number.isInteger(v.httpStatus) && Number(v.httpStatus) >= 100 && Number(v.httpStatus) <= 599)) {
    throw new Error('Invalid sitemap record fields or unsafe URL.');
  }
  if (v.previousAtUtc && Date.parse(v.previousAtUtc as string) > Date.parse(v.checkedAtUtc)) throw new Error('Reversed capture interval.');
  if (!v.complete) {
    if (v.kind !== 'attempt' || v.addedCount !== null || v.removedCount !== null || v.addedUrls.length || v.removedUrls.length) {
      throw new Error('Incomplete coverage cannot claim additions/removals.');
    }
  } else if (!hash(v.hash) || !count(v.urlCount) || v.httpStatus !== 200) {
    throw new Error('Complete evidence needs a successful response, URL count and hash.');
  } else if (v.kind === 'baseline') {
    if (!v.baselineNoteIds.length || v.previousAtUtc !== null || v.previousHash !== null || v.previousUrlCount !== null
      || v.addedCount !== null || v.removedCount !== null || v.addedUrls.length || v.removedUrls.length || v.partCount !== 1) {
      throw new Error('A baseline is not a report of additions.');
    }
  } else if (v.kind !== 'comparison' || !iso(v.previousAtUtc) || !hash(v.previousHash)
    || !count(v.previousUrlCount) || !count(v.addedCount) || !count(v.removedCount)
    || v.previousUrlCount + v.addedCount - v.removedCount !== v.urlCount) {
    throw new Error('Complete comparison totals or prior snapshot are inconsistent.');
  }
  return v as SitemapRecord;
}

export function formatSitemapRecord(record: SitemapRecord): string {
  return `${SITEMAP_RECORD_MARKER}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
}

function metadata(record: SitemapRecord): string {
  return JSON.stringify(Object.keys(record).filter(k => !['partIndex', 'addedUrls', 'removedUrls'].includes(k))
    .sort().map(k => [k, record[k as keyof SitemapRecord]]));
}

async function readBaseline(record: SitemapRecord, notes: Map<string, SitemapNote>): Promise<string[]> {
  const urls: string[] = [];
  const foundParts = new Set<number>();
  for (const id of record.baselineNoteIds) {
    const note = notes.get(id);
    if (!note) throw new Error('A referenced original baseline note is missing.');
    const part = note.content.match(/Part (\d+) of (\d+) contains (\d+) URLs\./);
    const partHash = note.content.match(/Part URL-set SHA-256: ([a-f0-9]{64})/);
    const fullHash = note.content.match(/Full URL-set SHA-256: ([a-f0-9]{64})/);
    const section = note.content.split('## Baseline URLs')[1]?.split('## Verification receipt')[0];
    const entries = section?.split(/\r?\n/).filter(l => l.startsWith('- ')).map(l => l.slice(2)) ?? [];
    if (!part || !partHash || fullHash?.[1] !== record.hash || Number(part[2]) !== record.baselineNoteIds.length
      || foundParts.has(Number(part[1])) || Number(part[1]) < 1 || Number(part[1]) > Number(part[2])
      || entries.length !== Number(part[3]) || entries.some(u => !isSitemapPageUrl(u))
      || new Set(entries).size !== entries.length || await sitemapUrlHash(entries) !== partHash[1]) {
      throw new Error('An original baseline part is incomplete or its hash/count does not match.');
    }
    foundParts.add(Number(part[1]));
    urls.push(...entries);
  }
  if (urls.length !== record.urlCount || new Set(urls).size !== urls.length || await sitemapUrlHash(urls) !== record.hash) {
    throw new Error('Combined baseline URL hash/count does not match.');
  }
  return urls.sort();
}

export async function buildSitemapReviewModel(notes: SitemapNote[]): Promise<SitemapReviewModel> {
  const warnings: string[] = [];
  const groups = new Map<string, { record: SitemapRecord; noteId: string }[]>();
  for (const note of notes) {
    try {
      const record = parseSitemapRecord(note);
      if (record) groups.set(record.runId, [...(groups.get(record.runId) ?? []), { record, noteId: note.id }]);
    } catch {
      warnings.push(`“${note.title}” contains an invalid or incomplete review record; no all-clear inferred.`);
    }
  }
  const runs: SitemapRun[] = [];
  for (const parts of groups.values()) {
    const first = parts[0].record;
    const problems: string[] = [];
    const unique = new Map<number, SitemapRecord>();
    for (const { record } of parts) {
      if (metadata(record) !== metadata(first)) problems.push('Conflicting metadata for the same run.');
      const before = unique.get(record.partIndex);
      if (before && JSON.stringify(before) !== JSON.stringify(record)) problems.push('Conflicting versions of a report part.');
      unique.set(record.partIndex, record);
    }
    if (unique.size !== first.partCount || Array.from({ length: first.partCount }, (_, i) => i + 1).some(i => !unique.has(i))) {
      problems.push('Not every report part is available. Counts/lists below are incomplete.');
    }
    const ordered = [...unique.values()].sort((a, b) => a.partIndex - b.partIndex);
    const addedUrls = ordered.flatMap(p => p.addedUrls).sort();
    const removedUrls = ordered.flatMap(p => p.removedUrls).sort();
    const removedSet = new Set(removedUrls);
    if (first.kind === 'comparison' && (addedUrls.length !== first.addedCount || removedUrls.length !== first.removedCount
      || new Set(addedUrls).size !== addedUrls.length || new Set(removedUrls).size !== removedUrls.length
      || addedUrls.some(u => removedSet.has(u)))) problems.push('URL lists do not match the declared disjoint totals.');
    runs.push({ ...first, addedUrls, removedUrls, noteIds: parts.map(p => p.noteId), verified: false, problems: [...new Set(problems)] });
  }
  let currentUrls: string[] = [];
  let checkpoint: SitemapRun | null = null;
  const byId = new Map(notes.map(n => [n.id, n]));
  for (const run of runs.sort((a, b) => Date.parse(a.checkedAtUtc) - Date.parse(b.checkedAtUtc) || a.runId.localeCompare(b.runId))) {
    if (!run.complete || run.problems.length) continue;
    try {
      if (run.kind === 'baseline') {
        if (checkpoint) throw new Error('Unexpected baseline reset; prior saved history is retained.');
        currentUrls = await readBaseline(run, byId);
      } else {
        if (!checkpoint || checkpoint.hash !== run.previousHash || currentUrls.length !== run.previousUrlCount) {
          throw new Error('Prior verified URL set is unavailable; this comparison cannot advance saved coverage.');
        }
        const urls = new Set(currentUrls);
        if (run.removedUrls.some(u => !urls.has(u)) || run.addedUrls.some(u => urls.has(u))) throw new Error('Changes conflict with the prior exact URL set.');
        run.removedUrls.forEach(u => urls.delete(u));
        run.addedUrls.forEach(u => urls.add(u));
        const next = [...urls].sort();
        if (next.length !== run.urlCount || await sitemapUrlHash(next) !== run.hash) throw new Error('Resulting URL-set hash/count does not match.');
        if (Date.parse(run.previousAtUtc!) !== Date.parse(checkpoint.checkedAtUtc)) throw new Error('Prior capture time does not match the verified checkpoint.');
        currentUrls = next;
      }
      run.verified = true;
      checkpoint = run;
    } catch (error) { run.problems.push(error instanceof Error ? error.message : 'Cannot verify saved evidence.'); }
  }
  return { runs: runs.reverse(), currentUrls, checkpoint, warnings };
}

export function sitemapRunMarkdown(run: SitemapRun): string {
  return `# AutoFinder sitemap review\n\nSource: ${SITEMAP_SOURCE}\nRun: ${run.runId}\nPrevious capture: ${run.previousAtUtc ?? 'Initial baseline'}\nCapture: ${run.checkedAtUtc}\nSaved evidence: ${run.complete && run.verified ? 'Complete; URL hash/count verified' : 'Incomplete or not verified; do not treat as an all-clear'}\n\n## Added URLs (${run.addedUrls.length} listed)\n\n${run.addedUrls.map(u => '- ' + u).join('\n') || 'None listed.'}\n\n## Removed URLs (${run.removedUrls.length} listed)\n\n${run.removedUrls.map(u => '- ' + u).join('\n') || 'None listed.'}\n\n${[...run.limitations, ...run.problems].join('\n')}\n\nNet sitemap membership changes between captures, not exact publication/deletion times or page-health evidence.\n`;
}
