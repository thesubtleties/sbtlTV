/**
 * MovieDetail - Full page movie detail view
 *
 * Shows movie information with backdrop, metadata, and play button.
 * Slides in as a full page, not a modal.
 */

import { useEffect, useCallback, useRef } from 'react';
import { getTmdbImageUrl, TMDB_POSTER_SIZES } from '../../services/tmdb';
import { useLazyBackdrop } from '../../hooks/useLazyBackdrop';
import { DetailBleed, DetailHeader } from './DetailHeader';
import { useDetailBleed } from '../../hooks/useHeroBleed';
import { useLazyPlot } from '../../hooks/useLazyPlot';
import { useLazyCredits } from '../../hooks/useLazyCredits';
import { useRpdbSettings } from '../../hooks/useRpdbSettings';
import { getRpdbPosterUrl } from '../../services/rpdb';
import { WatchlistButton } from './WatchlistButton';
import { MoreLikeThis } from './MoreLikeThis';
import { useMoreLikeThis } from '../../hooks/useMoreLikeThis';
import { useMoviePlaySources } from '../../hooks/usePlayResolver';
import { useMovieProgressByTmdb, useMovieProgress } from '../../hooks/useWatchProgress';
import type { StoredMovie, StoredSeries } from '../../db';
import type { MediaItem } from '../../types/media';
import './MovieDetail.css';

export interface MovieDetailProps {
  movie: StoredMovie;
  onClose: () => void;
  onCollapse?: () => void;
  isCollapsed?: boolean;
  onPlay?: (movie: StoredMovie, plot?: string | null, art?: string) => void;
  apiKey?: string | null; // TMDB API key for lazy backdrop loading
  onSelectRelated?: (item: MediaItem) => void; // a title picked in More like this
  onBack?: () => void; // one title back; only when opened from More like this
}

