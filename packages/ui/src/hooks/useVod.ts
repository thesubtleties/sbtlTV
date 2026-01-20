import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries, type StoredEpisode, type VodCategory } from '../db';
import { syncSeriesEpisodes, syncAllVod, type VodSyncResult } from '../db/sync';
import type { Source } from '../types/electron';

// ===========================================================================
// Movies Hooks
// ===========================================================================

/**
 * Query movies with optional category filter and search
 */
export function useMovies(categoryId?: string | null, search?: string) {
  const movies = useLiveQuery(async () => {
    let query = db.vodMovies.toCollection();

    if (categoryId) {
      // Filter by category
      const allMovies = await db.vodMovies.where('category_ids').equals(categoryId).toArray();
      if (search) {
        const searchLower = search.toLowerCase();
        return allMovies.filter(m => m.name.toLowerCase().includes(searchLower));
      }
      return allMovies;
    }

    // No category filter
    let allMovies = await query.toArray();

    if (search) {
      const searchLower = search.toLowerCase();
      allMovies = allMovies.filter(m => m.name.toLowerCase().includes(searchLower));
    }

    return allMovies;
  }, [categoryId, search]);

  return {
    movies: movies ?? [],
    loading: movies === undefined,
  };
}

/**
 * Get a single movie by ID
 */
export function useMovie(movieId: string | null) {
  const movie = useLiveQuery(
    async () => {
      if (!movieId) return null;
      return db.vodMovies.get(movieId);
    },
    [movieId]
  );

  return {
    movie: movie ?? null,
    loading: movie === undefined,
  };
}

/**
 * Get recently added movies
 */
export function useRecentMovies(limit = 20) {
  const movies = useLiveQuery(async () => {
    return db.vodMovies
      .orderBy('added')
      .reverse()
      .limit(limit)
      .toArray();
  }, [limit]);

  return {
    movies: movies ?? [],
    loading: movies === undefined,
  };
}

// ===========================================================================
// Series Hooks
// ===========================================================================

/**
 * Query series with optional category filter and search
 */
export function useSeries(categoryId?: string | null, search?: string) {
  const series = useLiveQuery(async () => {
    let query = db.vodSeries.toCollection();

    if (categoryId) {
      // Filter by category
      const allSeries = await db.vodSeries.where('category_ids').equals(categoryId).toArray();
      if (search) {
        const searchLower = search.toLowerCase();
        return allSeries.filter(s => s.name.toLowerCase().includes(searchLower));
      }
      return allSeries;
    }

    // No category filter
    let allSeries = await query.toArray();

    if (search) {
      const searchLower = search.toLowerCase();
      allSeries = allSeries.filter(s => s.name.toLowerCase().includes(searchLower));
    }

    return allSeries;
  }, [categoryId, search]);

  return {
    series: series ?? [],
    loading: series === undefined,
  };
}

/**
 * Get a single series by ID
 */
export function useSeriesById(seriesId: string | null) {
  const series = useLiveQuery(
    async () => {
      if (!seriesId) return null;
      return db.vodSeries.get(seriesId);
    },
    [seriesId]
  );

  return {
    series: series ?? null,
    loading: series === undefined,
  };
}

/**
 * Get recently added series
 */
export function useRecentSeries(limit = 20) {
  const series = useLiveQuery(async () => {
    return db.vodSeries
      .orderBy('added')
      .reverse()
      .limit(limit)
      .toArray();
  }, [limit]);

  return {
    series: series ?? [],
    loading: series === undefined,
  };
}

// ===========================================================================
// Episodes Hooks
// ===========================================================================

/**
 * Get episodes for a series, grouped by season
 * Fetches from Xtream if not cached locally
 */
