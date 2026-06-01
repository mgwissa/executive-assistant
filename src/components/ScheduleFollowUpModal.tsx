import { useState } from 'react';
import { Card } from './ui/Card';

type ScheduleFollowUpModalProps = {
  open: boolean;
  meetingTitle: string;
  defaultTitle?: string;
  defaultDueDate?: string;
  onClose: () => void;
  onSave: (payload: { title: string; dueDate: string; dueTime: string | null }) => Promise<void>;
};

export function ScheduleFollowUpModal({
  open,
  meetingTitle,
  defaultTitle,
  defaultDueDate,
  onClose,
  onSave,
}: ScheduleFollowUpModalProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const effectiveTitle = title || defaultTitle || `Follow up: ${meetingTitle}`;
  const effectiveDate = dueDate || defaultDueDate || new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-md">
        <Card tone="raised" className="rounded-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-text">Schedule follow-up</h2>
              <p className="mt-1 text-sm text-text-muted">After {meetingTitle}</p>
            </div>
            <button type="button" onClick={onClose} className="btn-ghost h-9 px-3">
              Close
            </button>
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onSave({
                  title: effectiveTitle.trim(),
                  dueDate: effectiveDate,
                  dueTime: dueTime.trim() ? dueTime : null,
                });
                setTitle('');
                setDueDate('');
                setDueTime('');
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">Task</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder={defaultTitle ?? `Follow up: ${meetingTitle}`}
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text">Due date</label>
                <input
                  type="date"
                  value={dueDate || defaultDueDate || ''}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="input"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text">Time (optional)</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="input"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                Create follow-up
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
