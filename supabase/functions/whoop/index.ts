import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createWhoopHandler } from '../_shared/whoopService.ts';

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return new Response('Service is not configured',{status:503});
  const admin = createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const handler = createWhoopHandler({admin,config:{supabaseUrl,
    appUrl:Deno.env.get('APP_PUBLIC_URL') ?? 'https://executive-assistant-chi.vercel.app',
    clientId:Deno.env.get('WHOOP_CLIENT_ID') ?? '',clientSecret:Deno.env.get('WHOOP_CLIENT_SECRET') ?? '',
    encryptionKey:Deno.env.get('WHOOP_TOKEN_ENCRYPTION_KEY') ?? '',cronSecret:Deno.env.get('CRON_SECRET') ?? '',
    allowedOrigins:(Deno.env.get('WHOOP_ALLOWED_ORIGINS') ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  },authenticate:async (request) => {
    const authorization = request.headers.get('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    const auth = createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization!}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error} = await auth.auth.getUser(token);
    if (error || !data.user) return null;
    try {
      const encoded = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      // Claims are inspected only AFTER getUser verifies the token.
      const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
      if (claims.client_id || claims.role !== 'authenticated') return null;
    } catch { return null; }
    return data.user.id;
  }});
  return handler(req);
});
