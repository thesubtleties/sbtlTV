/**
 * TMDB-enhanced list hooks
 *
 * These hooks provide Netflix-style curated lists by matching
 * TMDB trending/popular lists against local Xtream content.
 *
 * Uses WithCache functions that:
 * - Use direct API when access token is available
 * - Fall back to GitHub-cached lists when no token
 *
 * PERFORMANCE: Uses indexed tmdb_id lookups instead of full table scans.
 */

import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries } from '../db';
import {
  // WithCache functions (work with or without token)
  getTrendingMoviesWithCache,
  getTrendingTvShowsWithCache,
  getPopularMoviesWithCache,
  getPopularTvShowsWithCache,
  getTopRatedMoviesWithCache,
  getTopRatedTvShowsWithCache,
  getNowPlayingMoviesWithCache,
  getUpcomingMoviesWithCache,
  getOnTheAirTvShowsWithCache,
  getAiringTodayTvShowsWithCache,
  getMovieGenresWithCache,
  getTvGenresWithCache,
  // Direct API functions (require token)
  discoverMoviesByGenre,
  discoverTvShowsByGenre,
  type TmdbMovieResult,
  type TmdbTvResult,
  type TmdbGenre,
} from '../services/tmdb';

// ===========================================================================
// Settings Hook
// ===========================================================================

/**
 * Get TMDB access token from settings
 * Note: This is the "API Read Access Token" from TMDB, not the API key
 */
export function useTmdbAccessToken(): string | null {
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    async function loadToken() {
      if (!window.storage) return;
      const result = await window.storage.getSettings();
      if (result.data && 'tmdbApiKey' in result.data) {
        // Still stored as tmdbApiKey in settings for backwards compat
        setAccessToken((result.data as { tmdbApiKey?: string }).tmdbApiKey ?? null);
      }
    }
    loadToken();
  }, []);

  return accessToken;
}

// Alias for backwards compatibility
export const useTmdbApiKey = useTmdbAccessToken;

/**
 * Get enabled movie genres from settings
 * Returns undefined if not yet loaded, or array of genre IDs
 */
export function useEnabledMovieGenres(): number[] | undefined {
  const [enabledGenres, setEnabledGenres] = useState<number[] | undefined>(undefined);

  useEffect(() => {
    async function loadSettings() {
      if (!window.storage) return;
      const result = await window.storage.getSettings();
      if (result.data && 'movieGenresEnabled' in result.data) {
        setEnabledGenres((result.data as { movieGenresEnabled?: number[] }).movieGenresEnabled);
      }
    }
    loadSettings();
  }, []);

  return enabledGenres;
}

/**
 * Get enabled series genres from settings
 * Returns undefined if not yet loaded, or array of genre IDs
 */
export function useEnabledSeriesGenres(): number[] | undefined {
  const [enabledGenres, setEnabledGenres] = useState<number[] | undefined>(undefined);

  useEffect(() => {
    async function loadSettings() {
      if (!window.storage) return;
      const result = await window.storage.getSettings();
      if (result.data && 'seriesGenresEnabled' in result.data) {
        setEnabledGenres((result.data as { seriesGenresEnabled?: number[] }).seriesGenresEnabled);
      }
    }
    loadSettings();
  }, []);

  return enabledGenres;
}

// ===========================================================================
// Helper: Match TMDB list to local content using index
// ===========================================================================

/**
 * Query local movies by TMDB IDs using the tmdb_id index
 * Much faster than filtering all movies!
 */
function useMoviesByTmdbIds(tmdbIds: number[]) {
  return useLiveQuery(async () => {
    if (tmdbIds.length === 0) return [];
    // Use indexed lookup - O(log n) per ID instead of O(n) full scan
    return db.vodMovies.where('tmdb_id').anyOf(tmdbIds).toArray();
  }, [tmdbIds.join(',')]);
}

/**
 * Query local series by TMDB IDs using the tmdb_id index
 */
function useSeriesByTmdbIds(tmdbIds: number[]) {
  return useLiveQuery(async () => {
    if (tmdbIds.length === 0) return [];
    return db.vodSeries.where('tmdb_id').anyOf(tmdbIds).toArray();
  }, [tmdbIds.join(',')]);
}

/**
 * Sort matched results by TMDB order
 */
function sortByTmdbOrder<T extends { tmdb_id?: number }>(
  items: T[],
  tmdbOrder: Map<number, number>
): T[] {
  return [...items].sort(
    (a, b) =>
      (tmdbOrder.get(a.tmdb_id!) ?? Infinity) -
      (tmdbOrder.get(b.tmdb_id!) ?? Infinity)
  );
}

// ===========================================================================
// Generic hook factory for TMDB movie lists
// ===========================================================================

function useMovieList(
  fetchFn: (token?: string | null) => Promise<TmdbMovieResult[]>,
  accessToken: string | null
) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetchFn(accessToken)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const tmdbIds = useMemo(() => tmdbMovies.map((m) => m.id), [tmdbMovies]);
  const localMovies = useMoviesByTmdbIds(tmdbIds);

  const movies = useMemo(() => {
    if (!localMovies || tmdbMovies.length === 0) return [];
    const tmdbOrder = new Map(tmdbMovies.map((m, i) => [m.id, i]));
    return sortByTmdbOrder(localMovies, tmdbOrder);
  }, [localMovies, tmdbMovies]);

  return {
    movies,
    loading: loading || localMovies === undefined,
    error,
  };
}

// ===========================================================================
// Generic hook factory for TMDB series lists
// ===========================================================================

