import { useState, useCallback, memo } from 'react';
import { getTmdbImageUrl, TMDB_POSTER_SIZES } from '../../services/tmdb';
import type { StoredMovie, StoredSeries } from '../../db';
import './MediaCard.css';

export interface MediaCardProps {
  item: StoredMovie | StoredSeries;
  type: 'movie' | 'series';
  onClick?: (item: StoredMovie | StoredSeries) => void;
  size?: 'small' | 'medium' | 'large';
}

export const MediaCard = memo(function MediaCard({ item, type, onClick, size = 'medium' }: MediaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Get the appropriate image URL
  const posterUrl = 'stream_icon' in item
    ? item.stream_icon
    : (item as StoredSeries).cover;

  // Try TMDB image if we have tmdb_id but no local poster
  const tmdbPosterPath = (item as StoredMovie | StoredSeries).backdrop_path;
  const displayUrl = posterUrl || getTmdbImageUrl(tmdbPosterPath, TMDB_POSTER_SIZES.medium);

  // Extract year from release_date
  const year = item.release_date
    ? item.release_date.slice(0, 4)
    : null;

  // Rating
  const rating = item.rating ? parseFloat(item.rating) : null;

  const handleClick = useCallback(() => {
    onClick?.(item);
  }, [item, onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(item);
      }
    },
    [item, onClick]
  );

  return (
    <div
      className={`media-card media-card--${size}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${item.name}${year ? ` (${year})` : ''}`}
    >
      <div className="media-card__poster">
        {displayUrl && !imageError ? (
          <img
            src={displayUrl}
            alt={item.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={imageLoaded ? 'loaded' : ''}
          />
        ) : (
          <div className="media-card__placeholder">
            <span>{item.name.charAt(0).toUpperCase()}</span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="media-card__overlay">
          <div className="media-card__play-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="media-card__info">
        <h3 className="media-card__title">{item.name}</h3>
        <div className="media-card__meta">
          {year && <span className="media-card__year">{year}</span>}
          {rating && rating > 0 && (
            <span className="media-card__rating">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {rating.toFixed(1)}
            </span>
          )}
          <span className="media-card__type">{type === 'movie' ? 'Movie' : 'Series'}</span>
        </div>
      </div>
    </div>
  );
});

export default MediaCard;
