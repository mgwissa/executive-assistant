import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { refreshOutlookCalendar } from '../_shared/outlookCalendar.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ error: 'Server is not configured' }, 500);
    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'Unauthorized' }, 401);
    const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error } = await auth.auth.getUser();
    if (error || !user) return json({ error: 'Unauthorized' }, 401);
    // OAuth clients use MCP so the local grant and write scope are enforced.
    const encoded = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.client_id) return json({ error: 'OAuth clients must refresh through get_workspace_context.' }, 403);
    const result = await refreshOutlookCalendar(createClient(url, serviceKey), user.id);
    if (result.status !== 'synced') return json({ error: result.message, calendarSync: result }, 409);
    return json({ ok: true, imported: result.imported, calendarSync: result });
  } catch {
    return json({ error: 'Calendar refresh failed. Saved meetings were retained.' }, 500);
  }
});