function useSeriesList(
  fetchFn: (token?: string | null) => Promise<TmdbTvResult[]>,
  accessToken: string | null
) {
  const [tmdbSeries, setTmdbSeries] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetchFn(accessToken)
      .then(setTmdbSeries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accessToken]);

  const tmdbIds = useMemo(() => tmdbSeries.map((s) => s.id), [tmdbSeries]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbSeries.length === 0) return [];
    const tmdbOrder = new Map(tmdbSeries.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbSeries]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

// ===========================================================================
// Movie List Hooks
// ===========================================================================

export function useTrendingMovies(accessToken: string | null) {
  return useMovieList(
    (token) => getTrendingMoviesWithCache(token, 'week'),
    accessToken
  );
}

export function usePopularMovies(accessToken: string | null) {
  return useMovieList(getPopularMoviesWithCache, accessToken);
}

export function useTopRatedMovies(accessToken: string | null) {
  return useMovieList(getTopRatedMoviesWithCache, accessToken);
}

export function useNowPlayingMovies(accessToken: string | null) {
  return useMovieList(getNowPlayingMoviesWithCache, accessToken);
}

export function useUpcomingMovies(accessToken: string | null) {
  return useMovieList(getUpcomingMoviesWithCache, accessToken);
}

/**
 * Get local movies sorted by popularity (no TMDB required)
 */
export function useLocalPopularMovies(limit = 20) {
  const movies = useLiveQuery(async () => {
    return db.vodMovies
      .orderBy('popularity')
      .reverse()
      .filter((m) => m.popularity !== undefined && m.popularity > 0)
      .limit(limit)
      .toArray();
  }, [limit]);

  return {
    movies: movies ?? [],
    loading: movies === undefined,
  };
}

/**
 * Get movies by genre (requires access token for discover API)
 */
export function useMoviesByGenre(accessToken: string | null, genreId: number | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !genreId) return;

    setLoading(true);
    setError(null);

    discoverMoviesByGenre(accessToken, genreId)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accessToken, genreId]);

  const tmdbIds = useMemo(() => tmdbMovies.map((m) => m.id), [tmdbMovies]);
  const localMovies = useMoviesByTmdbIds(tmdbIds);

  const movies = useMemo(() => {
    if (!localMovies || tmdbMovies.length === 0) return [];
    const tmdbOrder = new Map(tmdbMovies.map((m, i) => [m.id, i]));
    return sortByTmdbOrder(localMovies, tmdbOrder);
  }, [localMovies, tmdbMovies]);

  return {
    movies,
    loading: loading || localMovies === undefined,
    error,
  };
}

// ===========================================================================
// TV Series List Hooks
// ===========================================================================

export function useTrendingSeries(accessToken: string | null) {
  return useSeriesList(
    (token) => getTrendingTvShowsWithCache(token, 'week'),
    accessToken
  );
}

export function usePopularSeries(accessToken: string | null) {
  return useSeriesList(getPopularTvShowsWithCache, accessToken);
}

export function useTopRatedSeries(accessToken: string | null) {
  return useSeriesList(getTopRatedTvShowsWithCache, accessToken);
}

export function useOnTheAirSeries(accessToken: string | null) {
  return useSeriesList(getOnTheAirTvShowsWithCache, accessToken);
}

export function useAiringTodaySeries(accessToken: string | null) {
  return useSeriesList(getAiringTodayTvShowsWithCache, accessToken);
}

/**
 * Get local series sorted by popularity (no TMDB required)
 */
export function useLocalPopularSeries(limit = 20) {
  const series = useLiveQuery(async () => {
    return db.vodSeries
      .orderBy('popularity')
      .reverse()
      .filter((s) => s.popularity !== undefined && s.popularity > 0)
      .limit(limit)
      .toArray();
  }, [limit]);

  return {
    series: series ?? [],
    loading: series === undefined,
  };
}

/**
 * Get series by genre (requires access token for discover API)
 */
export function useSeriesByGenre(accessToken: string | null, genreId: number | null) {
  const [tmdbSeries, setTmdbSeries] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !genreId) return;

    setLoading(true);
    setError(null);

    discoverTvShowsByGenre(accessToken, genreId)
      .then(setTmdbSeries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accessToken, genreId]);

  const tmdbIds = useMemo(() => tmdbSeries.map((s) => s.id), [tmdbSeries]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbSeries.length === 0) return [];
    const tmdbOrder = new Map(tmdbSeries.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbSeries]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

// ===========================================================================
// Genre Hooks
// ===========================================================================

export function useMovieGenres(accessToken: string | null) {
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMovieGenresWithCache(accessToken)
      .then(setGenres)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  return { genres, loading };
}

export function useTvGenres(accessToken: string | null) {
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTvGenresWithCache(accessToken)
      .then(setGenres)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  return { genres, loading };
}

// ===========================================================================
// Featured Content Hook
// ===========================================================================

/**
 * Get featured content for hero section
 * Returns top items from trending (with cache fallback)
 */
export function useFeaturedContent(accessToken: string | null, type: 'movies' | 'series', count = 5) {
  const { movies: trendingMovies } = useTrendingMovies(accessToken);
  const { series: trendingSeries } = useTrendingSeries(accessToken);
  const { movies: popularMovies } = useLocalPopularMovies(count);
  const { series: popularSeries } = useLocalPopularSeries(count);

  const featured = useMemo(() => {
    if (type === 'movies') {
      // Use trending (from API or cache), fall back to local popularity
      const items = trendingMovies.length > 0 ? trendingMovies : popularMovies;
      return items.slice(0, count);
    } else {
      const items = trendingSeries.length > 0 ? trendingSeries : popularSeries;
      return items.slice(0, count);
    }
  }, [type, trendingMovies, trendingSeries, popularMovies, popularSeries, count]);

  return {
    items: featured,
    loading: false,
  };
}
