// Pure WHOOP v2 parsing, transport and private-summary helpers. No credentials in summaries.
export const WHOOP_SCOPES = ['read:cycles', 'read:recovery', 'read:sleep', 'offline'] as const;
export const WHOOP_API = 'https://api.prod.whoop.com';
export const WHOOP_GUIDANCE = 'Private personal context, not a productivity or medical assessment. Use only for the owner\'s whole-day planning. Ask how the owner feels; do not infer capacity from a score. Never copy health metrics into shared notes, work tasks, work briefings, email, or general memory. Never automatically change tasks or meetings. Missing, stale, calibrating, and unscored data are not zero or healthy readings.';

export type WhoopCycle = {
  cycle_id: number; cycle_start: string; cycle_end: string | null; timezone_offset: string | null;
  recovery_state: string; recovery_score: number | null; recovery_calibrating: boolean;
  sleep_state: string; sleep_end: string | null; sleep_total_ms: number | null;
  sleep_performance_pct: number | null; strain_state: string; strain: number | null;
  source_updated_at: string | null;
};
export type WhoopConnection = {
  status: string; connected_at: string | null; last_sync_at: string | null;
  last_attempt_at: string | null; last_error_code: string | null; next_sync_at: string | null; last_cycle_count?: number | null;
};
export type WhoopTokens = { access_token: string; refresh_token: string; expires_at: string; scopes: string[] };
export class WhoopError extends Error {
  code: string; retryAfterSeconds: number;
  constructor(code: string, retryAfterSeconds = 300) {
    super(code); this.name = 'WhoopError'; this.code = code; this.retryAfterSeconds = retryAfterSeconds;
  }
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}
function state(value: unknown): string {
  return ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'].includes(String(value)) ? String(value) : 'MISSING';
}
function newest(rows: unknown[], key: string): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const value of rows) {
    const row = record(value); const id = String(row[key] ?? '');
    if (!id) throw new WhoopError('invalid_provider_data');
    const old = result.get(id);
    if (!old || String(row.updated_at ?? '') >= String(old.updated_at ?? '')) result.set(id, row);
  }
  return result;
}
export function normalizeWhoopCycles(cycles: unknown[], recoveries: unknown[], sleeps: unknown[]): WhoopCycle[] {
  const recoveryMap = newest(recoveries, 'cycle_id');
  const sleepMap = newest(sleeps, 'id');
  return [...newest(cycles, 'id').values()].map((cycle) => {
    const id = number(cycle.id); const start = time(cycle.start);
    if (id === null || !Number.isSafeInteger(id) || !start) throw new WhoopError('invalid_provider_data');
    if (cycle.end !== null && cycle.end !== undefined && (!time(cycle.end) || Date.parse(String(cycle.end)) < Date.parse(start))) throw new WhoopError('invalid_provider_data');
    const recovery = recoveryMap.get(String(id)) ?? {};
    const mainSleep = recovery.sleep_id ? sleepMap.get(String(recovery.sleep_id)) :
      [...sleepMap.values()].filter((s) => s.cycle_id === id && s.nap === false)
        .sort((a, b) => String(b.end).localeCompare(String(a.end)))[0];
    // Recovery's sleep id is authoritative; never substitute a nap or another cycle.
    const sleep = mainSleep?.cycle_id === id && mainSleep.nap === false ? mainSleep : {};
    const recoveryState = state(recovery.score_state), sleepState = state(sleep.score_state), strainState = state(cycle.score_state);
    const rs = record(recovery.score), ss = record(sleep.score), cs = record(cycle.score);
    const stages = record(ss.stage_summary);
    const durations = ['total_light_sleep_time_milli', 'total_slow_wave_sleep_time_milli', 'total_rem_sleep_time_milli']
      .map((key) => number(stages[key], 172_800_000));
    const total = durations.every((n) => n !== null) ? durations.reduce<number>((sum, n) => sum + (n ?? 0), 0) : null;
    return {
      cycle_id: id, cycle_start: start, cycle_end: time(cycle.end),
      timezone_offset: typeof cycle.timezone_offset === 'string' ? cycle.timezone_offset.slice(0, 6) : null,
      recovery_state: recoveryState, recovery_score: recoveryState === 'SCORED' ? number(rs.recovery_score, 100) : null,
      recovery_calibrating: rs.user_calibrating === true,
      sleep_state: sleepState, sleep_end: time(sleep.end),
      sleep_total_ms: sleepState === 'SCORED' && total !== null && total <= 172_800_000 ? total : null,
      sleep_performance_pct: sleepState === 'SCORED' ? number(ss.sleep_performance_percentage, 100) : null,
      strain_state: strainState, strain: strainState === 'SCORED' ? number(cs.strain, 21) : null,
      source_updated_at: [time(cycle.updated_at), time(recovery.updated_at), time(sleep.updated_at)].filter((v): v is string => !!v).sort().at(-1) ?? null,
    };
  }).sort((a, b) => b.cycle_start.localeCompare(a.cycle_start));
}
export function buildWhoopSummary(connection: WhoopConnection | null, cycles: WhoopCycle[], now = new Date()) {
  const rows = connection?.last_cycle_count === 0 ? [] : [...cycles].sort((a, b) => b.cycle_start.localeCompare(a.cycle_start));
  const latest = rows[0] ?? null;
  const age = connection?.last_sync_at ? now.getTime() - Date.parse(connection.last_sync_at) : NaN;
  const cycleAge = latest ? now.getTime()-Date.parse(latest.cycle_end ?? latest.cycle_start) : NaN;
  const stale = !Number.isFinite(age) || age < 0 || age > 6 * 60 * 60_000 ||
    !Number.isFinite(cycleAge) || cycleAge < 0 || cycleAge > 48 * 60 * 60_000;
  return {
    provider: 'WHOOP', sensitive: true, asOf: now.toISOString(),
    connectionStatus: connection?.status ?? 'disconnected',
    freshness: connection?.status !== 'connected' ? 'unavailable' : connection.last_error_code ? 'sync_failed' : !connection.last_sync_at ? 'not_synced' : stale ? 'stale' : 'recent',
    lastSyncedAt: connection?.last_sync_at ?? null, lastAttemptAt: connection?.last_attempt_at ?? null,
    errorCode: connection?.last_error_code ?? null, nextSyncAt: connection?.next_sync_at ?? null,
    latest: connection?.status === 'connected' ? latest : null,
    lastCompletedCycle: connection?.status === 'connected' ? rows.find((r) => !!r.cycle_end) ?? null : null,
    recentCycles: connection?.status === 'connected' ? rows.slice(0, 7) : [],
    guidance: WHOOP_GUIDANCE,
  };
}
export type WhoopSummary = ReturnType<typeof buildWhoopSummary>;

