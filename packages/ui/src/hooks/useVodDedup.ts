import { useMemo, useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries, type StoredEpisode } from '../db';
import { syncSeriesEpisodes } from '../db/sync';
import { usePreferredSourceResolver, useEnabledSourceIds } from './useSourceFiltering';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Find all series with same tmdb_id
  const relatedSeriesIds = useLiveQuery(async () => {
    if (!tmdbId) return [primarySeriesId];
    const all = await db.vodSeries.where('tmdb_id').equals(tmdbId).toArray();
    let filtered = all;
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      filtered = all.filter(s => enabledSet.has(s.source_id));
    }
    if (filtered.length === 0) return [primarySeriesId];
    // Sort by preference, primary first
    const sourceIds = filtered.map(s => s.source_id);
    const preferredId = resolve(sourceIds);
    filtered.sort((a, b) => {
      if (a.series_id === primarySeriesId) return -1;
      if (b.series_id === primarySeriesId) return 1;
      if (a.source_id === preferredId) return -1;
      if (b.source_id === preferredId) return 1;
      return 0;
    });
    return filtered.map(s => s.series_id);
  }, [primarySeriesId, tmdbId, enabledIds.join(','), resolve]);

  // Fetch episodes for all related series (on-demand)
  const fetchAll = useCallback(async () => {
    if (!relatedSeriesIds || relatedSeriesIds.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      if (!window.storage) return;
      const sourcesResult = await window.storage.getSources();
      const allSources = sourcesResult.data ?? [];

      await Promise.all(
        relatedSeriesIds.map(async (sid) => {
          const s = await db.vodSeries.get(sid);
          if (!s) return;
          const cached = await db.vodEpisodes.where('series_id').equals(sid).count();
          if (cached > 0) return; // Already have episodes
          const source = allSources.find(src => src.id === s.source_id);
          if (!source) return;
          await syncSeriesEpisodes(source, sid);
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch episodes');
    } finally {
      setLoading(false);
    }
  }, [relatedSeriesIds]);

  // Trigger fetch on mount
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Query all episodes from related series, merge by season+episode
  const allEpisodes = useLiveQuery(async () => {
    if (!relatedSeriesIds || relatedSeriesIds.length === 0) return [];
    return db.vodEpisodes.where('series_id').anyOf(relatedSeriesIds).toArray();
  }, [relatedSeriesIds]);

  // Merge: prefer primary/preferred source, fill gaps
  const seasons = useMemo(() => {
    if (!allEpisodes || allEpisodes.length === 0) return {} as Record<number, StoredEpisode[]>;

    // Priority order for series_ids (primary first, then preferred)
    const priority = new Map<string, number>();
    (relatedSeriesIds ?? []).forEach((sid, i) => priority.set(sid, i));

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
    loading: loading || allEpisodes === undefined,
    error,
    refetch: fetchAll,
    sourceCount: relatedSeriesIds?.length ?? 1,
  };
}
