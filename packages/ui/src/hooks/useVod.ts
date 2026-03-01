import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredEpisode } from '../db';
import { syncSeriesEpisodes, syncAllVod, type VodSyncResult } from '../db/sync';
import { useEnabledSourceIds } from './useSourceFiltering';

// ===========================================================================
// Single-Item Hooks
// ===========================================================================

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
 * Get total counts of movies and series (from enabled sources)
 */
export function useVodCounts() {
  const enabledIds = useEnabledSourceIds();
  const counts = useLiveQuery(async () => {
    if (enabledIds.length === 0) {
      const [movieCount, seriesCount] = await Promise.all([
        db.vodMovies.count(),
        db.vodSeries.count(),
      ]);
      return { movieCount, seriesCount };
    }
    const [movieCount, seriesCount] = await Promise.all([
      db.vodMovies.where('source_id').anyOf(enabledIds).count(),
      db.vodSeries.where('source_id').anyOf(enabledIds).count(),
    ]);
    return { movieCount, seriesCount };
  }, [enabledIds.join(',')]);

  return {
    movieCount: counts?.movieCount ?? 0,
    seriesCount: counts?.seriesCount ?? 0,
    loading: counts === undefined,
  };
}