export function useSeriesDetails(seriesId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get cached episodes from DB
  const episodes = useLiveQuery(
    async () => {
      if (!seriesId) return [];
      return db.vodEpisodes.where('series_id').equals(seriesId).toArray();
    },
    [seriesId]
  );

  // Fetch episodes if not cached
  const fetchEpisodes = useCallback(async () => {
    if (!seriesId || !window.storage) return;

    setLoading(true);
    setError(null);

    try {
      // Get the source for this series
      const series = await db.vodSeries.get(seriesId);
      if (!series) {
        setError('Series not found');
        return;
      }

      const sourcesResult = await window.storage.getSources();
      const source = sourcesResult.data?.find(s => s.id === series.source_id);

      if (!source) {
        setError('Source not found');
        return;
      }

      await syncSeriesEpisodes(source, seriesId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch episodes');
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  // Fetch on mount if no episodes cached
  useEffect(() => {
    if (episodes && episodes.length === 0 && seriesId) {
      fetchEpisodes();
    }
  }, [episodes, seriesId, fetchEpisodes]);

  // Group episodes by season
  const seasons = episodes?.reduce((acc, ep) => {
    const seasonNum = ep.season_num;
    if (!acc[seasonNum]) {
      acc[seasonNum] = [];
    }
    acc[seasonNum].push(ep);
    return acc;
  }, {} as Record<number, StoredEpisode[]>) ?? {};

  // Sort episodes within each season
  for (const seasonNum in seasons) {
    seasons[seasonNum].sort((a, b) => a.episode_num - b.episode_num);
  }

  return {
    episodes: episodes ?? [],
    seasons,
    loading: loading || episodes === undefined,
    error,
    refetch: fetchEpisodes,
  };
}

// ===========================================================================
// Category Hooks
// ===========================================================================

/**
 * Get VOD categories by type (excludes empty categories)
 */
export function useVodCategories(type: 'movie' | 'series') {
  const categories = useLiveQuery(async () => {
    const allCategories = await db.vodCategories.where('type').equals(type).toArray();

    // Filter out categories with no items
    const nonEmptyCategories = await Promise.all(
      allCategories.map(async (cat) => {
        const table = type === 'movie' ? db.vodMovies : db.vodSeries;
        const count = await table.where('category_ids').equals(cat.category_id).count();
        return count > 0 ? cat : null;
      })
    );

    return nonEmptyCategories.filter((cat): cat is VodCategory => cat !== null);
  }, [type]);

  return {
    categories: categories ?? [],
    loading: categories === undefined,
  };
}

/**
 * Get all VOD categories
 */
export function useAllVodCategories() {
  const categories = useLiveQuery(async () => {
    return db.vodCategories.toArray();
  });

  return {
    categories: categories ?? [],
    loading: categories === undefined,
  };
}

// ===========================================================================
// Sync Hooks
// ===========================================================================

/**
 * Hook for syncing VOD content
 */
export function useVodSync() {
  const [syncing, setSyncing] = useState(false);
  const [results, setResults] = useState<Map<string, VodSyncResult>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);

    try {
      const syncResults = await syncAllVod();
      setResults(syncResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, []);

  return {
    sync,
    syncing,
    results,
    error,
  };
}

// ===========================================================================
// Count Hooks
// ===========================================================================

/**
 * Get total counts of movies and series
 */
export function useVodCounts() {
  const counts = useLiveQuery(async () => {
    const [movieCount, seriesCount] = await Promise.all([
      db.vodMovies.count(),
      db.vodSeries.count(),
    ]);
    return { movieCount, seriesCount };
  });

  return {
    movieCount: counts?.movieCount ?? 0,
    seriesCount: counts?.seriesCount ?? 0,
    loading: counts === undefined,
  };
}

// ===========================================================================
// Browse Hooks (for gallery view with Virtuoso)
// ===========================================================================

/**
 * All movies for browse view (optionally filtered by category)
 * Returns items sorted alphabetically - Virtuoso handles virtualization
 * Pass null for categoryId to get ALL movies
 */
export function usePaginatedMovies(categoryId: string | null, search?: string) {
  const [items, setItems] = useState<StoredMovie[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        let result: StoredMovie[];

        if (categoryId) {
          // Filter by category
          result = await db.vodMovies.where('category_ids').equals(categoryId).toArray();
        } else {
          // All movies
          result = await db.vodMovies.toArray();
        }

        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          result = result.filter(m => m.name.toLowerCase().includes(searchLower));
        }

        // Sort alphabetically
        result.sort((a, b) => a.name.localeCompare(b.name));

        setItems(result);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [categoryId, search]);

  // Keep API compatible - Virtuoso handles virtualization, no pagination needed
  return {
    items,
    loading,
    hasMore: false,
    loadMore: () => {},
  };
}

/**
 * All series for browse view (optionally filtered by category)
 * Returns items sorted alphabetically - Virtuoso handles virtualization
 * Pass null for categoryId to get ALL series
 */
export function usePaginatedSeries(categoryId: string | null, search?: string) {
  const [items, setItems] = useState<StoredSeries[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        let result: StoredSeries[];

        if (categoryId) {
          // Filter by category
          result = await db.vodSeries.where('category_ids').equals(categoryId).toArray();
        } else {
          // All series
          result = await db.vodSeries.toArray();
        }

        // Apply search filter
        if (search) {
          const searchLower = search.toLowerCase();
          result = result.filter(s => s.name.toLowerCase().includes(searchLower));
        }

        // Sort alphabetically
        result.sort((a, b) => a.name.localeCompare(b.name));

        setItems(result);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [categoryId, search]);

  // Keep API compatible - Virtuoso handles virtualization, no pagination needed
  return {
    items,
    loading,
    hasMore: false,
    loadMore: () => {},
  };
}

/**
 * Get alphabet index for A-Z rail
 * Returns map of letter -> first item index for that letter
 */
export function useAlphabetIndex(items: Array<{ name: string }>) {
  const [index, setIndex] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const newIndex = new Map<string, number>();
    items.forEach((item, i) => {
      const firstChar = item.name.charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(firstChar) ? firstChar : '#';
      if (!newIndex.has(letter)) {
        newIndex.set(letter, i);
      }
    });
    setIndex(newIndex);
  }, [items]);

  return index;
}

/**
 * Get current letter based on scroll position
 */
export function useCurrentLetter(
  items: Array<{ name: string }>,
  visibleStartIndex: number
): string {
  if (items.length === 0 || visibleStartIndex < 0) return 'A';

  const currentItem = items[Math.min(visibleStartIndex, items.length - 1)];
  if (!currentItem) return 'A';

  const firstChar = currentItem.name.charAt(0).toUpperCase();
  return /[A-Z]/.test(firstChar) ? firstChar : '#';
}
