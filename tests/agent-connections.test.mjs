import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  agentAccessLabel,
  DEFAULT_MCP_PUBLIC_URL,
  mergeAgentConnections,
  resolveMcpPublicUrl,
} from '../src/lib/agentConnectionStatus.ts';
import * as connectionStatus from '../src/lib/agentConnectionStatus.ts';

const grant = (id) => ({ client: { id, name: 'Codex', uri: '', logo_uri: '' }, scopes: ['openid'], granted_at: '2026-09-01T13:14:00Z' });

test('setup uses the public resource, not the internal Supabase function', async () => {
  assert.equal(resolveMcpPublicUrl(), 'https://executive-assistant-chi.vercel.app/mcp');
  assert.equal(resolveMcpPublicUrl('  '), DEFAULT_MCP_PUBLIC_URL);
  assert.equal(resolveMcpPublicUrl('https://workspace.example/mcp/'), 'https://workspace.example/mcp');
  const plugin = JSON.parse(await readFile(new URL('../plugins/executive-assistant/.mcp.json', import.meta.url), 'utf8'));
  assert.ok(JSON.stringify(plugin).includes(DEFAULT_MCP_PUBLIC_URL));
});

test('invalid or credential-bearing setup URLs are not offered for copying', () => {
  for (const value of ['garbage', 'http://host/mcp', 'https://user:secret@host/mcp', 'https://host/mcp?token=secret', 'https://host/mcp#fragment']) {
    assert.equal(resolveMcpPublicUrl(value), '');
  }
});

test('same-name grants stay separate and match metadata by client ID', () => {
  const rows = mergeAgentConnections([grant('new'), grant('old')], [
    { oauth_client_id: 'old', last_used_at: null, revoked_at: '2026-09-15T13:00:00Z' },
    { oauth_client_id: 'new', last_used_at: '2026-09-16T13:00:00Z', revoked_at: null },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].access, 'approved');
  assert.equal(rows[0].lastUsedAt, '2026-09-16T13:00:00Z');
  assert.equal(rows[1].access, 'revoked');
  assert.equal(agentAccessLabel(rows[0].access), 'Access approved');
  assert.equal(agentAccessLabel(rows[1].access), 'Workspace access revoked');
});

test('an OAuth grant without local authorization is incomplete, not connected', () => {
  const [row] = mergeAgentConnections([grant('missing')], []);
  assert.equal(row.access, 'incomplete');
  assert.equal(row.lastUsedAt, null);
});

test('failed metadata reads preserve approvals without implying access works', () => {
  const [row] = mergeAgentConnections([grant('existing')], null);
  assert.equal(row.client.id, 'existing');
  assert.equal(row.access, 'unknown');
  assert.equal(agentAccessLabel(row.access), 'Access status unavailable');
});

const clientSource = await readFile(new URL('../src/lib/agentConnections.ts', import.meta.url), 'utf8');
const clientJs = ts.transpileModule(clientSource.replaceAll('import.meta.env', 'testEnv'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function clientApi(invoke, grantError = null) {
  const exports = {};
  const supabase = {
    auth: { oauth: { listGrants: async () => ({ data: [grant('existing')], error: grantError }) } },
    functions: { invoke },
  };
  vm.runInNewContext(clientJs, {
    exports, testEnv: {}, require: (name) => {
      if (name === './supabase') return { supabase };
      if (name === './agentConnectionStatus') return connectionStatus;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

test('the actual frontend setup function uses the canonical public URL', () => {
  assert.equal(clientApi(() => {}).executiveAssistantMcpUrl(), DEFAULT_MCP_PUBLIC_URL);
});

test('metadata errors, old deployment responses, and network failures keep grants visible as unknown', async () => {
  for (const invoke of [
    async () => ({ error: new Error('503'), data: null }),
    async () => ({ error: null, data: { error: 'Unknown action list' } }),
    async () => { throw new Error('Network unavailable'); },
  ]) {
    const result = await clientApi(invoke).listAgentConnections();
    assert.equal(result.metadataUnavailable, true);
    assert.equal(result.connections.length, 1);
    assert.equal(result.connections[0].access, 'unknown');
  }
});

test('grant-list failure is an error rather than a claim that no approvals exist', async () => {
  let invoked = false;
  const client = clientApi(async () => { invoked = true; }, new Error('Unable to list grants'));
  await assert.rejects(() => client.listAgentConnections(), /Unable to list grants/);
  assert.equal(invoked, false);
});

// Run the real Edge handler with an isolated, in-memory Supabase test double.
// No network, credentials, or live user data are involved.
const edgeSource = await readFile(new URL('../supabase/functions/agent-connections/index.ts', import.meta.url), 'utf8');
const edgeJs = ts.transpileModule(edgeSource.replace(/^import .*;\r?$/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function createHandler({ validUser = true, queryError = null } = {}) {
  const calls = [];
  let clientCount = 0;
  let handler;
  const records = [
    { user_id: 'owner', auth_kind: 'oauth', oauth_client_id: 'mine', last_used_at: null, revoked_at: null, token_hash: 'not-for-clients' },
    { user_id: 'other', auth_kind: 'oauth', oauth_client_id: 'theirs', last_used_at: null, revoked_at: null },
    { user_id: 'owner', auth_kind: 'legacy_token', oauth_client_id: null, last_used_at: null, revoked_at: null },
  ];
  const createClient = () => {
    clientCount += 1;
    return {
      auth: { getUser: async () => ({ data: { user: validUser ? { id: 'owner' } : null }, error: validUser ? null : new Error('Expired') }) },
      from(table) {
        calls.push(['from', table]);
        let columns = [];
        let rows = records;
        const query = {
          select(value) { calls.push(['select', value]); columns = value.split(','); return query; },
          eq(field, value) { calls.push(['eq', field, value]); rows = rows.filter((row) => row[field] === value); return query; },
          then(resolve) { return Promise.resolve({ data: rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key]]))), error: queryError }).then(resolve); },
        };
        return query;
      },
    };
  };
  vm.runInNewContext(edgeJs, {
    Deno: { env: { get: (key) => ({ SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })[key] }, serve: (fn) => { handler = fn; } },
    createClient, Response,
  });
  return { call: handler, calls, clientCount: () => clientCount };
}

const request = (body, authenticated = true) => new Request('https://test.invalid/agent-connections', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-placeholder' } : {}) }, body: JSON.stringify(body),
});

test('metadata endpoint uses the verified user, never a supplied user ID, and returns no credentials', async () => {
  const handler = createHandler();
  const response = await handler.call(request({ action: 'list', userId: 'other' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connections: [{ oauth_client_id: 'mine', last_used_at: null, revoked_at: null }] });
  assert.ok(handler.calls.some((call) => JSON.stringify(call) === JSON.stringify(['eq', 'user_id', 'owner'])));
  assert.ok(handler.calls.some((call) => JSON.stringify(call) === JSON.stringify(['select', 'oauth_client_id,last_used_at,revoked_at'])));
});

test('missing and invalid authentication cannot read metadata', async () => {
  const missing = createHandler();
  assert.equal((await missing.call(request({ action: 'list' }, false))).status, 401);
  assert.equal(missing.clientCount(), 0);
  const invalid = createHandler({ validUser: false });
  assert.equal((await invalid.call(request({ action: 'list' }))).status, 401);
  assert.equal(invalid.clientCount(), 1);
  assert.equal(invalid.calls.length, 0);
});

test('metadata failure returns an error, not an empty successful approvals list', async () => {
  const handler = createHandler({ queryError: { message: 'Database unavailable' } });
  const response = await handler.call(request({ action: 'list' }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not load connection activity' });
});
