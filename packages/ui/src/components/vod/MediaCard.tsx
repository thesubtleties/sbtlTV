import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { getTmdbImageUrl, TMDB_POSTER_SIZES } from '../../services/tmdb';
import { useRpdbSettings } from '../../hooks/useRpdbSettings';
import { getRpdbPosterUrl } from '../../services/rpdb';
import { useIsOnWatchlist, useToggleWatchlist } from '../../hooks/useWatchlist';
import type { StoredMovie, StoredSeries } from '../../db';
import './MediaCard.css';

export interface MediaCardProps {
  item: StoredMovie | StoredSeries;
  type: 'movie' | 'series';
  onClick?: (item: StoredMovie | StoredSeries) => void;
  size?: 'small' | 'medium' | 'large';
  progress?: number; // 0-100 watch progress, passed from parent
}

export const MediaCard = memo(function MediaCard({ item, type, onClick, size = 'medium', progress }: MediaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Check if title overflows (triggers marquee animation on hover)
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      setTitleOverflows(el.scrollWidth > el.clientWidth);
    }
  }, [item.title, item.name]);

  // Load RPDB settings
  const { apiKey: rpdbApiKey } = useRpdbSettings();

  // Get the appropriate image URL
  const posterUrl = 'stream_icon' in item
    ? item.stream_icon
    : (item as StoredSeries).cover;

  // Use RPDB poster if we have an API key and tmdb_id
  const rpdbPosterUrl = rpdbApiKey && item.tmdb_id
    ? getRpdbPosterUrl(rpdbApiKey, item.tmdb_id, type)
    : null;

  // Try TMDB image if we have tmdb_id but no local poster
  const tmdbPosterPath = (item as StoredMovie | StoredSeries).backdrop_path;

  // Priority: RPDB (if available) > local poster > TMDB fallback
  const displayUrl = rpdbPosterUrl || posterUrl || getTmdbImageUrl(tmdbPosterPath, TMDB_POSTER_SIZES.medium);

  // Use item.year if available, otherwise extract from release_date
  const year = item.year
    || (item.release_date ? item.release_date.slice(0, 4) : null);

  // Use clean title if available, otherwise fall back to name
  const displayTitle = item.title || item.name;

  // Rating - only show if it's a meaningful value (not 0, not NaN)
  const parsedRating = item.rating ? parseFloat(item.rating) : NaN;
  const rating = !isNaN(parsedRating) && parsedRating > 0 ? parsedRating : null;

  const progressPercent = progress ?? 0;

  const onWatchlist = useIsOnWatchlist(type, item.tmdb_id, 'stream_id' in item ? item.stream_id : (item as StoredSeries).series_id);
  const toggleWatchlist = useToggleWatchlist();
  const handleToggleWatchlist = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const streamId = 'stream_id' in item ? item.stream_id : (item as StoredSeries).series_id;
    toggleWatchlist(type, { tmdbId: item.tmdb_id, streamId, name: item.name });
  }, [toggleWatchlist, type, item]);

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
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={imageLoaded ? 'loaded' : ''}
          />
        ) : (
          <div className="media-card__placeholder">
            <span>{item.name.charAt(0).toUpperCase()}</span>
          </div>
        )}

        {/* Watched indicator — top-right, eye-shaped blur */}
        {progressPercent >= 90 && (
          <div className="media-card__watched" />
        )}

        {/* Hover overlay */}
        <div className="media-card__overlay">
          <button
            className={`media-card__heart${onWatchlist ? ' media-card__heart--active' : ''}`}
            onClick={handleToggleWatchlist}
            aria-label={onWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {onWatchlist ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
              </svg>
            )}
          </button>
          <div className="media-card__play-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="rgba(255,255,255,0.55)">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
            </svg>
          </div>
        </div>

      </div>

      {/* Watch progress bar — on the seam between poster and info (not shown when completed) */}
      {progressPercent > 0 && progressPercent < 90 && (
        <div className="media-card__progress">
          <div className="media-card__progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
      )}

      <div className="media-card__info">
        <h3
          ref={titleRef}
          className={`media-card__title${titleOverflows ? ' media-card__title--overflow' : ''}`}
        >
          <span className="media-card__title-inner">{displayTitle}</span>
        </h3>
        <div className="media-card__meta">
          {year && <span className="media-card__year">{year}</span>}
          {rating && (
            <span className="media-card__rating">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export default MediaCard;
