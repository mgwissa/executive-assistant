/** Owner decisions live separately from immutable refinement evidence and ADO state. */
export type RefinementProgressStatus = 'not_started' | 'in_progress' | 'complete';
export type RefinementProgressTarget = {
  noteId: string; sourceId: string; itemKind: 'action' | 'story'; itemId: string;
};
export type RefinementProgressRow = {
  user_id: string; note_id: string | null; source_id: string; item_kind: 'action' | 'story';
  item_id: string; status: RefinementProgressStatus; updated_at: string;
};
export const refinementProgressKey = (target: RefinementProgressTarget): string =>
  JSON.stringify([target.sourceId, target.itemKind, target.itemId]);
export const refinementProgressTarget = (row: RefinementProgressRow): RefinementProgressTarget => ({
  noteId: row.note_id ?? '', sourceId: row.source_id, itemKind: row.item_kind, itemId: row.item_id,
});
const token = (value: unknown): value is string => typeof value === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isRefinementProgressStatus = (value: unknown): value is RefinementProgressStatus =>
  value === 'not_started' || value === 'in_progress' || value === 'complete';
export function isRefinementProgressTarget(value: RefinementProgressTarget): boolean {
  return uuid(value.noteId) && token(value.sourceId) && token(value.itemId)
    && (value.itemKind === 'action' || value.itemKind === 'story');
}
export function isRefinementProgressRow(value: unknown, userId: string): value is RefinementProgressRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.user_id === userId && (row.note_id === null || uuid(row.note_id)) && token(row.source_id) && token(row.item_id)
    && (row.item_kind === 'action' || row.item_kind === 'story') && isRefinementProgressStatus(row.status)
    && typeof row.updated_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row.updated_at)
    && Number.isFinite(Date.parse(row.updated_at));
}
