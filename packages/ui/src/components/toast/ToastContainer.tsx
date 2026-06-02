import { useToasts } from '../../stores/toastStore';
import { ToastItem } from './ToastItem';
import { UpdateNotification } from '../UpdateNotification';
import './Toast.css';

export function ToastContainer() {
  const toasts = useToasts();
  // Always rendered: the UpdateNotification (sticky update chip) self-nulls when inactive and
  // anchors the bottom of the stack; transient toasts pile up above it. column-reverse in CSS
  // puts the first DOM child (the chip) at the bottom.
  return (
    <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
      <UpdateNotification />
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
