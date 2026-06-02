import { create } from 'zustand';

export type ToastKind = 'progress' | 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  duration?: number; // ms to auto-dismiss; undefined = sticky (progress)
}

const MAX_TOASTS = 4;
let counter = 0;

interface ToastState {
  toasts: Toast[];
  addToast: (t: Omit<Toast, 'id'>) => string;
  updateToast: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (t) => {
    const id = String(++counter);
    set((s) => {
      const next = [...s.toasts, { ...t, id }];
      if (next.length <= MAX_TOASTS) return { toasts: next };
      // Over cap: drop the oldest NON-progress toast so an in-flight progress
      // toast is never orphaned (its later succeed()/fail() must still land).
      const dropIdx = next.findIndex((x) => x.kind !== 'progress');
      if (dropIdx === -1) return { toasts: next }; // all progress (rare) — keep them
      return { toasts: [...next.slice(0, dropIdx), ...next.slice(dropIdx + 1)] };
    });
    return id;
  },
  updateToast: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const useToasts = () => useToastStore((s) => s.toasts);
