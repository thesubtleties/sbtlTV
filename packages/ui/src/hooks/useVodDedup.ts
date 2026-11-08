import { useMemo, useState, useEffect, useCallback } from 'react';
import type { StoredMovie, StoredSeries, StoredEpisode } from '../db';
import { data } from '../data/client';
import { useDataQuery } from '../data/useDataQuery';
import { usePreferredSourceResolver, useEnabledSourceIds } from './useSourceFiltering';
import { EPISODES_MAX_AGE_MS } from '../services/hoverPrefetch';

export interface DedupedMovie {
  item: StoredMovie;
  sources: { sourceId: string; streamId: string; directUrl: string }[];
}

export interface DedupedSeries {
  item: StoredSeries;
  sources: { sourceId: string; seriesId: string }[];
}

/**
 * Deduplicate movies by tmdb_id. Items without tmdb_id pass through individually.
 * Representative is from the highest-preference source.
 */
export function useDedupedMovies(movies: StoredMovie[]): DedupedMovie[] {
  const resolve = usePreferredSourceResolver('vod');

  return useMemo(() => {
    const byTmdb = new Map<number, StoredMovie[]>();
    const noTmdb: StoredMovie[] = [];

    for (const m of movies) {
      if (m.tmdb_id) {
        const group = byTmdb.get(m.tmdb_id);
        if (group) group.push(m);
        else byTmdb.set(m.tmdb_id, [m]);
      } else {
        noTmdb.push(m);
      }
    }

    const deduped: DedupedMovie[] = [];

    for (const group of byTmdb.values()) {
      const sourceIds = group.map(m => m.source_id);
      const preferredSourceId = resolve(sourceIds);
      const representative = group.find(m => m.source_id === preferredSourceId) ?? group[0];

      deduped.push({
        item: representative,
        sources: group.map(m => ({
          sourceId: m.source_id,
          streamId: m.stream_id,
          directUrl: m.direct_url,
        })),
      });
    }

    for (const m of noTmdb) {
      deduped.push({
        item: m,
        sources: [{ sourceId: m.source_id, streamId: m.stream_id, directUrl: m.direct_url }],
      });
    }

    return deduped;
  }, [movies, resolve]);
}

/**
 * Deduplicate series by tmdb_id. Items without tmdb_id pass through individually.
 */
export function useDedupedSeries(series: StoredSeries[]): DedupedSeries[] {
  const resolve = usePreferredSourceResolver('vod');

  return useMemo(() => {
    const byTmdb = new Map<number, StoredSeries[]>();
    const noTmdb: StoredSeries[] = [];

    for (const s of series) {
      if (s.tmdb_id) {
        const group = byTmdb.get(s.tmdb_id);
        if (group) group.push(s);
        else byTmdb.set(s.tmdb_id, [s]);
      } else {
        noTmdb.push(s);
      }
    }

    const deduped: DedupedSeries[] = [];

    for (const group of byTmdb.values()) {
      const sourceIds = group.map(s => s.source_id);
      const preferredSourceId = resolve(sourceIds);
      const representative = group.find(s => s.source_id === preferredSourceId) ?? group[0];

      deduped.push({
        item: representative,
        sources: group.map(s => ({
          sourceId: s.source_id,
          seriesId: s.series_id,
        })),
      });
    }

    for (const s of noTmdb) {
      deduped.push({
        item: s,
        sources: [{ sourceId: s.source_id, seriesId: s.series_id }],
      });
    }

    return deduped;
  }, [series, resolve]);
}

/**
 * Merge episodes across sources sharing a tmdb_id.
 * Fetches episodes from all matching series, deduplicates by season+episode,
 * preferring the primary series source and filling gaps from others.
 */
