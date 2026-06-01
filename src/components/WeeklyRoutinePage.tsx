import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ROUTINE_WEEKDAYS,
  type RoutineAntiPattern,
  type RoutineCadence,
  type RoutineDay,
  type RoutineRitual,
  type RoutineTimeBlock,
  type RoutineWeekday,
} from '../lib/weeklyRoutineGuide';
import {
  getRoutineBlocksForWeekday,
  getRoutineDay,
  getRoutineRitualsForWeekday,
  routineDayLabel,
  routineProgress,
  routineWeekDatesFor,
  routineWeekdayFromLabel,
  type RoutineChecklistItem,
  type RoutineStatus,
} from '../lib/weeklyRoutine';
import {
  createEmptyRitual,
  createEmptyTimeBlock,
  isDefaultGuideTemplate,
  resolveWeeklyRoutineTemplate,
  routineTemplateVersion,
  templateForSave,
  type WeeklyRoutineTemplate,
} from '../lib/weeklyRoutineTemplate';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useWeeklyRoutineStore } from '../store/useWeeklyRoutineStore';
import type { Json } from '../types/database';
import { BookIcon, CheckSquareIcon, ClockIcon, PencilIcon, SparklesIcon, TrashIcon } from './icons';
import { WeeklyRoutineItemModal, type EditTarget } from './WeeklyRoutineItemModal';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';

