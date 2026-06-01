import type { Task } from '../types';

export const MAX_TASK_TAG_LENGTH = 32;
export const MAX_TASK_TAGS = 12;

/** Normalize a single tag; returns null when empty or invalid. */
export function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_TASK_TAG_LENGTH) return null;
  return trimmed;
}

/** Dedupe and normalize a tag list, preserving order. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TASK_TAGS) break;
  }
  return out;
}

/** Parse comma/semicolon/whitespace-separated tag input. */
export function parseTagsFromInput(input: string): string[] {
  const parts = input.split(/[,;\n]+/).flatMap((chunk) => chunk.split(/\s+/));
  return normalizeTags(parts);
}

export function collectTaskTags(tasks: readonly Pick<Task, 'tags'>[]): string[] {
  const set = new Set<string>();
  for (const task of tasks) {
    for (const tag of task.tags ?? []) {
      if (tag) set.add(tag);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function taskMatchesTagFilter(task: Pick<Task, 'tags'>, tag: string | null): boolean {
  if (!tag) return true;
  return (task.tags ?? []).includes(tag);
}

export function tagCountByLabel(tasks: readonly Pick<Task, 'tags'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const tag of task.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}
