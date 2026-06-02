import { useToastStore } from '../stores/toastStore';

const DURATION = { success: 4000, info: 4000, error: 8000 } as const;

/**
 * Ergonomic toast helpers. Components call `const toast = useToast()` and fire
 * `toast.error/success/info(...)`. `toast.progress(...)` returns handles to flip
 * the SAME toast from progress → success/error in place (e.g. removing → removed).
 *
 * Non-component callers (deep effect catches) use `useToastStore.getState().addToast(...)`.
 */
export function useToast() {
  const add = useToastStore((s) => s.addToast);
  const update = useToastStore((s) => s.updateToast);

  return {
    error: (title: string, message?: string) =>
      add({ kind: 'error', title, message, duration: DURATION.error }),
    success: (title: string, message?: string) =>
      add({ kind: 'success', title, message, duration: DURATION.success }),
    info: (title: string, message?: string) =>
      add({ kind: 'info', title, message, duration: DURATION.info }),
    progress: (title: string, message?: string) => {
      const id = add({ kind: 'progress', title, message }); // sticky (no duration)
      return {
        id,
        succeed: (t?: string, m?: string) =>
          update(id, { kind: 'success', title: t ?? title, message: m, duration: DURATION.success }),
        fail: (t?: string, m?: string) =>
          update(id, { kind: 'error', title: t ?? title, message: m, duration: DURATION.error }),
      };
    },
  };
}
