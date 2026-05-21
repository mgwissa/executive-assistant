import { useActiveView } from '../lib/routes';
import { useShellLayoutStore } from '../store/useShellLayoutStore';
import { MenuIcon } from './icons';

const titles: Record<string, string> = {
  dashboard: 'Dashboard',
  links: 'Links',
  calendar: 'Calendar',
  owed: 'Owed to me',
  tasks: 'Tasks',
  notes: 'Notes',
  profile: 'Profile',
  time: 'Time tracking',
  routine: 'Weekly routine',
};

const subtitles: Record<string, string> = {
  dashboard: 'Your daily command center.',
  notes: 'Browse notebooks in the sidebar; search filters the notes list there.',
  tasks: 'Your open work, sorted by priority.',
  calendar: 'Today, this week, and beyond.',
  owed: "Tasks you're waiting on from other people.",
  links: 'Quick-access bookmarks.',
  profile: 'Account, preferences, and notifications.',
  time: 'Where your hours are going.',
  routine: 'This week\u2019s rhythm.',
  assistant: 'Your morning briefing in full.',
};

export function TopBar() {
  const view = useActiveView();
  const title = titles[view] ?? 'Workspace';
  const subtitle = subtitles[view] ?? '';
  const openMobileNav = useShellLayoutStore((s) => s.openMobileNav);

  return (
    <header className="relative border-b border-border bg-surface/60 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={openMobileNav}
          className="btn-ghost tap-target -ml-1 shrink-0 p-0 md:hidden"
          aria-label="Open navigation menu"
          aria-controls="mobile-primary-nav"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-text sm:text-lg">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 hidden text-xs text-text-muted sm:block">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
