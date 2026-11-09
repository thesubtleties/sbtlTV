import { useMemo, useState, useEffect, useCallback, useReducer, useRef } from 'react';
import type { StoredMovie, StoredSeries, StoredEpisode } from '../db';
import { data } from '../data/client';
import { useDataQuery } from '../data/useDataQuery';
import { usePreferredSourceResolver, useEnabledSourceIds } from './useSourceFiltering';
import { EPISODES_MAX_AGE_MS } from '../services/hoverPrefetch';
import { episodeFetchReducer, initialEpisodeFetchState, EPISODE_FETCH_TIMEOUT_MS } from './episodeFetchState';

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
  const { data: related, stale: relatedStale, error: relatedError } = useDataQuery(
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

  // Asks the data process for each related series' list. On open (maxAgeMs) it
  // skips lists under a day old; Try again (no maxAgeMs) always asks.
  const [fetchState, dispatch] = useReducer(episodeFetchReducer, initialEpisodeFetchState);
  const currentIds = useRef(relatedSeriesIds);
  currentIds.current = relatedSeriesIds;
  const sourceOf = useMemo(() => {
    const m = new Map((related ?? []).map((s) => [s.series_id, s.source_id]));
    return (seriesId: string) => m.get(seriesId) ?? seriesId.slice(0, Math.max(0, seriesId.indexOf('_')));
  }, [related]);
  const fetchEpisodes = useCallback(async (maxAgeMs?: number) => {
    setError(null);
    try {
      await Promise.all(relatedSeriesIds.map(async (seriesId) => {
        const r = await data.query({ type: 'syncEpisodes', seriesId, ...(maxAgeMs !== undefined ? { maxAgeMs } : {}) });
        // A reply for a series the page has since left is dropped.
        if (r.queued && currentIds.current.includes(seriesId)) dispatch({ type: 'queued', seriesId, sourceId: sourceOf(seriesId) });
      }));
    } catch (err) {
      if (relatedSeriesIds.every((id) => currentIds.current.includes(id))) setError(err instanceof Error ? err.message : 'Failed to fetch episodes');
    }
  }, [relatedSeriesIds, sourceOf]);
  const refetch = useCallback(() => fetchEpisodes(), [fetchEpisodes]);

  // Once per opened series (and its related set). Waits for the related query so a
  // provisional single-id set does not ask twice; if that query fails, goes ahead
  // with the primary series alone.
  const relatedPending = !!tmdbId && !relatedError && (related === undefined || relatedStale);
  useEffect(() => {
    dispatch({ type: 'reset' });
    if (!relatedPending) void fetchEpisodes(EPISODES_MAX_AGE_MS);
  }, [relatedKey, relatedPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each fetch ends with a progress event for its series.
  useEffect(() => data.onSync((progress) => {
    if (progress.stage === 'episodes' && progress.seriesId && currentIds.current.includes(progress.seriesId)) dispatch({ type: 'progress', progress });
  }), []);

  // A lost progress event or a provider that never answers cannot spin forever.
  const fetchingKey = fetchState.fetching.map((f) => f.seriesId).join(',');
  useEffect(() => {
    if (!fetchingKey) return;
    const t = setTimeout(() => dispatch({ type: 'timeout' }), EPISODE_FETCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [fetchingKey]);
  const hasEpisodes = (allEpisodes?.length ?? 0) > 0;
  const waitingForFirst = fetchState.fetching.length > 0 && !hasEpisodes;

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
    error,                      // the request itself failed (data process unreachable)
    issues: fetchState.issues,  // per source: last fetch empty or failed (see episodeFetchState)
    hasEpisodes,
    refetch,
    sourceCount: relatedSeriesIds.length,
  };
}
