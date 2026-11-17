/**
 * HorizontalCategoryStrip - Unified VOD header with navigation
 *
 * Features:
 * - Back button with contextual icon (movie reel / TV)
 * - Scrollable category pills with smooth scroll
 * - Integrated search input
 * - Arrow buttons for navigation (appear when scrollable)
 * - Mouse wheel horizontal scroll support
 */

import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, type CSSProperties } from 'react';
import './HorizontalCategoryStrip.css';
import './HeaderStyles.css';

interface Category {
  id: string;
  name: string;
}

export interface HorizontalCategoryStripProps {
  categories: Category[];
  selectedId: string | null; // null = home, 'all' = all, string = category
  onSelect: (id: string | null) => void;
  // New props for unified header
  type?: 'movie' | 'series';
  onBack?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onSearchSubmit?: () => void;
}

// Icons
const BackArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

const MovieIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
    <path d="M8 4l0 16" />
    <path d="M16 4l0 16" />
    <path d="M4 8l4 0" />
    <path d="M4 16l4 0" />
    <path d="M4 12l16 0" />
    <path d="M16 8l4 0" />
    <path d="M16 16l4 0" />
  </svg>
);

const SeriesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9" />
    <path d="M16 3l-4 4l-4 -4" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
    <path d="M21 21l-6 -6" />
  </svg>
);

const ClearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function HorizontalCategoryStrip({
  categories,
  selectedId,
  onSelect,
  type,
  onBack,
  searchQuery = '',
  onSearchChange,
  onSearchSubmit,
}: HorizontalCategoryStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Experiment (header style B): the category list as a sheet that grows out of the capsule.
  // 'closing' keeps it drawn while it shrinks back in
  const [genres, setGenres] = useState<'closed' | 'open' | 'closing'>('closed');
  const genresOpen = genres === 'open';
  const navRef = useRef<HTMLDivElement>(null);
  const setGenresOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setGenres((g) => {
      const open = typeof next === 'function' ? next(g === 'open') : next;
      if (open) return 'open';
      return g === 'open' ? 'closing' : g;
    });
  }, []);
  useEffect(() => {
    if (genres !== 'closing') return;
    const t = setTimeout(() => setGenres('closed'), 320);
    return () => clearTimeout(t);
  }, [genres]);
  // A click anywhere else, or Escape, closes the sheet
  useEffect(() => {
    if (!genresOpen) return;
    const away = (e: PointerEvent) => { if (!navRef.current?.contains(e.target as Node)) setGenresOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setGenresOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [genresOpen, setGenresOpen]);
  // The capsule's one highlight glides to the active item; the sheet needs the capsule's size to grow from
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('.h-category-strip__pill.active, .h-category-strip__genres-btn.active')
        ?? nav.querySelector<HTMLElement>('.h-category-strip__genres-btn');
      const box = nav.getBoundingClientRect();
      if (active && active.offsetParent) {
        const r = active.getBoundingClientRect();
        nav.style.setProperty('--ind-x', `${r.left - box.left}px`);
        nav.style.setProperty('--ind-w', `${r.width}px`);
        nav.style.setProperty('--ind-o', active.classList.contains('active') ? '1' : '0');
      }
      nav.style.setProperty('--cap-w', `${box.width}px`);
      nav.style.setProperty('--cap-h', `${box.height}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [selectedId, genres]);

  // Process categories: strip prefixes and sort alphabetically
  const processedCategories = useMemo(() => {
    return categories
      .map((cat) => ({
        ...cat,
        displayName: cat.name
          .replace(/^(Series|Movies|Movie)-/i, '')
          .trim(),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [categories]);

  // Check scroll state
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  // Update scroll state on mount and resize
  useEffect(() => {
    updateScrollState();

    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);

    // Re-check after categories load
    const timeout = setTimeout(updateScrollState, 100);

    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      clearTimeout(timeout);
    };
  }, [updateScrollState, categories]);

  // Handle wheel scroll (convert vertical to horizontal)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Scroll by amount
  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;

    const scrollAmount = el.clientWidth * 0.6;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  // Handle search key down
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearchSubmit?.();
    }
  }, [onSearchSubmit]);

  // Determine if we're showing the unified header (has back button)
  const showUnifiedHeader = !!onBack;

  return (
    <div className={`h-category-strip ${showUnifiedHeader ? 'h-category-strip--unified' : ''}`}>
      {/* Back button with type icon */}
      {showUnifiedHeader && (
        <button
          className="h-category-strip__back"
          onClick={onBack}
          aria-label="Go back"
        >
          <span className="h-category-strip__back-arrow">
            <BackArrow />
          </span>
          <span className="h-category-strip__back-icon">
            {type === 'series' ? <SeriesIcon /> : <MovieIcon />}
          </span>
        </button>
      )}

      {/* Home button - only show if not unified header */}
      {!showUnifiedHeader && (
        <button
          className={`h-category-strip__home ${selectedId === null ? 'active' : ''}`}
          onClick={() => onSelect(null)}
          aria-label="Home"
          title="Home"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.1L1 12h3v9h6v-6h4v6h6v-9h3L12 2.1z" />
          </svg>
        </button>
      )}

      {/* Experiment: one group for the navigation (layout-neutral unless a header style uses it) */}
      <div className={`h-category-strip__nav ${genres !== 'closed' ? 'h-category-strip__nav--sheet' : ''}`} ref={navRef}>
      <span className="h-category-strip__indicator" aria-hidden="true" />
      {/* Left arrow */}
      <button
        className={`h-category-strip__arrow h-category-strip__arrow--left ${canScrollLeft ? 'visible' : ''}`}
        onClick={() => scroll('left')}
        aria-label="Scroll left"
      >
        <ChevronLeft />
      </button>

      {/* Scroll container */}
      <div className={`h-category-strip__scroll-wrapper ${canScrollLeft ? 'fade-left' : ''} ${canScrollRight ? 'fade-right' : ''}`}>
        <div ref={scrollRef} className="h-category-strip__scroll">
          {/* Home pill - only in unified header mode */}
          {showUnifiedHeader && (
            <button
              className={`h-category-strip__pill ${selectedId === null ? 'active' : ''}`}
              onClick={() => onSelect(null)}
            >
              Home
            </button>
          )}

          {/* All button */}
          <button
            className={`h-category-strip__pill ${selectedId === 'all' ? 'active' : ''}`}
            onClick={() => onSelect('all')}
          >
            All
          </button>

          {/* Category pills */}
          {processedCategories.map((cat) => (
            <button
              key={cat.id}
              className={`h-category-strip__pill ${selectedId === cat.id ? 'active' : ''}`}
              onClick={() => onSelect(cat.id)}
            >
              {cat.displayName}
            </button>
          ))}
        </div>
      </div>

      {/* Right arrow */}
      <button
        className={`h-category-strip__arrow h-category-strip__arrow--right ${canScrollRight ? 'visible' : ''}`}
        onClick={() => scroll('right')}
        aria-label="Scroll right"
      >
        <ChevronRight />
      </button>

      {/* Experiment (header style B): Genres button + sheet; hidden in the default style */}
      {showUnifiedHeader && (
        <div className="h-category-strip__genres">
          <button
            className={`h-category-strip__genres-btn ${selectedId && selectedId !== 'all' ? 'active' : ''}`}
            onClick={() => setGenresOpen((o) => !o)}
            aria-expanded={genresOpen}
          >
            {processedCategories.find((c) => c.id === selectedId)?.displayName ?? 'Genres'}
            <ChevronDown />
          </button>
          {genres !== 'closed' && (
            <div className={`h-category-strip__sheet ${genres === 'closing' ? 'h-category-strip__sheet--closing' : ''}`} role="menu">
              {processedCategories.map((cat, i) => (
                <button
                  key={cat.id}
                  role="menuitem"
                  style={{ '--i': i } as CSSProperties}
                  className={`h-category-strip__sheet-item ${selectedId === cat.id ? 'active' : ''}`}
                  onClick={() => { onSelect(cat.id); setGenresOpen(false); }}
                >
                  {cat.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Search input - only in unified header */}
      {showUnifiedHeader && onSearchChange && (
        <div className="h-category-strip__search">
          <SearchIcon />
          <input
            type="text"
            placeholder={type === 'series' ? 'Search series...' : 'Search movies...'}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {searchQuery && (
            <button
              className="h-category-strip__search-clear"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              <ClearIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default HorizontalCategoryStrip;