export function MovieDetail({ movie, onClose, onCollapse, isCollapsed, onPlay, apiKey, onSelectRelated, onBack }: MovieDetailProps) {
  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Lazy-load backdrop, plot, genre, and credits from TMDB if available
  const tmdbBackdropUrl = useLazyBackdrop(movie, apiKey);
  const { plot: lazyPlot, genre: lazyGenre } = useLazyPlot(movie, apiKey);
  const lazyCredits = useLazyCredits(movie, apiKey);

  const { items: related } = useMoreLikeThis('movie', movie.tmdb_id, apiKey);
  const playSources = useMoviePlaySources(movie.tmdb_id, movie.stream_id);
  const progressByTmdb = useMovieProgressByTmdb(movie.tmdb_id);
  const progressByStream = useMovieProgress(movie.stream_id);
  const watchProgress = (progressByTmdb ?? progressByStream)?.progress ?? 0;
  const hasMultipleSources = playSources.length > 1;

  // The backdrop shown here goes to the loading screen too (blurred behind it)
  const playArt = tmdbBackdropUrl || movie.stream_icon || undefined;
  const handlePlay = useCallback(() => {
    onPlay?.(movie, lazyPlot || movie.plot, playArt);
  }, [movie, onPlay, lazyPlot, playArt]);

  const handlePlayFromSource = useCallback((url: string) => {
    onPlay?.({ ...movie, direct_url: url }, lazyPlot || movie.plot, playArt);
  }, [movie, onPlay, lazyPlot, playArt]);

  // Load RPDB settings for poster
  const { apiKey: rpdbApiKey } = useRpdbSettings();
  const rpdbPosterUrl = rpdbApiKey && movie.tmdb_id
    ? getRpdbPosterUrl(rpdbApiKey, movie.tmdb_id, 'movie')
    : null;

  // Get images - use TMDB backdrop if available, fallback to stream_icon
  const backdropUrl = tmdbBackdropUrl || movie.stream_icon;

  // Priority: RPDB poster > local poster > TMDB fallback
  const posterUrl = rpdbPosterUrl || movie.stream_icon ||
    (movie.backdrop_path
      ? getTmdbImageUrl(movie.backdrop_path, TMDB_POSTER_SIZES.medium)
      : null);

  // Use clean title if available, otherwise fall back to name
  const displayTitle = movie.title || movie.name;

  // Use year field if available, otherwise extract from release_date
  const year = movie.year || movie.release_date?.slice(0, 4);

  // Rating - only show if it's a meaningful value (not 0, not NaN)
  const parsedRating = movie.rating ? parseFloat(movie.rating) : NaN;
  const rating = !isNaN(parsedRating) && parsedRating > 0 ? parsedRating : null;
  const genreSource = movie.genre || lazyGenre;
  const genres = genreSource?.split(',').map((g) => g.trim()).filter(Boolean) ?? [];
  const duration = movie.duration && movie.duration > 0
    ? `${Math.floor(movie.duration / 60)}h ${movie.duration % 60}m`
    : null;

  // The backdrop runs up under the title bar, clear until the art scrolls away (off while slid away for the player)
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { onScroll: bleedScroll } = useDetailBleed(!isCollapsed, scrollerRef);

  return (
    <div
      className={`movie-detail${isCollapsed ? ' movie-detail--collapsed' : ''}`}
      ref={scrollerRef}
      onScroll={(e) => bleedScroll(e.currentTarget.scrollTop)}
    >
      <DetailBleed />
      {/* Backdrop */}
      <div className="movie-detail__backdrop">
        {backdropUrl && <img src={backdropUrl} alt="" aria-hidden="true" />}
        <div className="movie-detail__backdrop-gradient" />
      </div>

      {/* Header with back button and collapse */}
      <DetailHeader className="movie-detail" onHome={onClose} onBack={onBack} onCollapse={onCollapse} />

      {/* Content */}
      <div className="movie-detail__content">
        <div className="movie-detail__main">
          {/* Poster */}
          <div className="movie-detail__poster">
            {posterUrl ? (
              <img src={posterUrl} alt={movie.name} />
            ) : (
              <div className="movie-detail__poster-placeholder">
                <span>{movie.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            {watchProgress >= 90 && (
              <div className="movie-detail__watched" />
            )}
            {watchProgress > 0 && watchProgress < 90 && (
              <div className="movie-detail__progress">
                <div className="movie-detail__progress-bar" style={{ width: `${watchProgress}%` }} />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="movie-detail__info">
            <h1 className="movie-detail__title">{displayTitle}</h1>

            <div className="movie-detail__meta">
              {year && <span className="movie-detail__year">{year}</span>}
              {rating && (
                <span className="movie-detail__rating">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {rating.toFixed(1)}
                </span>
              )}
              {duration && (
                <span className="movie-detail__duration">{duration}</span>
              )}
            </div>

            {genres.length > 0 && (
              <div className="movie-detail__genres">
                {genres.map((genre) => (
                  <span key={genre} className="movie-detail__genre">
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {(movie.plot || lazyPlot) && (
              <p className="movie-detail__description">{movie.plot || lazyPlot}</p>
            )}

            {/* Actions */}
            <div className="movie-detail__actions">
              <button
                className="movie-detail__btn movie-detail__btn--primary"
                onClick={handlePlay}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
                </svg>
                Play
              </button>
              <WatchlistButton
                type="movie"
                tmdbId={movie.tmdb_id}
                streamId={movie.stream_id}
                name={movie.name}
                className="movie-detail__btn movie-detail__btn--secondary"
              />
            </div>

            {/* Credits */}
            <div className="movie-detail__credits">
              {lazyCredits.cast && (
                <div className="movie-detail__credit-row">
                  <span className="movie-detail__credit-label">Cast</span>
                  <span className="movie-detail__credit-value">{lazyCredits.cast}</span>
                </div>
              )}
              {lazyCredits.director && (
                <div className="movie-detail__credit-row">
                  <span className="movie-detail__credit-label">Director</span>
                  <span className="movie-detail__credit-value">{lazyCredits.director}</span>
                </div>
              )}
            </div>

            {/* Source picker — only when multiple sources */}
            {hasMultipleSources && (
              <div className="movie-detail__sources">
                <span className="movie-detail__sources-label">Available from</span>
                <div className="movie-detail__sources-list">
                  {playSources.map((src) => (
                    <button
                      key={src.sourceId}
                      className="movie-detail__source-btn"
                      onClick={() => handlePlayFromSource(src.url)}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {src.sourceName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <MoreLikeThis type="movie" items={related} onSelect={onSelectRelated} />
      </div>
    </div>
  );
}

export default MovieDetail;
