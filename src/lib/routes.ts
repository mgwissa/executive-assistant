import { useLocation } from 'react-router-dom';

export type View = 'dashboard' | 'calendar' | 'links' | 'notes' | 'owed' | 'tasks' | 'profile';

export const VIEW_PATHS: Record<View, string> = {
  dashboard: '/dashboard',
  calendar: '/calendar',
  links: '/links',
  owed: '/owed',
  tasks: '/tasks',
  notes: '/notes',
  profile: '/profile',
};

const PATH_TO_VIEW: Record<string, View> = {
  '/dashboard': 'dashboard',
  '/calendar': 'calendar',
  '/links': 'links',
  '/owed': 'owed',
  '/tasks': 'tasks',
  '/notes': 'notes',
  '/profile': 'profile',
};

export function viewPath(view: View): string {
  return VIEW_PATHS[view];
}

/** Map pathname to a shell view, or null for `/` or unrecognized paths. */
export function pathnameToView(pathname: string): View | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return null;
  return PATH_TO_VIEW[p] ?? null;
}

export function useActiveView(): View {
  const { pathname } = useLocation();
  return pathnameToView(pathname) ?? 'dashboard';
}
