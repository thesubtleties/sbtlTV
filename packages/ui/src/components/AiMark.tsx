import './AiMark.css';

/** AI-translated subtitle: our own four-point spark and "AI", in the accent color. */
export function AiMark({ title = 'AI-translated' }: { title?: string }) {
  return (
    <span className="ai-mark" title={title} aria-label={title}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 0.8 L7.1 4.9 L11.2 6 L7.1 7.1 L6 11.2 L4.9 7.1 L0.8 6 L4.9 4.9 Z" fill="currentColor" />
      </svg>
      AI
    </span>
  );
}
