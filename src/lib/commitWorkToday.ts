import type { ActionItem } from './format';
import { setActionItemLineDueDate } from './format';
import { bumpPriorityOneLevel } from './delegationChase';
import type { WorkItemRef } from './executiveDirective';
import {
  commitRefToFocusToday,
  scheduleFocusForTomorrow,
  tomorrowIsoFrom,
  type FocusQueuePrefs,
} from './focusQueue';
import { applyMarkdownPatchToNote, getNoteCanonicalMarkdown } from './noteContentBridge';
import type { TaskPriority } from './priority';
import { findOpenTaskForNoteActionRef } from './taskActionMatch';
import type { Note, Task } from '../types';

export type CommitWorkContext = {
  todayIso: string;
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  tasks: Task[];
  notes: Note[];
  actionItems: ActionItem[];
  setDueDate: (id: string, date: string | null) => Promise<void>;
  setDueTime: (id: string, time: string | null) => Promise<void>;
  setTaskPriority: (id: string, priority: TaskPriority) => Promise<void>;
  updateNote: (
    id: string,
    patch: { title?: string; content?: string; content_blocks?: Note['content_blocks'] },
  ) => Promise<void>;
};

export async function commitTaskToToday(
  taskId: string,
  ctx: CommitWorkContext,
  options?: { raisePriority?: boolean },
): Promise<void> {
  const ref: WorkItemRef = { kind: 'task', taskId };
  ctx.onFocusPrefsUpdate(commitRefToFocusToday(ctx.focusPrefs, ref));
  await ctx.setDueDate(taskId, ctx.todayIso);
  await ctx.setDueTime(taskId, null);
  if (options?.raisePriority) {
    const task = ctx.tasks.find((t) => t.id === taskId);
    const raised = bumpPriorityOneLevel((task?.priority as TaskPriority) ?? 'normal');
    if (raised) await ctx.setTaskPriority(taskId, raised);
  }
}

export async function commitActionToToday(
  noteId: string,
  line: number,
  ctx: CommitWorkContext,
): Promise<void> {
  const ref: WorkItemRef = { kind: 'action', noteId, line };
  ctx.onFocusPrefsUpdate(commitRefToFocusToday(ctx.focusPrefs, ref));
  const note = ctx.notes.find((n) => n.id === noteId);
  const lineText = note ? getNoteCanonicalMarkdown(note).split('\n')[line] ?? '' : '';
  if (note) {
    const patched = applyMarkdownPatchToNote(note, (md) =>
      setActionItemLineDueDate(md, line, ctx.todayIso),
    );
    if (patched) await ctx.updateNote(noteId, patched);
  }
  const openTasks = ctx.tasks.filter((t) => !t.done);
  const existing = findOpenTaskForNoteActionRef(openTasks, ctx.actionItems, ref, lineText);
  if (existing) {
    await ctx.setDueDate(existing.id, ctx.todayIso);
    await ctx.setDueTime(existing.id, null);
  }
}

export async function scheduleTaskForTomorrow(taskId: string, ctx: CommitWorkContext): Promise<void> {
  const ref: WorkItemRef = { kind: 'task', taskId };
  ctx.onFocusPrefsUpdate(scheduleFocusForTomorrow(ctx.focusPrefs, ref, ctx.todayIso));
  const tomorrow = tomorrowIsoFrom(ctx.todayIso);
  await ctx.setDueDate(taskId, tomorrow);
  await ctx.setDueTime(taskId, null);
}

export async function scheduleActionForTomorrow(
  noteId: string,
  line: number,
  ctx: CommitWorkContext,
): Promise<void> {
  const ref: WorkItemRef = { kind: 'action', noteId, line };
  ctx.onFocusPrefsUpdate(scheduleFocusForTomorrow(ctx.focusPrefs, ref, ctx.todayIso));
  const tomorrow = tomorrowIsoFrom(ctx.todayIso);
  const note = ctx.notes.find((n) => n.id === noteId);
  const lineText = note ? getNoteCanonicalMarkdown(note).split('\n')[line] ?? '' : '';
  if (note) {
    const patched = applyMarkdownPatchToNote(note, (md) =>
      setActionItemLineDueDate(md, line, tomorrow),
    );
    if (patched) await ctx.updateNote(noteId, patched);
  }
  const openTasks = ctx.tasks.filter((t) => !t.done);
  const existing = findOpenTaskForNoteActionRef(openTasks, ctx.actionItems, ref, lineText);
  if (existing) {
    await ctx.setDueDate(existing.id, tomorrow);
    await ctx.setDueTime(existing.id, null);
  }
}
