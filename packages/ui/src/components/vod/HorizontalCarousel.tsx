import { useRef, useState, useCallback, useEffect } from 'react';
import type { StoredMovie, StoredSeries } from '../../db';
import { MediaCard } from './MediaCard';
import { getMovieProgress } from '../../hooks/useWatchProgress';
import './HorizontalCarousel.css';

export interface HorizontalCarouselProps {
  title: string;
  items: (StoredMovie | StoredSeries)[];
  type: 'movie' | 'series';
  onItemClick?: (item: StoredMovie | StoredSeries) => void;
  cardSize?: 'small' | 'medium' | 'large';
  loading?: boolean;
  maxItems?: number; // Limit items for performance
  hidden?: boolean; // Hide but maintain minimal height for Virtuoso
  progressMap?: Map<string, number>; // Bulk movie progress lookup
  tag?: 'selected'; // Hand-chosen row from sbtltv.com
  subtitle?: string; // One muted line after the title (shown as plain text)
}

// Tabler Icons feather-filled (tabler.io/icons)
function FeatherFilledIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 9.585v6.415h6.414l-2.707 2.707a1 1 0 0 1 -.112 .097l-.11 .071l-.114 .054l-.105 .035l-.149 .03l-.117 .006h-4.586l-1.707 1.707a1 1 0 1 1 -1.414 -1.414l1.707 -1.709v-4.584l.003 -.075l.017 -.126l.03 -.111l.044 -.111l.052 -.098l.067 -.096l.08 -.09z" />
      <path d="M19.414 11l-3 3h-4.914l2.914 -3z" />
      <path d="M13 4.586v4.998l-3 3v-4.999z" />
      <path d="M16.482 3a4.515 4.515 0 0 1 4.518 4.514a4.7 4.7 0 0 1 -.239 1.487l-5.761 -.001v-5.76c.469 -.158 .968 -.24 1.482 -.24" />
    </svg>
  );
}

export function HorizontalCarousel({
  title,
  items,
  type,
  onItemClick,
  cardSize = 'medium',
  loading = false,
  maxItems = 20,
  hidden = false,
  progressMap,
  tag,
  subtitle,
}: HorizontalCarouselProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Limit items for performance
  const displayItems = maxItems ? items.slice(0, maxItems) : items;

  // Update scroll button visibility
  const updateScrollButtons = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    window.addEventListener('resize', updateScrollButtons);
    return () => window.removeEventListener('resize', updateScrollButtons);
  }, [updateScrollButtons, items.length]);

  // Scroll by amount
  const scroll = useCallback((direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = container.clientWidth * 0.75;
    const targetScroll = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: targetScroll,
      behavior: 'smooth',
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      scroll('left');
    } else if (e.key === 'ArrowRight') {
      scroll('right');
    }
  }, [scroll]);

  // Hidden carousels render a minimal placeholder for Virtuoso
  if (hidden || (displayItems.length === 0 && !loading)) {
    return <div className="carousel carousel--empty" aria-hidden="true" />;
  }

  return (
    <section className="carousel" onKeyDown={handleKeyDown}>
      <div className="carousel__header">
        <div className="carousel__heading">
          <h2 className="carousel__title">{title}</h2>
          {tag === 'selected' && (
            <span className="carousel__tag"><FeatherFilledIcon />Selected</span>
          )}
          {subtitle && <span className="carousel__subtitle">{subtitle}</span>}
        </div>
        <div className="carousel__nav">
          <button
            className="carousel__nav-btn"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            aria-label="Scroll left"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className="carousel__nav-btn"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            aria-label="Scroll right"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className="carousel__scroll-container"
        ref={scrollContainerRef}
        onScroll={updateScrollButtons}
      >
        <div className="carousel__track">
          {loading ? (
            // Loading skeletons
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`media-card-skeleton media-card-skeleton--${cardSize}`} />
            ))
          ) : (
            displayItems.map((item) => (
              <MediaCard
                key={type === 'movie' ? (item as StoredMovie).stream_id : (item as StoredSeries).series_id}
                item={item}
                type={type}
                onClick={onItemClick}
                size={cardSize}
                progress={progressMap ? getMovieProgress(progressMap, item) : undefined}
              />
            ))
          )}
        </div>
      </div>

      {/* Scroll fade indicators */}
      {canScrollLeft && <div className="carousel__fade carousel__fade--left" />}
      {canScrollRight && <div className="carousel__fade carousel__fade--right" />}
    </section>
  );
}

export default HorizontalCarousel;
