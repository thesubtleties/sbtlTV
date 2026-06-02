import { useToasts } from '../../stores/toastStore';
import { ToastItem } from './ToastItem';
import './Toast.css';

export function ToastContainer() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
