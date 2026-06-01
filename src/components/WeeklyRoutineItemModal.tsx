import { useEffect, useState } from 'react';
import {
  ROUTINE_WEEKDAYS,
  type RoutineAutomationTarget,
  type RoutineRitual,
  type RoutineTimeBlock,
  type RoutineWeekday,
} from '../lib/weeklyRoutineGuide';

const PRIMARY_HATS: NonNullable<RoutineTimeBlock['primaryHat']>[] = [
  'PO',
  'PM',
  'Project Manager',
  'Designer',
  'Market Watcher',
];

const AUTOMATION_TARGETS: RoutineAutomationTarget[] = ['none', 'task', 'calendar', 'both'];

type EditTarget =
  | { kind: 'block'; item: RoutineTimeBlock }
  | { kind: 'ritual'; item: RoutineRitual };

export function WeeklyRoutineItemModal({
  target,
  onClose,
  onSave,
}: {
  target: EditTarget;
  onClose: () => void;
  onSave: (item: RoutineTimeBlock | RoutineRitual) => void;
}) {
  const [draft, setDraft] = useState(target.item);

  useEffect(() => {
    setDraft(target.item);
  }, [target]);

  const isBlock = target.kind === 'block';
  const blockDraft = isBlock ? (draft as RoutineTimeBlock) : null;
  const ritualDraft = !isBlock ? (draft as RoutineRitual) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-text">
          {isBlock ? 'Edit time block' : 'Edit ritual'}
        </h2>

        <div className="mt-4 space-y-4">
          <Field label="Title">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="input"
            />
          </Field>

          {isBlock && blockDraft ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <input
                    type="time"
                    value={blockDraft.startTime}
                    onChange={(e) =>
                      setDraft({ ...blockDraft, startTime: e.target.value })
                    }
                    className="input"
                  />
                </Field>
                <Field label="End">
                  <input
                    type="time"
                    value={blockDraft.endTime}
                    onChange={(e) =>
                      setDraft({ ...blockDraft, endTime: e.target.value })
                    }
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  value={blockDraft.description}
                  onChange={(e) =>
                    setDraft({ ...blockDraft, description: e.target.value })
                  }
                  rows={3}
                  className="input"
                />
              </Field>
              <Field label="Why (optional)">
                <textarea
                  value={blockDraft.why ?? ''}
                  onChange={(e) =>
                    setDraft({ ...blockDraft, why: e.target.value || undefined })
                  }
                  rows={2}
                  className="input"
                />
              </Field>
              <Field label="Primary hat">
                <select
                  value={blockDraft.primaryHat ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...blockDraft,
                      primaryHat: (e.target.value || undefined) as RoutineTimeBlock['primaryHat'],
                    })
                  }
                  className="input"
                >
                  <option value="">None</option>
                  {PRIMARY_HATS.map((hat) => (
                    <option key={hat} value={hat}>
                      {hat}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : ritualDraft ? (
            <>
              <Field label="Duration (minutes)">
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={ritualDraft.durationMinutes}
                  onChange={(e) =>
                    setDraft({
                      ...ritualDraft,
                      durationMinutes: Number(e.target.value) || 30,
                    })
                  }
                  className="input"
                />
              </Field>
              <Field label="Output">
                <textarea
                  value={ritualDraft.output}
                  onChange={(e) =>
                    setDraft({ ...ritualDraft, output: e.target.value })
                  }
                  rows={3}
                  className="input"
                />
              </Field>
              <Field label="Days">
                <div className="flex flex-wrap gap-2">
                  {ROUTINE_WEEKDAYS.map((day) => {
                    const checked = ritualDraft.days.includes(day);
                    return (
                      <label
                        key={day}
                        className={[
                          'cursor-pointer rounded-lg border px-3 py-1.5 text-xs capitalize',
                          checked
                            ? 'border-brand-500 bg-brand-500/10 text-text'
                            : 'border-border text-text-muted',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          className="sr-only"
                          onChange={() => {
                            const nextDays = checked
                              ? ritualDraft.days.filter((d) => d !== day)
                              : [...ritualDraft.days, day];
                            setDraft({ ...ritualDraft, days: nextDays.length ? nextDays : [day] });
                          }}
                        />
                        {day.slice(0, 3)}
                      </label>
                    );
                  })}
                </div>
              </Field>
            </>
          ) : null}

          <Field label="Automation">
            <select
              value={draft.automation.target}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  automation: {
                    ...draft.automation,
                    target: e.target.value as RoutineAutomationTarget,
                  },
                })
              }
              className="input"
            >
              {AUTOMATION_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {automationLabel(t)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={!draft.title.trim()}
            className="btn-primary"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function automationLabel(target: RoutineAutomationTarget): string {
  if (target === 'both') return 'Task + calendar';
  if (target === 'calendar') return 'Calendar';
  if (target === 'task') return 'Task';
  return 'Checklist only';
}

export type { EditTarget, RoutineWeekday };
