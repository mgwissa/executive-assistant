import { ToastHost } from './ToastHost';
import { useWorkNudges } from '../hooks/useWorkNudges';

/** Polls for due-time tasks and surfaces in-app toasts + optional browser notifications. */
export function WorkNudgeHost() {
  useWorkNudges();
  return <ToastHost />;
}
