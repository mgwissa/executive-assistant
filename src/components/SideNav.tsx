import { useNavigate } from 'react-router-dom';
import { buildSideNavItems } from '../lib/optionalFeatures';
import { viewPath, useActiveView } from '../lib/routes';
import { useAuthStore } from '../store/useAuthStore';
import { useProfileStore } from '../store/useProfileStore';
import { useShellLayoutStore } from '../store/useShellLayoutStore';
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon, NoteIcon, XIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

/**
 * Primary navigation.
 *
 * - On desktop (md+) it is the persistent left rail with two flavours:
 *   collapsed (icon-only) and expanded (icons + labels). State is persisted.
 * - On mobile (<md) the parent (Shell) renders this in `mobile` mode as a
 *   slide-out drawer; tapping a nav item also closes the drawer.
 */
export function SideNav({ mobile = false }: { mobile?: boolean } = {}) {
  const view = useActiveView();
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const optionalFeatures = useProfileStore((s) => s.profile?.enabled_addons);
  const items = buildSideNavItems(optionalFeatures);
  const sideNavCollapsed = useShellLayoutStore((s) => s.sideNavCollapsed);
  const toggleSideNav = useShellLayoutStore((s) => s.toggleSideNav);
  const closeMobileNav = useShellLayoutStore((s) => s.closeMobileNav);

  const goTo = (id: string) => {
    navigate(viewPath(id as Parameters<typeof viewPath>[0]));
    if (mobile) closeMobileNav();
  };

  // Mobile drawer: always use the wide-label layout (a phone with an open
  // drawer has plenty of width for full labels) and add the safe-area paddings.
  if (mobile) {
    return (
      <aside
        className="pt-safe pb-safe flex h-full w-[18rem] max-w-[85vw] shrink-0 flex-col border-r border-border-strong bg-nav"
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border-strong px-3 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
              <NoteIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-text">Notes</p>
              <p className="truncate text-xs text-text-muted">{user?.email ?? 'Your workspace'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={closeMobileNav}
              className="btn-ghost tap-target shrink-0 p-0"
              title="Close menu"
              aria-label="Close navigation"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pt-2" aria-label="Primary">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
            Navigation
          </p>
          <ul className="space-y-1">
            {items.map(({ id, label, Icon, accent }) => {
              const active = view === id;
              const a = accentClassesFor(accent);
              return (
                <li key={id}>
                  <button
                    onClick={() => goTo(id)}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors focus-ring',
                      active
                        ? 'bg-nav-raised text-text shadow-card ring-1 ring-border-strong'
                        : 'text-text-muted hover:bg-nav-raised hover:text-text',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-9 w-9 items-center justify-center rounded-md',
                        active ? a.tile : a.tileIdle,
                      ].join(' ')}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="truncate">{label}</span>
                    {active && <span className={['ml-auto h-1.5 w-1.5 rounded-full', a.dot].join(' ')} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto border-t border-border-strong px-3 py-3">
          <button
            onClick={() => {
              signOut();
              closeMobileNav();
            }}
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

  if (sideNavCollapsed) {
    return (
      <aside className="flex h-full w-[4.25rem] shrink-0 flex-col border-r border-border-strong bg-nav">
        <div className="flex flex-col items-center gap-2 border-b border-border-strong px-2 py-3">
          <button
            type="button"
            onClick={toggleSideNav}
            className="btn-ghost h-9 w-9 shrink-0 p-0"
            title="Expand navigation"
            aria-expanded={false}
            aria-controls="app-primary-nav"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
            <NoteIcon className="h-4 w-4" />
          </div>
          <ThemeToggle />
        </div>

        <nav id="app-primary-nav" className="flex flex-1 flex-col overflow-y-auto px-1.5 py-2" aria-label="Primary">
          <ul className="flex flex-1 flex-col gap-1">
            {items.map(({ id, label, Icon, accent }) => {
              const active = view === id;
              const a = accentClassesFor(accent);
              return (
                <li key={id}>
                  <button
                    onClick={() => goTo(id)}
                    aria-current={active ? 'page' : undefined}
                    title={label}
                    className={[
                      'relative flex w-full items-center justify-center rounded-lg p-2 transition-colors focus-ring',
                      active
                        ? 'bg-nav-raised text-text shadow-card ring-1 ring-border-strong'
                        : 'text-text-muted hover:bg-nav-raised hover:text-text',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex h-8 w-8 items-center justify-center rounded-md',
                        active ? a.tile : a.tileIdle,
                      ].join(' ')}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {active ? (
                      <span
                        className={['absolute right-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full', a.dot].join(
                          ' ',
                        )}
                      />
                    ) : null}
                    <span className="sr-only">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto border-t border-border-strong px-1.5 py-2">
          <button
            onClick={() => signOut()}
            className="btn-ghost flex w-full justify-center p-2"
            title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
          >
            <LogOutIcon className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border-strong bg-nav">
      <div className="flex items-center justify-between gap-2 border-b border-border-strong px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
            <NoteIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-text">Notes</p>
            <p className="truncate text-xs text-text-muted">{user?.email ?? 'Your workspace'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={toggleSideNav}
            className="btn-ghost h-8 w-8 shrink-0 p-0"
            title="Collapse navigation"
            aria-expanded={true}
            aria-controls="app-primary-nav"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav id="app-primary-nav" className="px-2 pt-2" aria-label="Primary">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
          Navigation
        </p>
        <ul className="space-y-1">
          {items.map(({ id, label, Icon, accent }) => {
            const active = view === id;
            const a = accentClassesFor(accent);
            return (
              <li key={id}>
                <button
                  onClick={() => goTo(id)}
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
                      active ? a.tile : a.tileIdle,
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{label}</span>
                  {active && <span className={['ml-auto h-1.5 w-1.5 rounded-full', a.dot].join(' ')} />}
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

type AccentClasses = { tile: string; tileIdle: string; dot: string };

function accentClassesFor(accent: string | undefined): AccentClasses {
  switch (accent) {
    case 'blue':
      return {
        tile: 'bg-blue-500/15 text-blue-200 shadow-[0_0_0_1px_rgb(59_130_246_/0.22),0_0_28px_rgb(59_130_246_/0.22)]',
        tileIdle: 'bg-blue-500/8 text-blue-300/80',
        dot: 'bg-blue-400',
      };
    case 'purple':
      return {
        tile: 'bg-purple-500/15 text-purple-200 shadow-[0_0_0_1px_rgb(168_85_247_/0.22),0_0_28px_rgb(168_85_247_/0.22)]',
        tileIdle: 'bg-purple-500/8 text-purple-300/80',
        dot: 'bg-purple-400',
      };
    case 'amber':
      return {
        tile: 'bg-amber-500/15 text-amber-200 shadow-[0_0_0_1px_rgb(245_158_11_/0.22),0_0_28px_rgb(245_158_11_/0.18)]',
        tileIdle: 'bg-amber-500/8 text-amber-300/80',
        dot: 'bg-amber-400',
      };
    case 'green':
      return {
        tile: 'bg-emerald-500/15 text-emerald-200 shadow-[0_0_0_1px_rgb(16_185_129_/0.22),0_0_28px_rgb(16_185_129_/0.18)]',
        tileIdle: 'bg-emerald-500/8 text-emerald-300/80',
        dot: 'bg-emerald-400',
      };
    default:
      return {
        tile: 'bg-brand-500/18 text-brand-200 shadow-[0_0_0_1px_rgb(99_102_241_/0.22),0_0_28px_rgb(99_102_241_/0.20)]',
        tileIdle: 'bg-brand-500/10 text-brand-300/80',
        dot: 'bg-brand-400',
      };
  }
}
