/**
 * Stored values: `critical` | `urgent` | `high` | `normal` | `low` (DB + API).
 *
 * Display names are tuned so the top levels aren’t all “alarm” words: Critical stays
 * sharp; middle tiers are calmer (Important, Active); bottom tiers read as queue (Routine, Later).
 *
 * Notes / quick-add still accept legacy `[P0]`–`[P4]` prefixes for the same five levels.
 */
export type TaskPriority = 'critical' | 'urgent' | 'high' | 'normal' | 'low';

export const PRIORITY_ORDER: TaskPriority[] = ['critical', 'urgent', 'high', 'normal', 'low'];

/** Single source of truth for pill labels and dropdown options. */
export const PRIORITY_PILL: Record<TaskPriority, string> = {
  critical: 'Critical',
  urgent: 'Important',
  high: 'Active',
  normal: 'Routine',
  low: 'Later',
};

/** Same as PRIORITY_PILL — used in selects and forms. */
export const PRIORITY_LABEL = PRIORITY_PILL;

/** Short blurbs for settings / legend. */
export const PRIORITY_HINT: Record<TaskPriority, string> = {
  critical: 'Nothing else first',
  urgent: 'Next after critical',
  high: 'In motion',
  normal: 'Default queue',
  low: 'When you can',
};

/** Lower number = show first (more important). */
export function priorityRank(p: TaskPriority): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i === -1 ? 2 : i;
}

/** After `[Pn]` or `(Pn)`, whitespace before the title is optional (e.g. `[P1]Buy` works). */
const P_TAG = /^\s*(?:\[(P[0-4])\]|\((P[0-4])\))\s*/i;

function mapPLevel(token: string): TaskPriority {
  const n = token.toUpperCase().replace(/[^0-4]/g, '');
  if (n === '0') return 'critical';
  if (n === '1') return 'urgent';
  if (n === '2') return 'high';
  if (n === '3') return 'normal';
  return 'low';
}

/** Strip leading legacy `[P0]`–`[P4]` / `(P2)` and return priority + remainder. */
export function parsePriorityPrefix(raw: string): { priority: TaskPriority; label: string } {
  const s = raw.trim();
  const m = s.match(P_TAG);
  if (!m) return { priority: 'normal', label: s };
  const level = (m[1] ?? m[2] ?? 'P3').toUpperCase();
  const label = s.slice(m[0].length).trim();
  return { priority: mapPLevel(level), label: label || s };
}

/**
 * When renaming a task: if the string has no legacy `[Pn]` prefix, keep `fallbackPriority`.
 * If it does, use the parsed priority and stripped title.
 */
export function parsePriorityInTitle(
  raw: string,
  fallbackPriority: TaskPriority,
): { title: string; priority: TaskPriority } {
  const s = raw.trim();
  if (!s) return { title: '', priority: fallbackPriority };
  const m = s.match(P_TAG);
  if (!m) return { title: s, priority: fallbackPriority };
  const { priority, label } = parsePriorityPrefix(s);
  return { title: label.trim() || s, priority };
}
