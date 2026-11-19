/**
 * SeriesDetail - Full page series detail view with season/episode picker
 *
 * Shows series information with backdrop, metadata, season dropdown,
 * and episode list. Slides in as a full page, not a modal.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getTmdbImageUrl, TMDB_POSTER_SIZES } from '../../services/tmdb';
import { useLazyBackdrop } from '../../hooks/useLazyBackdrop';
import { DetailBleed, DetailHeader } from './DetailHeader';
import { useDetailBleed } from '../../hooks/useHeroBleed';
import { useLazyPlot } from '../../hooks/useLazyPlot';
import { useLazyCredits } from '../../hooks/useLazyCredits';
import { useMergedEpisodes } from '../../hooks/useVodDedup';
import { blockingMessage, warningText } from '../../hooks/episodeFetchState';
import { useRpdbSettings } from '../../hooks/useRpdbSettings';
import { getRpdbPosterUrl } from '../../services/rpdb';
import { WatchlistButton } from './WatchlistButton';
import { EpisodeRow } from './EpisodeRow';
import { MoreLikeThis } from './MoreLikeThis';
import { useMoreLikeThis } from '../../hooks/useMoreLikeThis';
import { seriesSeasonKey } from '../../utils/detailNav';
import { useEpisodeProgressMap } from '../../hooks/useWatchProgress';
import { useUIStore } from '../../stores/uiStore';
import type { StoredMovie, StoredSeries, StoredEpisode } from '../../db';
import type { MediaItem, VodPlayInfo } from '../../types/media';
import './SeriesDetail.css';

export interface SeriesDetailProps {
  series: StoredSeries;
  onClose: () => void;
  onCollapse?: () => void;
  isCollapsed?: boolean;
  onPlayEpisode?: (info: VodPlayInfo) => void;
  apiKey?: string | null; // TMDB API key for lazy backdrop loading
  onSelectRelated?: (item: MediaItem) => void; // a title picked in More like this
  onBack?: () => void; // one title back; only when opened from More like this
  initialTab?: SeriesTab; // 'more' when coming Back to this series (it was left from its More like this tab)
}

type SeriesTab = 'episodes' | 'more';
const TABS: { id: SeriesTab; label: string }[] = [{ id: 'episodes', label: 'Episodes' }, { id: 'more', label: 'More like this' }];

export function SeriesDetail({ series, onClose, onCollapse, isCollapsed, onPlayEpisode, apiKey, onSelectRelated, onBack, initialTab }: SeriesDetailProps) {
  const seriesKey = seriesSeasonKey(series);
  const rememberedSeason = useUIStore((s) => s.seriesSeasonMap[seriesKey]);
  const setSeriesSeason = useUIStore((s) => s.setSeriesSeason);
  const clearSeriesSeason = useUIStore((s) => s.clearSeriesSeason);
  const [selectedSeason, setSelectedSeasonLocal] = useState<number>(rememberedSeason ?? 1);

  const setSelectedSeason = useCallback((season: number) => {
    setSelectedSeasonLocal(season);
    setSeriesSeason(seriesKey, season);
  }, [seriesKey, setSeriesSeason]);

  // Fetch episodes (cross-source merge when tmdb_id matches multiple sources)
  const { seasons, loading, error, issues, hasEpisodes, refreshing, refetch } = useMergedEpisodes(series.series_id, series.tmdb_id);
  // Episodes | More like this tabs: shown while the row may still come (so the episodes don't jump
  // down when it does) and when there is one; gone when there's nothing to show
  const { items: related, pending: relatedPending } = useMoreLikeThis('series', series.tmdb_id, apiKey);
  const [tab, setTab] = useState<SeriesTab>(initialTab ?? 'episodes');
  const hasTabs = related.length > 0 || relatedPending;
  const activeTab = hasTabs ? tab : 'episodes';
  // A retry that fails at once (offline, blocked) still shows it tried.
  const [retryShown, setRetryShown] = useState(false);
  const retry = useCallback(() => {
    setRetryShown(true);
    window.setTimeout(() => setRetryShown(false), 700);
    void refetch();
  }, [refetch]);
  const retrying = retryShown || (refreshing && hasEpisodes);
  const sources = useUIStore((s) => s.sources);
  const sourceName = useCallback((id: string) => sources.find((s) => s.id === id)?.name ?? 'Your provider', [sources]);
  // Nothing stored: the problem takes the list's place. A stored list stays, with a warning.
  const problem = hasEpisodes ? null : (error ?? blockingMessage(issues, sourceName));
  const warning = hasEpisodes ? warningText(issues, sourceName) : null;
  const warningDetail = issues.filter((i) => i.kind === 'failed' && i.message).map((i) => `${sourceName(i.sourceId)}: ${i.message}`).join('\n');

  // Get sorted season numbers
  const seasonNumbers = Object.keys(seasons)
    .map(Number)
    .sort((a, b) => a - b);

  // Set first season as default when loaded (only if no remembered season)
  useEffect(() => {
    if (seasonNumbers.length > 0 && !seasonNumbers.includes(selectedSeason)) {
      setSelectedSeason(seasonNumbers[0]);
    }
  }, [seasonNumbers, selectedSeason, setSelectedSeason]);

  // Leaving this series (Home, Esc, or Back to the title before) forgets its remembered season
  const handleHome = useCallback(() => {
    clearSeriesSeason(seriesKey);
    onClose();
  }, [clearSeriesSeason, seriesKey, onClose]);
  const handleBack = useCallback(() => {
    clearSeriesSeason(seriesKey);
    onBack?.();
  }, [clearSeriesSeason, seriesKey, onBack]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleHome();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleHome]);

  // Lazy-load backdrop, plot, genre, and credits from TMDB if available
  const tmdbBackdropUrl = useLazyBackdrop(series, apiKey);
  const { plot: lazyPlot, genre: lazyGenre } = useLazyPlot(series, apiKey);
  const lazyCredits = useLazyCredits(series, apiKey);

  const handlePlayEpisode = useCallback(
    (episode: StoredEpisode) => {
      onPlayEpisode?.({
        url: episode.direct_url,
        title: series.title || series.name,
        year: series.year || series.release_date?.slice(0, 4),
        plot: lazyPlot || series.plot,
        type: 'series',
        episodeInfo: `S${episode.season_num} E${episode.episode_num}${episode.title ? ` · ${episode.title}` : ''}`,
        streamId: episode.id,
        tmdbId: series.tmdb_id,
        sourceId: series.source_id, // series.source_id is always set; episode.source_id is not (adapter omits it)
        seasonNum: episode.season_num,
        episodeNum: episode.episode_num,
        seriesStreamId: series.series_id,
        art: tmdbBackdropUrl || series.cover || undefined,   // the backdrop shown here, blurred behind the loading screen
      });
    },
    [series, onPlayEpisode, lazyPlot, tmdbBackdropUrl]
  );

  // Load RPDB settings for poster
  const { apiKey: rpdbApiKey } = useRpdbSettings();
  const rpdbPosterUrl = rpdbApiKey && series.tmdb_id
    ? getRpdbPosterUrl(rpdbApiKey, series.tmdb_id, 'series')
    : null;

  // Get images - use TMDB backdrop if available, fallback to cover
  const backdropUrl = tmdbBackdropUrl || series.cover;

  // Priority: RPDB poster > local cover > TMDB fallback
  const posterUrl = rpdbPosterUrl || series.cover ||
    (series.backdrop_path
      ? getTmdbImageUrl(series.backdrop_path, TMDB_POSTER_SIZES.medium)
      : null);

  // Use clean title if available, otherwise fall back to name
  const displayTitle = series.title || series.name;

  // Use year field if available, otherwise extract from release_date
  const year = series.year || series.release_date?.slice(0, 4);

  // Rating - only show if it's a meaningful value (not 0, not NaN)
  const parsedRating = series.rating ? parseFloat(series.rating) : NaN;
  const rating = !isNaN(parsedRating) && parsedRating > 0 ? parsedRating : null;
  const genreSource = series.genre || lazyGenre;
  const genres = genreSource?.split(',').map((g) => g.trim()).filter(Boolean) ?? [];

  // Episode progress (bulk query for entire series)
  const episodeProgressMap = useEpisodeProgressMap({
    tmdbId: series.tmdb_id, sourceId: series.source_id, seriesStreamId: series.series_id,
  });

  // Current season episodes
  const currentEpisodes = seasons[selectedSeason] ?? [];

  // The backdrop runs up under the title bar, clear until the art scrolls away (off while slid away for the player)
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { onScroll: bleedScroll } = useDetailBleed(!isCollapsed, scrollerRef);

  return (
    <div
      className={`series-detail${isCollapsed ? ' series-detail--collapsed' : ''}`}
      ref={scrollerRef}
      onScroll={(e) => bleedScroll(e.currentTarget.scrollTop)}
    >
      <DetailBleed />
      {/* Backdrop */}
      <div className="series-detail__backdrop">
        {backdropUrl && <img src={backdropUrl} alt="" aria-hidden="true" />}
        <div className="series-detail__backdrop-gradient" />
      </div>

      {/* Header with back button and collapse */}
      <DetailHeader className="series-detail" onHome={handleHome} onBack={onBack ? handleBack : undefined} onCollapse={onCollapse} />

      {/* Content */}
      <div className="series-detail__content">
        <div className="series-detail__main">
          {/* Poster */}
          <div className="series-detail__poster">
            {posterUrl ? (
              <img src={posterUrl} alt={series.name} />
            ) : (
              <div className="series-detail__poster-placeholder">
                <span>{series.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="series-detail__info">
            <h1 className="series-detail__title">{displayTitle}</h1>

            <div className="series-detail__meta">
              {year && <span className="series-detail__year">{year}</span>}
              {rating && (
                <span className="series-detail__rating">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {rating.toFixed(1)}
                </span>
              )}
              {seasonNumbers.length > 0 && (
                <span className="series-detail__seasons-count">
                  {seasonNumbers.length} Season{seasonNumbers.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {genres.length > 0 && (
              <div className="series-detail__genres">
                {genres.map((genre) => (
                  <span key={genre} className="series-detail__genre">
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {(series.plot || lazyPlot) && (
              <p className="series-detail__description">{series.plot || lazyPlot}</p>
            )}

            {/* Credits */}
            {lazyCredits.cast && (
              <div className="series-detail__credits">
                <span className="series-detail__credit-label">Cast</span>
                <span className="series-detail__credit-value">{lazyCredits.cast}</span>
              </div>
            )}

            {/* Actions */}
            <div className="series-detail__actions">
              <WatchlistButton
                type="series"
                tmdbId={series.tmdb_id}
                streamId={series.series_id}
                name={series.name}
                className="series-detail__btn series-detail__btn--secondary"
              />
            </div>
          </div>
        </div>

        {/* Episodes section */}
        <div className={`series-detail__episodes-section${activeTab === 'more' ? ' series-detail__episodes-section--tabs-only' : ''}`}>
          {hasTabs && (
            <div className="series-detail__tabs" role="tablist" aria-label="Series sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`series-detail__tab${activeTab === t.id ? ' series-detail__tab--active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {activeTab === 'episodes' && (
          <>
          {/* Season selector */}
          <div className="series-detail__season-selector">
            <label htmlFor="season-select">Season</label>
            <div className="series-detail__select-wrapper">
              <select
                id="season-select"
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
              >
                {seasonNumbers.map((num) => (
                  <option key={num} value={num}>
                    Season {num}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
            {warning && (
              <div className="series-detail__refresh-warning" role="status" title={warningDetail || undefined}>
                <svg className="series-detail__refresh-warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
                <span>{retrying ? 'Trying again…' : warning}</span>
                <button type="button" className={`series-detail__refresh-button${retrying ? ' series-detail__refresh-button--spinning' : ''}`} onClick={retry} disabled={retrying} aria-label="Try again" title="Try again">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Episode list */}
          <div className="series-detail__episodes">
            {loading ? (
              <div className="series-detail__loading">
                <div className="series-detail__spinner" />
                <span>Loading episodes...</span>
              </div>
            ) : problem ? (
              <div className="series-detail__error">
                <p>{problem}</p>
                <button onClick={refetch}>Try Again</button>
              </div>
            ) : currentEpisodes.length === 0 ? (
              <div className="series-detail__empty">
                <p>No episodes found for Season {selectedSeason}</p>
              </div>
            ) : (
              <div className="series-detail__episode-list">
                {currentEpisodes.map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    progress={episodeProgressMap.get(`S${episode.season_num}_E${episode.episode_num}`) ?? 0}
                    onPlay={handlePlayEpisode}
                  />
                ))}
              </div>
            )}
          </div>
          </>
          )}
        </div>
        {activeTab === 'more' && (
          <MoreLikeThis type="series" items={related} inTab onSelect={onSelectRelated} />
        )}
      </div>
    </div>
  );
}

export default SeriesDetail;
