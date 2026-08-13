import { useState } from 'react';
import { parseTagsFromInput } from '../lib/taskTags';
import type { TaskQuickAddPayload } from '../lib/taskQuickAdd';

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
  const [dateKind, setDateKind] = useState<'none' | 'review' | 'deadline'>('none');
  const [dueDate, setDueDate] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const reset = () => {
    setTitle('');
    setDateKind('none');
    setDueDate('');
    setReviewDate('');
    setDueTime('');
    setTagsInput('');
  };

  const controls = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="sr-only" htmlFor={`${idPrefix}-date-kind`}>
        Date type
      </label>
      <select
        id={`${idPrefix}-date-kind`}
        value={dateKind}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as 'none' | 'review' | 'deadline';
          setDateKind(next);
          if (next !== 'deadline') {
            setDueDate('');
            setDueTime('');
          }
          if (next !== 'review') setReviewDate('');
        }}
        className="input mt-0 w-full py-2 text-sm sm:w-[9.5rem] sm:py-1.5"
      >
        <option value="none">No date</option>
        <option value="review">Review later</option>
        <option value="deadline">Real deadline</option>
      </select>
      {dateKind === 'review' ? (
        <>
          <label className="sr-only" htmlFor={`${idPrefix}-review`}>Review date</label>
          <input id={`${idPrefix}-review`} type="date" value={reviewDate} disabled={disabled} onChange={(e) => setReviewDate(e.target.value)} className="input mt-0 w-full py-2 text-sm sm:w-[9.25rem] sm:py-1.5" />
        </>
      ) : null}
      {dateKind === 'deadline' ? (
        <>
          <label className="sr-only" htmlFor={`${idPrefix}-due`}>Deadline</label>
          <input id={`${idPrefix}-due`} type="date" value={dueDate} disabled={disabled} onChange={(e) => { const next = e.target.value; setDueDate(next); if (!next) setDueTime(''); }} className="input mt-0 w-full py-2 text-sm sm:w-[9.25rem] sm:py-1.5" />
          <label className="sr-only" htmlFor={`${idPrefix}-time`}>Deadline time</label>
          <input id={`${idPrefix}-time`} type="time" value={dueTime} disabled={disabled || !dueDate} onChange={(e) => setDueTime(e.target.value)} className="input mt-0 w-full py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-[7.5rem] sm:py-1.5" />
        </>
      ) : null}
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
          dateKind,
          dueDate,
          reviewDate,
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
