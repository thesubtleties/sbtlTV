import { useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredEpisode } from '../db';
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

  const movies = useLiveQuery(async () => {
    if (tmdbId) {
      return db.vodMovies.where('tmdb_id').equals(tmdbId).toArray();
    }
    if (streamId) {
      const m = await db.vodMovies.get(streamId);
      return m ? [m] : [];
    }
    return [];
  }, [tmdbId, streamId]);

  return useMemo(() => {
    if (!movies || movies.length === 0) return [];

    let filtered = movies;
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      filtered = movies.filter(m => enabledSet.has(m.source_id));
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

  const episodes = useLiveQuery(async () => {
    if (!tmdbId && !fallbackSeriesId) return [];

    if (tmdbId) {
      // Find all series with this tmdb_id, then find matching episodes
      const allSeries = await db.vodSeries.where('tmdb_id').equals(tmdbId).toArray();
      const seriesIds = allSeries.map(s => s.series_id);
      if (seriesIds.length === 0) return [];

      const allEpisodes = await db.vodEpisodes
        .where('series_id')
        .anyOf(seriesIds)
        .toArray();

      return allEpisodes.filter(
        ep => ep.season_num === seasonNum && ep.episode_num === episodeNum
      );
    }

    // Fallback: single series
    if (fallbackSeriesId) {
      const eps = await db.vodEpisodes
        .where('series_id')
        .equals(fallbackSeriesId)
        .toArray();
      return eps.filter(
        ep => ep.season_num === seasonNum && ep.episode_num === episodeNum
      );
    }

    return [];
  }, [tmdbId, fallbackSeriesId, seasonNum, episodeNum]);

  return useMemo(() => {
    if (!episodes || episodes.length === 0) return [];

    let filtered = episodes;
    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      filtered = episodes.filter(ep => ep.source_id && enabledSet.has(ep.source_id));
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
