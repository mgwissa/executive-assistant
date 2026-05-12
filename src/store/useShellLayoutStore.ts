import { create } from 'zustand';

const K_NAV = 'notes-shell-sideNavCollapsed';
const K_NOTES = 'notes-shell-notesSidebarCollapsed';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type ShellLayoutState = {
  sideNavCollapsed: boolean;
  notesSidebarCollapsed: boolean;
  toggleSideNav: () => void;
  toggleNotesSidebar: () => void;
};

export const useShellLayoutStore = create<ShellLayoutState>((set, get) => ({
  sideNavCollapsed: readBool(K_NAV, false),
  notesSidebarCollapsed: readBool(K_NOTES, false),
  toggleSideNav: () => {
    const next = !get().sideNavCollapsed;
    writeBool(K_NAV, next);
    set({ sideNavCollapsed: next });
  },
  toggleNotesSidebar: () => {
    const next = !get().notesSidebarCollapsed;
    writeBool(K_NOTES, next);
    set({ notesSidebarCollapsed: next });
  },
}));
