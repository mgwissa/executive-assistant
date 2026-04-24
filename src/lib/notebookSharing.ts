import type { Notebook } from '../types';

export function isNotebookShared(
  nb: Notebook,
  currentUserId: string | undefined,
  memberCountByNotebook: Record<string, number>,
): boolean {
  if (!currentUserId) return false;
  if (nb.user_id !== currentUserId) return true;
  return (memberCountByNotebook[nb.id] ?? 0) > 0;
}

export const PENDING_NOTEBOOK_INVITE_KEY = 'pending_notebook_invite';

export function buildNotebookInviteUrl(token: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('invite', token);
  return url.toString();
}
