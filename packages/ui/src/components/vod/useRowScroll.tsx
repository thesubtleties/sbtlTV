import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';

/**
 * A home row's sideways scrolling: whether there's more to either side (the ‹ › buttons and the edge fades), a page
 * at a time, and the arrow keys. Shared by the carousels and Continue Watching, so every row can be scrolled without
 * a trackpad (a mouse wheel only scrolls up and down).
 */
export function useRowScroll(itemCount: number) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const scrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  const update = useCallback(() => {
    if (!scroller) return;
    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, [scroller]);

  useEffect(() => {
    if (!scroller) return;
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scroller, update, itemCount]);

  // Most of a screen at a time
  const scroll = useCallback((direction: 'left' | 'right') => {
    if (!scroller) return;
    const amount = scroller.clientWidth * 0.75;
    scroller.scrollTo({
      left: direction === 'left' ? scroller.scrollLeft - amount : scroller.scrollLeft + amount,
      behavior: 'smooth',
    });
  }, [scroller]);

  // preventDefault: a focused row's scroller would also do the browser's own small arrow scroll, which cancels the
  // smooth page (one press moved 40px instead of 75%)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scroll('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      scroll('right');
    }
  }, [scroll]);

  return { scrollerRef, canScrollLeft, canScrollRight, scroll, handleKeyDown };
}

/** The row's ‹ › buttons (greyed when there's nothing more that way) */
export function CarouselNav({ canScrollLeft, canScrollRight, scroll, disabled = false }: {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scroll: (direction: 'left' | 'right') => void;
  disabled?: boolean;
}) {
  return (
    <div className="carousel__nav">
      <button className="carousel__nav-btn" onClick={() => scroll('left')} disabled={disabled || !canScrollLeft} aria-label="Scroll left">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button className="carousel__nav-btn" onClick={() => scroll('right')} disabled={disabled || !canScrollRight} aria-label="Scroll right">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
