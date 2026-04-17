import { useAuthStore } from '../store/useAuthStore';
import { useViewStore, type View } from '../store/useViewStore';
import {
  CalendarIcon,
  CheckSquareIcon,
  HomeIcon,
  LogOutIcon,
  NoteIcon,
  UserIcon,
} from './icons';
import { ThemeToggle } from './ThemeToggle';

type Item = {
  id: View;
  label: string;
  Icon: typeof HomeIcon;
};

const topItems: Item[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: HomeIcon },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { id: 'tasks', label: 'Todos', Icon: CheckSquareIcon },
  { id: 'notes', label: 'Notes', Icon: NoteIcon },
];

export function NavRail() {
  const { view, setView } = useViewStore();
  const { user, signOut } = useAuthStore();

  const renderItem = ({ id, label, Icon }: Item) => {
    const active = view === id;
    return (
      <button
        key={id}
        onClick={() => setView(id)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        className={[
          'flex h-10 w-10 items-center justify-center rounded-md transition-colors',
          active
            ? 'bg-white text-brand-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-brand-400 dark:ring-slate-700'
            : 'text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100',
        ].join(' ')}
      >
        <Icon className="h-5 w-5" />
      </button>
    );
  };

  return (
    <nav className="flex h-full w-14 flex-col items-center justify-between border-r border-slate-200 bg-slate-50 py-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-1">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
          <NoteIcon className="h-4 w-4" />
        </div>
        {topItems.map(renderItem)}
      </div>

      <div className="flex flex-col items-center gap-1">
        {renderItem({ id: 'profile', label: 'Profile', Icon: UserIcon })}
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
