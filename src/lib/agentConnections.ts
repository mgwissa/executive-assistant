import { supabase } from './supabase';
import {
  mergeAgentConnections,
  resolveMcpPublicUrl,
  type AgentConnectionGrant,
  type AgentConnectionMetadata,
} from './agentConnectionStatus';

export type AgentAuthorizationDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: AgentConnectionGrant['client'];
  user: { id: string; email: string };
  scope: string;
};

export function executiveAssistantMcpUrl(): string {
  return resolveMcpPublicUrl(import.meta.env.VITE_MCP_PUBLIC_URL as string | undefined);
}

export async function listAgentConnections() {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) throw error;
  // A failed metadata lookup must not hide grants or imply that access works.
  // This also supports deploying the frontend before the updated function.
  let metadata: AgentConnectionMetadata[] | null = null;
  try {
    const result = await supabase.functions.invoke<{ connections?: AgentConnectionMetadata[] }>('agent-connections', {
      body: { action: 'list' },
    });
    if (!result.error && Array.isArray(result.data?.connections)) metadata = result.data.connections;
  } catch {
    // Keep revocation available even when last-use information is unavailable.
  }
  return { connections: mergeAgentConnections((data ?? []) as AgentConnectionGrant[], metadata), metadataUnavailable: metadata === null };
}

async function updateConnectionRecord(action: 'approve' | 'revoke', clientId: string, name?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ error?: string }>('agent-connections', {
    body: { action, clientId, ...(name ? { name } : {}) },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function approveAgentConnection(clientId: string, name: string): Promise<void> {
  await updateConnectionRecord('approve', clientId, name);
}

export async function deactivateAgentConnection(clientId: string): Promise<void> {
  await updateConnectionRecord('revoke', clientId);
}

export async function revokeAgentConnection(clientId: string): Promise<void> {
  // Disable workspace access first. Even if upstream grant revocation fails,
  // the MCP/API layer will reject the locally revoked connection.
  await deactivateAgentConnection(clientId);
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) throw error;
}

export async function getAgentAuthorizationDetails(authorizationId: string): Promise<
  AgentAuthorizationDetails | { redirect_url: string }
> {
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw error;
  if (!data) throw new Error('The authorization request did not return any details.');
  return data as AgentAuthorizationDetails | { redirect_url: string };
}

export async function finishAgentAuthorization(authorizationId: string, approved: boolean): Promise<string> {
  const result = approved
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (result.error) throw result.error;
  if (!result.data?.redirect_url) throw new Error('The authorization decision did not return a redirect.');
  return result.data.redirect_url;
}
