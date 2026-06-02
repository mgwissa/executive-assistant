import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveCalendarTimeZone } from '../lib/calendarWeek';
import { isOptionalFeatureEnabled } from '../lib/optionalFeatures';
import { viewPath } from '../lib/routes';
import { formatDueTimeDisplay } from '../lib/taskSchedule';
import {
  currentLocalHm,
  markNudgeShown,
  NUDGE_POLL_MS,
  NUDGE_SNOOZE_MS,
  snoozeNudge,
  tasksDueForNudge,
  todayIsoInTz,
} from '../lib/workNudges';
import { useProfileStore } from '../store/useProfileStore';
import { useTasksStore } from '../store/useTasksStore';
import { useToastStore } from '../store/useToastStore';
import type { Task } from '../types';

function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function showBrowserNudge(task: Task, body: string, onOpen: () => void): void {
  if (!browserNotificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`Time to start: ${task.title}`, {
      body,
      tag: `work-nudge-${task.id}`,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    // Safari / restricted contexts may throw.
  }
}

export function useWorkNudges() {
  const navigate = useNavigate();
  const profile = useProfileStore((s) => s.profile);
  const tasks = useTasksStore((s) => s.tasks);
  const toggleDone = useTasksStore((s) => s.toggleDone);
  const pushToast = useToastStore((s) => s.push);
  const dismissToast = useToastStore((s) => s.dismiss);
  const activeRef = useRef(new Set<string>());

  const inAppEnabled = profile?.notify_in_app_nudges_enabled ?? true;
  const browserEnabled = profile?.notify_browser_nudges_enabled ?? false;

  const openWork = useCallback(() => {
    const dest = isOptionalFeatureEnabled(profile, 'assistant')
      ? viewPath('dashboard')
      : viewPath('tasks');
    navigate(dest);
  }, [navigate, profile]);

  const finishNudge = useCallback(
    (taskId: string, todayIso: string, toastId?: string) => {
      markNudgeShown(taskId, todayIso);
      activeRef.current.delete(taskId);
      if (toastId) dismissToast(toastId);
    },
    [dismissToast],
  );

  const presentNudge = useCallback(
    (task: Task, todayIso: string) => {
      if (activeRef.current.has(task.id)) return;
      activeRef.current.add(task.id);

      const timeLabel = formatDueTimeDisplay(task.due_time);
      const body = timeLabel
        ? `Scheduled for ${timeLabel} — start now?`
        : 'This task is due now — start?';

      let toastId: string | undefined;

      if (inAppEnabled) {
        toastId = pushToast({
          id: `work-nudge-${task.id}`,
          title: task.title,
          body,
          onDismiss: () => finishNudge(task.id, todayIso),
          actions: [
            {
              label: 'Start',
              variant: 'primary',
              onClick: () => {
                finishNudge(task.id, todayIso, toastId);
                openWork();
              },
            },
            {
              label: 'Done',
              onClick: () => {
                void toggleDone(task.id, true);
                finishNudge(task.id, todayIso, toastId);
              },
            },
            {
              label: 'Snooze 15m',
              onClick: () => {
                snoozeNudge(task.id, Date.now() + NUDGE_SNOOZE_MS);
                activeRef.current.delete(task.id);
                if (toastId) dismissToast(toastId);
              },
            },
          ],
        });
      }

      const showBrowser = browserEnabled && (document.hidden || !inAppEnabled);
      if (showBrowser) {
        showBrowserNudge(task, body, () => {
          finishNudge(task.id, todayIso, toastId);
          openWork();
        });
        if (!inAppEnabled) {
          markNudgeShown(task.id, todayIso);
          activeRef.current.delete(task.id);
        }
      }
    },
    [
      inAppEnabled,
      browserEnabled,
      pushToast,
      finishNudge,
      openWork,
      toggleDone,
      dismissToast,
    ],
  );

  const scan = useCallback(() => {
    if (!profile) return;
    if (!inAppEnabled && !browserEnabled) return;

    const tz = resolveCalendarTimeZone(profile.timezone);
    const now = new Date();
    const todayIso = todayIsoInTz(now, tz);
    const localHm = currentLocalHm(now, tz);
    const due = tasksDueForNudge(tasks, todayIso, localHm);

    for (const task of due) {
      presentNudge(task, todayIso);
    }
  }, [profile, inAppEnabled, browserEnabled, tasks, presentNudge]);

  useEffect(() => {
    scan();
    const interval = window.setInterval(scan, NUDGE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [scan]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') scan();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [scan]);
}
