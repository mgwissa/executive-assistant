export const DEFAULT_MCP_PUBLIC_URL = 'https://executive-assistant-chi.vercel.app/mcp';

export type AgentConnectionGrant = {
  client: { id: string; name: string; uri: string; logo_uri: string };
  scopes: string[];
  granted_at: string;
};

// Deliberately excludes credentials and user IDs. Returned by the owner-scoped
// agent-connections function, never by opening access to the private table.
export type AgentConnectionMetadata = {
  oauth_client_id: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type AgentConnection = AgentConnectionGrant & {
  access: 'approved' | 'revoked' | 'incomplete' | 'unknown';
  lastUsedAt: string | null;
};

export function resolveMcpPublicUrl(configured?: string): string {
  const value = configured?.trim() || DEFAULT_MCP_PUBLIC_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function mergeAgentConnections(
  grants: AgentConnectionGrant[],
  metadata: AgentConnectionMetadata[] | null,
): AgentConnection[] {
  const byClient = new Map(metadata?.map((row) => [row.oauth_client_id, row]));
  return grants.map((grant) => {
    const record = byClient.get(grant.client.id);
    return {
      ...grant,
      access: metadata === null ? 'unknown' : !record ? 'incomplete' : record.revoked_at ? 'revoked' : 'approved',
      lastUsedAt: record?.last_used_at ?? null,
    };
  });
}

export function agentAccessLabel(access: AgentConnection['access']): string {
  switch (access) {
    case 'approved': return 'Access approved';
    case 'revoked': return 'Workspace access revoked';
    case 'incomplete': return 'Setup incomplete';
    case 'unknown': return 'Access status unavailable';
  }
}
