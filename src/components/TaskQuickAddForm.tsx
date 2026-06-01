import { useState } from 'react';
import { parseTagsFromInput } from '../lib/taskTags';
import type { TaskPriority } from '../lib/priority';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../lib/priority';
import { prioritySelectClass } from '../lib/priorityUiClasses';
import type { CreateTaskOptions } from '../store/useTasksStore';

export type TaskQuickAddPayload = {
  title: string;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string;
  tags: string[];
};

export function toCreateTaskOptions({
  priority,
  dueDate,
  dueTime,
  tags,
}: Omit<TaskQuickAddPayload, 'title'>): CreateTaskOptions {
  return {
    priority,
    ...(dueDate ? { dueDate, dueTime: dueTime || null } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function TaskQuickAddForm({
  disabled = false,
  className = '',
  variant = 'default',
  idPrefix = 'task-quick-add',
  titlePlaceholder = 'Add a todo…',
  submitLabel = 'Add',
  onSubmit,
}: {
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'embedded';
  idPrefix?: string;
  titlePlaceholder?: string;
  submitLabel?: string;
  onSubmit: (payload: TaskQuickAddPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const reset = () => {
    setTitle('');
    setPriority('normal');
    setDueDate('');
    setDueTime('');
    setTagsInput('');
  };

  const controls = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="sr-only" htmlFor={`${idPrefix}-priority`}>
        Priority
      </label>
      <select
        id={`${idPrefix}-priority`}
        value={priority}
        disabled={disabled}
        onChange={(e) => setPriority(e.target.value as TaskPriority)}
        className={[
          'input mt-0 w-full py-2 text-sm sm:w-[8.5rem] sm:py-1.5',
          prioritySelectClass(priority),
        ].join(' ')}
      >
        {PRIORITY_ORDER.map((opt) => (
          <option key={opt} value={opt}>
            {PRIORITY_LABEL[opt]}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`${idPrefix}-due`}>
        Due date
      </label>
      <input
        id={`${idPrefix}-due`}
        type="date"
        value={dueDate}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setDueDate(next);
          if (!next) setDueTime('');
        }}
        className="input mt-0 w-full py-2 text-sm sm:w-[9.25rem] sm:py-1.5"
      />
      <label className="sr-only" htmlFor={`${idPrefix}-time`}>
        Due time
      </label>
      <input
        id={`${idPrefix}-time`}
        type="time"
        value={dueTime}
        disabled={disabled || !dueDate}
        onChange={(e) => setDueTime(e.target.value)}
        className="input mt-0 w-full py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-[7.5rem] sm:py-1.5"
      />
      <label className="sr-only" htmlFor={`${idPrefix}-tags`}>
        Tags
      </label>
      <input
        id={`${idPrefix}-tags`}
        type="text"
        value={tagsInput}
        disabled={disabled}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="Tags (comma-separated)"
        title="Comma-separated tags — spaces OK within a tag"
        className="input mt-0 w-full min-w-0 py-2 text-sm sm:min-w-[8rem] sm:flex-1 sm:py-1.5"
      />
      <button
        type="submit"
        disabled={disabled}
        className={[
          'btn-primary w-full shrink-0 whitespace-nowrap sm:w-auto',
          variant === 'default' ? 'sm:ml-auto' : '',
        ].join(' ')}
      >
        {submitLabel}
      </button>
    </div>
  );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed || disabled) return;
        await onSubmit({
          title: trimmed,
          priority,
          dueDate,
          dueTime,
          tags: parseTagsFromInput(tagsInput),
        });
        reset();
      }}
      className={[
        variant === 'embedded'
          ? 'flex flex-col gap-2 border-b border-border px-4 py-3'
          : 'space-y-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={variant === 'embedded' ? 'input w-full' : 'input w-full'}
        placeholder={titlePlaceholder}
        maxLength={200}
        disabled={disabled}
      />
      {controls}
    </form>
  );
}
