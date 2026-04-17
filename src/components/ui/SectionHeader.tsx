import { Badge } from './Badge';

export function SectionHeader({
  icon,
  title,
  count,
  action,
  accent = 'subtle',
  className,
}: {
  icon?: import('react').ReactNode;
  title: string;
  count?: number;
  action?: import('react').ReactNode;
  accent?: 'subtle' | 'brand' | 'blue' | 'purple' | 'amber' | 'green';
  className?: string;
}) {
  const iconClass =
    accent === 'blue'
      ? 'text-blue-300'
      : accent === 'purple'
        ? 'text-purple-300'
        : accent === 'amber'
          ? 'text-amber-300'
          : accent === 'green'
            ? 'text-emerald-300'
            : accent === 'brand'
              ? 'text-brand-300'
              : 'text-text-subtle';

  return (
    <div className={['mb-3 flex items-center justify-between', className ?? ''].join(' ')}>
      <div className="flex items-center gap-2 text-text-muted">
        {icon && <span className={iconClass}>{icon}</span>}
        <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
        {typeof count === 'number' && count > 0 && <Badge variant={accent}>{count}</Badge>}
      </div>
      {action}
    </div>
  );
}

