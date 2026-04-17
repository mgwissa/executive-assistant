import type { PropsWithChildren, ReactNode } from 'react';
import { IconBadge } from './IconBadge';

export function EmptyState({
  title,
  message,
  icon,
  action,
}: PropsWithChildren<{
  title: string;
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="px-4 py-10 text-center">
      {icon && (
        <div className="mb-3 flex justify-center">
          <IconBadge tone="muted" size="md">
            {icon}
          </IconBadge>
        </div>
      )}
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 text-xs text-text-muted">{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

