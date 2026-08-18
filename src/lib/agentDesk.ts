/**
 * Agent Desk — shared types, log parsing, and the undo contract.
 *
 * The agent acts on the workspace directly and records what it did in
 * `agent_actions`. There is no approval gate, so the audit trail carries the
 * whole weight of trust: it has to be readable, and Undo has to actually work.
 *
 * The undo contract
 * -----------------
 * `agent_actions.before` and `.after` store **raw database column names** for
 * the fields the action touched — not the camelCase names used elsewhere in
 * the app. That is deliberate: undoing a task edit is then a literal
 * `update(before)` against the row, with no translation layer to get wrong.
 * If you add a new action kind, keep that property.
 *
 * Everything arriving from `jsonb` is `unknown` and gets narrowed here. Parsers
 * return null on shapes they don't recognise rather than throwing, so one bad
 * row can never break the whole log.
 */

export const AGENT_ACTION_KINDS = [
  'task_create',
  'task_update',
  'task_complete',
  'task_delete',
  'focus_reorder',
  'chase_logged',
  'memory_write',
  'note_create',
  'note_append',
  'note_triage',
  'note_scratch',
  'brief_write',
] as const;

export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

export type AgentActionStatus = 'applied' | 'undone' | 'failed';

export type AgentRunKind =
  | 'morning_brief'
  | 'midday_triage'
  | 'evening_closeout'
  | 'chase_sweep'
  | 'adhoc';

export type AgentRunStatus = 'running' | 'ok' | 'error';

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export function isAgentActionKind(v: string): v is AgentActionKind {
  return (AGENT_ACTION_KINDS as readonly string[]).includes(v);
}

/**
 * `effects` is written by the agent as an array of plain strings so the log can
 * always render "what changed" without understanding every payload shape.
 * Non-strings are dropped rather than rendered as `[object Object]`.
 */
export function parseEffects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export type AgentTarget =
  | { type: 'task'; id: string }
  | { type: 'profile' }
  | { type: 'memory'; key: string }
  | { type: 'note'; id: string }
  | { type: 'brief'; id: string }
  | { type: 'unknown' };

export function parseTarget(raw: unknown): AgentTarget {
  if (!isRecord(raw)) return { type: 'unknown' };
  const type = str(raw.type);
  if (type === 'task') {
    const id = str(raw.id);
    return id ? { type: 'task', id } : { type: 'unknown' };
  }
  if (type === 'profile') return { type: 'profile' };
  if (type === 'note') {
    const id = str(raw.id);
    return id ? { type: 'note', id } : { type: 'unknown' };
  }
  if (type === 'brief') {
    const id = str(raw.id);
    return id ? { type: 'brief', id } : { type: 'unknown' };
  }
  if (type === 'memory') {
    const key = str(raw.key);
    return key ? { type: 'memory', key } : { type: 'unknown' };
  }
  return { type: 'unknown' };
}

/** Raw column-name patch, as stored in `before` / `after`. */
export type ColumnPatch = Record<string, unknown>;

