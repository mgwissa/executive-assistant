import { supabase } from './supabase';

export type AgentConnectionGrant = {
  client: {
    id: string;
    name: string;
    uri: string;
    logo_uri: string;
  };
  scopes: string[];
  granted_at: string;
};

export type AgentAuthorizationDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: AgentConnectionGrant['client'];
  user: { id: string; email: string };
  scope: string;
};

export function executiveAssistantMcpUrl(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  return base ? `${base}/functions/v1/executive-assistant-mcp` : '';
}

export async function listAgentConnections(): Promise<AgentConnectionGrant[]> {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) throw error;
  return (data ?? []) as AgentConnectionGrant[];
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
