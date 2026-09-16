import { useEffect, useState } from 'react';
import {
  executiveAssistantMcpUrl,
  listAgentConnections,
  revokeAgentConnection,
} from '../lib/agentConnections';
import { agentAccessLabel, type AgentConnection } from '../lib/agentConnectionStatus';
import { BrainIcon, ChevronDownIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function AgentConnectionsSection() {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metadataUnavailable, setMetadataUnavailable] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy MCP address');
  const mcpUrl = executiveAssistantMcpUrl();
  const hasConnections = connections.length > 0;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError(null);
    void listAgentConnections()
      .then((result) => {
        if (mounted) {
          setConnections(result.connections);
          setMetadataUnavailable(result.metadataUnavailable);
        }
      })
      .catch((cause: unknown) => {
        if (mounted) setLoadError(cause instanceof Error ? cause.message : 'Could not load agent approvals.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refreshVersion]);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy MCP address'), 2000);
    } catch {
      setCopyLabel('Copy failed');
    }
  };

  return (
    <Card tone="sunken">
      <div className="mb-4 flex items-start gap-3">
        <IconBadge tone="purple" size="md">
          <BrainIcon className="h-5 w-5" />
        </IconBadge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Agent connections</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {hasConnections
              ? 'Manage which agents have permission to read context and make audited workspace updates.'
              : 'Connect an agent to securely read context and make audited workspace updates.'}
          </p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p> : null}

      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-text">Saved approvals</h3>
            <p className="mt-0.5 text-xs text-text-muted">An approval grants access; it does not confirm a live connection.</p>
          </div>
          <button type="button" className="btn-secondary" disabled={loading || busyId !== null} onClick={() => setRefreshVersion((value) => value + 1)}>
            {loading ? 'Refreshing…' : 'Refresh approvals'}
          </button>
        </div>
        {loadError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">Could not load approvals: {loadError}</p> : null}
        {!loading && !loadError && metadataUnavailable ? (
          <p className="mt-3 text-xs text-text-muted" role="status">Approvals are available, but workspace access and last-use details could not be checked. You can still revoke an approval.</p>
        ) : null}
        {loading ? (
          <p className="mt-3 text-sm text-text-muted">Loading approvals…</p>
        ) : loadError ? null : connections.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No agents have been approved yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-sunken/60">
            {connections.map((connection) => (
              <li key={connection.client.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text">{connection.client.name || 'Unnamed agent'}</p>
                  </div>
                  <p className="mt-1 text-xs font-medium text-text-muted">{agentAccessLabel(connection.access)}</p>
                  <p className="mt-0.5 text-xs text-text-muted">Approved {formatWhen(connection.granted_at)}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {metadataUnavailable ? 'Last workspace request: unavailable' : connection.lastUsedAt ? `Last workspace request: ${formatWhen(connection.lastUsedAt)}` : 'No workspace requests recorded'}
                  </p>
                  <p className="mt-1 break-all text-xs text-text-subtle">Client ID: <code className="select-all">{connection.client.id}</code></p>
                  {connection.access === 'incomplete' || connection.access === 'revoked' ? (
                    <p className="mt-1 text-xs text-text-muted">To restore access, authenticate the existing MCP server and approve it again.</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-danger shrink-0"
                  disabled={busyId !== null}
                  onClick={async () => {
                    if (!window.confirm(`Revoke “${connection.client.name}” (client ${connection.client.id})? This client will lose workspace access.`)) return;
                    setBusyId(connection.client.id);
                    setError(null);
                    try {
                      await revokeAgentConnection(connection.client.id);
                      setConnections((current) => current.filter((item) => item.client.id !== connection.client.id));
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Could not revoke the connection.');
                    } finally {
                      setBusyId(null);
                      // Local access may have been revoked even if the upstream
                      // grant revocation failed. Reload rather than show old state.
                      setRefreshVersion((value) => value + 1);
                    }
                  }}
                >
                  {busyId === connection.client.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasConnections && !loading && !loadError ? (
          <p className="mt-3 text-xs leading-relaxed text-text-muted">Separate installations or setup attempts can create approvals with the same name. Use the client ID and last workspace request to identify them; do not revoke one solely because its name matches another.</p>
        ) : null}
      </div>

      <details className="group mt-4 rounded-lg border border-border bg-surface/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-text marker:content-none [&::-webkit-details-marker]:hidden">
          <span>Agent cannot connect?</span>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-subtle transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-border px-4 pb-4 pt-3 text-sm leading-relaxed text-text-muted">
          <p>Check the existing server in your agent's MCP settings. Its URL must match the public MCP address below, not the internal Supabase function address.</p>
          <p>If sign-in has expired, authenticate that existing server again. If you use the Codex CLI, run <code>codex mcp login &lt;your-server-name&gt;</code> in your terminal. You do not need to add another server.</p>
          <p>This page can show approvals and past workspace requests, but cannot check or renew a login stored inside your agent.</p>
        </div>
      </details>

      {!loading ? (
        <details className="group mt-4 rounded-lg border border-border bg-surface/30" open={!hasConnections}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-text marker:content-none [&::-webkit-details-marker]:hidden">
            <span>{hasConnections ? 'Connect another agent' : 'Connect an agent'}</span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-subtle transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-4 pb-4 pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">Connect from Codex</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-text-muted">
              <li>Open Settings in the ChatGPT desktop app or Codex extension, then MCP servers.</li>
              <li>Check whether this address is already configured. Reuse that server if it is; otherwise add a Streamable HTTP server using the address below.</li>
              <li>Save the server, then restart the app or extension.</li>
              <li>Return to MCP servers, select Authenticate, then sign in and approve the connection.</li>
            </ol>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface-sunken px-3 py-2 text-xs text-text">{mcpUrl || 'The public MCP URL is not configured correctly.'}</code>
              <button type="button" className="btn-secondary shrink-0" disabled={!mcpUrl} onClick={() => void copyAddress()}>
                {copyLabel}
              </button>
            </div>
            <p className="mt-2 text-xs text-text-subtle">Each person signs in and approves access only to their own account. No repository clone, API key, or bridge file is required.</p>
          </div>
        </details>
      ) : null}
    </Card>
  );
}
