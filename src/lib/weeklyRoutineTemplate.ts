import {
  MARKET_SCAN_CHECKLIST,
  MARKET_SCAN_SOURCES,
  ROUTINE_ANTI_PATTERNS,
  ROUTINE_CADENCES,
  ROUTINE_DAYS,
  ROUTINE_RITUALS,
  ROUTINE_TIME_BLOCKS,
  WEEKLY_ROUTINE_TEMPLATE_VERSION,
  type RoutineAntiPattern,
  type RoutineCadence,
  type RoutineDay,
  type RoutineRitual,
  type RoutineTimeBlock,
} from './weeklyRoutineGuide';

export type WeeklyRoutineTemplate = {
  version: string;
  days: RoutineDay[];
  timeBlocks: RoutineTimeBlock[];
  rituals: RoutineRitual[];
  cadences: RoutineCadence[];
  antiPatterns: RoutineAntiPattern[];
  marketScanChecklist: string[];
  marketScanSources: string[];
};

export const USER_WEEKLY_ROUTINE_VERSION = 'user-weekly-routine-v1';

export function defaultWeeklyRoutineTemplate(): WeeklyRoutineTemplate {
  return {
    version: WEEKLY_ROUTINE_TEMPLATE_VERSION,
    days: structuredClone(ROUTINE_DAYS),
    timeBlocks: structuredClone(ROUTINE_TIME_BLOCKS),
    rituals: structuredClone(ROUTINE_RITUALS),
    cadences: structuredClone(ROUTINE_CADENCES),
    antiPatterns: structuredClone(ROUTINE_ANTI_PATTERNS),
    marketScanChecklist: [...MARKET_SCAN_CHECKLIST],
    marketScanSources: [...MARKET_SCAN_SOURCES],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** Best-effort parse; returns null when shape is unusable. */
export function parseWeeklyRoutineTemplate(raw: unknown): WeeklyRoutineTemplate | null {
  if (!isRecord(raw)) return null;
  const days = Array.isArray(raw.days) ? (raw.days as RoutineDay[]) : null;
  const timeBlocks = Array.isArray(raw.timeBlocks) ? (raw.timeBlocks as RoutineTimeBlock[]) : null;
  const rituals = Array.isArray(raw.rituals) ? (raw.rituals as RoutineRitual[]) : null;
  if (!days?.length || !timeBlocks || !rituals) return null;
  return {
    version: asString(raw.version, USER_WEEKLY_ROUTINE_VERSION),
    days,
    timeBlocks,
    rituals,
    cadences: Array.isArray(raw.cadences) ? (raw.cadences as RoutineCadence[]) : [],
    antiPatterns: Array.isArray(raw.antiPatterns) ? (raw.antiPatterns as RoutineAntiPattern[]) : [],
    marketScanChecklist: asStringArray(raw.marketScanChecklist),
    marketScanSources: asStringArray(raw.marketScanSources),
  };
}

export function resolveWeeklyRoutineTemplate(
  weeklyRoutine: unknown | null | undefined,
): WeeklyRoutineTemplate {
  const parsed = weeklyRoutine != null ? parseWeeklyRoutineTemplate(weeklyRoutine) : null;
  return parsed ?? defaultWeeklyRoutineTemplate();
}

export function templateForSave(template: WeeklyRoutineTemplate): WeeklyRoutineTemplate {
  return {
    ...template,
    version: USER_WEEKLY_ROUTINE_VERSION,
  };
}

export function isDefaultGuideTemplate(template: WeeklyRoutineTemplate): boolean {
  return template.version === WEEKLY_ROUTINE_TEMPLATE_VERSION;
}

export function newRoutineItemId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createEmptyTimeBlock(
  weekday: RoutineDay['weekday'],
  sortOrder: number,
): RoutineTimeBlock {
  return {
    id: newRoutineItemId('block'),
    kind: 'time-block',
    weekday,
    sortOrder,
    startTime: '09:00',
    endTime: '10:00',
    title: 'New time block',
    description: '',
    automation: { target: 'none', cadence: 'weekly' },
  };
}

export function createEmptyRitual(weekday: RoutineDay['weekday'], sortOrder: number): RoutineRitual {
  return {
    id: newRoutineItemId('ritual'),
    kind: 'ritual',
    sortOrder,
    title: 'New ritual',
    days: [weekday],
    durationMinutes: 30,
    output: '',
    automation: { target: 'none', cadence: 'weekly' },
  };
}

export function routineTemplateVersion(template: WeeklyRoutineTemplate): string {
  return template.version;
}
