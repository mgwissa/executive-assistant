import type { PropsWithChildren } from 'react';

type Size = 'sm' | 'md' | 'lg';
type Tone = 'brand' | 'muted' | 'success' | 'danger' | 'blue' | 'purple' | 'amber' | 'green';

export function IconBadge({
  size = 'md',
  tone = 'brand',
  className,
  children,
}: PropsWithChildren<{
  size?: Size;
  tone?: Tone;
  className?: string;
}>) {
  const s =
    size === 'sm'
      ? 'h-8 w-8 rounded-md'
      : size === 'lg'
        ? 'h-12 w-12 rounded-xl'
        : 'h-10 w-10 rounded-lg';

  const t =
    tone === 'muted'
      ? 'bg-surface-sunken text-text-muted'
      : tone === 'success'
        ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        : tone === 'danger'
          ? 'bg-red-600/10 text-red-700 dark:bg-red-500/10 dark:text-red-300'
    : tone === 'blue'
      ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
    : tone === 'purple'
      ? 'bg-purple-600/10 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300'
    : tone === 'amber'
      ? 'bg-amber-600/10 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
    : tone === 'green'
      ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
      : 'bg-brand-600/10 text-brand-700 dark:bg-brand-400/10 dark:text-brand-300';

  return (
    <div
      className={[
        'flex items-center justify-center',
        s,
        t,
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

