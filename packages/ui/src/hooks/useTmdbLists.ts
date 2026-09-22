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

const MAX_LIST_RETRIES = 3;
const LIST_RETRY_BASE_MS = 5000;
import { useEnabledSourceIds } from './useSourceFiltering';
import { useDataQuery } from '../data/useDataQuery';
import type { StoredMovie, StoredSeries } from '../db';
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
  discoverMoviesByGenreWithCache,
  discoverTvShowsByGenreWithCache,
  getCachedMovieGenreCounts,
  getCachedTvGenreCounts,
  type TmdbMovieResult,
  type TmdbTvResult,
  type TmdbGenre,
} from '../services/tmdb';
import {
  useTmdbApiKey as useTmdbApiKeySelector,
  useSettingsLoaded,
  useMovieGenresEnabled as useMovieGenresEnabledSelector,
  useSeriesGenresEnabled as useSeriesGenresEnabledSelector,
} from '../stores/uiStore';

// ===========================================================================
// Settings Hooks (read from Zustand — no IPC)
// ===========================================================================

/**
 * Get TMDB access token from Zustand settings
 * Note: This is the "API Read Access Token" from TMDB, not the API key
 */
export function useTmdbAccessToken(): string | null {
  return useTmdbApiKeySelector();
}

export function useTmdbAccessTokenState(): { token: string | null; loaded: boolean } {
  const token = useTmdbApiKeySelector();
  const loaded = useSettingsLoaded();
  return { token, loaded };
}

// Alias for backwards compatibility
export const useTmdbApiKey = useTmdbAccessToken;

/**
 * Get enabled movie genres from Zustand settings
 * Returns undefined if not yet loaded, or array of genre IDs
 */
export function useEnabledMovieGenres(): number[] | undefined {
  const loaded = useSettingsLoaded();
  const genres = useMovieGenresEnabledSelector();
  if (!loaded) return undefined;
  return genres;
}

/**
 * Get enabled series genres from Zustand settings
 * Returns undefined if not yet loaded, or array of genre IDs
 */
export function useEnabledSeriesGenres(): number[] | undefined {
  const loaded = useSettingsLoaded();
  const genres = useSeriesGenresEnabledSelector();
  if (!loaded) return undefined;
  return genres;
}

// ===========================================================================
// Helper: Match TMDB list to local content using index
// ===========================================================================

/**
 * Query local movies by TMDB IDs using the tmdb_id index
 * Much faster than filtering all movies!
 */
function useMoviesByTmdbIds(tmdbIds: number[]): StoredMovie[] | undefined {
  const enabledIds = useEnabledSourceIds();
  const { data } = useDataQuery(
    { type: 'movies', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: enabledIds },
    ['vod_movies'], [tmdbIds.join(','), enabledIds.join(',')],
  );
  return data;
}

/**
 * Query local series by TMDB IDs using the tmdb_id index (source-filtered)
 */
function useSeriesByTmdbIds(tmdbIds: number[]): StoredSeries[] | undefined {
  const enabledIds = useEnabledSourceIds();
  const { data } = useDataQuery(
    { type: 'series', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: enabledIds },
    ['vod_series'], [tmdbIds.join(','), enabledIds.join(',')],
  );
  return data;
}

/**
 * Filter to items in TMDB order map, then sort by that order
 */
