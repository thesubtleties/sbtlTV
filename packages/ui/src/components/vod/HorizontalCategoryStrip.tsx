/**
 * HorizontalCategoryStrip - Netflix-style horizontal category navigation
 *
 * Features:
 * - Home icon button (fixed left)
 * - Scrollable category pills with smooth scroll
 * - Arrow buttons for navigation (appear when scrollable)
 * - Mouse wheel horizontal scroll support
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import './HorizontalCategoryStrip.css';

interface Category {
  id: string;
  name: string;
}

export interface HorizontalCategoryStripProps {
  categories: Category[];
  selectedId: string | null;  // null = home, 'all' = all, string = category
  onSelect: (id: string | null) => void;
}

// Icons as inline SVG - filled home icon, subtle chevrons
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.1L1 12h3v9h6v-6h4v6h6v-9h3L12 2.1z" />
  </svg>
);

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
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
}: HorizontalCategoryStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  // Must use native event listener with passive: false to allow preventDefault
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Only hijack vertical scroll when hovering the strip
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

  return (
    <div className="h-category-strip">
      {/* Home button - fixed left */}
      <button
        className={`h-category-strip__home ${selectedId === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
        aria-label="Home"
        title="Home"
      >
        <HomeIcon />
      </button>

      {/* Left arrow - outside scroll area */}
      <button
        className={`h-category-strip__arrow h-category-strip__arrow--left ${canScrollLeft ? 'visible' : ''}`}
        onClick={() => scroll('left')}
        aria-label="Scroll left"
      >
        <ChevronLeft />
      </button>

      {/* Scroll container with fade edges */}
      <div className={`h-category-strip__scroll-wrapper ${canScrollLeft ? 'fade-left' : ''} ${canScrollRight ? 'fade-right' : ''}`}>
        {/* Scrollable categories */}
        <div
          ref={scrollRef}
          className="h-category-strip__scroll"
        >
          {/* All button */}
          <button
            className={`h-category-strip__pill ${selectedId === 'all' ? 'active' : ''}`}
            onClick={() => onSelect('all')}
          >
            All
          </button>

          {/* Category pills */}
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`h-category-strip__pill ${selectedId === cat.id ? 'active' : ''}`}
              onClick={() => onSelect(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Right arrow - outside scroll area */}
      <button
        className={`h-category-strip__arrow h-category-strip__arrow--right ${canScrollRight ? 'visible' : ''}`}
        onClick={() => scroll('right')}
        aria-label="Scroll right"
      >
        <ChevronRight />
      </button>
    </div>
  );
}

export default HorizontalCategoryStrip;
