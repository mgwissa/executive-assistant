import {
  ROUTINE_DAYS,
  ROUTINE_RITUALS,
  ROUTINE_TIME_BLOCKS,
  ROUTINE_WEEKDAYS,
  type RoutineRitual,
  type RoutineTimeBlock,
  type RoutineWeekday,
} from './weeklyRoutineGuide';

export type RoutineStatus = 'pending' | 'done' | 'skipped';

export type RoutineChecklistItem = RoutineTimeBlock | RoutineRitual;

export function routineWeekdayFromDate(date: Date): RoutineWeekday {
  const day = date.getDay();
  if (day === 2) return 'tuesday';
  if (day === 3) return 'wednesday';
  if (day === 4) return 'thursday';
  if (day === 5) return 'friday';
  return 'monday';
}

export function routineWeekdayFromLabel(label: string): RoutineWeekday {
  const normalized = label.toLowerCase();
  if (normalized === 'tuesday') return 'tuesday';
  if (normalized === 'wednesday') return 'wednesday';
  if (normalized === 'thursday') return 'thursday';
  if (normalized === 'friday') return 'friday';
  return 'monday';
}

export function routineWeekDatesFor(todayIso: string): Record<RoutineWeekday, string> {
  const base = new Date(`${todayIso}T12:00:00`);
  const day = base.getDay();
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const monday = addDays(base, mondayDelta);
  return {
    monday: toDateIso(monday),
    tuesday: toDateIso(addDays(monday, 1)),
    wednesday: toDateIso(addDays(monday, 2)),
    thursday: toDateIso(addDays(monday, 3)),
    friday: toDateIso(addDays(monday, 4)),
  };
}

export function routineDayLabel(weekday: RoutineWeekday): string {
  return ROUTINE_DAYS.find((d) => d.weekday === weekday)?.label ?? weekday;
}

export function getRoutineDay(weekday: RoutineWeekday) {
  return ROUTINE_DAYS.find((d) => d.weekday === weekday) ?? ROUTINE_DAYS[0];
}

export function getRoutineBlocksForWeekday(weekday: RoutineWeekday): RoutineTimeBlock[] {
  return ROUTINE_TIME_BLOCKS
    .filter((item) => item.weekday === weekday)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getRoutineRitualsForWeekday(weekday: RoutineWeekday): RoutineRitual[] {
  return ROUTINE_RITUALS
    .filter((item) => item.days.includes(weekday))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function routineProgress(
  items: RoutineChecklistItem[],
  statusForItem: (itemId: string) => RoutineStatus,
): { done: number; total: number; percent: number } {
  const done = items.filter((item) => statusForItem(item.id) === 'done').length;
  const total = items.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function nextRoutineWeekday(weekday: RoutineWeekday): RoutineWeekday {
  const idx = ROUTINE_WEEKDAYS.indexOf(weekday);
  return ROUTINE_WEEKDAYS[(idx + 1) % ROUTINE_WEEKDAYS.length];
}

export function previousRoutineWeekday(weekday: RoutineWeekday): RoutineWeekday {
  const idx = ROUTINE_WEEKDAYS.indexOf(weekday);
  return ROUTINE_WEEKDAYS[(idx - 1 + ROUTINE_WEEKDAYS.length) % ROUTINE_WEEKDAYS.length];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function toDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
