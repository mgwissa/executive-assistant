import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse({ error: 'Server is not configured' }, 500);
  if (!authorization) return jsonResponse({ error: 'Unauthorized' }, 401);

  const auth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: JsonRecord;
  try {
    const parsed = await req.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const admin = createClient(supabaseUrl, serviceKey);

  if (action === 'approve') {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!clientId || !name) return jsonResponse({ error: 'Valid clientId and name are required' }, 400);

    const { data: existing, error: readError } = await admin
      .from('agent_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('oauth_client_id', clientId)
      .maybeSingle();
    if (readError) return jsonResponse({ error: readError.message }, 500);

    const query = existing
      ? admin.from('agent_connections').update({ name, revoked_at: null }).eq('id', existing.id)
      : admin.from('agent_connections').insert({
        user_id: user.id,
        oauth_client_id: clientId,
        auth_kind: 'oauth',
        name,
        token_prefix: null,
        token_hash: null,
        scopes: ['context:read', 'workspace:write'],
      });
    const { error } = await query;
    return error ? jsonResponse({ error: error.message }, 500) : jsonResponse({ ok: true });
  }

  if (action === 'revoke') {
    if (!clientId) return jsonResponse({ error: 'clientId is required' }, 400);
    const { error } = await admin
      .from('agent_connections')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('oauth_client_id', clientId)
      .is('revoked_at', null);
    return error ? jsonResponse({ error: error.message }, 500) : jsonResponse({ ok: true });
  }

  return jsonResponse({ error: `Unknown action "${action}"` }, 400);
});
