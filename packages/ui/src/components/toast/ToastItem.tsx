import { useEffect } from 'react';
import { useToastStore, type Toast, type ToastKind } from '../../stores/toastStore';
import { SbtlLoader } from './SbtlLoader';

export function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismissToast);

  // Arm an auto-dismiss timer for transient kinds. Deps include kind+duration so a
  // progress→success flip re-runs this and arms the timer; progress stays sticky.
  useEffect(() => {
    if (toast.kind === 'progress' || !toast.duration) return;
    const t = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, toast.duration, dismiss]);

  return (
    <div className={`toast toast--${toast.kind}`}>
      <div className="toast__icon">
        {toast.kind === 'progress' ? <SbtlLoader /> : <ToastIcon kind={toast.kind} />}
      </div>
      <div className="toast__text">
        <strong>{toast.title}</strong>
        {toast.message && <span>{toast.message}</span>}
      </div>
      <button className="toast__dismiss" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

function ToastIcon({ kind }: { kind: Exclude<ToastKind, 'progress'> }) {
  if (kind === 'success') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (kind === 'error') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </svg>
  );
}
