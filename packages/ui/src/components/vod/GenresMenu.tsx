import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';

export const GENRE_COLUMNS = 4;

export interface GenresMenuProps {
  categories: { id: string; displayName: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Clicks inside this (the capsule) don't count as outside */
  containerRef: RefObject<HTMLElement | null>;
}

const ChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/**
 * The Floating header's Genres button and the panel that grows out of the capsule (HeaderStyles.css). The panel stays
 * drawn while it shrinks back in ('closing'). Keyboard: arrows move through the grid (rows of GENRE_COLUMNS), Home/End,
 * Enter picks, Escape closes and returns focus to Genres, Tab closes.
 */
export function GenresMenu({ categories, selectedId, onSelect, containerRef }: GenresMenuProps) {
  const [state, setState] = useState<'closed' | 'open' | 'closing'>('closed');
  const [focus, setFocus] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = categories.find((c) => c.id === selectedId);
  const open = state === 'open';

  const close = useCallback((refocus: boolean) => {
    setState((s) => (s === 'open' ? 'closing' : s));
    if (refocus) buttonRef.current?.focus();
  }, []);
  useEffect(() => {
    if (state !== 'closing') return;
    const t = setTimeout(() => setState('closed'), 320);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!containerRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, close, containerRef]);
  useEffect(() => { if (open) itemRefs.current[focus]?.focus(); }, [open, focus]);
  // The view changed underneath (Home or All picked in the capsule): the panel goes
  const shownFor = useRef(selectedId);
  useEffect(() => {
    if (shownFor.current !== selectedId) close(false);
    shownFor.current = selectedId;
  }, [selectedId, close]);

  const toggle = () => {
    if (open) { close(false); return; }
    setFocus(Math.max(0, categories.findIndex((c) => c.id === selectedId)));
    setState('open');
  };
  const onKey = (e: KeyboardEvent) => {
    const last = categories.length - 1;
    const move: Record<string, number> = {
      ArrowRight: focus + 1, ArrowLeft: focus - 1, ArrowDown: focus + GENRE_COLUMNS, ArrowUp: focus - GENRE_COLUMNS, Home: 0, End: last,
    };
    // Keys the panel handles stop here: the app's own shortcuts would otherwise run too (Escape closes Movies,
    // Space pauses, arrows seek). Tab moves on as usual
    const handled = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (e.key in move) return handled(() => setFocus(Math.min(last, Math.max(0, move[e.key]))));
    if (e.key === 'Enter' || e.key === ' ') return handled(() => itemRefs.current[focus]?.click());
    if (e.key === 'Escape') return handled(() => close(true));
    if (e.key === 'Tab') close(false);
  };

  return (
    <div className="h-category-strip__genres">
      <button
        ref={buttonRef}
        type="button"
        className={`h-category-strip__genres-btn ${current ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="h-category-strip__genres-label" title={current?.displayName}>{current?.displayName ?? 'Genres'}</span>
        <ChevronDown />
      </button>
      {state !== 'closed' && (
        <div
          className={`h-category-strip__sheet ${state === 'closing' ? 'h-category-strip__sheet--closing' : ''}`}
          role="menu"
          aria-label="Genres"
          inert={state === 'closing' || undefined}
          onKeyDown={onKey}
        >
          {categories.map((cat, i) => (
            <button
              key={cat.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              tabIndex={i === focus ? 0 : -1}
              style={{ '--i': i } as CSSProperties}
              className={`h-category-strip__sheet-item ${selectedId === cat.id ? 'active' : ''}`}
              onClick={() => { onSelect(cat.id); close(true); }}
            >
              {cat.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
