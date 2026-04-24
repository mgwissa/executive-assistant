import { useEffect, useState } from 'react';
import { buildNotebookInviteUrl } from '../lib/notebookSharing';
import { EMPTY_NOTEBOOK_MEMBERS, useSharingStore } from '../store/useSharingStore';

type ShareNotebookModalProps = {
  notebookId: string;
  notebookName: string;
  isOwner: boolean;
  currentUserId: string;
  open: boolean;
  onClose: () => void;
  /** After leaving or removing the last path to a notebook — parent refetches and may switch selection. */
  onMembershipChanged: () => void | Promise<void>;
};

export function ShareNotebookModal({
  notebookId,
  notebookName,
  isOwner,
  currentUserId,
  open,
  onClose,
  onMembershipChanged,
}: ShareNotebookModalProps) {
  const fetchSharing = useSharingStore((s) => s.fetchSharing);
  const rotateInvite = useSharingStore((s) => s.rotateInvite);
  const revokeAllInvites = useSharingStore((s) => s.revokeAllInvites);
  const removeMember = useSharingStore((s) => s.removeMember);
  const leaveNotebook = useSharingStore((s) => s.leaveNotebook);
  const members = useSharingStore(
    (s) => s.membersByNotebook[notebookId] ?? EMPTY_NOTEBOOK_MEMBERS,
  );
  const activeInvite = useSharingStore((s) => s.activeInviteByNotebook[notebookId] ?? null);
  const loading = useSharingStore((s) => s.loadingNotebookId === notebookId);
  const storeError = useSharingStore((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy link');

  useEffect(() => {
    if (!open) return;
    void fetchSharing(notebookId);
  }, [open, notebookId, fetchSharing]);

  useEffect(() => {
    if (!open) setCopyLabel('Copy link');
  }, [open]);

  if (!open) return null;

  const inviteUrl = activeInvite ? buildNotebookInviteUrl(activeInvite.token) : null;

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyLabel('Copied');
      window.setTimeout(() => setCopyLabel('Copy link'), 2000);
    } catch {
      setCopyLabel('Copy failed');
    }
  };

  const handleRotate = async () => {
    setBusy(true);
    try {
      await rotateInvite(notebookId, currentUserId);
    } finally {
      setBusy(false);
    }
  };

  const handleStopSharing = async () => {
    if (!window.confirm('Revoke the invite link? People who already joined keep access until you remove them.')) {
      return;
    }
    setBusy(true);
    try {
      await revokeAllInvites(notebookId);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!window.confirm('Remove this person from the notebook?')) return;
    setBusy(true);
    try {
      await removeMember(notebookId, userId);
      await onMembershipChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm(`Leave "${notebookName}"? You will lose access unless invited again.`)) return;
    setBusy(true);
    try {
      await leaveNotebook(notebookId, currentUserId);
      await onMembershipChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-notebook-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border-strong bg-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <h2 id="share-notebook-title" className="text-lg font-semibold text-text">
            Share notebook
          </h2>
          <button type="button" className="btn-ghost h-8 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-sm text-text-muted">{notebookName}</p>

        {storeError ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {storeError}
          </p>
        ) : null}

        {isOwner ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-text-muted">
              Anyone with the link can join this notebook as an editor while the link is active.
            </p>

            {loading ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : inviteUrl ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-muted">Invite link</label>
                <div className="flex gap-2">
                  <input readOnly className="input min-w-0 flex-1 text-xs" value={inviteUrl} />
                  <button
                    type="button"
                    className="btn-secondary shrink-0 text-sm"
                    onClick={() => void handleCopy()}
                  >
                    {copyLabel}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busy}
                    onClick={() => void handleRotate()}
                  >
                    Rotate link
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-sm text-amber-700 dark:text-amber-300"
                    disabled={busy}
                    onClick={() => void handleStopSharing()}
                  >
                    Stop sharing
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy}
                onClick={() => void handleRotate()}
              >
                Create invite link
              </button>
            )}

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Members ({members.length})
              </h3>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                {members.length === 0 ? (
                  <li className="text-text-muted">No collaborators yet.</li>
                ) : (
                  members.map((m) => (
                    <li
                      key={m.user_id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised"
                    >
                      <span className="truncate font-mono text-xs text-text">
                        {m.user_id.slice(0, 8)}…
                      </span>
                      <button
                        type="button"
                        className="btn-ghost shrink-0 px-2 py-0.5 text-xs text-red-600 dark:text-red-400"
                        disabled={busy}
                        onClick={() => void handleRemoveMember(m.user_id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-text-muted">
              You have full edit access to this notebook. It is owned by another account.
            </p>
            <p className="text-sm text-text-muted">
              Members: <span className="font-medium text-text">{members.length}</span>
            </p>
            <button
              type="button"
              className="btn-ghost text-sm text-red-600 dark:text-red-400"
              disabled={busy}
              onClick={() => void handleLeave()}
            >
              Leave notebook
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
