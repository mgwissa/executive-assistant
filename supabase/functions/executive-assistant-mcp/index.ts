import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

type JsonRecord = Record<string, unknown>;
type RpcId = string | number | null;

const OAUTH_SCOPES = ['openid', 'email', 'profile'] as const;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
};

const TOOLS = [
  {
    name: 'get_workspace_context',
    title: 'Get executive-assistant context',
    description: 'Read the current user’s schedule, tasks, focus plan, notes index, recent briefs, recent audited activity, and any due check-in work. Call this first when the user starts a morning conversation, including a simple “good morning”.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'search_notes',
    title: 'Search workspace notes',
    description: 'Search the current user’s notes and return bounded matching content. Use this when the normal workspace context does not contain enough detail.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, description: 'Text to find in note titles and content.' } },
      required: ['query'],
      additionalProperties: false,
    },
    securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'apply_workspace_actions',
    title: 'Apply audited workspace changes',
    description: 'Apply one or more narrow, audited changes after agreeing them with the user. Supports task create/update/complete, focus reorder, note creation, appending approved context, marking meeting notes triaged or reopened, and briefing writes. It cannot delete tasks, rewrite existing note content, or change legacy priority.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Plain-language summary for the audit run.' },
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: 25,
          items: {
            type: 'object',
            description: 'One audited action. For note_append provide kind, noteId, and approved content using headings, paragraphs, bullets, or numbered items. For note_triage provide kind, noteId, and triaged.',
            required: ['kind'],
            properties: { kind: { type: 'string' } },
            additionalProperties: true,
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
    securitySchemes: [{ type: 'oauth2', scopes: OAUTH_SCOPES }],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
] as const;

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
  });
}

function rpcResult(id: RpcId, result: unknown): Response {
  return json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown): Response {
  return json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function claims(token: string): JsonRecord | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server is not configured' }, 500);

  const configuredResource = Deno.env.get('MCP_PUBLIC_URL')?.trim().replace(/\/+$/, '');
  const resource = configuredResource || `${supabaseUrl}/functions/v1/executive-assistant-mcp`;
  const metadataUrl = `${resource}?metadata=oauth-protected-resource`;
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"`;

  if (req.method === 'GET' && new URL(req.url).searchParams.get('metadata') === 'oauth-protected-resource') {
    return json({
      resource,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      scopes_supported: OAUTH_SCOPES,
      resource_documentation: resource,
    });
  }

  if (req.method !== 'POST') return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': challenge });

  const authorization = req.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const tokenClaims = token ? claims(token) : null;
  const clientId = tokenClaims && typeof tokenClaims.client_id === 'string' ? tokenClaims.client_id : null;
  if (!authorization || !token || !clientId) {
    return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': challenge });
  }

  const auth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': challenge });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: connection } = await admin
    .from('agent_connections')
    .select('id')
    .eq('user_id', user.id)
    .eq('oauth_client_id', clientId)
    .eq('auth_kind', 'oauth')
    .is('revoked_at', null)
    .maybeSingle();
  if (!connection) return json({ error: 'Connection is not approved or has been revoked' }, 403);

  let request: JsonRecord;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) return rpcError(null, -32600, 'Invalid Request');
    request = parsed;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  const id = typeof request.id === 'string' || typeof request.id === 'number' || request.id === null ? request.id : null;
  const method = typeof request.method === 'string' ? request.method : '';
  if (!('id' in request)) return new Response(null, { status: 202, headers: corsHeaders });

  if (method === 'initialize') {
    const params = isRecord(request.params) ? request.params : {};
    const requestedVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
    const protocolVersion = requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.some((version) => version === requestedVersion)
      ? requestedVersion
      : SUPPORTED_PROTOCOL_VERSIONS[0];
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Executive Assistant', version: '1.0.0' },
      instructions: 'Use read tools to understand the user’s real schedule and work context. When the user begins a morning conversation—even with only “good morning”—call get_workspace_context before replying. If context.checkIn.pendingChecks contains morning_brief, complete the morning briefing and focus refresh first; the greeting is sufficient initiation and needs no separate confirmation. Treat other changes as recommendations agreed with the user. Use apply_workspace_actions only for explicit, narrow changes; every applied change is audited and reversible in the app.',
    });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
  if (method !== 'tools/call') return rpcError(id, -32601, `Method not found: ${method}`);

  const params = isRecord(request.params) ? request.params : {};
  const toolName = typeof params.name === 'string' ? params.name : '';
  const args = isRecord(params.arguments) ? params.arguments : {};
  let payload: JsonRecord;
  if (toolName === 'get_workspace_context') {
    payload = { action: 'context' };
  } else if (toolName === 'search_notes') {
    payload = { action: 'notes.search', query: args.query };
  } else if (toolName === 'apply_workspace_actions') {
    payload = { action: 'mutate', summary: args.summary, actions: args.actions };
  } else {
    return rpcError(id, -32602, `Unknown tool: ${toolName}`);
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/codex-api`, {
    method: 'POST',
    headers: { Authorization: authorization, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const bodyText = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { error: bodyText || 'Workspace API returned an invalid response' };
  }

  if (upstream.status === 401) return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': challenge });
  const failed = !upstream.ok && upstream.status !== 207;
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: isRecord(body) ? body : { result: body },
    isError: failed,
  });
});
