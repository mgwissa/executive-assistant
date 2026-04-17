import { create } from 'zustand';

type EmergencyState = {
  /** When true, full app is usable even if multiple Critical (P0) items remain. */
  bypass: boolean;
  setBypass: (v: boolean) => void;
  clear: () => void;
};

export const useEmergencyStore = create<EmergencyState>((set) => ({
  bypass: false,
  setBypass: (bypass) => set({ bypass }),
  clear: () => set({ bypass: false }),
}));
