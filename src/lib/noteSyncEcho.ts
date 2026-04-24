/** Suppress Realtime refetch when Postgres echoes our own debounced note write. */
const selfPersisted = new Map<string, string>();

export function markNoteSelfPersisted(noteId: string, updatedAt: string): void {
  selfPersisted.set(noteId, updatedAt);
  window.setTimeout(() => {
    if (selfPersisted.get(noteId) === updatedAt) selfPersisted.delete(noteId);
  }, 4000);
}

export function isNoteSelfPersistedEcho(noteId: string, updatedAt: string): boolean {
  return selfPersisted.get(noteId) === updatedAt;
}
