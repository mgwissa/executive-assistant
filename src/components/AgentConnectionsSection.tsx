import { useEffect, useState } from 'react';
import {
  executiveAssistantMcpUrl,
  listAgentConnections,
  revokeAgentConnection,
  type AgentConnectionGrant,
} from '../lib/agentConnections';
import { BrainIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function AgentConnectionsSection() {
  const [connections, setConnections] = useState<AgentConnectionGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy MCP address');
  const mcpUrl = executiveAssistantMcpUrl();

  useEffect(() => {
    let mounted = true;
    void listAgentConnections()
      .then((rows) => {
        if (mounted) setConnections(rows);
      })
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load agent connections.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
      <div className="mb-5 flex items-start gap-3">
        <IconBadge tone="purple" size="md">
          <BrainIcon className="h-5 w-5" />
        </IconBadge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Agent connections</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            Connect Codex to this hosted workspace from any project. Each person signs in and approves access to only their own account.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <p className="text-sm font-semibold text-text">Connect from Codex</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-text-muted">
          <li>Open Settings in the ChatGPT desktop app or Codex extension, then MCP servers.</li>
          <li>Add a Streamable HTTP server and paste the address below.</li>
          <li>Choose OAuth authentication, save, then restart the app or extension.</li>
          <li>Return to MCP servers and select Authenticate.</li>
          <li>Sign in here, verify the client details, and approve the connection.</li>
        </ol>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface-sunken px-3 py-2 text-xs text-text">{mcpUrl}</code>
          <button type="button" className="btn-secondary shrink-0" onClick={() => void copyAddress()}>
            {copyLabel}
          </button>
        </div>
        <p className="mt-2 text-xs text-text-subtle">No repository clone, local app, API key, or bridge file is required.</p>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p> : null}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-text">Approved agents</h3>
        {loading ? (
          <p className="mt-2 text-sm text-text-muted">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No agents are connected yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface/40">
            {connections.map((connection) => (
              <li key={connection.client.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{connection.client.name}</p>
                  <p className="mt-0.5 text-xs text-text-muted">Approved {formatWhen(connection.granted_at)}</p>
                </div>
                <button
                  type="button"
                  className="btn-danger shrink-0"
                  disabled={busyId !== null}
                  onClick={async () => {
                    if (!window.confirm(`Revoke “${connection.client.name}”? Its agent will lose workspace access.`)) return;
                    setBusyId(connection.client.id);
                    setError(null);
                    try {
                      await revokeAgentConnection(connection.client.id);
                      setConnections((current) => current.filter((item) => item.client.id !== connection.client.id));
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : 'Could not revoke the connection.');
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId === connection.client.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
