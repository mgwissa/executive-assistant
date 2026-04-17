import type { TaskPriority } from './priority';
import { PRIORITY_ORDER } from './priority';

/** Stored in `profiles.priority_escalation` (JSON). */
export type PriorityEscalationConfig = {
  enabled: boolean;
  /** Days at Later before bumping to Routine */
  p4ToP3Days: number;
  /** Days at Routine before bumping to Active */
  p3ToP2Days: number;
  /** Days at Active before bumping to Important */
  p2ToP1Days: number;
};

export const DEFAULT_ESCALATION_CONFIG: PriorityEscalationConfig = {
  enabled: false,
  p4ToP3Days: 7,
  p3ToP2Days: 7,
  p2ToP1Days: 7,
};

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 365) return 365;
  return Math.floor(n);
}

/** Parse profile JSON; invalid or missing fields fall back to defaults. */
export function parseEscalationConfig(raw: unknown): PriorityEscalationConfig {
  const d = DEFAULT_ESCALATION_CONFIG;
  if (raw == null || typeof raw !== 'object') return { ...d };
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    p4ToP3Days: clampDays(Number(o.p4ToP3Days ?? d.p4ToP3Days)),
    p3ToP2Days: clampDays(Number(o.p3ToP2Days ?? d.p3ToP2Days)),
    p2ToP1Days: clampDays(Number(o.p2ToP1Days ?? d.p2ToP1Days)),
  };
}

export function escalationConfigForSave(partial: PriorityEscalationConfig): Record<string, unknown> {
  return {
    enabled: partial.enabled,
    p4ToP3Days: clampDays(partial.p4ToP3Days),
    p3ToP2Days: clampDays(partial.p3ToP2Days),
    p2ToP1Days: clampDays(partial.p2ToP1Days),
  };
}

function daysThreshold(priority: TaskPriority, cfg: PriorityEscalationConfig): number | null {
  switch (priority) {
    case 'low':
      return cfg.p4ToP3Days;
    case 'normal':
      return cfg.p3ToP2Days;
    case 'high':
      return cfg.p2ToP1Days;
    case 'urgent':
    case 'critical':
      return null;
  }
}

/** One step toward Critical; `critical` itself is never auto-bumped. */
export function bumpPriority(priority: TaskPriority): TaskPriority | null {
  const i = PRIORITY_ORDER.indexOf(priority);
  if (i <= 0) return null;
  return PRIORITY_ORDER[i - 1]!;
}

function wholeDaysSince(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  const diff = now.getTime() - t;
  return Math.floor(diff / 86_400_000);
}

export type TaskLike = {
  id: string;
  done: boolean;
  priority: string;
  priority_set_at: string;
};

/**
 * If the task has sat at its current priority long enough, return the next priority + new clock.
 * At most one bump per call (cadence-friendly).
 */
export function computeEscalation(
  task: TaskLike,
  cfg: PriorityEscalationConfig,
  now: Date = new Date(),
): { nextPriority: TaskPriority; newPrioritySetAt: string } | null {
  if (!cfg.enabled || task.done) return null;
  const p = task.priority as TaskPriority;
  const threshold = daysThreshold(p, cfg);
  if (threshold == null) return null;
  const days = wholeDaysSince(task.priority_set_at, now);
  if (days < threshold) return null;
  const next = bumpPriority(p);
  if (!next) return null;
  return { nextPriority: next, newPrioritySetAt: now.toISOString() };
}
