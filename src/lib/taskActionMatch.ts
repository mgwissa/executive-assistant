import { ACTION_ITEM_RE, DUE_TAG_RE, type ActionItem } from './format';
import { parsePriorityPrefix } from './priority';
import type { Task } from '../types';

/** Normalize titles when matching note action items to standalone tasks. */
export function normalizeTaskMatchKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Same display title logic as `extractActionItems`. */
export function displayTitleFromNoteLine(lineText: string): string {
  const match = lineText.match(ACTION_ITEM_RE);
  if (!match) {
    return lineText
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
      .replace(DUE_TAG_RE, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  const raw = match[2];
  const withoutDue = raw.replace(DUE_TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
  return parsePriorityPrefix(withoutDue).label.trim();
}

/** Open standalone task that mirrors this note checkbox (same display title). */
export function findOpenTaskForActionItem(
  tasks: readonly Task[],
  displayText: string,
): Task | undefined {
  const key = normalizeTaskMatchKey(displayText);
  if (!key) return undefined;
  return tasks.find((t) => !t.done && normalizeTaskMatchKey(t.title) === key);
}

export function findOpenTaskForNoteActionRef(
  tasks: readonly Task[],
  actionItems: readonly ActionItem[],
  ref: { noteId: string; line: number },
  lineText: string,
): Task | undefined {
  const actionItem = actionItems.find((i) => i.noteId === ref.noteId && i.line === ref.line);
  if (actionItem) {
    return findOpenTaskForActionItem(tasks, actionItem.displayText);
  }
  return findOpenTaskForActionItem(tasks, displayTitleFromNoteLine(lineText));
}

export function actionItemHasMatchingOpenTask(
  tasks: readonly Task[],
  item: Pick<ActionItem, 'displayText'>,
): boolean {
  return findOpenTaskForActionItem(tasks, item.displayText) != null;
}

/** Hide note checkboxes that already have a matching open standalone task. */
export function filterActionItemsDeduped(
  tasks: readonly Task[],
  items: readonly ActionItem[],
): ActionItem[] {
  return items.filter((item) => !actionItemHasMatchingOpenTask(tasks, item));
}

/** @deprecated Use displayTitleFromNoteLine */
export function titleFromActionLine(lineText: string): string {
  return displayTitleFromNoteLine(lineText);
}
