import type { PropsWithChildren } from 'react';

export function Kbd({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <kbd
      className={[
        'inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-muted',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </kbd>
  );
}

