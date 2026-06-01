import { useMemo, useState } from 'react';
import {
  MAX_TASK_TAGS,
  normalizeTags,
  parseTagsFromInput,
  tagCountByLabel,
} from '../lib/taskTags';import type { Task } from '../types';
import { XIcon } from './icons';
import { Badge } from './ui/Badge';

export function TaskTagBadges({
  tags,
  className = '',
  onRemove,
}: {
  tags: readonly string[];
  className?: string;
  onRemove?: (tag: string) => void;
}) {
  if (!tags.length) return null;
  return (
    <div className={['flex flex-wrap gap-1', className].filter(Boolean).join(' ')}>
      {tags.map((tag) =>
        onRemove ? (
          <button
            key={tag}
            type="button"
            onClick={() => onRemove(tag)}
            className="group inline-flex items-center gap-0.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-text-muted ring-1 ring-border transition-colors hover:text-text"
            title={`Remove tag ${tag}`}
          >
            {tag}
            <XIcon className="h-3 w-3 opacity-60 group-hover:opacity-100" />
          </button>
        ) : (
          <Badge key={tag} variant="subtle" className="text-[11px] font-medium normal-case">
            {tag}
          </Badge>
        ),
      )}
    </div>
  );
}

export function TaskTagFilter({
  tasks,
  selected,
  onSelect,
  className = '',
}: {
  tasks: readonly Pick<Task, 'tags'>[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
  className?: string;
}) {
  const options = useMemo(() => {
    const counts = tagCountByLabel(tasks);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  if (options.length === 0) return null;

  return (
    <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Tags</span>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={filterPillClass(!selected)}
      >
        All
      </button>
      {options.map(([tag, count]) => (
        <button
          key={tag}
          type="button"
          onClick={() => onSelect(selected === tag ? null : tag)}
          className={filterPillClass(selected === tag)}
        >
          {tag}
          <span className="opacity-70">({count})</span>
        </button>
      ))}
    </div>
  );
}

function filterPillClass(active: boolean): string {
  return [
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-ring',
    active
      ? 'bg-brand-500/15 text-brand-800 ring-1 ring-brand-500/40 dark:text-brand-200'
      : 'bg-surface-sunken text-text-muted ring-1 ring-border hover:text-text',
  ].join(' ');
}

export function TaskTagEditor({
  tags,
  disabled = false,
  onChange,
}: {
  tags: readonly string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const addDraft = () => {
    const next = normalizeTags([...tags, ...parseTagsFromInput(draft)]);
    onChange(next);
    setDraft('');
  };

  const atLimit = tags.length >= MAX_TASK_TAGS;

  return (
    <div className="space-y-2">
      <TaskTagBadges
        tags={tags}
        onRemove={
          disabled
            ? undefined
            : (tag) => onChange(tags.filter((t) => t !== tag))
        }
      />
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={draft}
            disabled={atLimit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder={atLimit ? 'Tag limit reached' : 'Add tag, or several comma-separated'}
            className="input mt-0 min-h-[2rem] min-w-[12rem] flex-1 py-1 text-sm"
          />
          <button
            type="button"
            disabled={atLimit || parseTagsFromInput(draft).length === 0}
            onClick={addDraft}
            className="btn-secondary py-1.5 text-sm"
          >
            Add
          </button>
        </div>
      ) : null}
      {!disabled ? (
        <p className="text-xs text-text-subtle">
          Lowercase labels — separate tags with commas (spaces allowed inside a tag). Up to{' '}
          {MAX_TASK_TAGS} per task.
        </p>
      ) : null}
    </div>
  );
}
