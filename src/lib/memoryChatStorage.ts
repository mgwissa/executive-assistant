import type { MemoryCitation } from './memoryApi';

export type MemoryChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: MemoryCitation[];
};

const STORAGE_PREFIX = 'memory-chat:';
const MAX_TURNS = 80;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isTurn(value: unknown): value is MemoryChatTurn {
  if (!value || typeof value !== 'object') return false;
  const t = value as MemoryChatTurn;
  return (
    typeof t.id === 'string' &&
    (t.role === 'user' || t.role === 'assistant') &&
    typeof t.content === 'string'
  );
}

export function loadMemoryChat(userId: string): MemoryChatTurn[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTurn).slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

export function saveMemoryChat(userId: string, turns: MemoryChatTurn[]): void {
  try {
    const trimmed = turns.slice(-MAX_TURNS);
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    /* quota or private mode — ignore */
  }
}

export function clearMemoryChat(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}
