import { useEffect, useMemo } from 'react';
import { EmailReviewView } from './EmailReviewView';
import { useAuthStore } from '../store/useAuthStore';
import { useEmailReviewStore } from '../store/useEmailReviewStore';
import { useProfileStore } from '../store/useProfileStore';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import type { EmailReviewCase, EmailReviewStatus } from '../lib/emailReview';

export function EmailReviewPage() {
  const userId = useAuthStore(s => s.user?.id);
  const timezone = resolveCalendarTimeZone(useProfileStore(s => s.profile?.timezone));
  const store = useEmailReviewStore();
  const fetchAll = store.fetchAll;
  useEffect(() => { if (userId) void fetchAll(userId); }, [userId, fetchAll]);
  // Stable callbacks keep history reads tied to actual case/version changes.
  const handlers = useMemo(() => ({
    onRefresh: () => { if (userId) void useEmailReviewStore.getState().fetchAll(userId); },
    onHistory: (id: string) => { if (userId) void useEmailReviewStore.getState().fetchHistory(userId, id); },
    onReview: (item: EmailReviewCase, status: EmailReviewStatus, note: string) => userId
      ? useEmailReviewStore.getState().review(userId, item, status, note) : Promise.resolve(null),
  }), [userId]);
  const owned = store.userId === userId;
  return <EmailReviewView {...store} {...handlers} timezone={timezone}
    cases={owned ? store.cases : []} latestIntake={owned ? store.latestIntake : null}
    checkpoint={owned ? store.checkpoint : null} history={owned ? store.history : {}}
    loading={!owned || store.loading} error={owned ? store.error : null} />;
}
