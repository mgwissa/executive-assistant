import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  MARKET_SCAN_CHECKLIST,
  MARKET_SCAN_SOURCES,
  ROUTINE_ANTI_PATTERNS,
  ROUTINE_CADENCES,
  ROUTINE_WEEKDAYS,
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
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useWeeklyRoutineStore } from '../store/useWeeklyRoutineStore';
import { BookIcon, CheckSquareIcon, ClockIcon, SparklesIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { IconBadge } from './ui/IconBadge';
import { SectionHeader } from './ui/SectionHeader';

export function WeeklyRoutinePage() {
  const user = useAuthStore((s) => s.user);
  const profileTimezone = useProfileStore((s) => s.profile?.timezone);
  const timezone = profileTimezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const todayDate = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const todayWeekday = routineWeekdayFromLabel(formatInTimeZone(new Date(), timezone, 'EEEE'));
  const [selectedWeekday, setSelectedWeekday] = useState<RoutineWeekday>(todayWeekday);

  const weekDates = useMemo(() => routineWeekDatesFor(todayDate), [todayDate]);
  const selectedDate = weekDates[selectedWeekday];
  const selectedDay = getRoutineDay(selectedWeekday);
  const blocks = useMemo(() => getRoutineBlocksForWeekday(selectedWeekday), [selectedWeekday]);
  const rituals = useMemo(() => getRoutineRitualsForWeekday(selectedWeekday), [selectedWeekday]);
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
    void fetchRange(user.id, weekDates.monday, weekDates.friday);
  }, [user, weekDates.monday, weekDates.friday, fetchRange]);

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
    if (!user) return;
    void setItemStatus(user.id, selectedDate, itemId, status);
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
                A checklist version of the multi-hat product leader guide. V1 tracks progress;
                the model is ready for later task, calendar, and customization workflows.
              </p>
            </div>
          </div>
          <Card padded="sm" tone="sunken" className="min-w-[12rem]">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
              {routineDayLabel(selectedWeekday)} progress
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
        </header>

        <DayTabs
          selected={selectedWeekday}
          today={todayWeekday}
          dates={weekDates}
          onSelect={setSelectedWeekday}
        />

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <Card>
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Badge variant="purple">{selectedDay.primaryHat ?? 'Routine'}</Badge>
                  <h2 className="mt-2 text-xl font-semibold text-text">
                    {selectedDay.label} - {selectedDay.theme}
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">{selectedDay.summary}</p>
                </div>
                <p className="font-mono text-xs text-text-muted">{selectedDate}</p>
              </div>

              <SectionHeader
                title="Time blocks"
                count={blocks.length}
                accent="purple"
                icon={<ClockIcon className="h-4 w-4" />}
              />
              <div className="divide-y divide-border rounded-xl border border-border">
                {blocks.map((item) => (
                  <RoutineBlockRow
                    key={item.id}
                    item={item}
                    status={statusForItem(item.id)}
                    disabled={loading || !user}
                    onStatus={(status) => updateStatus(item.id, status)}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="Weekly rituals for this day"
                count={rituals.length}
                accent="brand"
                icon={<CheckSquareIcon className="h-4 w-4" />}
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
                      disabled={loading || !user}
                      onStatus={(status) => updateStatus(item.id, status)}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <aside className="space-y-6">
            <ReferenceCard
              title="Market scan checklist"
              icon={<SparklesIcon className="h-4 w-4" />}
              items={MARKET_SCAN_CHECKLIST}
            />
            <ReferenceCard title="Market sources" items={MARKET_SCAN_SOURCES} />
            <Card>
              <SectionHeader title="Cadences" accent="green" />
              <div className="space-y-4">
                {ROUTINE_CADENCES.map((cadence) => (
                  <div key={cadence.id}>
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
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <SectionHeader title="Anti-patterns" accent="amber" />
              <div className="space-y-3">
                {ROUTINE_ANTI_PATTERNS.map((item) => (
                  <div key={item.id} className="rounded-lg bg-surface-sunken p-3">
                    <p className="text-sm font-medium text-text">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.alternative}</p>
                  </div>
                ))}
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DayTabs({
  selected,
  today,
  dates,
  onSelect,
}: {
  selected: RoutineWeekday;
  today: RoutineWeekday;
  dates: Record<RoutineWeekday, string>;
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
            <span className="block text-sm font-semibold">{routineDayLabel(weekday)}</span>
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
  onStatus,
}: {
  item: RoutineTimeBlock;
  status: RoutineStatus;
  disabled: boolean;
  onStatus: (status: RoutineStatus) => void;
}) {
  return (
    <RoutineItemShell
      status={status}
      disabled={disabled}
      onStatus={onStatus}
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
  onStatus,
}: {
  item: RoutineRitual;
  status: RoutineStatus;
  disabled: boolean;
  onStatus: (status: RoutineStatus) => void;
}) {
  return (
    <RoutineItemShell
      status={status}
      disabled={disabled}
      onStatus={onStatus}
      leading={
        <div className="w-24 shrink-0 text-xs text-text-muted">
          {item.durationMinutes} min
        </div>
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
}: {
  status: RoutineStatus;
  disabled: boolean;
  leading: ReactNode;
  children: ReactNode;
  onStatus: (status: RoutineStatus) => void;
}) {
  const done = status === 'done';
  return (
    <div className={['flex gap-3 p-4', done ? 'bg-emerald-500/5' : ''].join(' ')}>
      <input
        type="checkbox"
        checked={done}
        disabled={disabled}
        onChange={(e) => onStatus(e.target.checked ? 'done' : 'pending')}
        className="mt-1 rounded border-border"
      />
      {leading}
      {children}
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
    </div>
  );
}

function ReferenceCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon?: ReactNode;
  items: string[];
}) {
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
