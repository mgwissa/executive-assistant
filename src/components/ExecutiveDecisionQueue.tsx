import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BriefingReport } from '../lib/assistantBriefing';
import { listDecisionInsights } from '../lib/decisionQueue';
import type { ActionItem } from '../lib/format';
import type { FocusQueuePrefs } from '../lib/focusQueue';
import { viewPath } from '../lib/routes';
import type { Note, Task } from '../types';
import { DecisionInsightCard } from './DecisionInsightCard';
import { ArrowRightIcon, BrainIcon } from './icons';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';

type ExecutiveDecisionQueueProps = {
  briefing: BriefingReport;
  todayIso: string;
  focusPrefs: FocusQueuePrefs;
  onFocusPrefsUpdate: (next: FocusQueuePrefs) => void;
  tasks: Task[];
  notes: Note[];
  actionItems: ActionItem[];
  dismissedIds: ReadonlySet<string>;
  onDismiss: (insightId: string) => void;
  onRefresh?: () => void;
};

export function ExecutiveDecisionQueue({
  briefing,
  todayIso,
  focusPrefs,
  onFocusPrefsUpdate,
  tasks,
  notes,
  actionItems,
  dismissedIds,
  onDismiss,
  onRefresh,
}: ExecutiveDecisionQueueProps) {
  const navigate = useNavigate();
  const items = useMemo(
    () => listDecisionInsights(briefing, dismissedIds),
    [briefing, dismissedIds],
  );

  if (items.length === 0) {
    return (
      <Card padded="sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
            Decisions needed
          </p>
          <Badge variant="subtle">0</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Nothing waiting on a call from you.
        </p>
      </Card>
    );
  }

  return (
    <Card padded="sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
          Decisions needed
        </p>
        <Badge variant="brand">{items.length}</Badge>
      </div>
      <ul className="mt-3 space-y-2.5">
        {items.map((insight) => (
          <DecisionInsightCard
            key={insight.id}
            insight={insight}
            todayIso={todayIso}
            focusPrefs={focusPrefs}
            onFocusPrefsUpdate={onFocusPrefsUpdate}
            tasks={tasks}
            notes={notes}
            actionItems={actionItems}
            onDismiss={() => onDismiss(insight.id)}
            onRefresh={onRefresh}
            variant="compact"
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => navigate(viewPath('assistant'))}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
      >
        <BrainIcon className="h-3.5 w-3.5" />
        Full briefing
        <ArrowRightIcon className="h-3 w-3" />
      </button>
    </Card>
  );
}
