import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from './cors.ts';

export type AuthContext = {
  user: User;
  admin: SupabaseClient;
};

export async function requireUser(req: Request): Promise<AuthContext | Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: userErr?.message ?? 'Unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  return { user, admin };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}

export async function requireMemoryAddon(
  admin: SupabaseClient,
  userId: string,
): Promise<Response | null> {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('enabled_addons')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return jsonResponse({ error: error.message }, 500);
  const addons = (profile?.enabled_addons as string[] | null) ?? [];
  if (!addons.includes('memory')) {
    return jsonResponse({ error: 'Working memory is not enabled. Turn it on in Profile.' }, 403);
  }
  return null;
}
