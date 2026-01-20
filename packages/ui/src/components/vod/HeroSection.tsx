import { useState, useEffect, useCallback } from 'react';
import type { StoredMovie, StoredSeries } from '../../db';
import { useLazyBackdrop } from '../../hooks/useLazyBackdrop';
import { useLazyPlot } from '../../hooks/useLazyPlot';
import './HeroSection.css';

export interface HeroSectionProps {
  items: (StoredMovie | StoredSeries)[];
  type: 'movie' | 'series';
  onPlay?: (item: StoredMovie | StoredSeries) => void;
  onMoreInfo?: (item: StoredMovie | StoredSeries) => void;
  autoRotate?: boolean;
  rotateInterval?: number;
  apiKey?: string | null; // TMDB API key for lazy backdrop loading
}

export function HeroSection({
  items,
  type,
  onPlay,
  onMoreInfo,
  autoRotate = true,
  rotateInterval = 8000,
  apiKey,
}: HeroSectionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const currentItem = items[currentIndex];

  // Lazy-load backdrop and plot from TMDB if available
  const tmdbBackdropUrl = useLazyBackdrop(currentItem, apiKey);
  const lazyPlot = useLazyPlot(currentItem, apiKey);

  // Auto-rotate through items
  useEffect(() => {
    if (!autoRotate || items.length <= 1) return;

    const timer = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % items.length);
        setIsTransitioning(false);
      }, 500); // Match CSS transition duration
    }, rotateInterval);

    return () => clearInterval(timer);
  }, [autoRotate, items.length, rotateInterval]);

  const handleDotClick = useCallback((index: number) => {
    if (index === currentIndex) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(index);
      setIsTransitioning(false);
    }, 300);
  }, [currentIndex]);

  if (!currentItem) {
    return (
      <div className="hero hero--empty">
        <div className="hero__content">
          <h1>No content available</h1>
          <p>Add an Xtream source in Settings to get started</p>
        </div>
      </div>
    );
  }

  // Get backdrop image - use TMDB if available, fallback to cover/icon
  const fallbackUrl = 'stream_icon' in currentItem
    ? currentItem.stream_icon
    : (currentItem as StoredSeries).cover;
  const backdropUrl = tmdbBackdropUrl || fallbackUrl;

  // Get year
  const year = currentItem.release_date?.slice(0, 4);

  // Get rating
  const rating = currentItem.rating ? parseFloat(currentItem.rating) : null;

  return (
    <section className={`hero ${isTransitioning ? 'hero--transitioning' : ''}`}>
      {/* Background image */}
      <div className="hero__backdrop">
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt=""
            aria-hidden="true"
          />
        )}
        <div className="hero__gradient" />
      </div>

      {/* Content */}
      <div className="hero__content">
        <div className="hero__info">
          <span className="hero__type">{type === 'movie' ? 'Movie' : 'Series'}</span>
          <h1 className="hero__title">{currentItem.name}</h1>

          <div className="hero__meta">
            {year && <span className="hero__year">{year}</span>}
            {rating && rating > 0 && (
              <span className="hero__rating">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {rating.toFixed(1)}
              </span>
            )}
            {currentItem.genre && (
              <span className="hero__genre">{currentItem.genre.split(',')[0]}</span>
            )}
          </div>

          {(currentItem.plot || lazyPlot) && (
            <p className="hero__description">{currentItem.plot || lazyPlot}</p>
          )}

          <div className="hero__actions">
            <button
              className="hero__btn hero__btn--primary"
              onClick={() => onPlay?.(currentItem)}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </button>
            <button
              className="hero__btn hero__btn--secondary"
              onClick={() => onMoreInfo?.(currentItem)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              More Info
            </button>
          </div>
        </div>
      </div>

      {/* Navigation dots */}
      {items.length > 1 && (
        <div className="hero__dots">
          {items.map((_, index) => (
            <button
              key={index}
              className={`hero__dot ${index === currentIndex ? 'active' : ''}`}
              onClick={() => handleDotClick(index)}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default HeroSection;
