import { useState, useCallback, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { StoredMovie, StoredSeries } from '../../db';
import { MediaCard } from './MediaCard';
import { getMovieProgress } from '../../hooks/useWatchProgress';
import { itemWidth, type CardSize } from './carouselSizes';
import './HorizontalCarousel.css';

type CarouselItem = StoredMovie | StoredSeries;

export interface HorizontalCarouselProps {
  title: string;
  items: CarouselItem[];
  type: 'movie' | 'series';
  onItemClick?: (item: CarouselItem) => void;
  cardSize?: CardSize;
  loading?: boolean;
  maxItems?: number; // Optional cap; rows are virtualized, so long rows are fine without one
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

// Virtuoso renders only the cards near the visible part of the row. Defined outside the
// component so rows don't remount their cards on every render.
interface RowContext {
  type: 'movie' | 'series';
  cardSize: CardSize;
  onItemClick?: (item: CarouselItem) => void;
  progressMap?: Map<string, number>;
}
const itemKey = (_index: number, item: CarouselItem) =>
  'stream_id' in item ? `m:${item.stream_id}` : `s:${(item as StoredSeries).series_id}`;
const renderCard = (_index: number, item: CarouselItem, ctx: RowContext) => (
  <div className="carousel__item">
    <MediaCard
      item={item}
      type={ctx.type}
      onClick={ctx.onItemClick}
      size={ctx.cardSize}
      progress={ctx.progressMap ? getMovieProgress(ctx.progressMap, item) : undefined}
    />
  </div>
);
// Cards beyond the visible width rendered ahead of time: covers the side padding (which
// Virtuoso can't see) and fast flicks. `top`/`bottom` mean left/right in horizontal mode.
const OVERSCAN = { top: 600, bottom: 600 };

export function HorizontalCarousel({
  title,
  items,
  type,
  onItemClick,
  cardSize = 'medium',
  loading = false,
  maxItems,
  hidden = false,
  progressMap,
  tag,
  subtitle,
}: HorizontalCarouselProps) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const displayItems = maxItems ? items.slice(0, maxItems) : items;

  const scrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  // Update scroll button visibility
  const updateScrollButtons = useCallback(() => {
    if (!scroller) return;
    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, [scroller]);

  useEffect(() => {
    if (!scroller) return;
    updateScrollButtons();
    scroller.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      scroller.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [scroller, updateScrollButtons, displayItems.length]);

  // Scroll by most of a screen
  const scroll = useCallback((direction: 'left' | 'right') => {
    if (!scroller) return;
    const amount = scroller.clientWidth * 0.75;
    scroller.scrollTo({
      left: direction === 'left' ? scroller.scrollLeft - amount : scroller.scrollLeft + amount,
      behavior: 'smooth',
    });
  }, [scroller]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // preventDefault: a focused row's scroller would also do the browser's own small
    // arrow scroll, which cancels our smooth page (one press moved 40px instead of 75%)
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scroll('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
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
          {tag === 'selected' && <span className="carousel__mark"><FeatherFilledIcon /></span>}
          <h2 className="carousel__title">
            {tag === 'selected' && <span className="carousel__sr">Selected list: </span>}
            {title}
          </h2>
          {subtitle && <span className="carousel__subtitle">{subtitle}</span>}
        </div>
        <div className="carousel__nav">
          <button
            className="carousel__nav-btn"
            onClick={() => scroll('left')}
            disabled={loading || !canScrollLeft}
            aria-label="Scroll left"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            className="carousel__nav-btn"
            onClick={() => scroll('right')}
            disabled={loading || !canScrollRight}
            aria-label="Scroll right"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="carousel__scroll-container">
          <div className="carousel__track">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`media-card-skeleton media-card-skeleton--${cardSize}`} />
            ))}
          </div>
        </div>
      ) : (
        <Virtuoso<CarouselItem, RowContext>
          className="carousel__virtual"
          horizontalDirection
          data={displayItems}
          fixedItemHeight={itemWidth(cardSize)}
          increaseViewportBy={OVERSCAN}
          computeItemKey={itemKey}
          itemContent={renderCard}
          context={{ type, cardSize, onItemClick, progressMap }}
          scrollerRef={scrollerRef}
        />
      )}

      {/* Scroll fade indicators */}
      {!loading && canScrollLeft && <div className="carousel__fade carousel__fade--left" />}
      {!loading && canScrollRight && <div className="carousel__fade carousel__fade--right" />}
    </section>
  );
}

export default HorizontalCarousel;
