import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Owner progress is planning context, never authority to mutate tasks or ADO. */
export type RefinementProgressItem = {
  source_id: string;
  item_kind: 'action' | 'story';
  item_id: string;
  status: 'not_started' | 'in_progress' | 'complete';
  updated_at: string;
};
export type RefinementProgressContext = {
  available: boolean;
  complete: boolean;
  truncated: boolean;
  items: RefinementProgressItem[];
  limitation?: string;
};

const ITEM_LIMIT = 500;
const COLUMNS = 'user_id,source_id,item_kind,item_id,status,updated_at';
const token = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const unavailable = (): RefinementProgressContext => ({
  available: false, complete: false, truncated: false, items: [],
  limitation: 'Owner refinement progress could not be loaded or verified. Do not assume not_started or replay recorded work.',
});

function item(value: unknown, userId: string): RefinementProgressItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.user_id !== userId || !token(row.source_id) || !token(row.item_id)
    || (row.item_kind !== 'action' && row.item_kind !== 'story')
    || (row.status !== 'not_started' && row.status !== 'in_progress' && row.status !== 'complete')
    || typeof row.updated_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(row.updated_at)
    || !Number.isFinite(Date.parse(row.updated_at))) return null;
  return { source_id: row.source_id, item_kind: row.item_kind, item_id: row.item_id,
    status: row.status, updated_at: row.updated_at };
}

/**
 * Read across the verified owner's source/item keys. note_id is only an anchor:
 * limiting this to currently returned notes would hide decisions on older copies.
 * A failed/capped read cannot establish that missing work is not_started.
 */
export async function readRefinementProgress(admin: SupabaseClient, userId: string): Promise<RefinementProgressContext> {
  if (!userId) return unavailable();
  try {
    const { data, error } = await admin.from('refinement_item_progress')
      .select(COLUMNS).eq('user_id', userId)
      .order('updated_at', { ascending: false }).order('source_id').order('item_kind').order('item_id')
      .limit(ITEM_LIMIT + 1);
    if (error || !Array.isArray(data)) return unavailable();
    const parsed = data.map(row => item(row, userId));
    if (parsed.some(row => row === null)) return unavailable();
    const rows = parsed as RefinementProgressItem[];
    const identities = rows.map(row => JSON.stringify([row.source_id, row.item_kind, row.item_id]));
    if (new Set(identities).size !== identities.length) return unavailable();
    const truncated = rows.length > ITEM_LIMIT;
    return { available: true, complete: !truncated, truncated, items: rows.slice(0, ITEM_LIMIT),
      ...(truncated ? { limitation: 'Only part of the owner refinement progress was loaded. Missing items are unknown; do not assume not_started or replay recorded work.' } : {}) };
  } catch {
    return unavailable();
  }
}
