import { useEffect, useState } from 'react';
import {
  executiveAssistantMcpUrl,
  listAgentConnections,
  revokeAgentConnection,
  type AgentConnectionGrant,
} from '../lib/agentConnections';
import { BrainIcon, ChevronDownIcon } from './icons';
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
  const hasConnections = connections.length > 0;

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
      <div className="mb-4 flex items-start gap-3">
        <IconBadge tone="purple" size="md">
          <BrainIcon className="h-5 w-5" />
        </IconBadge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Agent connections</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {hasConnections
              ? 'Your approved agents can securely read context and make audited workspace updates.'
              : 'Connect an agent to securely read context and make audited workspace updates.'}
          </p>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p> : null}

      <div className="rounded-lg border border-border bg-surface/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-text">{hasConnections ? 'Connected agents' : 'Connection status'}</h3>
            {hasConnections ? <p className="mt-0.5 text-xs text-text-muted">Ready to work with this workspace.</p> : null}
          </div>
          {hasConnections ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Connected
            </span>
          ) : null}
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-text-muted">Checking connection…</p>
        ) : connections.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No agents are connected yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-sunken/60">
            {connections.map((connection) => (
              <li key={connection.client.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <p className="truncate text-sm font-semibold text-text">{connection.client.name}</p>
                  </div>
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
              <li>Add a Streamable HTTP server and paste the address below.</li>
              <li>Save the server, then restart the app or extension.</li>
              <li>Return to MCP servers, select Authenticate, then sign in and approve the connection.</li>
            </ol>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-surface-sunken px-3 py-2 text-xs text-text">{mcpUrl}</code>
              <button type="button" className="btn-secondary shrink-0" onClick={() => void copyAddress()}>
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