export function WeeklyRoutinePage() {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const profileSaving = useProfileStore((s) => s.saving);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const profileTimezone = profile?.timezone;
  const timezone = profileTimezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const todayDate = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const todayWeekday = routineWeekdayFromLabel(formatInTimeZone(new Date(), timezone, 'EEEE'));
  const [selectedWeekday, setSelectedWeekday] = useState<RoutineWeekday>(todayWeekday);
  const [editing, setEditing] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState<WeeklyRoutineTemplate | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const savedTemplate = useMemo(
    () => resolveWeeklyRoutineTemplate(profile?.weekly_routine),
    [profile?.weekly_routine],
  );
  const activeTemplate = editing && draftTemplate ? draftTemplate : savedTemplate;
  const templateVersion = routineTemplateVersion(activeTemplate);
  const usingDefaultGuide = isDefaultGuideTemplate(savedTemplate) && profile?.weekly_routine == null;

  const weekDates = useMemo(() => routineWeekDatesFor(todayDate), [todayDate]);
  const selectedDate = weekDates[selectedWeekday];
  const selectedDay = getRoutineDay(selectedWeekday, activeTemplate);
  const blocks = useMemo(
    () => getRoutineBlocksForWeekday(selectedWeekday, activeTemplate),
    [selectedWeekday, activeTemplate],
  );
  const rituals = useMemo(
    () => getRoutineRitualsForWeekday(selectedWeekday, activeTemplate),
    [selectedWeekday, activeTemplate],
  );
  const allChecklistItems = useMemo<RoutineChecklistItem[]>(
    () => [...blocks, ...rituals],
    [blocks, rituals],
  );

  const states = useWeeklyRoutineStore((s) => s.states);
  const loading = useWeeklyRoutineStore((s) => s.loading);
  const error = useWeeklyRoutineStore((s) => s.error);
  const fetchRange = useWeeklyRoutineStore((s) => s.fetchRange);
  const setItemStatus = useWeeklyRoutineStore((s) => s.setItemStatus);

  useEffect(() => {
    if (!user) return;
    void fetchRange(user.id, weekDates.monday, weekDates.friday, templateVersion);
  }, [user, weekDates.monday, weekDates.friday, templateVersion, fetchRange]);

  const statusByItem = useMemo(() => {
    const map = new Map<string, RoutineStatus>();
    for (const row of states) {
      if (row.routine_date === selectedDate) {
        map.set(row.item_id, statusFromDb(row.status));
      }
    }
    return map;
  }, [states, selectedDate]);

  const statusForItem = (itemId: string): RoutineStatus => statusByItem.get(itemId) ?? 'pending';
  const progress = routineProgress(allChecklistItems, statusForItem);

  const updateStatus = (itemId: string, status: RoutineStatus) => {
    if (!user || editing) return;
    void setItemStatus(user.id, selectedDate, itemId, status, templateVersion);
  };

  const startEditing = () => {
    setDraftTemplate(structuredClone(savedTemplate));
    setEditing(true);
    setSaveMessage(null);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraftTemplate(null);
    setEditTarget(null);
    setSaveMessage(null);
  };

  const saveTemplate = async () => {
    if (!user || !draftTemplate) return;
    setSaveMessage(null);
    const payload = templateForSave(draftTemplate);
    await updateProfile(user.id, { weekly_routine: payload as unknown as Json });
    setEditing(false);
    setDraftTemplate(null);
    setSaveMessage('Routine saved.');
    setTimeout(() => setSaveMessage(null), 2500);
  };

  const resetToDefault = async () => {
    if (!user) return;
    if (!window.confirm('Reset to the built-in product-leader guide? Your custom routine will be removed.')) {
      return;
    }
    setSaveMessage(null);
    await updateProfile(user.id, { weekly_routine: null });
    cancelEditing();
    setSaveMessage('Restored default routine.');
    setTimeout(() => setSaveMessage(null), 2500);
  };

  const patchDraft = useCallback((updater: (prev: WeeklyRoutineTemplate) => WeeklyRoutineTemplate) => {
    setDraftTemplate((prev) => (prev ? updater(prev) : prev));
  }, []);

  const updateDay = (weekday: RoutineWeekday, patch: Partial<RoutineDay>) => {
    patchDraft((prev) => ({
      ...prev,
      days: prev.days.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    }));
  };

  const addBlock = () => {
    patchDraft((prev) => {
      const maxOrder = prev.timeBlocks
        .filter((b) => b.weekday === selectedWeekday)
        .reduce((max, b) => Math.max(max, b.sortOrder), 0);
      return {
        ...prev,
        timeBlocks: [...prev.timeBlocks, createEmptyTimeBlock(selectedWeekday, maxOrder + 10)],
      };
    });
  };

  const addRitual = () => {
    patchDraft((prev) => {
      const maxOrder = prev.rituals.reduce((max, r) => Math.max(max, r.sortOrder), 0);
      return {
        ...prev,
        rituals: [...prev.rituals, createEmptyRitual(selectedWeekday, maxOrder + 10)],
      };
    });
  };

  const deleteBlock = (id: string) => {
    patchDraft((prev) => ({
      ...prev,
      timeBlocks: prev.timeBlocks.filter((b) => b.id !== id),
    }));
  };

  const deleteRitual = (id: string) => {
    patchDraft((prev) => ({
      ...prev,
      rituals: prev.rituals.filter((r) => r.id !== id),
    }));
  };

  const applyItemEdit = (item: RoutineTimeBlock | RoutineRitual) => {
    patchDraft((prev) => {
      if (item.kind === 'time-block') {
        return {
          ...prev,
          timeBlocks: prev.timeBlocks.map((b) => (b.id === item.id ? item : b)),
        };
      }
      return {
        ...prev,
        rituals: prev.rituals.map((r) => (r.id === item.id ? item : r)),
      };
    });
    setEditTarget(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <IconBadge size="lg" tone="purple" className="rounded-2xl">
              <BookIcon className="h-6 w-6" />
            </IconBadge>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-text">
                Weekly operating rhythm
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                Your weekly checklist — time blocks, rituals, cadences, and reference notes.
                {usingDefaultGuide ? ' Using the built-in product-leader guide.' : ' Custom routine.'}
              </p>
              {saveMessage ? (
                <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                  {saveMessage}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void saveTemplate()}
                    disabled={profileSaving}
                    className="btn-primary py-2 text-sm"
                  >
                    {profileSaving ? 'Saving…' : 'Save routine'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={profileSaving}
                    className="btn-secondary py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetToDefault()}
                    disabled={profileSaving}
                    className="btn-ghost py-2 text-sm text-text-muted"
                  >
                    Reset to default
                  </button>
                </>
              ) : (
                <button type="button" onClick={startEditing} className="btn-secondary py-2 text-sm">
                  Edit routine
                </button>
              )}
            </div>
            <Card padded="sm" tone="sunken" className="min-w-[12rem]">
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {routineDayLabel(selectedWeekday, activeTemplate)} progress
              </p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-semibold text-text">{progress.percent}%</span>
                <span className="pb-1 text-sm text-text-muted">
                  {progress.done}/{progress.total} done
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </Card>
          </div>
        </header>

        <DayTabs
          selected={selectedWeekday}
          today={todayWeekday}
          dates={weekDates}
          template={activeTemplate}
          onSelect={setSelectedWeekday}
        />

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {editing ? (
          <p className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/5 px-4 py-2 text-sm text-text-muted">
            Edit mode — checklist progress is paused until you save or cancel.
          </p>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Card>
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                {editing ? (
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label="Day theme">
                      <input
                        type="text"
                        value={selectedDay.theme}
                        onChange={(e) => updateDay(selectedWeekday, { theme: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Summary">
                      <textarea
                        value={selectedDay.summary}
                        onChange={(e) => updateDay(selectedWeekday, { summary: e.target.value })}
                        rows={2}
                        className="input"
                      />
                    </Field>
                    <Field label="Primary hat">
                      <select
                        value={selectedDay.primaryHat ?? ''}
                        onChange={(e) =>
                          updateDay(selectedWeekday, {
                            primaryHat: (e.target.value || undefined) as RoutineDay['primaryHat'],
                          })
                        }
                        className="input"
                      >
                        <option value="">None</option>
                        {(['PO', 'PM', 'Project Manager', 'Designer', 'Market Watcher'] as const).map(
                          (hat) => (
                            <option key={hat} value={hat}>
                              {hat}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  </div>
                ) : (
                  <div>
                    <Badge variant="purple">{selectedDay.primaryHat ?? 'Routine'}</Badge>
                    <h2 className="mt-2 text-xl font-semibold text-text">
                      {selectedDay.label} - {selectedDay.theme}
                    </h2>
                    <p className="mt-1 text-sm text-text-muted">{selectedDay.summary}</p>
                  </div>
                )}
                <p className="font-mono text-xs text-text-muted">{selectedDate}</p>
              </div>

              <SectionHeader
                title="Time blocks"
                count={blocks.length}
                accent="purple"
                icon={<ClockIcon className="h-4 w-4" />}
                action={
                  editing ? (
                    <button type="button" onClick={addBlock} className="text-xs font-medium text-brand-700">
                      + Add block
                    </button>
                  ) : undefined
                }
              />
              <div className="divide-y divide-border rounded-xl border border-border">
                {blocks.length === 0 ? (
                  <p className="p-4 text-sm text-text-muted">No time blocks for this day.</p>
                ) : (
                  blocks.map((item) => (
                    <RoutineBlockRow
                      key={item.id}
                      item={item}
                      status={statusForItem(item.id)}
                      disabled={loading || !user || editing}
                      editing={editing}
                      onStatus={(status) => updateStatus(item.id, status)}
                      onEdit={() => setEditTarget({ kind: 'block', item })}
                      onDelete={() => deleteBlock(item.id)}
                    />
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="Weekly rituals for this day"
                count={rituals.length}
                accent="brand"
                icon={<CheckSquareIcon className="h-4 w-4" />}
                action={
                  editing ? (
                    <button type="button" onClick={addRitual} className="text-xs font-medium text-brand-700">
                      + Add ritual
                    </button>
                  ) : undefined
                }
              />
              {rituals.length === 0 ? (
                <p className="text-sm text-text-muted">No recurring rituals are assigned to this day.</p>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border">
                  {rituals.map((item) => (
                    <RitualRow
                      key={item.id}
                      item={item}
                      status={statusForItem(item.id)}
                      disabled={loading || !user || editing}
                      editing={editing}
                      onStatus={(status) => updateStatus(item.id, status)}
                      onEdit={() => setEditTarget({ kind: 'ritual', item })}
                      onDelete={() => deleteRitual(item.id)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <aside className="space-y-6">
            <EditableReferenceCard
              title="Market scan checklist"
              icon={<SparklesIcon className="h-4 w-4" />}
              items={activeTemplate.marketScanChecklist}
              editing={editing}
              onChange={(items) =>
                patchDraft((prev) => ({ ...prev, marketScanChecklist: items }))
              }
            />
            <EditableReferenceCard
              title="Market sources"
              items={activeTemplate.marketScanSources}
              editing={editing}
              onChange={(items) => patchDraft((prev) => ({ ...prev, marketScanSources: items }))}
            />
            <CadencesEditor
              cadences={activeTemplate.cadences}
              editing={editing}
              onChange={(cadences) => patchDraft((prev) => ({ ...prev, cadences }))}
            />
            <AntiPatternsEditor
              items={activeTemplate.antiPatterns}
              editing={editing}
              onChange={(antiPatterns) => patchDraft((prev) => ({ ...prev, antiPatterns }))}
            />
          </aside>
        </div>
      </div>

      {editTarget ? (
        <WeeklyRoutineItemModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={applyItemEdit}
        />
      ) : null}
    </div>
  );
}

function DayTabs({
  selected,
  today,
  dates,
  template,
  onSelect,
}: {
  selected: RoutineWeekday;
  today: RoutineWeekday;
  dates: Record<RoutineWeekday, string>;
  template: WeeklyRoutineTemplate;
  onSelect: (weekday: RoutineWeekday) => void;
}) {
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {ROUTINE_WEEKDAYS.map((weekday) => {
        const active = selected === weekday;
        return (
          <button
            key={weekday}
            type="button"
            onClick={() => onSelect(weekday)}
            className={[
              'min-w-[9rem] rounded-xl border px-4 py-3 text-left transition-colors focus-ring',
              active
                ? 'border-brand-500 bg-brand-500/10 text-text shadow-card'
                : 'border-border bg-surface-raised/60 text-text-muted hover:bg-surface-raised hover:text-text',
            ].join(' ')}
          >
            <span className="block text-sm font-semibold">{routineDayLabel(weekday, template)}</span>
            <span className="mt-0.5 block font-mono text-xs">{dates[weekday]}</span>
            {today === weekday ? <Badge className="mt-2">Today</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}

function RoutineBlockRow({
  item,
  status,
  disabled,
  editing,
  onStatus,
  onEdit,
  onDelete,
}: {
  item: RoutineTimeBlock;
  status: RoutineStatus;
  disabled: boolean;
  editing: boolean;
  onStatus: (status: RoutineStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <RoutineItemShell
      status={status}
      disabled={disabled}
      onStatus={onStatus}
      editing={editing}
      onEdit={onEdit}
      onDelete={onDelete}
      leading={
        <div className="w-24 shrink-0 font-mono text-xs text-text-muted">
          {formatRoutineTime(item.startTime)}-{formatRoutineTime(item.endTime)}
        </div>
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-text">{item.title}</p>
          {item.primaryHat ? <Badge variant="purple">{item.primaryHat}</Badge> : null}
          {item.automation.target !== 'none' ? (
            <Badge variant="blue">{automationLabel(item.automation.target)}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-text-muted">{item.description}</p>
        {item.why ? <p className="mt-1 text-xs text-text-subtle">{item.why}</p> : null}
      </div>
    </RoutineItemShell>
  );
}

function RitualRow({
  item,
  status,
  disabled,
  editing,
  onStatus,
  onEdit,
  onDelete,
}: {
  item: RoutineRitual;
  status: RoutineStatus;
  disabled: boolean;
  editing: boolean;
  onStatus: (status: RoutineStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <RoutineItemShell
      status={status}
      disabled={disabled}
      onStatus={onStatus}
      editing={editing}
      onEdit={onEdit}
      onDelete={onDelete}
      leading={
        <div className="w-24 shrink-0 text-xs text-text-muted">{item.durationMinutes} min</div>
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-text">{item.title}</p>
          <Badge variant="brand">{automationLabel(item.automation.target)}</Badge>
        </div>
        <p className="mt-1 text-sm text-text-muted">{item.output}</p>
      </div>
    </RoutineItemShell>
  );
}

function RoutineItemShell({
  status,
  disabled,
  leading,
  children,
  onStatus,
  editing,
  onEdit,
  onDelete,
}: {
  status: RoutineStatus;
  disabled: boolean;
  leading: ReactNode;
  children: ReactNode;
  onStatus: (status: RoutineStatus) => void;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const done = status === 'done';
  return (
    <div className={['flex gap-3 p-4', done ? 'bg-emerald-500/5' : ''].join(' ')}>
      {!editing ? (
        <input
          type="checkbox"
          checked={done}
          disabled={disabled}
          onChange={(e) => onStatus(e.target.checked ? 'done' : 'pending')}
          className="mt-1 rounded border-border"
        />
      ) : (
        <div className="mt-1 w-4 shrink-0" />
      )}
      {leading}
      {children}
      {editing ? (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-2 text-text-muted hover:bg-surface-raised hover:text-text focus-ring"
            aria-label="Edit"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md p-2 text-text-muted hover:bg-red-500/10 hover:text-red-600 focus-ring dark:hover:text-red-300"
            aria-label="Delete"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onStatus(status === 'skipped' ? 'pending' : 'skipped')}
          className={[
            'h-8 shrink-0 rounded-md px-2 text-xs transition-colors focus-ring',
            status === 'skipped'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-200'
              : 'text-text-muted hover:bg-surface-raised hover:text-text',
          ].join(' ')}
        >
          {status === 'skipped' ? 'Skipped' : 'Skip'}
        </button>
      )}
    </div>
  );
}

function EditableReferenceCard({
  title,
  icon,
  items,
  editing,
  onChange,
}: {
  title: string;
  icon?: ReactNode;
  items: string[];
  editing: boolean;
  onChange: (items: string[]) => void;
}) {
  if (editing) {
    return (
      <Card>
        <SectionHeader title={title} icon={icon} accent="blue" />
        <textarea
          value={items.join('\n')}
          onChange={(e) =>
            onChange(
              e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
          rows={Math.max(4, items.length + 1)}
          className="input font-mono text-xs"
          placeholder="One item per line"
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader title={title} icon={icon} accent="blue" />
      <ul className="space-y-2 text-sm text-text-muted">
        {items.map((item) => (
          <li key={item} className="leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CadencesEditor({
  cadences,
  editing,
  onChange,
}: {
  cadences: RoutineCadence[];
  editing: boolean;
  onChange: (cadences: RoutineCadence[]) => void;
}) {
  const updateCadence = (id: string, patch: Partial<RoutineCadence>) => {
    onChange(cadences.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCadence = () => {
    onChange([
      ...cadences,
      {
        id: `cadence-${crypto.randomUUID().slice(0, 8)}`,
        title: 'New cadence',
        cadence: 'monthly',
        items: [''],
      },
    ]);
  };

  const deleteCadence = (id: string) => {
    onChange(cadences.filter((c) => c.id !== id));
  };

  return (
    <Card>
      <SectionHeader
        title="Cadences"
        accent="green"
        action={
          editing ? (
            <button type="button" onClick={addCadence} className="text-xs font-medium text-brand-700">
              + Add
            </button>
          ) : undefined
        }
      />
      <div className="space-y-4">
        {cadences.map((cadence) => (
          <div key={cadence.id}>
            {editing ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cadence.title}
                    onChange={(e) => updateCadence(cadence.id, { title: e.target.value })}
                    className="input flex-1 text-sm"
                  />
                  <select
                    value={cadence.cadence}
                    onChange={(e) =>
                      updateCadence(cadence.id, {
                        cadence: e.target.value as RoutineCadence['cadence'],
                      })
                    }
                    className="input w-28 text-sm"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => deleteCadence(cadence.id)}
                    className="rounded-md p-2 text-text-muted hover:text-red-600"
                    aria-label="Delete cadence"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={cadence.items.join('\n')}
                  onChange={(e) =>
                    updateCadence(cadence.id, {
                      items: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean),
                    })
                  }
                  rows={3}
                  className="input text-xs"
                  placeholder="One item per line"
                />
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text">{cadence.title}</h3>
                  <Badge variant="green">{cadence.cadence}</Badge>
                </div>
                <ul className="space-y-2 text-sm text-text-muted">
                  {cadence.items.map((item) => (
                    <li key={item} className="leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AntiPatternsEditor({
  items,
  editing,
  onChange,
}: {
  items: RoutineAntiPattern[];
  editing: boolean;
  onChange: (items: RoutineAntiPattern[]) => void;
}) {
  const updateItem = (id: string, patch: Partial<RoutineAntiPattern>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([
      ...items,
      {
        id: `anti-${crypto.randomUUID().slice(0, 8)}`,
        title: 'New anti-pattern',
        alternative: '',
      },
    ]);
  };

  const deleteItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <Card>
      <SectionHeader
        title="Anti-patterns"
        accent="amber"
        action={
          editing ? (
            <button type="button" onClick={addItem} className="text-xs font-medium text-brand-700">
              + Add
            </button>
          ) : undefined
        }
      />
      <div className="space-y-3">
        {items.map((item) =>
          editing ? (
            <div key={item.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={item.title}
                  onChange={(e) => updateItem(item.id, { title: e.target.value })}
                  className="input flex-1 text-sm"
                  placeholder="Anti-pattern"
                />
                <button
                  type="button"
                  onClick={() => deleteItem(item.id)}
                  className="rounded-md p-2 text-text-muted hover:text-red-600"
                  aria-label="Delete"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={item.alternative}
                onChange={(e) => updateItem(item.id, { alternative: e.target.value })}
                rows={2}
                className="input text-xs"
                placeholder="Better alternative"
              />
            </div>
          ) : (
            <div key={item.id} className="rounded-lg bg-surface-sunken p-3">
              <p className="text-sm font-medium text-text">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.alternative}</p>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function statusFromDb(status: string): RoutineStatus {
  if (status === 'done' || status === 'skipped') return status;
  return 'pending';
}

function formatRoutineTime(value: string): string {
  const [hourRaw, minute] = value.split(':');
  const hour = Number(hourRaw);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function automationLabel(target: string): string {
  if (target === 'both') return 'Task + calendar ready';
  if (target === 'calendar') return 'Calendar ready';
  if (target === 'task') return 'Task ready';
  return 'Checklist';
}
