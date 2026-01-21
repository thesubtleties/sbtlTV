/**
 * TMDB-enhanced list hooks
 *
 * These hooks provide Netflix-style curated lists by matching
 * TMDB trending/popular lists against local Xtream content.
 *
 * PERFORMANCE: Uses indexed tmdb_id lookups instead of full table scans.
 */

import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries } from '../db';
import {
  getTrendingMovies,
  getTrendingTvShows,
  getPopularMovies,
  getPopularTvShows,
  getTopRatedMovies,
  getTopRatedTvShows,
  getMovieGenres,
  getTvGenres,
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
 * Get TMDB API key from settings
 */
export function useTmdbApiKey(): string | null {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    async function loadKey() {
      if (!window.storage) return;
      const result = await window.storage.getSettings();
      if (result.data && 'tmdbApiKey' in result.data) {
        setApiKey((result.data as { tmdbApiKey?: string }).tmdbApiKey ?? null);
      }
    }
    loadKey();
  }, []);

  return apiKey;
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
// Movie List Hooks
// ===========================================================================

/**
 * Get trending movies that are available locally
 */
export function useTrendingMovies(apiKey: string | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch trending list from TMDB
  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getTrendingMovies(apiKey)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  // Extract TMDB IDs for indexed lookup
  const tmdbIds = useMemo(() => tmdbMovies.map((m) => m.id), [tmdbMovies]);

  // Query local movies by TMDB IDs (indexed!)
  const localMovies = useMoviesByTmdbIds(tmdbIds);

  // Sort by TMDB order
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

/**
 * Get popular movies that are available locally
 */
export function usePopularMovies(apiKey: string | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getPopularMovies(apiKey)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

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

/**
 * Get top rated movies that are available locally
 */
export function useTopRatedMovies(apiKey: string | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getTopRatedMovies(apiKey)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

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

/**
 * Get movies sorted by local popularity (TMDB popularity score)
 * Used as fallback when no API key
 * Falls back to recently added if no popularity data available
 */
export function useLocalPopularMovies(limit = 20) {
  const movies = useLiveQuery(async () => {
    // Query recent movies
    const allMovies = await db.vodMovies
      .orderBy('added')
      .reverse()
      .limit(limit * 2)
      .toArray();

    // If any have popularity, sort by it
    const withPopularity = allMovies.filter((m) => m.popularity !== undefined);
    if (withPopularity.length > 0) {
      return withPopularity
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, limit);
    }

    // Fallback: just return recent movies
    return allMovies.slice(0, limit);
  }, [limit]);

  return {
    movies: movies ?? [],
    loading: movies === undefined,
  };
}

/**
 * Get movies by TMDB genre (that are available locally)
 */
export function useMoviesByGenre(apiKey: string | null, genreId: number | null) {
  const [tmdbMovies, setTmdbMovies] = useState<TmdbMovieResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey || !genreId) return;

    setLoading(true);
    setError(null);

    discoverMoviesByGenre(apiKey, genreId)
      .then(setTmdbMovies)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey, genreId]);

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
// Series List Hooks
// ===========================================================================

/**
 * Get trending TV shows that are available locally
 */
