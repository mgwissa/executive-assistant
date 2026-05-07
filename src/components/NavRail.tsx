import { useNavigate } from 'react-router-dom';
import { buildSideNavItems, type NavItemDef } from '../lib/optionalFeatures';
import { viewPath, useActiveView } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { LogOutIcon, NoteIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

type Item = NavItemDef;

export function NavRail() {
  const view = useActiveView();
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const optionalFeatures = useProfileStore((s) => s.profile?.enabled_addons);
  const full = buildSideNavItems(optionalFeatures);
  const profileEntry = full[full.length - 1];
  const topItems: Item[] = full.slice(0, -1) as Item[];

  const renderItem = ({ id, label, Icon }: Item) => {
    const active = view === id;
    return (
      <button
        key={id}
        onClick={() => navigate(viewPath(id))}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={[
          'flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-ring',
          active
            ? 'bg-surface-raised text-brand-700 shadow-card ring-1 ring-border'
            : 'text-text-subtle hover:bg-surface-raised hover:text-text',
        ].join(' ')}
      >
        <Icon className="h-5 w-5" />
      </button>
    );
  };

  return (
    <nav className="flex h-full w-14 flex-col items-center justify-between border-r border-border-strong bg-surface-sunken py-3">
      <div className="flex flex-col items-center gap-1">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white shadow-card">
          <NoteIcon className="h-4 w-4" />
        </div>
        {topItems.map(renderItem)}
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="divider my-2 w-8" />
        {renderItem(profileEntry)}
        <ThemeToggle />
        <button
          onClick={() => signOut()}
          className="btn-ghost h-8 w-8 p-0"
          aria-label="Sign out"
          title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
        >
          <LogOutIcon className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
