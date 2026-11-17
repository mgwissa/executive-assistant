import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { buildWhoopSummary, decryptTokens, encryptTokens, hashState, normalizeWhoopCycles, parseTokens,
  randomState, record, WHOOP_API, WHOOP_SCOPES, WhoopError, whoopCollection, whoopRequest,
  type WhoopConnection, type WhoopCycle, type WhoopTokens } from './whoop.ts';

export type WhoopConfig = { supabaseUrl: string; appUrl: string; clientId: string; clientSecret: string; encryptionKey: string; cronSecret: string; allowedOrigins?: string[] };
type Dependencies = { admin: SupabaseClient; authenticate: (request: Request) => Promise<string | null>; config: WhoopConfig; fetcher?: typeof fetch };

export function createWhoopHandler({ admin, authenticate, config, fetcher = fetch }: Dependencies) {
  const app = new URL(config.appUrl);
  const callback = new URL('/profile',app); callback.searchParams.set('whoop','callback');
  const redirectUri = callback.toString();
  if (app.protocol !== 'https:' && !(app.protocol === 'http:' && ['localhost','127.0.0.1'].includes(app.hostname))) throw new Error('APP_PUBLIC_URL must use HTTPS');
  const origins = new Set([app.origin, ...(config.allowedOrigins ?? [])]);
  let validKey = false;
  try { validKey = atob(config.encryptionKey).length === 32; } catch { /* setup incomplete */ }
  const configured = !!(config.clientId && config.clientSecret && validKey);
  async function apply(userId: string | null, action: string, payload: Record<string, unknown> = {}) {
    const { data, error } = await admin.rpc('apply_whoop_action', { p_user_id: userId, p_action: action, p_payload: payload });
    if (error) throw new WhoopError('storage_unavailable');
    const result = record(data);
    if (result.ok !== true) throw new WhoopError(typeof result.error === 'string' ? result.error : 'storage_unavailable');
    return result;
  }
  async function exchange(body: Record<string, string>): Promise<WhoopTokens> {
    const response = await whoopRequest('/oauth/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: config.clientId, client_secret: config.clientSecret }),
    }, fetcher);
    try { return parseTokens(await response.json()); }
    catch (error) { if (error instanceof WhoopError) throw error; throw new WhoopError('invalid_provider_data'); }
  }
  async function sync(userId: string) {
    if (!configured) throw new WhoopError('not_configured');
    const leaseToken = crypto.randomUUID();
    const lease = await apply(userId, 'lease', { lease_token: leaseToken });
    const generation = lease.generation;
    const guard = { generation, lease_token: leaseToken };
    try {
      let tokens = await decryptTokens(String(lease.encrypted_tokens), config.encryptionKey, userId);
      let refreshed = false;
      const refresh = async () => {
        tokens = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: 'offline' });
        // WHOOP rotates BOTH tokens. Persist immediately, before data requests.
        await apply(userId, 'tokens', { ...guard, encrypted_tokens: await encryptTokens(tokens, config.encryptionKey, userId) });
        refreshed = true;
      };
      if (Date.parse(tokens.expires_at) <= Date.now() + 120_000) await refresh();
      const end = new Date().toISOString(), start = new Date(Date.parse(end) - 14 * 86_400_000).toISOString();
      const deadline = Date.now() + 70_000;
      const collect = async () => {
        const cycles = await whoopCollection('/developer/v2/cycle', tokens.access_token, start, end, fetcher, deadline);
        const recoveries = await whoopCollection('/developer/v2/recovery', tokens.access_token, start, end, fetcher, deadline);
        const sleeps = await whoopCollection('/developer/v2/activity/sleep', tokens.access_token, start, end, fetcher, deadline);
        return normalizeWhoopCycles(cycles, recoveries, sleeps);
      };
      let cycles: WhoopCycle[];
      try { cycles = await collect(); }
      catch (error) {
        if (!(error instanceof WhoopError) || error.code !== 'authorization_required' || refreshed) throw error;
        await refresh(); cycles = await collect();
      }
      await apply(userId, 'success', { ...guard, cycles });
      return { ok: true };
    } catch (cause) {
      const error = cause instanceof WhoopError ? cause : new WhoopError('sync_failed');
      try { await apply(userId, 'failure', { ...guard, error_code: error.code, retry_seconds: error.retryAfterSeconds }); }
      catch { /* A revoked/replaced connection must never be revived by a late failure. */ }
      throw error;
    }
  }
  async function status(userId: string) {
    const [connection, cycles, grants, agents] = await Promise.all([
      admin.from('whoop_connections').select('status,connected_at,last_sync_at,last_attempt_at,last_error_code,last_cycle_count,next_sync_at').eq('user_id', userId).maybeSingle(),
      admin.from('whoop_cycle_summaries').select('summary').eq('user_id', userId).gte('cycle_start',new Date(Date.now()-30*86_400_000).toISOString()).order('cycle_start', { ascending: false }).limit(14),
      admin.from('whoop_agent_access').select('agent_connection_id').eq('user_id', userId),
      admin.from('agent_connections').select('id,name,oauth_client_id,last_used_at,scopes').eq('user_id', userId).eq('auth_kind','oauth').is('revoked_at',null).order('last_used_at',{ascending:false,nullsFirst:false}).limit(20),
    ]);
    if (connection.error || cycles.error || grants.error || agents.error) throw new WhoopError('storage_unavailable');
    return { configured, redirectUri,
      summary: buildWhoopSummary(connection.data as WhoopConnection | null, (cycles.data ?? []).map((r) => r.summary as WhoopCycle)),
      allowedConnectionIds: (grants.data ?? []).map((r) => r.agent_connection_id as string),
      agents: (agents.data ?? []).filter((a) => Array.isArray(a.scopes) && a.scopes.includes('context:read'))
        .map((a) => ({ id:a.id as string, name:a.name as string, clientId:a.oauth_client_id as string, lastUsedAt:a.last_used_at as string | null })),
    };
  }
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const headers: Record<string, string> = { 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type':'application/json' } });
    if (origin && !origins.has(origin)) return json({error:'origin_not_allowed'},403);
    if (req.method === 'OPTIONS') return new Response('ok',{headers});
    if (req.method !== 'POST') return json({error:'method_not_allowed'},405);
    let body: Record<string, unknown>;
    try { body = record(await req.json()); } catch { return json({error:'invalid_json'},400); }
    try {
      if (body.action === 'scheduled_sync') {
        const supplied = req.headers.get('x-cron-secret');
        if (!config.cronSecret || !supplied || await hashState(supplied) !== await hashState(config.cronSecret)) return json({error:'unauthorized'},401);
        const cleanup = await admin.rpc('cleanup_whoop_storage');
        if (cleanup.error) throw new WhoopError('storage_unavailable');
        if (!configured) return json({error:'not_configured'},503);
        const { data, error } = await admin.from('whoop_connections').select('user_id').eq('status','connected')
          .lte('next_sync_at',new Date().toISOString()).order('next_sync_at').limit(1);
        if (error) throw new WhoopError('storage_unavailable');
        let synced = 0;
        for (const row of data ?? []) { try { await sync(row.user_id); synced++; } catch { /* Private failure saved by sync; next check retries. */ } }
        return json({ok:true,attempted:data?.length ?? 0,synced});
      }
      // This authentication must reject MCP/OAuth client tokens. Only the owner UI
      // can connect, share, sync or disconnect. Agents have a separate cached read.
      const userId = await authenticate(req);
      if (!userId) return json({error:'unauthorized'},401);
      if (body.action === 'status') return json(await status(userId));
      if (body.action === 'complete') {
        if (!configured) return json({error:'not_configured'},503);
        if (typeof body.state !== 'string' || body.state.length > 256 || typeof body.code !== 'string' || !body.code || body.code.length > 4000) return json({error:'invalid_state'},400);
        // Complete only with the SAME verified EA owner session that started it.
        // A state from another account cannot bind the victim's WHOOP data.
        const pending = await apply(userId,'consume_state',{state_hash:await hashState(body.state)});
        const tokens = await exchange({grant_type:'authorization_code',code:body.code,redirect_uri:redirectUri});
        await apply(userId,'authorized',{generation:pending.generation,connection_ids:pending.connection_ids,
          encrypted_tokens:await encryptTokens(tokens,config.encryptionKey,userId)});
        return json({ok:true});
      }
      if (body.action === 'connect' || body.action === 'grants') {
        const ids = body.connectionIds;
        if (!Array.isArray(ids) || ids.length > 20 || ids.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return json({error:'invalid_assistant_selection'},400);
        if (body.action === 'grants') { await apply(userId,'grants',{connection_ids:ids}); return json({ok:true}); }
        if (!configured) return json({error:'not_configured'},503);
        const state = randomState();
        await apply(userId,'begin',{state_hash:await hashState(state),generation:crypto.randomUUID(),connection_ids:ids});
        const auth = new URL('/oauth/oauth2/auth',WHOOP_API);
        auth.search = new URLSearchParams({client_id:config.clientId,redirect_uri:redirectUri,response_type:'code',scope:WHOOP_SCOPES.join(' '),state}).toString();
        return json({authorizationUrl:auth.toString()});
      }
      if (body.action === 'sync') { await sync(userId); return json({ok:true}); }
      if (body.action === 'disconnect') {
        // Revoke locally FIRST. A failed WHOOP revocation never restores access.
        const result = await apply(userId,'disconnect'); let providerRevoked = false;
        try {
          if (result.encrypted_tokens && config.encryptionKey) {
            const tokens = await decryptTokens(String(result.encrypted_tokens),config.encryptionKey,userId);
            await whoopRequest('/developer/v2/user/access',{method:'DELETE',headers:{Authorization:`Bearer ${tokens.access_token}`}},fetcher);
            providerRevoked = true;
          }
        } catch { /* Tell the owner that upstream grant revocation is unconfirmed. */ }
        return json({ok:true,providerRevoked});
      }
      return json({error:'unsupported_action'},400);
    } catch (cause) {
      const code = cause instanceof WhoopError ? cause.code : 'service_unavailable';
      return json({error:code},code === 'deferred' ? 409 : code === 'rate_limited' ? 429 : 503);
    }
  };
}