export function useTrendingSeries(apiKey: string | null) {
  const [tmdbShows, setTmdbShows] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getTrendingTvShows(apiKey)
      .then(setTmdbShows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const tmdbIds = useMemo(() => tmdbShows.map((s) => s.id), [tmdbShows]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbShows.length === 0) return [];
    const tmdbOrder = new Map(tmdbShows.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbShows]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

/**
 * Get popular TV shows that are available locally
 */
export function usePopularSeries(apiKey: string | null) {
  const [tmdbShows, setTmdbShows] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getPopularTvShows(apiKey)
      .then(setTmdbShows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const tmdbIds = useMemo(() => tmdbShows.map((s) => s.id), [tmdbShows]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbShows.length === 0) return [];
    const tmdbOrder = new Map(tmdbShows.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbShows]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

/**
 * Get top rated TV shows that are available locally
 */
export function useTopRatedSeries(apiKey: string | null) {
  const [tmdbShows, setTmdbShows] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);

    getTopRatedTvShows(apiKey)
      .then(setTmdbShows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  const tmdbIds = useMemo(() => tmdbShows.map((s) => s.id), [tmdbShows]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbShows.length === 0) return [];
    const tmdbOrder = new Map(tmdbShows.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbShows]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

/**
 * Get series sorted by local popularity
 * Falls back to recently added if no popularity data available
 */
export function useLocalPopularSeries(limit = 20) {
  const series = useLiveQuery(async () => {
    const allSeries = await db.vodSeries
      .orderBy('added')
      .reverse()
      .limit(limit * 2)
      .toArray();

    // If any have popularity, sort by it
    const withPopularity = allSeries.filter((s) => s.popularity !== undefined);
    if (withPopularity.length > 0) {
      return withPopularity
        .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
        .slice(0, limit);
    }

    // Fallback: just return recent series
    return allSeries.slice(0, limit);
  }, [limit]);

  return {
    series: series ?? [],
    loading: series === undefined,
  };
}

/**
 * Get series by TMDB genre
 */
export function useSeriesByGenre(apiKey: string | null, genreId: number | null) {
  const [tmdbShows, setTmdbShows] = useState<TmdbTvResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey || !genreId) return;

    setLoading(true);
    setError(null);

    discoverTvShowsByGenre(apiKey, genreId)
      .then(setTmdbShows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiKey, genreId]);

  const tmdbIds = useMemo(() => tmdbShows.map((s) => s.id), [tmdbShows]);
  const localSeries = useSeriesByTmdbIds(tmdbIds);

  const series = useMemo(() => {
    if (!localSeries || tmdbShows.length === 0) return [];
    const tmdbOrder = new Map(tmdbShows.map((s, i) => [s.id, i]));
    return sortByTmdbOrder(localSeries, tmdbOrder);
  }, [localSeries, tmdbShows]);

  return {
    series,
    loading: loading || localSeries === undefined,
    error,
  };
}

// ===========================================================================
// Genre Hooks
// ===========================================================================

/**
 * Get movie genres from TMDB
 */
export function useMovieGenres(apiKey: string | null) {
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    getMovieGenres(apiKey)
      .then(setGenres)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [apiKey]);

  return { genres, loading };
}

/**
 * Get TV genres from TMDB
 */
export function useTvGenres(apiKey: string | null) {
  const [genres, setGenres] = useState<TmdbGenre[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!apiKey) return;

    setLoading(true);
    getTvGenres(apiKey)
      .then(setGenres)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [apiKey]);

  return { genres, loading };
}

// ===========================================================================
// Featured Content Hook
// ===========================================================================

/**
 * Get featured content for hero section
 * Returns top items sorted by TMDB popularity
 */
export function useFeaturedContent(apiKey: string | null, type: 'movies' | 'series', count = 5) {
  const { movies: trendingMovies } = useTrendingMovies(apiKey);
  const { series: trendingSeries } = useTrendingSeries(apiKey);
  const { movies: popularMovies } = useLocalPopularMovies(count);
  const { series: popularSeries } = useLocalPopularSeries(count);

  // Use TMDB trending if API key available, otherwise local popularity
  const featured = useMemo(() => {
    if (type === 'movies') {
      const items = apiKey && trendingMovies.length > 0
        ? trendingMovies
        : popularMovies;
      return items.slice(0, count);
    } else {
      const items = apiKey && trendingSeries.length > 0
        ? trendingSeries
        : popularSeries;
      return items.slice(0, count);
    }
  }, [type, apiKey, trendingMovies, trendingSeries, popularMovies, popularSeries, count]);

  return {
    items: featured,
    loading: false,
  };
}