export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 300;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(30, Math.min(2_147_483_647, seconds)) : 300;
}
export async function whoopRequest(path: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(path, WHOOP_API);
  if (url.origin !== WHOOP_API) throw new WhoopError('invalid_provider_url');
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
  catch { throw new WhoopError('provider_unavailable'); }
  if (response.status === 429) throw new WhoopError('rate_limited', retryAfter(response.headers.get('retry-after')));
  if (response.status === 401 || response.status === 403 || (response.status === 400 && path.includes('/oauth/'))) throw new WhoopError('authorization_required');
  if (!response.ok) throw new WhoopError('provider_unavailable');
  return response;
}
export async function whoopCollection(path: string, accessToken: string, start: string, end: string, fetcher: typeof fetch = fetch, deadline = Date.now() + 70_000): Promise<unknown[]> {
  const rows: unknown[] = [], seen = new Set<string>(); let next: string | null = null;
  for (let page = 0; page < 8; page++) {
    if (Date.now() >= deadline) throw new WhoopError('incomplete_pagination');
    const url = new URL(path, WHOOP_API);
    url.searchParams.set('start', start); url.searchParams.set('end', end); url.searchParams.set('limit', '25');
    if (next) url.searchParams.set('nextToken', next);
    const response = await whoopRequest(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
    let body: Record<string, unknown>;
    try { body = record(await response.json()); } catch { throw new WhoopError('invalid_provider_data'); }
    if (!Array.isArray(body.records)) throw new WhoopError('invalid_provider_data');
    rows.push(...body.records);
    if (body.next_token === null || body.next_token === undefined || body.next_token === '') return rows;
    if (typeof body.next_token !== 'string' || seen.has(body.next_token)) throw new WhoopError('incomplete_pagination');
    next = body.next_token; seen.add(next);
  }
  throw new WhoopError('incomplete_pagination');
}
export function parseTokens(value: unknown, now = Date.now()): WhoopTokens {
  const r = record(value);
  if (typeof r.access_token !== 'string' || !r.access_token || typeof r.refresh_token !== 'string' || !r.refresh_token ||
    typeof r.expires_in !== 'number' || !Number.isFinite(r.expires_in) || r.expires_in <= 0 || typeof r.scope !== 'string') throw new WhoopError('authorization_required');
  const scopes = r.scope.split(/\s+/).filter(Boolean);
  if (!WHOOP_SCOPES.every((scope) => scopes.includes(scope))) throw new WhoopError('missing_scopes');
  return { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: new Date(now + r.expires_in * 1000).toISOString(), scopes: [...WHOOP_SCOPES] };
}
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function bytes(value: string): Uint8Array { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }
async function key(secret: string) {
  let raw: Uint8Array;
  try { raw = bytes(secret); } catch { throw new WhoopError('not_configured'); }
  if (raw.length !== 32) throw new WhoopError('not_configured');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptTokens(tokens: WhoopTokens, secret: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, await key(secret), new TextEncoder().encode(JSON.stringify(tokens)));
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function decryptTokens(ciphertext: string, secret: string, userId: string): Promise<WhoopTokens> {
  try {
    const [version, iv, data] = ciphertext.split('.');
    if (version !== 'v1') throw new Error('version');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) as BufferSource, additionalData: new TextEncoder().encode(userId) }, await key(secret), bytes(data) as BufferSource);
    const r = record(JSON.parse(new TextDecoder().decode(plain)));
    if (typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string' || !time(r.expires_at) || !Array.isArray(r.scopes)) throw new Error('shape');
    return r as WhoopTokens;
  } catch { throw new WhoopError('authorization_required'); }
}
export async function hashState(value: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function randomState(): string { return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
