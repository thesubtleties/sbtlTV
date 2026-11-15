import './DetailHeader.css';

interface DetailHeaderProps {
  className: string;
  /** Leaves the detail for the Movies/Series home. Always shown. */
  onHome: () => void;
  /** One title back (opened from More like this). Shown only when there is one. */
  onBack?: () => void;
  onCollapse?: () => void;
}

export function DetailHeader({ className, onHome, onBack, onCollapse }: DetailHeaderProps) {
  return (
    <header className={`${className}__header`}>
      <div className="detail-header__nav">
        <button className={`${className}__back`} onClick={onHome} aria-label="Home" title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l-2 0l9 -9l9 9l-2 0" />
            <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
            <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
          </svg>
          Home
        </button>
        {onBack && (
          <button className={`${className}__back`} onClick={onBack} aria-label="Go back" title="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
        )}
      </div>
      {onCollapse && (
        <button
          className={`${className}__collapse`}
          onClick={onCollapse}
          aria-label="Collapse detail"
          title="Collapse"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </header>
  );
}
