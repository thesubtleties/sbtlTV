import { useMemo } from 'react';
import type { VodType } from '../types/media';
import { useGroupedVodCategories } from './useVodCategories';
import {
  useTrendingMovies,
  usePopularMovies,
  useTopRatedMovies,
  useNowPlayingMovies,
  useLocalPopularMovies,
  useTrendingSeries,
  usePopularSeries,
  useTopRatedSeries,
  useOnTheAirSeries,
  useLocalPopularSeries,
  useFeaturedContent,
  useTmdbApiKey,
  useMovieGenres,
  useTvGenres,
  useEnabledMovieGenres,
  useEnabledSeriesGenres,
  useMultipleMoviesByGenre,
  useMultipleSeriesByGenre,
} from './useTmdbLists';
import { useWatchlistMovies, useWatchlistSeries } from './useWatchlist';
import { useMovieProgressMap } from './useWatchProgress';

/**
 * Aggregates all data needed for the VodPage home view (hero + carousels).
 * Pulls from TMDB lists, watchlist, local popularity, categories, and genre data.
 */
export function useVodHomeData(type: VodType) {
  // API key for TMDB
  const tmdbApiKey = useTmdbApiKey();

  // Genres from TMDB
  const { genres: movieGenres } = useMovieGenres(type === 'movie' ? tmdbApiKey : null);
  const { genres: tvGenres } = useTvGenres(type === 'series' ? tmdbApiKey : null);
  const genres = type === 'movie' ? movieGenres : tvGenres;

  // Featured content for hero
  const { items: featuredItems } = useFeaturedContent(tmdbApiKey, type, 5);

  // Trending and popular from TMDB (if API key available)
  const { movies: trendingMovies, loading: trendingMoviesLoading } = useTrendingMovies(type === 'movie' ? tmdbApiKey : null);
  const { series: trendingSeries, loading: trendingSeriesLoading } = useTrendingSeries(type === 'series' ? tmdbApiKey : null);
  const { movies: popularMovies, loading: popularMoviesLoading } = usePopularMovies(type === 'movie' ? tmdbApiKey : null);
  const { series: popularSeries, loading: popularSeriesLoading } = usePopularSeries(type === 'series' ? tmdbApiKey : null);

  // Top rated
  const { movies: topRatedMovies, loading: topRatedMoviesLoading } = useTopRatedMovies(type === 'movie' ? tmdbApiKey : null);
  const { series: topRatedSeries, loading: topRatedSeriesLoading } = useTopRatedSeries(type === 'series' ? tmdbApiKey : null);

  // Now playing (movies) / On the air (series)
  const { movies: nowPlayingMovies, loading: nowPlayingLoading } = useNowPlayingMovies(type === 'movie' ? tmdbApiKey : null);
  const { series: onTheAirSeries, loading: onTheAirLoading } = useOnTheAirSeries(type === 'series' ? tmdbApiKey : null);

  // Select the right data based on type
  const trendingItems = type === 'movie' ? trendingMovies : trendingSeries;
  const trendingLoading = type === 'movie' ? trendingMoviesLoading : trendingSeriesLoading;
  const popularItems = type === 'movie' ? popularMovies : popularSeries;
  const popularLoading = type === 'movie' ? popularMoviesLoading : popularSeriesLoading;
  const topRatedItems = type === 'movie' ? topRatedMovies : topRatedSeries;
  const topRatedLoading = type === 'movie' ? topRatedMoviesLoading : topRatedSeriesLoading;
  const nowOrOnAirItems = type === 'movie' ? nowPlayingMovies : onTheAirSeries;
  const nowOrOnAirLoading = type === 'movie' ? nowPlayingLoading : onTheAirLoading;

  // Watchlist
  const watchlistMovies = useWatchlistMovies();
  const watchlistSeries = useWatchlistSeries();
  const watchlistItems = type === 'movie' ? watchlistMovies : watchlistSeries;

  // Bulk movie progress (one query, passed down to cards as props)
  const movieProgressMap = useMovieProgressMap();

  // Fallback: local popularity (only when no TMDB API key)
  const { movies: localPopularMovies } = useLocalPopularMovies(type === 'movie' && !tmdbApiKey ? 20 : 0);
  const { series: localPopularSeries } = useLocalPopularSeries(type === 'series' && !tmdbApiKey ? 20 : 0);
  const localPopularItems = type === 'movie' ? localPopularMovies : localPopularSeries;

  // VOD categories (grouped by name across sources)
  const { groupedCategories } = useGroupedVodCategories(type);

  // Enabled genres from settings
  const enabledMovieGenres = useEnabledMovieGenres();
  const enabledSeriesGenres = useEnabledSeriesGenres();
  const enabledGenreIds = type === 'movie' ? enabledMovieGenres : enabledSeriesGenres;

  // Filter genres to only show enabled ones
  // No hard limit - user controls via Settings which genres to show
  const genresToShow = useMemo(() => {
    if (!genres.length) return [];
    // If no enabled genres defined yet (undefined), show all genres
    if (enabledGenreIds === undefined) {
      return genres;
    }
    // Show all enabled genres (user chose these in Settings)
    return genres.filter(g => enabledGenreIds.includes(g.id));
  }, [genres, enabledGenreIds]);

  // Get genre IDs for pre-fetching
  const genreIdsToFetch = useMemo(
    () => genresToShow.map(g => g.id),
    [genresToShow]
  );

  // Pre-fetch all genre data at once (not lazily per-carousel)
  // This ensures smooth scrolling - data is ready before carousels render
  const movieGenreData = useMultipleMoviesByGenre(
    type === 'movie' ? tmdbApiKey : null,
    type === 'movie' ? genreIdsToFetch : []
  );
  const seriesGenreData = useMultipleSeriesByGenre(
    type === 'series' ? tmdbApiKey : null,
    type === 'series' ? genreIdsToFetch : []
  );
  const genreData = type === 'movie' ? movieGenreData : seriesGenreData;

  return {
    tmdbApiKey,
    featuredItems,
    trendingItems,
    trendingLoading,
    popularItems,
    popularLoading,
    topRatedItems,
    topRatedLoading,
    nowOrOnAirItems,
    nowOrOnAirLoading,
    watchlistItems,
    movieProgressMap,
    localPopularItems,
    groupedCategories,
    genresToShow,
    genreData,
  };
}
