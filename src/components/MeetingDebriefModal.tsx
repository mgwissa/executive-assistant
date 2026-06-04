import { useEffect, useState } from 'react';
import { Card } from './ui/Card';

type MeetingDebriefModalProps = {
  open: boolean;
  meetingTitle: string;
  /** Pre-fill outcomes textarea (e.g. from linked meeting note). */
  initialNotes?: string;
  onClose: () => void;
  onSave: (payload: { taskTitles: string[]; notes: string }) => Promise<void>;
  onScheduleFollowUp?: () => void;
};

export function MeetingDebriefModal({
  open,
  meetingTitle,
  initialNotes = '',
  onClose,
  onSave,
  onScheduleFollowUp,
}: MeetingDebriefModalProps) {
  const [taskLines, setTaskLines] = useState<string[]>(['']);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNotes(initialNotes);
  }, [open, initialNotes]);

  if (!open) return null;

  const reset = () => {
    setTaskLines(['']);
    setNotes('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg">
        <Card tone="raised" className="rounded-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-text">Meeting debrief</h2>
              <p className="mt-1 text-sm text-text-muted">{meetingTitle}</p>
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
                  taskTitles: taskLines.map((t) => t.trim()).filter(Boolean),
                  notes: notes.trim(),
                });
                reset();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text">Follow-up tasks</label>
              {taskLines.map((line, i) => (
                <input
                  key={i}
                  value={line}
                  onChange={(e) =>
                    setTaskLines((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  className="input"
                  placeholder={i === 0 ? 'Send recap to team' : 'Another follow-up'}
                  maxLength={200}
                  autoFocus={i === 0}
                />
              ))}
              {taskLines.length < 5 && (
                <button
                  type="button"
                  className="btn-ghost py-1.5 text-xs"
                  onClick={() => setTaskLines((prev) => [...prev, ''])}
                >
                  + Add another task
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text">Outcomes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input min-h-[5rem] resize-y"
                placeholder="Decisions, owners, next steps…"
                maxLength={2000}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              {onScheduleFollowUp && (
                <button
                  type="button"
                  className="btn-ghost mr-auto"
                  onClick={() => {
                    onScheduleFollowUp();
                    reset();
                  }}
                  disabled={busy}
                >
                  Schedule follow-up instead
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                Save debrief
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
