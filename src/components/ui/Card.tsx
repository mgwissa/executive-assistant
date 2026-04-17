import type { PropsWithChildren } from 'react';

type Tone = 'default' | 'raised' | 'sunken';
type Padding = 'none' | 'sm' | 'md' | 'lg';

export function Card({
  tone = 'default',
  padded = 'md',
  className,
  children,
}: PropsWithChildren<{
  tone?: Tone;
  padded?: Padding;
  className?: string;
}>) {
  const toneClass =
    tone === 'raised'
      ? 'bg-surface-raised shadow-card-raised'
      : tone === 'sunken'
        ? 'bg-surface-sunken'
        : 'bg-surface-raised shadow-card';

  const padClass =
    padded === 'none'
      ? ''
      : padded === 'sm'
        ? 'p-3'
        : padded === 'lg'
          ? 'p-8'
          : 'p-6';

  return (
    <div
      className={[
        'rounded-card border border-border',
        toneClass,
        padClass,
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

