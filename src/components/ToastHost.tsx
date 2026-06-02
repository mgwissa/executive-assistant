import { useEffect } from 'react';
import { XIcon } from './icons';
import { useToastStore } from '../store/useToastStore';

function ToastItem({
  id,
  title,
  body,
  actions,
  durationMs,
  onDismiss,
}: Omit<import('../store/useToastStore').Toast, 'id'> & { id: string }) {
  const dismiss = useToastStore((s) => s.dismiss);

  const dismissWithCallback = () => {
    onDismiss?.();
    dismiss(id);
  };

  useEffect(() => {
    if (durationMs == null || durationMs <= 0) return;
    const timer = window.setTimeout(() => dismissWithCallback(), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto w-full max-w-sm rounded-card border border-border bg-surface-raised p-4 shadow-card-raised"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">{title}</p>
          {body ? <p className="mt-1 text-xs text-text-muted">{body}</p> : null}
          {actions && actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={
                    action.variant === 'primary'
                      ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400'
                      : 'rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-sunken'
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismissWithCallback}
          className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-sunken hover:text-text"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(100vw-2rem,24rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>
  );
}
