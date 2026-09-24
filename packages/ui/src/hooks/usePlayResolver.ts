import { useMemo } from 'react';
import { useDataQuery } from '../data/useDataQuery';
import { usePreferredSourceResolver, useSourceMap, useEnabledSourceIds } from './useSourceFiltering';

export interface SourceOption {
  sourceId: string;
  sourceName: string;
  url: string;
  streamId: string;
}

/**
 * Resolve play sources for a movie. Returns all enabled source URLs,
 * sorted by preference. First item is the preferred source.
 */
export function useMoviePlaySources(tmdbId?: number, streamId?: string): SourceOption[] {
  const enabledIds = useEnabledSourceIds();
  const resolve = usePreferredSourceResolver('vod');
  const sourceMap = useSourceMap();

  const { data: movies } = useDataQuery(
    tmdbId ? { type: 'movies', by: { kind: 'tmdbIds', tmdbIds: [tmdbId] }, sourceIds: [] }
      : streamId ? { type: 'movies', by: { kind: 'ids', streamIds: [streamId] }, sourceIds: [] } : null,
    ['vod_movies'], [tmdbId, streamId],
  );

  return useMemo(() => {
    if (!movies || movies.length === 0) return [];

    let filtered = movies;
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      filtered = movies.filter(m => enabledSet.has(m.source_id));
    } else if (sourceMap.size > 0) {
      // Filter out stale data from deleted sources
      filtered = movies.filter(m => sourceMap.has(m.source_id));
    }

    if (filtered.length === 0) return [];

    // Sort by preference
    const preferredId = resolve(filtered.map(m => m.source_id));
    const sorted = [...filtered].sort((a, b) => {
      if (a.source_id === preferredId) return -1;
      if (b.source_id === preferredId) return 1;
      return 0;
    });

    return sorted.map(m => ({
      sourceId: m.source_id,
      sourceName: sourceMap.get(m.source_id)?.name ?? m.source_id,
      url: m.direct_url,
      streamId: m.stream_id,
    }));
  }, [movies, enabledIds, resolve, sourceMap]);
}

/**
 * Resolve play sources for an episode across sources sharing a tmdb_id.
 * Matches by season_num + episode_num.
 */
export function useEpisodePlaySources(
  tmdbId: number | undefined,
  seasonNum: number,
  episodeNum: number,
  fallbackSeriesId?: string,
): SourceOption[] {
  const enabledIds = useEnabledSourceIds();
  const resolve = usePreferredSourceResolver('vod');
  const sourceMap = useSourceMap();

  // All series sharing the tmdb_id (or just the fallback series), then their episodes
  const { data: relatedSeries } = useDataQuery(
    tmdbId ? { type: 'series', by: { kind: 'tmdbIds', tmdbIds: [tmdbId] }, sourceIds: [] } : null,
    ['vod_series'], [tmdbId],
  );
  const seriesIds = useMemo(() => {
    if (tmdbId) return (relatedSeries ?? []).map((s) => s.series_id);
    return fallbackSeriesId ? [fallbackSeriesId] : [];
  }, [tmdbId, relatedSeries, fallbackSeriesId]);
  const { data: allEpisodes } = useDataQuery(
    seriesIds.length > 0 ? { type: 'episodes', seriesIds } : null,
    ['vod_episodes'], [seriesIds.join(',')],
  );
  const episodes = useMemo(
    () => (allEpisodes ?? []).filter((ep) => ep.season_num === seasonNum && ep.episode_num === episodeNum),
    [allEpisodes, seasonNum, episodeNum],
  );

  return useMemo(() => {
    if (!episodes || episodes.length === 0) return [];

    let filtered = episodes;
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      filtered = episodes.filter(ep => ep.source_id && enabledSet.has(ep.source_id));
    } else if (sourceMap.size > 0) {
      // Filter out stale data from deleted sources
      filtered = episodes.filter(ep => ep.source_id && sourceMap.has(ep.source_id));
    }

    if (filtered.length === 0) return [];

    const preferredId = resolve(filtered.map(ep => ep.source_id!).filter(Boolean));
    const sorted = [...filtered].sort((a, b) => {
      if (a.source_id === preferredId) return -1;
      if (b.source_id === preferredId) return 1;
      return 0;
    });

    return sorted.map(ep => ({
      sourceId: ep.source_id ?? '',
      sourceName: sourceMap.get(ep.source_id ?? '')?.name ?? ep.source_id ?? '',
      url: ep.direct_url,
      streamId: ep.id,
    }));
  }, [episodes, enabledIds, resolve, sourceMap]);
}
