import { useState, useEffect, useCallback, useMemo } from 'react';
import type { MovieRow, SeriesRow, EpisodeRow } from '@sbtltv/core';
import { data } from '../data/client';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';

// VOD rows come from the data process now; these keep the names callers use.
export type StoredMovie = MovieRow;
export type StoredSeries = SeriesRow;
export type StoredEpisode = EpisodeRow;

// ===========================================================================
// Single-Item Hooks
// ===========================================================================

/**
 * Get a single movie by ID
 */
export function useMovie(movieId: string | null) {
  const { data: rows, loading } = useDataQuery(
    movieId ? { type: 'movies', by: { kind: 'ids', streamIds: [movieId] }, sourceIds: [] } : null,
    ['vod_movies'], [movieId],
  );
  return { movie: rows?.[0] ?? null, loading };
}

/**
 * Get a single series by ID
 */
export function useSeriesById(seriesId: string | null) {
  const { data: rows, loading } = useDataQuery(
    seriesId ? { type: 'series', by: { kind: 'ids', seriesIds: [seriesId] }, sourceIds: [] } : null,
    ['vod_series'], [seriesId],
  );
  return { series: rows?.[0] ?? null, loading };
}

// ===========================================================================
// Episodes Hooks
// ===========================================================================

/**
 * Get episodes for a series, grouped by season.
 * Asks the data process to fetch them from the provider when none are stored.
 */
export function useSeriesDetails(seriesId: string | null) {
  const { data: episodes, loading } = useDataQuery(
    seriesId ? { type: 'episodes', seriesIds: [seriesId] } : null,
    ['vod_episodes'], [seriesId],
  );
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!seriesId) return;
    setError(null);
    try {
      await data.query({ type: 'syncEpisodes', seriesId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch episodes');
    }
  }, [seriesId]);

  // Fetch when nothing is stored yet
  useEffect(() => {
    if (seriesId && episodes && episodes.length === 0) void refetch();
  }, [seriesId, episodes?.length, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const seasons = useMemo(() => {
    const out: Record<number, StoredEpisode[]> = {};
    for (const ep of episodes ?? []) (out[ep.season_num] ??= []).push(ep);
    for (const k in out) out[k].sort((a, b) => a.episode_num - b.episode_num);
    return out;
  }, [episodes]);

  return { episodes: episodes ?? [], seasons, loading, error, refetch };
}

// ===========================================================================
// Count Hooks
// ===========================================================================

/**
 * Get total counts of movies and series (from enabled sources)
 */
export function useVodCounts() {
  const enabledIds = useEnabledSourceIds();
  const { data: counts, loading } = useDataQuery({ type: 'vodCounts', sourceIds: enabledIds }, ['vod_movies', 'vod_series'], [enabledIds.join(',')]);
  return { movieCount: counts?.movies ?? 0, seriesCount: counts?.series ?? 0, loading };
}