export function parseColumnPatch(raw: unknown): ColumnPatch | null {
  return isRecord(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Undo planning
// ---------------------------------------------------------------------------

/**
 * A concrete, executable description of how to reverse one action. The store
 * carries these out; keeping the decision here means the reversal rules are
 * testable in isolation and readable in one place.
 */
export type UndoPlan =
  | { op: 'delete_task'; taskId: string }
  | { op: 'patch_task'; taskId: string; patch: ColumnPatch }
  | { op: 'restore_task'; row: ColumnPatch }
  | { op: 'patch_profile'; patch: ColumnPatch }
  | { op: 'delete_memory'; key: string }
  | { op: 'restore_memory'; key: string; row: ColumnPatch }
  | { op: 'delete_note'; noteId: string }
  | { op: 'patch_note'; noteId: string; patch: ColumnPatch; expectedUpdatedAt: string }
  | { op: 'delete_brief'; briefId: string }
  | { op: 'restore_brief'; row: ColumnPatch };

export type UndoRefusal = { reason: string };

export function isUndoRefusal(v: UndoPlan | UndoRefusal): v is UndoRefusal {
  return 'reason' in v;
}

export type AgentActionLike = {
  kind: string;
  status: string;
  target: unknown;
  before: unknown;
  after: unknown;
};

/**
 * Work out how to reverse an action, or explain why it can't be reversed.
 *
 * Returning a refusal (rather than silently doing nothing) matters: the log
 * shows the reason on the disabled Undo button, so an un-undoable entry is
 * never a mystery.
 */
export function planUndo(action: AgentActionLike): UndoPlan | UndoRefusal {
  if (action.status === 'undone') {
    return { reason: 'Already undone' };
  }
  if (action.status === 'failed') {
    return { reason: 'This change never applied, so there is nothing to undo' };
  }

  const target = parseTarget(action.target);
  const before = parseColumnPatch(action.before);
  const after = parseColumnPatch(action.after);

  switch (action.kind) {
    // The task did not exist beforehand, so reversing means removing it.
    case 'task_create': {
      if (target.type !== 'task') {
        return { reason: 'Missing the task reference needed to undo this' };
      }
      return { op: 'delete_task', taskId: target.id };
    }

    // `before` holds the prior value of exactly the columns that were written.
    case 'task_update':
    case 'task_complete':
    case 'chase_logged': {
      if (target.type !== 'task') {
        return { reason: 'Missing the task reference needed to undo this' };
      }
      if (!before || Object.keys(before).length === 0) {
        return { reason: 'No prior state was recorded for this change' };
      }
      return { op: 'patch_task', taskId: target.id, patch: before };
    }

    // `before` holds the whole deleted row, so it can be re-inserted.
    case 'task_delete': {
      if (!before || typeof before.id !== 'string') {
        return { reason: 'The deleted task was not recorded in full' };
      }
      return { op: 'restore_task', row: before };
    }

    case 'focus_reorder': {
      if (!before || !('focus_queue' in before)) {
        return { reason: 'No prior focus order was recorded' };
      }
      return { op: 'patch_profile', patch: { focus_queue: before.focus_queue } };
    }

    case 'memory_write': {
      if (target.type !== 'memory') {
        return { reason: 'Missing the memory reference needed to undo this' };
      }
      // No prior row means this memory was newly written; drop it.
      if (!before || Object.keys(before).length === 0) {
        return { op: 'delete_memory', key: target.key };
      }
      return { op: 'restore_memory', key: target.key, row: before };
    }

    case 'note_create': {
      if (target.type !== 'note') {
        return { reason: 'Missing the note reference needed to undo this' };
      }
      return { op: 'delete_note', noteId: target.id };
    }

    case 'note_append': {
      if (target.type !== 'note') {
        return { reason: 'Missing the note reference needed to undo this' };
      }
      if (!before || !('content' in before) || !('content_blocks' in before)) {
        return { reason: 'No prior note content was recorded for this append' };
      }
      const expectedUpdatedAt = after ? str(after.updated_at) : null;
      if (!expectedUpdatedAt) {
        return { reason: 'No note version was recorded for safe undo' };
      }
      return { op: 'patch_note', noteId: target.id, patch: before, expectedUpdatedAt };
    }

    case 'note_triage':
    case 'note_scratch': {
      if (target.type !== 'note') {
        return { reason: 'Missing the note reference needed to undo this' };
      }
      const lifecycleColumn = action.kind === 'note_scratch' ? 'scratch_at' : 'triaged_at';
      if (!before || !(lifecycleColumn in before)) {
        return { reason: 'No prior note lifecycle state was recorded' };
      }
      const expectedUpdatedAt = after ? str(after.updated_at) : null;
      if (!expectedUpdatedAt) {
        return { reason: 'No note version was recorded for safe undo' };
      }
      return { op: 'patch_note', noteId: target.id, patch: before, expectedUpdatedAt };
    }

    case 'brief_write': {
      if (target.type !== 'brief') {
        return { reason: 'Missing the brief reference needed to undo this' };
      }
      if (!before || Object.keys(before).length === 0) {
        return { op: 'delete_brief', briefId: target.id };
      }
      return { op: 'restore_brief', row: before };
    }

    default:
      return { reason: `Unrecognised action type "${action.kind}"` };
  }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type AgentAccent = 'brand' | 'blue' | 'purple' | 'amber' | 'green' | 'red';

export const ACTION_KIND_META: Record<
  AgentActionKind,
  { label: string; accent: AgentAccent }
> = {
  task_create: { label: 'Created', accent: 'green' },
  task_update: { label: 'Changed', accent: 'amber' },
  task_complete: { label: 'Closed', accent: 'green' },
  task_delete: { label: 'Deleted', accent: 'red' },
  focus_reorder: { label: 'Reordered focus', accent: 'brand' },
  chase_logged: { label: 'Chase drafted', accent: 'blue' },
  memory_write: { label: 'Learned', accent: 'purple' },
  note_create: { label: 'Captured note', accent: 'blue' },
  note_append: { label: 'Added context', accent: 'blue' },
  note_triage: { label: 'Triaged meeting note', accent: 'green' },
  note_scratch: { label: 'Changed scratch state', accent: 'amber' },
  brief_write: { label: 'Briefed', accent: 'purple' },
};

export const RUN_KIND_LABEL: Record<AgentRunKind, string> = {
  morning_brief: 'Morning brief',
  midday_triage: 'Midday triage',
  evening_closeout: 'Evening close-out',
  chase_sweep: 'Chase sweep',
  adhoc: 'Ad-hoc run',
};

export function runKindLabel(kind: string): string {
  return RUN_KIND_LABEL[kind as AgentRunKind] ?? 'Run';
}

export function actionKindMeta(kind: string): { label: string; accent: AgentAccent } {
  return isAgentActionKind(kind) ? ACTION_KIND_META[kind] : { label: 'Change', accent: 'brand' };
}
