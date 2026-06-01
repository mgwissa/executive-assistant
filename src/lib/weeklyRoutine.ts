import type { RoutineRitual, RoutineTimeBlock, RoutineWeekday } from './weeklyRoutineGuide';
import {
  defaultWeeklyRoutineTemplate,
  type WeeklyRoutineTemplate,
} from './weeklyRoutineTemplate';

export type RoutineStatus = 'pending' | 'done' | 'skipped';

export type RoutineChecklistItem = RoutineTimeBlock | RoutineRitual;

const DEFAULT_TEMPLATE = defaultWeeklyRoutineTemplate();

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

export function routineDayLabel(
  weekday: RoutineWeekday,
  template: WeeklyRoutineTemplate = DEFAULT_TEMPLATE,
): string {
  return template.days.find((d) => d.weekday === weekday)?.label ?? weekday;
}

export function getRoutineDay(
  weekday: RoutineWeekday,
  template: WeeklyRoutineTemplate = DEFAULT_TEMPLATE,
) {
  return template.days.find((d) => d.weekday === weekday) ?? template.days[0];
}

export function getRoutineBlocksForWeekday(
  weekday: RoutineWeekday,
  template: WeeklyRoutineTemplate = DEFAULT_TEMPLATE,
): RoutineTimeBlock[] {
  return template.timeBlocks
    .filter((item) => item.weekday === weekday)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getRoutineRitualsForWeekday(
  weekday: RoutineWeekday,
  template: WeeklyRoutineTemplate = DEFAULT_TEMPLATE,
): RoutineRitual[] {
  return template.rituals
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
  const order: RoutineWeekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const idx = order.indexOf(weekday);
  return order[(idx + 1) % order.length]!;
}

export function previousRoutineWeekday(weekday: RoutineWeekday): RoutineWeekday {
  const order: RoutineWeekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const idx = order.indexOf(weekday);
  return order[(idx - 1 + order.length) % order.length]!;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function toDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
