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
  accent: 'brand' | 'blue' | 'purple' | 'amber' | 'green';
};

const items: Item[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: HomeIcon, accent: 'purple' },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon, accent: 'blue' },
  { id: 'tasks', label: 'Todos', Icon: CheckSquareIcon, accent: 'amber' },
  { id: 'notes', label: 'Notes', Icon: NoteIcon, accent: 'brand' },
  { id: 'profile', label: 'Profile', Icon: UserIcon, accent: 'green' },
];

export function SideNav() {
  const { view, setView } = useViewStore();
  const { user, signOut } = useAuthStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border-strong bg-nav">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
            <NoteIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-text">Notes</p>
            <p className="truncate text-xs text-text-muted">{user?.email ?? 'Your workspace'}</p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <nav className="px-2">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Navigation
        </p>
        <ul className="space-y-1">
          {items.map(({ id, label, Icon, accent }) => {
            const active = view === id;
            const accentClasses =
              accent === 'blue'
                ? {
                    tile: 'bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgb(59_130_246_/0.22),0_0_28px_rgb(59_130_246_/0.22)]',
                    tileIdle: 'bg-blue-500/8 text-blue-300/80',
                    dot: 'bg-blue-400',
                  }
                : accent === 'purple'
                  ? {
                      tile: 'bg-purple-500/15 text-purple-200 shadow-[0_0_0_1px_rgb(168_85_247_/0.22),0_0_28px_rgb(168_85_247_/0.22)]',
                      tileIdle: 'bg-purple-500/8 text-purple-300/80',
                      dot: 'bg-purple-400',
                    }
                  : accent === 'amber'
                    ? {
                        tile: 'bg-amber-500/15 text-amber-200 shadow-[0_0_0_1px_rgb(245_158_11_/0.22),0_0_28px_rgb(245_158_11_/0.18)]',
                        tileIdle: 'bg-amber-500/8 text-amber-300/80',
                        dot: 'bg-amber-400',
                      }
                    : accent === 'green'
                      ? {
                          tile: 'bg-emerald-500/15 text-emerald-200 shadow-[0_0_0_1px_rgb(16_185_129_/0.22),0_0_28px_rgb(16_185_129_/0.18)]',
                          tileIdle: 'bg-emerald-500/8 text-emerald-300/80',
                          dot: 'bg-emerald-400',
                        }
                      : {
                          tile: 'bg-brand-500/18 text-brand-200 shadow-[0_0_0_1px_rgb(99_102_241_/0.22),0_0_28px_rgb(99_102_241_/0.20)]',
                          tileIdle: 'bg-brand-500/10 text-brand-300/80',
                          dot: 'bg-brand-400',
                        };
            return (
              <li key={id}>
                <button
                  onClick={() => setView(id)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-ring',
                    active
                      ? 'bg-nav-raised text-text shadow-card ring-1 ring-border-strong'
                      : 'text-text-muted hover:bg-nav-raised hover:text-text',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-8 w-8 items-center justify-center rounded-md',
                      active
                        ? accentClasses.tile
                        : accentClasses.tileIdle,
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{label}</span>
                  {active && <span className={['ml-auto h-1.5 w-1.5 rounded-full', accentClasses.dot].join(' ')} />}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto px-3 py-3">
        <div className="divider mb-3" />
        <button
          onClick={() => signOut()}
          className="btn-ghost w-full justify-start px-3"
          title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
        >
          <LogOutIcon className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