function sortByTmdbOrder<T extends { tmdb_id?: number }>(
  items: T[],
  tmdbOrder: Map<number, number>
): T[] {
  // Dedup: one item per tmdb_id (first encountered wins — Dexie returns in insert order)
  const seen = new Set<number>();
  return items
    .filter((item) => {
      if (item.tmdb_id === undefined || !tmdbOrder.has(item.tmdb_id)) return false;
      if (seen.has(item.tmdb_id)) return false;
      seen.add(item.tmdb_id);
      return true;
    })
    .sort(
      (a, b) =>
        (tmdbOrder.get(a.tmdb_id!) ?? 0) - (tmdbOrder.get(b.tmdb_id!) ?? 0)
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

  // A failed list fetch (a busy main process mid-sync, a network blip) used to
  // leave the home showing "No content available" until the page remounted.
  // Retry a few times with backoff instead.
  const [retryAttempt, setRetryAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFn(accessToken)
      .then((results) => { if (!cancelled) setTmdbMovies(results); })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        if (retryAttempt < MAX_LIST_RETRIES) {
          setTimeout(() => { if (!cancelled) setRetryAttempt((n) => n + 1); }, LIST_RETRY_BASE_MS * 2 ** retryAttempt);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // fetchFn intentionally omitted — callers pass inline arrows, so including
  // it would cause an infinite re-fetch loop on every render.
  }, [accessToken, retryAttempt]);

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

  // A failed list fetch (a busy main process mid-sync, a network blip) used to
  // leave the home showing "No content available" until the page remounted.
  // Retry a few times with backoff instead.
  const [retryAttempt, setRetryAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFn(accessToken)
      .then((results) => { if (!cancelled) setTmdbSeries(results); })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        if (retryAttempt < MAX_LIST_RETRIES) {
          setTimeout(() => { if (!cancelled) setRetryAttempt((n) => n + 1); }, LIST_RETRY_BASE_MS * 2 ** retryAttempt);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // fetchFn intentionally omitted — callers pass inline arrows, so including
  // it would cause an infinite re-fetch loop on every render.
  }, [accessToken, retryAttempt]);

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
  const enabledIds = useEnabledSourceIds();
  // Fetch a generous buffer for dedup, not the full table
  const { data, loading } = useDataQuery(
    limit > 0 ? { type: 'movies', by: { kind: 'popular' }, sourceIds: enabledIds, limit: limit * 10 } : null,
    ['vod_movies'], [limit, enabledIds.join(',')],
  );
  const movies = useMemo(() => {
    const seen = new Set<number>();
    return (data ?? []).filter((m) => {
      if (!m.tmdb_id) return true;
      if (seen.has(m.tmdb_id)) return false;
      seen.add(m.tmdb_id);
      return true;
    }).slice(0, limit);
  }, [data, limit]);

  return { movies, loading: limit > 0 && loading };
}

/**
 * Get movies by genre (uses cache fallback when no access token)
 */
export function useMoviesByGenre(accessToken: string | null, genreId: number | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  // Start loading=true if we have genreId - prevents brief "empty" flash before useEffect
  const [loading, setLoading] = useState(!!genreId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genreId) return;

    setLoading(true);
    setError(null);

    discoverMoviesByGenreWithCache(accessToken, genreId)
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
  const enabledIds = useEnabledSourceIds();
  const { data, loading } = useDataQuery(
    limit > 0 ? { type: 'series', by: { kind: 'popular' }, sourceIds: enabledIds, limit: limit * 10 } : null,
    ['vod_series'], [limit, enabledIds.join(',')],
  );
  const series = useMemo(() => {
    const seen = new Set<number>();
    return (data ?? []).filter((s) => {
      if (!s.tmdb_id) return true;
      if (seen.has(s.tmdb_id)) return false;
      seen.add(s.tmdb_id);
      return true;
    }).slice(0, limit);
  }, [data, limit]);

  return { series, loading: limit > 0 && loading };
}

/**
 * Get series by genre (uses cache fallback when no access token)
 */
export function useSeriesByGenre(accessToken: string | null, genreId: number | null) {
  const [tmdbSeries, setTmdbSeries] = useState<TmdbTvResult[]>([]);
  // Start loading=true if we have genreId - prevents brief "empty" flash before useEffect
  const [loading, setLoading] = useState(!!genreId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genreId) return;

    setLoading(true);
    setError(null);

    discoverTvShowsByGenreWithCache(accessToken, genreId)
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

/**
 * Get cached movie counts per genre (for settings UI)
 * Used to show which genres have content in cache when no API key
 */
export function useCachedMovieGenreCounts(hasApiKey: boolean) {
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(!hasApiKey);

  useEffect(() => {
    // Only fetch counts when no API key (cache mode)
    if (hasApiKey) {
      setCounts(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);
    getCachedMovieGenreCounts()
      .then(setCounts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [hasApiKey]);

  return { counts, loading };
}

/**
 * Get cached TV show counts per genre (for settings UI)
 * Used to show which genres have content in cache when no API key
 */
export function useCachedTvGenreCounts(hasApiKey: boolean) {
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(!hasApiKey);

  useEffect(() => {
    // Only fetch counts when no API key (cache mode)
    if (hasApiKey) {
      setCounts(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);
    getCachedTvGenreCounts()
      .then(setCounts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [hasApiKey]);

  return { counts, loading };
}

// ===========================================================================
// Multi-Genre Hooks (pre-fetch all genres at once)
// ===========================================================================

interface GenreData<T> {
  genreId: number;
  items: T[];
  loading: boolean;
}

/**
 * Pre-fetch movies for multiple genres at once
 * Returns a Map of genreId -> { items, loading }
 */
export function useMultipleMoviesByGenre(
  accessToken: string | null,
  genreIds: number[]
): Map<number, { items: StoredMovie[]; loading: boolean }> {
  const [tmdbData, setTmdbData] = useState<Map<number, TmdbMovieResult[]>>(new Map());
  const [fetchedGenreIds, setFetchedGenreIds] = useState<string>('');

  // Track which genreIds we've fetched (as string for easy comparison)
  const genreIdsKey = genreIds.join(',');

  // Fetch all genres in parallel (uses cache fallback when no access token)
  useEffect(() => {
    if (genreIds.length === 0) return;

    // Fetch each genre in parallel
    Promise.all(
      genreIds.map(async (genreId) => {
        try {
          const movies = await discoverMoviesByGenreWithCache(accessToken, genreId);
          return { genreId, movies };
        } catch {
          return { genreId, movies: [] };
        }
      })
    ).then((results) => {
      const newData = new Map<number, TmdbMovieResult[]>();
      results.forEach(({ genreId, movies }) => {
        newData.set(genreId, movies);
      });
      setTmdbData(newData);
      setFetchedGenreIds(genreIdsKey);
    });
  }, [accessToken, genreIdsKey]); // genreIdsKey for stable dependency

  // Collect all TMDB IDs for batch local lookup
  const allTmdbIds = useMemo(() => {
    const ids: number[] = [];
    tmdbData.forEach((movies) => {
      movies.forEach((m) => ids.push(m.id));
    });
    return ids;
  }, [tmdbData]);

  const localMovies = useMoviesByTmdbIds(allTmdbIds);

  // Build result map
  // Loading if: fetch not complete OR local lookup not complete
  const isFetching = fetchedGenreIds !== genreIdsKey;

  return useMemo(() => {
    const result = new Map<number, { items: StoredMovie[]; loading: boolean }>();

    genreIds.forEach((genreId) => {
      const tmdbMovies = tmdbData.get(genreId) || [];
      const isLoading = isFetching || localMovies === undefined;

      if (isLoading) {
        result.set(genreId, { items: [], loading: true });
      } else if (tmdbMovies.length === 0) {
        result.set(genreId, { items: [], loading: false });
      } else {
        const tmdbOrder = new Map(tmdbMovies.map((m, i) => [m.id, i]));
        const items = sortByTmdbOrder(localMovies || [], tmdbOrder);
        result.set(genreId, { items, loading: false });
      }
    });

    return result;
  }, [genreIds, tmdbData, isFetching, localMovies]);
}

/**
 * Pre-fetch series for multiple genres at once
 * Returns a Map of genreId -> { items, loading }
 */
export function useMultipleSeriesByGenre(
  accessToken: string | null,
  genreIds: number[]
): Map<number, { items: StoredSeries[]; loading: boolean }> {
  const [tmdbData, setTmdbData] = useState<Map<number, TmdbTvResult[]>>(new Map());
  const [fetchedGenreIds, setFetchedGenreIds] = useState<string>('');

  // Track which genreIds we've fetched (as string for easy comparison)
  const genreIdsKey = genreIds.join(',');

  // Fetch all genres in parallel (uses cache fallback when no access token)
  useEffect(() => {
    if (genreIds.length === 0) return;

    // Fetch each genre in parallel
    Promise.all(
      genreIds.map(async (genreId) => {
        try {
          const series = await discoverTvShowsByGenreWithCache(accessToken, genreId);
          return { genreId, series };
        } catch {
          return { genreId, series: [] };
        }
      })
    ).then((results) => {
      const newData = new Map<number, TmdbTvResult[]>();
      results.forEach(({ genreId, series }) => {
        newData.set(genreId, series);
      });
      setTmdbData(newData);
      setFetchedGenreIds(genreIdsKey);
    });
  }, [accessToken, genreIdsKey]); // genreIdsKey for stable dependency

  // Collect all TMDB IDs for batch local lookup
  const allTmdbIds = useMemo(() => {
    const ids: number[] = [];
    tmdbData.forEach((series) => {
      series.forEach((s) => ids.push(s.id));
    });
    return ids;
  }, [tmdbData]);

  const localSeries = useSeriesByTmdbIds(allTmdbIds);

  // Build result map
  // Loading if: fetch not complete OR local lookup not complete
  const isFetching = fetchedGenreIds !== genreIdsKey;

  return useMemo(() => {
    const result = new Map<number, { items: StoredSeries[]; loading: boolean }>();

    genreIds.forEach((genreId) => {
      const tmdbSeries = tmdbData.get(genreId) || [];
      const isLoading = isFetching || localSeries === undefined;

      if (isLoading) {
        result.set(genreId, { items: [], loading: true });
      } else if (tmdbSeries.length === 0) {
        result.set(genreId, { items: [], loading: false });
      } else {
        const tmdbOrder = new Map(tmdbSeries.map((s, i) => [s.id, i]));
        const items = sortByTmdbOrder(localSeries || [], tmdbOrder);
        result.set(genreId, { items, loading: false });
      }
    });

    return result;
  }, [genreIds, tmdbData, isFetching, localSeries]);
}

// ===========================================================================
// Featured Content Hook
// ===========================================================================

/**
 * Randomly sample n items from an array (Fisher-Yates shuffle)
 */
function randomSample<T>(array: T[], n: number): T[] {
  if (array.length <= n) return [...array];
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// Module-level cache: persists for the app session, clears on restart
const featuredCache = new Map<string, (StoredMovie | StoredSeries)[]>();

/**
 * Get featured content for hero section
 * Returns random items from trending (with local popular fallback).
 * Randomizes once per app session per type - stable across tab switches.
 */
export function useFeaturedContent(accessToken: string | null, type: 'movie' | 'series', count = 5) {
  const { loaded: tokenLoaded } = useTmdbAccessTokenState();
  const { movies: trendingMovies } = useTrendingMovies(accessToken);
  const { series: trendingSeries } = useTrendingSeries(accessToken);
  // Fetch a larger pool so randomSample actually shuffles
  const { movies: popularMovies } = useLocalPopularMovies(count * 4);
  const { series: popularSeries } = useLocalPopularSeries(count * 4);

  const [featured, setFeatured] = useState<(StoredMovie | StoredSeries)[]>(
    () => featuredCache.get(type) || []
  );

  useEffect(() => {
    if (featuredCache.has(type)) return;

    // Wait for settings to load so we know if there's a TMDB key
    if (!tokenLoaded) return;

    // Prefer trending (TMDB), fall back to local popular
    let items: (StoredMovie | StoredSeries)[];

    if (type === 'movie') {
      items = trendingMovies.length > 0 ? trendingMovies : popularMovies;
    } else {
      items = trendingSeries.length > 0 ? trendingSeries : popularSeries;
    }

    if (items.length > 0) {
      const sampled = randomSample(items, count);
      featuredCache.set(type, sampled);
      setFeatured(sampled);
    }
  }, [type, tokenLoaded, trendingMovies, trendingSeries, popularMovies, popularSeries, count]);

  return {
    items: featured,
    loading: false,
  };
}
