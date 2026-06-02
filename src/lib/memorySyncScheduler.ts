import { isOptionalFeatureEnabled } from './optionalFeatures';
import { deleteMemorySource, syncMemorySource, type MemorySourceType } from './memoryApi';
import { useProfileStore } from '../store/useProfileStore';

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 3000;

function memoryEnabled(): boolean {
  return isOptionalFeatureEnabled(useProfileStore.getState().profile, 'memory');
}

function scheduleKey(sourceType: MemorySourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

/** Debounced index of a single note/task/debrief after content changes. Fire-and-forget. */
export function scheduleMemoryIndex(sourceType: MemorySourceType, sourceId: string): void {
  if (!memoryEnabled() || sourceId.startsWith('tmp-')) return;

  const key = scheduleKey(sourceType, sourceId);
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);

  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      void syncMemorySource(sourceType, sourceId).catch((err) => {
        console.warn('[memory] index failed', sourceType, sourceId, err);
      });
    }, DEBOUNCE_MS),
  );
}

export function scheduleMemoryDelete(sourceType: MemorySourceType, sourceId: string): void {
  if (!memoryEnabled() || sourceId.startsWith('tmp-')) return;
  const key = scheduleKey(sourceType, sourceId);
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingTimers.delete(key);
  void deleteMemorySource(sourceType, sourceId).catch((err) => {
    console.warn('[memory] delete failed', sourceType, sourceId, err);
  });
}
