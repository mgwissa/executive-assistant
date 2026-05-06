import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { viewPath } from '../lib/routes';
import { useUsefulLinksStore } from '../store/useUsefulLinksStore';
import { ArrowRightIcon, LinkIcon } from './icons';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionHeader } from './ui/SectionHeader';

const DASHBOARD_PREVIEW = 8;

type UsefulLinksSectionProps = {
  /** When set, replaces default vertical margins (e.g. in a grid pair). */
  className?: string;
};

export function UsefulLinksSection({ className }: UsefulLinksSectionProps) {
  const navigate = useNavigate();
  const links = useUsefulLinksStore((s) => s.links);
  const loading = useUsefulLinksStore((s) => s.loading);
  const error = useUsefulLinksStore((s) => s.error);

  const sorted = useMemo(
    () =>
      [...links].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.id.localeCompare(b.id);
      }),
    [links],
  );

  const preview = sorted.slice(0, DASHBOARD_PREVIEW);
  const overflow = sorted.length - preview.length;

  return (
    <section
      className={
        className?.trim()
          ? ['min-w-0', className].join(' ')
          : 'mb-6 min-w-0 lg:mb-8'
      }
    >
      <SectionHeader
        icon={<LinkIcon className="h-4 w-4" />}
        title="Useful links"
        count={sorted.length}
        accent="brand"
        action={
          <button
            type="button"
            onClick={() => navigate(viewPath('links'))}
            className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600"
          >
            Manage
            <ArrowRightIcon className="h-3 w-3" />
          </button>
        }
      />

      <Card
        padded="none"
        className="flex min-h-0 max-h-[min(50vh,30rem)] flex-1 flex-col overflow-hidden"
      >
        {error ? (
          <p className="border-b border-border bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {sorted.length === 0 ? (
          <div className="px-4 py-5">
            <EmptyState
              icon={<LinkIcon className="h-5 w-5" />}
              title="No links yet"
              message="Add bookmarks on the Links page — they’ll show up here for quick access."
              action={
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => navigate(viewPath('links'))}
                >
                  Go to Links
                </button>
              }
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2 border-b border-border bg-surface-raised/25 px-4 py-3">
            <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto overscroll-contain">
              {preview.map((l) => (
                <a
                  key={l.id}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-border transition-colors hover:bg-surface-raised hover:text-brand-600"
                >
                  <LinkIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{l.label}</span>
                </a>
              ))}
              {loading && preview.length === 0 ? (
                <p className="px-2 py-1 text-sm text-text-muted">Loading…</p>
              ) : null}
            </div>
            {overflow > 0 ? (
              <button
                type="button"
                onClick={() => navigate(viewPath('links'))}
                className="text-left text-xs font-medium text-brand-700 hover:text-brand-600"
              >
                +{overflow} more on Links
              </button>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}
