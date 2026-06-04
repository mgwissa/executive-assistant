import type { Event } from '../types';
import { randomUUID } from './uuid';

/** Profile `meeting_rules` entry — title matched case-insensitively via RegExp. */
export type MeetingRule = {
  id: string;
  titlePattern: string;
  prep_required?: boolean;
  allow_back_to_back?: boolean;
  debrief_required?: boolean;
};

export type ResolvedMeetingTemperament = {
  prepRequired: boolean;
  allowBackToBack: boolean;
  debriefRequired: boolean;
};

export const DEFAULT_PREP_REQUIRED = true;
export const DEFAULT_ALLOW_BACK_TO_BACK = false;
export const DEFAULT_DEBRIEF_REQUIRED = true;

const BACK_TO_BACK_THRESHOLD_MS = 10 * 60 * 1000;

export function parseMeetingRules(raw: unknown): MeetingRule[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const titlePattern = typeof row.titlePattern === 'string' ? row.titlePattern.trim() : '';
    if (!titlePattern) continue;
    out.push({
      id: typeof row.id === 'string' ? row.id : randomUUID(),
      titlePattern,
      prep_required: typeof row.prep_required === 'boolean' ? row.prep_required : undefined,
      allow_back_to_back:
        typeof row.allow_back_to_back === 'boolean' ? row.allow_back_to_back : undefined,
      debrief_required:
        typeof row.debrief_required === 'boolean' ? row.debrief_required : undefined,
    });
  }
  return out;
}

export function titleMatchesPattern(title: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  try {
    return new RegExp(p, 'i').test(title);
  } catch {
    return title.toLowerCase().includes(p.toLowerCase());
  }
}

/** Escape a meeting title into a case-insensitive literal regex. */
export function titleToMeetingPattern(title: string): string {
  return title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveMeetingTemperament(
  event: Pick<Event, 'title' | 'prep_required' | 'allow_back_to_back' | 'debrief_required'>,
  rules: MeetingRule[],
): ResolvedMeetingTemperament {
  let prepRequired = event.prep_required ?? DEFAULT_PREP_REQUIRED;
  let allowBackToBack = event.allow_back_to_back ?? DEFAULT_ALLOW_BACK_TO_BACK;
  let debriefRequired = event.debrief_required ?? DEFAULT_DEBRIEF_REQUIRED;

  for (const rule of rules) {
    if (!titleMatchesPattern(event.title, rule.titlePattern)) continue;
    if (rule.prep_required !== undefined) prepRequired = rule.prep_required;
    if (rule.allow_back_to_back !== undefined) allowBackToBack = rule.allow_back_to_back;
    if (rule.debrief_required !== undefined) debriefRequired = rule.debrief_required;
  }

  return { prepRequired, allowBackToBack, debriefRequired };
}

export function buildMeetingRule(
  title: string,
  flags: { prep_required?: boolean; allow_back_to_back?: boolean; debrief_required?: boolean },
): MeetingRule {
  return {
    id: randomUUID(),
    titlePattern: titleToMeetingPattern(title),
    ...flags,
  };
}

export function meetingRuleShortLabel(
  action: 'prep_off' | 'back_to_back_ok' | 'debrief_off',
): string {
  switch (action) {
    case 'prep_off':
      return 'Never ask to prep';
    case 'back_to_back_ok':
      return 'Always allow back-to-back';
    case 'debrief_off':
      return 'Never ask to debrief';
  }
}

export function appendMeetingRule(rules: MeetingRule[], rule: MeetingRule): MeetingRule[] {
  const withoutDup = rules.filter(
    (r) =>
      r.titlePattern !== rule.titlePattern ||
      r.prep_required !== rule.prep_required ||
      r.allow_back_to_back !== rule.allow_back_to_back ||
      r.debrief_required !== rule.debrief_required,
  );
  return [...withoutDup, rule];
}

export function removeMeetingRule(rules: MeetingRule[], id: string): MeetingRule[] {
  return rules.filter((r) => r.id !== id);
}

/** True when consecutive meetings have less than 10 min between them and neither allows it. */
export function isBackToBackPair(
  earlierEnd: Date,
  laterStart: Date,
  earlierAllows: boolean,
  laterAllows: boolean,
): boolean {
  if (earlierAllows || laterAllows) return false;
  const gap = laterStart.getTime() - earlierEnd.getTime();
  return gap >= 0 && gap < BACK_TO_BACK_THRESHOLD_MS;
}

export { BACK_TO_BACK_THRESHOLD_MS };
