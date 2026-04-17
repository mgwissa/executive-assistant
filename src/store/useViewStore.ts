import { create } from 'zustand';

export type View = 'dashboard' | 'calendar' | 'notes' | 'tasks' | 'profile';

type ViewState = {
  view: View;
  setView: (view: View) => void;
};

export const useViewStore = create<ViewState>((set) => ({
  view: 'dashboard',
  setView: (view) => set({ view }),
}));
