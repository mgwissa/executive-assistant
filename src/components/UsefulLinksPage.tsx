import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useUsefulLinksStore } from '../store/useUsefulLinksStore';
import { LinkIcon, PlusIcon, TrashIcon } from './icons';
import { Card } from './ui/Card';

export function UsefulLinksPage() {
  const user = useAuthStore((s) => s.user);
  const links = useUsefulLinksStore((s) => s.links);
  const loading = useUsefulLinksStore((s) => s.loading);
  const error = useUsefulLinksStore((s) => s.error);
  const add = useUsefulLinksStore((s) => s.add);
  const update = useUsefulLinksStore((s) => s.update);
  const remove = useUsefulLinksStore((s) => s.remove);
  const move = useUsefulLinksStore((s) => s.move);

  const [draftLabel, setDraftLabel] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [adding, setAdding] = useState(false);

  const sorted = useMemo(
    () =>
      [...links].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.id.localeCompare(b.id);
      }),
    [links],
  );

  const onAdd = async () => {
    if (!user) return;
    setAdding(true);
    try {
      await add(user.id, draftLabel, draftUrl);
      setDraftLabel('');
      setDraftUrl('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <p className="mb-6 text-sm text-text-muted">
          Save shortcuts you open often. Links open in a new tab. Hostnames without{' '}
          <code className="rounded bg-surface-raised px-1 py-0.5 text-xs ring-1 ring-border">https://</code>{' '}
          get it automatically.
        </p>

        <Card padded="none" className="overflow-hidden">
          {error ? (
            <p className="border-b border-border bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <div className="space-y-4 border-b border-border bg-surface-raised/20 px-4 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <label htmlFor="links-page-label" className="block text-[11px] font-medium text-text-muted">
                  Label
                </label>
                <input
                  id="links-page-label"
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder="e.g. Team wiki"
                  maxLength={200}
                  disabled={!user}
                  className="input"
                />
              </div>
              <div className="min-w-0 flex-[2] space-y-1.5">
                <label htmlFor="links-page-url" className="block text-[11px] font-medium text-text-muted">
                  URL
                </label>
                <input
                  id="links-page-url"
                  type="url"
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://…"
                  autoComplete="off"
                  disabled={!user}
                  className="input font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onAdd();
                  }}
                />
              </div>
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={!user || adding || !draftLabel.trim() || !draftUrl.trim()}
                onClick={() => void onAdd()}
              >
                <span className="inline-flex items-center gap-1.5">
                  <PlusIcon className="h-4 w-4" />
                  Add link
                </span>
              </button>
            </div>
          </div>

          {loading && sorted.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-muted">Loading…</p>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <IconBadgeWrap>
                <LinkIcon className="h-6 w-6" />
              </IconBadgeWrap>
              <p className="text-sm font-medium text-text">No links yet</p>
              <p className="max-w-sm text-xs text-text-muted">
                Add your first shortcut above — mail, docs, dashboards, or anything you reach for daily.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.map((l, idx) => (
                <ManageRow
                  key={l.id}
                  label={l.label}
                  url={l.url}
                  canUp={idx > 0}
                  canDown={idx < sorted.length - 1}
                  onMoveUp={() => void move(l.id, 'up')}
                  onMoveDown={() => void move(l.id, 'down')}
                  onSave={(nextLabel, nextUrl) => void update(l.id, nextLabel, nextUrl)}
                  onRemove={() => void remove(l.id)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function IconBadgeWrap({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-raised ring-1 ring-border text-text-subtle">
      {children}
    </div>
  );
}

function ManageRow({
  label,
  url,
  canUp,
  canDown,
  onMoveUp,
  onMoveDown,
  onSave,
  onRemove,
}: {
  label: string;
  url: string;
  canUp: boolean;
  canDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSave: (label: string, url: string) => void;
  onRemove: () => void;
}) {
  const [lab, setLab] = useState(label);
  const [href, setHref] = useState(url);

  useEffect(() => {
    setLab(label);
    setHref(url);
  }, [label, url]);

  const dirty = lab.trim() !== label.trim() || href.trim() !== url.trim();

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={lab}
          onChange={(e) => setLab(e.target.value)}
          maxLength={200}
          className="input sm:max-w-[12rem]"
          aria-label="Link label"
        />
        <input
          type="url"
          value={href}
          onChange={(e) => setHref(e.target.value)}
          className="input min-w-0 flex-1 font-mono text-xs"
          aria-label="URL"
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost h-8 px-2 text-xs"
        >
          Open
        </a>
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-xs"
          disabled={!canUp}
          onClick={onMoveUp}
          aria-label="Move up"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-xs"
          disabled={!canDown}
          onClick={onMoveDown}
          aria-label="Move down"
          title="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          className="btn-secondary h-8 px-2 text-xs"
          disabled={!dirty || !lab.trim() || !href.trim()}
          onClick={() => onSave(lab, href)}
        >
          Save
        </button>
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-red-600 dark:text-red-400"
          onClick={onRemove}
          aria-label="Remove link"
          title="Remove"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
