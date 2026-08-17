import { useEffect, useState } from 'react';
import {
  approveAgentConnection,
  deactivateAgentConnection,
  finishAgentAuthorization,
  getAgentAuthorizationDetails,
  type AgentAuthorizationDetails,
} from '../lib/agentConnections';
import { BrainIcon } from './icons';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';

export function OAuthConsentPage() {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
  const [details, setDetails] = useState<AgentAuthorizationDetails | null>(null);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(() => authorizationId
    ? null
    : 'This authorization request is missing its identifier. Return to Codex and try again.');

  useEffect(() => {
    if (!authorizationId) return;
    let mounted = true;
    void getAgentAuthorizationDetails(authorizationId)
      .then((result) => {
        if (!mounted) return;
        if ('redirect_url' in result) {
          window.location.assign(result.redirect_url);
          return;
        }
        setDetails(result);
      })
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load the authorization request.');
      });
    return () => {
      mounted = false;
    };
  }, [authorizationId]);

  const decide = async (approved: boolean) => {
    if (!authorizationId || !details) return;
    setBusy(approved ? 'approve' : 'deny');
    setError(null);
    let localConnectionApproved = false;
    try {
      if (approved) {
        await approveAgentConnection(details.client.id, details.client.name || 'Connected agent');
        localConnectionApproved = true;
      }
      const redirect = await finishAgentAuthorization(authorizationId, approved);
      window.location.assign(redirect);
    } catch (cause) {
      let message = cause instanceof Error ? cause.message : 'Could not complete authorization.';
      if (localConnectionApproved) {
        try {
          await deactivateAgentConnection(details.client.id);
        } catch {
          message += ' The incomplete connection could not be cleaned up; revoke it from Profile before retrying.';
        }
      }
      setError(message);
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-4 py-10">
      <Card className="w-full max-w-lg" padded="lg">
        <div className="flex items-start gap-4">
          <IconBadge tone="purple" size="lg"><BrainIcon className="h-6 w-6" /></IconBadge>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-subtle">Agent connection</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Allow access to your workspace?</h1>
          </div>
        </div>

        {error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</p> : null}

        {!details && !error ? <p className="mt-6 text-sm text-text-muted">Loading authorization request…</p> : null}

        {details ? (
          <>
            <div className="mt-6 rounded-lg border border-border bg-surface-sunken p-4">
              <p className="text-sm text-text-muted"><span className="font-semibold text-text">{details.client.name || 'An MCP client'}</span> is requesting access as {details.user.email}.</p>
              <dl className="mt-3 space-y-2 rounded-md border border-border/70 bg-surface p-3 text-xs">
                <div>
                  <dt className="font-semibold text-text">Client website</dt>
                  <dd className="mt-0.5 break-all text-text-muted">{details.client.uri || 'Not provided'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-text">Returns to</dt>
                  <dd className="mt-0.5 break-all text-text-muted">{details.redirect_uri}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-text">OAuth permissions</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {details.scope.split(/\s+/).filter(Boolean).map((scope) => (
                      <span key={scope} className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-text-muted">{scope}</span>
                    ))}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-sm font-semibold text-text">It will be able to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-muted">
                <li>Read your schedule, tasks, focus plan, notes context, and briefings.</li>
                <li>Search your notes when more context is needed.</li>
                <li>Create, update, or complete tasks and rearrange your focus plan.</li>
                <li>Create notes and save briefings through the existing audited action system.</li>
              </ul>
              <p className="mt-3 text-xs text-text-subtle">It cannot delete tasks or change the legacy priority field. Applied changes appear in Codex activity and remain undoable where supported.</p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void decide(false)}>
                {busy === 'deny' ? 'Denying…' : 'Deny'}
              </button>
              <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void decide(true)}>
                {busy === 'approve' ? 'Approving…' : 'Allow connection'}
              </button>
            </div>
          </>
        ) : null}
      </Card>
    </main>
  );
}
