import { useActiveView } from '../lib/routes';
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
};

export function TopBar() {
  const view = useActiveView();
  const title = titles[view] ?? 'Workspace';

  return (
    <header className="relative border-b border-border bg-surface/60 px-6 py-4 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-text">{title}</h1>
          <p className="mt-0.5 text-xs text-text-muted">Your daily command center.</p>
        </div>
        <div className="w-full max-w-md">
          <div className="rounded-xl bg-surface-raised/60 p-1 ring-1 ring-border backdrop-blur">
            <SearchBar />
          </div>
        </div>
      </div>
    </header>
  );
}

