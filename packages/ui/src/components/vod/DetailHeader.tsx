interface DetailHeaderProps {
  className: string;
  onBack: () => void;
  onCollapse?: () => void;
}

export function DetailHeader({ className, onBack, onCollapse }: DetailHeaderProps) {
  return (
    <header className={`${className}__header`}>
      <button
        className={`${className}__back`}
        onClick={onBack}
        aria-label="Go back"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
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
