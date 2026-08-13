import type { CreateTaskOptions } from '../store/useTasksStore';

export type TaskQuickAddPayload = {
  title: string;
  dateKind: 'none' | 'review' | 'deadline';
  dueDate: string;
  reviewDate: string;
  dueTime: string;
  tags: string[];
};

export function toCreateTaskOptions({
  dateKind,
  dueDate,
  reviewDate,
  dueTime,
  tags,
}: Omit<TaskQuickAddPayload, 'title'>): CreateTaskOptions {
  return {
    ...(dateKind === 'deadline' && dueDate ? { dueDate, dueTime: dueTime || null } : {}),
    ...(dateKind === 'review' && reviewDate ? { reviewDate } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

