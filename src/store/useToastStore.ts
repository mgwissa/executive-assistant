import { create } from 'zustand';

export type ToastAction = {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'ghost';
};

export type Toast = {
  id: string;
  title: string;
  body?: string;
  actions?: ToastAction[];
  /** When set, auto-dismiss after this many ms. Omit to persist until dismissed. */
  durationMs?: number | null;
  onDismiss?: () => void;
};

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (toast) => {
    const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clear: () => set({ toasts: [] }),
}));