export function useMergedEpisodes(primarySeriesId: string, tmdbId?: number) {
  const enabledIds = useEnabledSourceIds();
  const resolve = usePreferredSourceResolver('vod');
  const [error, setError] = useState<string | null>(null);

  // Find all series with same tmdb_id
  const { data: related, stale: relatedStale } = useDataQuery(
    tmdbId ? { type: 'series', by: { kind: 'tmdbIds', tmdbIds: [tmdbId] }, sourceIds: enabledIds } : null,
    ['vod_series'], [tmdbId, enabledIds.join(',')],
  );
  const relatedSeriesIds = useMemo(() => {
    if (!related || related.length === 0) return [primarySeriesId];
    const list = [...related];
    // Sort by preference, primary first
    const preferredId = resolve(list.map((s) => s.source_id));
    list.sort((a, b) => {
      if (a.series_id === primarySeriesId) return -1;
      if (b.series_id === primarySeriesId) return 1;
      if (a.source_id === preferredId) return -1;
      if (b.source_id === preferredId) return 1;
      return 0;
    });
    return list.map((s) => s.series_id);
  }, [related, primarySeriesId, resolve]);
  const relatedKey = relatedSeriesIds.join(',');

  // Query all episodes from related series
  const { data: allEpisodes, loading } = useDataQuery(
    { type: 'episodes', seriesIds: relatedSeriesIds },
    ['vod_episodes'], [relatedKey],
  );

  // Ask the provider for each related series' list. On open (maxAgeMs) the data
  // process skips lists stored within the last day and refreshes older ones in the
  // background while the stored list shows; Try again (no maxAgeMs) always asks.
  // Series whose fetch is queued or running: until one lands, an empty list means
  // "loading", not "no episodes".
  const [fetching, setFetching] = useState<string[]>([]);
  const fetchEpisodes = useCallback(async (maxAgeMs?: number) => {
    setError(null);
    try {
      await Promise.all(relatedSeriesIds.map(async (seriesId) => {
        const r = await data.query({ type: 'syncEpisodes', seriesId, ...(maxAgeMs !== undefined ? { maxAgeMs } : {}) });
        if (r.queued) setFetching((f) => (f.includes(seriesId) ? f : [...f, seriesId]));
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch episodes');
    }
  }, [relatedSeriesIds]);
  const refetch = useCallback(() => fetchEpisodes(), [fetchEpisodes]);

  // Once per opened series (and its related set). Waits for the related query so a
  // provisional single-id set does not ask twice.
  const relatedPending = !!tmdbId && (related === undefined || relatedStale);
  useEffect(() => {
    if (!relatedPending) void fetchEpisodes(EPISODES_MAX_AGE_MS);
  }, [relatedKey, relatedPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // The fetches run in the data process; each ends with a progress event, and a
  // failure for any related series is shown.
  useEffect(() => data.onSync((p) => {
    if (p.stage !== 'episodes' || !p.seriesId || !relatedSeriesIds.includes(p.seriesId)) return;
    if (p.state === 'finished' || p.state === 'failed') setFetching((f) => f.filter((id) => id !== p.seriesId));
    if (p.state === 'failed') setError(p.message ?? 'Failed to fetch episodes');
  }), [relatedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new series starts clean; a lost progress event cannot leave a spinner forever.
  useEffect(() => { setFetching([]); }, [relatedKey]);
  useEffect(() => {
    if (fetching.length === 0) return;
    const t = setTimeout(() => setFetching([]), 30_000);
    return () => clearTimeout(t);
  }, [fetching.length]);
  const waitingForFirst = fetching.length > 0 && (allEpisodes?.length ?? 0) === 0;

  // Merge: prefer primary/preferred source, fill gaps
  const seasons = useMemo(() => {
    if (!allEpisodes || allEpisodes.length === 0) return {} as Record<number, StoredEpisode[]>;

    // Priority order for series_ids (primary first, then preferred)
    const priority = new Map<string, number>();
    relatedSeriesIds.forEach((sid, i) => priority.set(sid, i));

    // Group by season+episode, keep highest priority
    const episodeMap = new Map<string, StoredEpisode>();
    for (const ep of allEpisodes) {
      const key = `${ep.season_num}_${ep.episode_num}`;
      const existing = episodeMap.get(key);
      if (!existing) {
        episodeMap.set(key, ep);
      } else {
        const existingPriority = priority.get(existing.series_id) ?? 999;
        const newPriority = priority.get(ep.series_id) ?? 999;
        if (newPriority < existingPriority) {
          episodeMap.set(key, ep);
        }
      }
    }

    // Group into seasons
    const result: Record<number, StoredEpisode[]> = {};
    for (const ep of episodeMap.values()) {
      if (!result[ep.season_num]) result[ep.season_num] = [];
      result[ep.season_num].push(ep);
    }
    for (const num in result) {
      result[num].sort((a, b) => a.episode_num - b.episode_num);
    }
    return result;
  }, [allEpisodes, relatedSeriesIds]);

  return {
    seasons,
    loading: loading || waitingForFirst,
    error,
    refetch,
    sourceCount: relatedSeriesIds.length,
  };
}
