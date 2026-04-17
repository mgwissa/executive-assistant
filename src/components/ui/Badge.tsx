import type { PropsWithChildren } from 'react';

type Variant =
  | 'subtle'
  | 'brand'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'
  | 'blue'
  | 'purple'
  | 'amber'
  | 'green';

export function Badge({
  variant = 'subtle',
  className,
  children,
}: PropsWithChildren<{
  variant?: Variant;
  className?: string;
}>) {
  const v =
    variant === 'brand'
      ? 'bg-brand-600/10 text-brand-700 dark:bg-brand-400/10 dark:text-brand-300'
      : variant === 'danger'
        ? 'bg-red-600/10 text-red-700 dark:bg-red-500/10 dark:text-red-300'
        : variant === 'success' || variant === 'green'
          ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
          : variant === 'warning' || variant === 'amber'
            ? 'bg-amber-600/10 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
            : variant === 'info' || variant === 'blue'
              ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
              : variant === 'purple'
                ? 'bg-purple-600/10 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300'
        : 'bg-surface-sunken text-text-muted';

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        v,
        className ?? '',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

