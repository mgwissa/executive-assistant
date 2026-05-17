import { useActiveView } from '../lib/routes';
import { useShellLayoutStore } from '../store/useShellLayoutStore';
import { MenuIcon } from './icons';
import { SearchBar } from './SearchBar';

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

export function TopBar() {
  const view = useActiveView();
  const title = titles[view] ?? 'Workspace';
  const notesContext = view === 'notes';
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
          <p className="mt-0.5 hidden text-xs text-text-muted sm:block">
            {notesContext
              ? 'Browse notebooks in the sidebar; search filters the notes list there.'
              : 'Your daily command center.'}
          </p>
        </div>

        {/* Search lives in the notes sidebar in notes context. On phones, hide it
            in the top bar to leave room for the title; users can scroll into
            page content where each page provides its own controls. */}
        {!notesContext ? (
          <div className="hidden w-full max-w-md sm:block">
            <div className="rounded-xl bg-surface-raised/60 p-1 ring-1 ring-border backdrop-blur">
              <SearchBar />
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
