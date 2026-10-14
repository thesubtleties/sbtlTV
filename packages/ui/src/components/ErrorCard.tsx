import './ErrorCard.css';

/**
 * A playback problem, under the title bar: a warning on the palette's card
 * surface. Stays until dismissed or the next play. onRetry: play the same
 * channel or movie again.
 */
export function ErrorCard({ message, onDismiss, onRetry }: { message: string; onDismiss: () => void; onRetry?: () => void }) {
  return (
    <div className="error-card" role="alert">
      <svg className="error-card__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
        <line x1="12" y1="9.5" x2="12" y2="13.5" />
        <line x1="12" y1="17" x2="12" y2="17" />
      </svg>
      <div className="error-card__text">
        <strong>Playback problem</strong>
        <span title={message}>{message}</span>
      </div>
      {onRetry && (
        <button className="error-card__retry" onClick={onRetry}>Try again</button>
      )}
      <button className="error-card__close" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
