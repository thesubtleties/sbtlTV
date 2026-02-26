import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredWatchProgress } from '../db';

function movieProgressId(streamId: string): string {
  return `movie_${streamId}`;
}

function episodeProgressId(seriesTmdbId: number, season: number, episode: number): string {
  return `episode_${seriesTmdbId}_S${season}_E${episode}`;
}

/** Get watch progress for a movie by stream_id */
export function useMovieProgress(streamId?: string): StoredWatchProgress | undefined {
  return useLiveQuery(
    () => streamId ? db.watchProgress.get(movieProgressId(streamId)) : undefined,
    [streamId]
  );
}

/** Get watch progress for a movie by tmdb_id (any source) */
export function useMovieProgressByTmdb(tmdbId?: number): StoredWatchProgress | undefined {
  return useLiveQuery(
    () => tmdbId ? db.watchProgress.where('tmdb_id').equals(tmdbId).first() : undefined,
    [tmdbId]
  );
}

/** Get watch progress for an episode */
export function useEpisodeProgress(
  seriesTmdbId?: number, season?: number, episode?: number
): StoredWatchProgress | undefined {
  return useLiveQuery(
    () => (seriesTmdbId && season != null && episode != null)
      ? db.watchProgress.get(episodeProgressId(seriesTmdbId, season, episode))
      : undefined,
    [seriesTmdbId, season, episode]
  );
}

/** Update watch progress — called from mpv onStatus */
export async function updateWatchProgress(opts: {
  type: 'movie' | 'episode';
  streamId: string;
  tmdbId?: number;
  seriesTmdbId?: number;
  seasonNum?: number;
  episodeNum?: number;
  name?: string;
  position: number;
  duration: number;
  sourceId?: string;
}): Promise<void> {
  if (opts.duration <= 0) return;

  const progress = Math.round((opts.position / opts.duration) * 100);
  const completed = progress >= 90;

  let id: string;
  if (opts.type === 'episode' && opts.seriesTmdbId && opts.seasonNum != null && opts.episodeNum != null) {
    id = episodeProgressId(opts.seriesTmdbId, opts.seasonNum, opts.episodeNum);
  } else {
    id = movieProgressId(opts.streamId);
  }

  await db.watchProgress.put({
    id,
    type: opts.type,
    tmdb_id: opts.tmdbId,
    stream_id: opts.streamId,
    series_tmdb_id: opts.seriesTmdbId,
    season_num: opts.seasonNum,
    episode_num: opts.episodeNum,
    position: opts.position,
    duration: opts.duration,
    progress,
    completed,
    name: opts.name,
    updated_at: new Date(),
    source_id: opts.sourceId,
  });
}

/** Get "continue watching" items (in progress, not completed) */
export function useContinueWatching(limit = 20): StoredWatchProgress[] {
  return useLiveQuery(
    () => db.watchProgress
      .orderBy('updated_at')
      .reverse()
      .filter(item => !item.completed)
      .limit(limit)
      .toArray(),
    [limit]
  ) ?? [];
}

/** Hook to clear progress for an item */
export function useClearProgress() {
  return useCallback(async (id: string) => {
    await db.watchProgress.delete(id);
  }, []);
}

/** One-time DB lookup for resume position (seconds). Returns 0 if none or completed. */
export async function getResumePosition(
  type: 'movie' | 'episode',
  opts: { streamId?: string; seriesTmdbId?: number; seasonNum?: number; episodeNum?: number },
): Promise<number> {
  let id: string;
  if (type === 'episode' && opts.seriesTmdbId && opts.seasonNum != null && opts.episodeNum != null) {
    id = episodeProgressId(opts.seriesTmdbId, opts.seasonNum, opts.episodeNum);
  } else if (opts.streamId) {
    id = movieProgressId(opts.streamId);
  } else {
    return 0;
  }
  const entry = await db.watchProgress.get(id);
  if (!entry || entry.completed) return 0;
  // Don't resume if less than 10s in — not worth it
  if (entry.position < 10) return 0;
  return entry.position;
}

const EMPTY_PROGRESS_MAP = new Map<string, number>();

/** Bulk progress map for movies — one query, O(1) lookup per card.
 *  Keyed by both tmdb_id and stream_id so lookup always hits. */
export function useMovieProgressMap(): Map<string, number> {
  return useLiveQuery(async () => {
    const items = await db.watchProgress.where('type').equals('movie').toArray();
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.completed) continue;
      if (item.tmdb_id) map.set(`tmdb_${item.tmdb_id}`, item.progress);
      if (item.stream_id) map.set(`stream_${item.stream_id}`, item.progress);
    }
    return map;
  }, []) ?? EMPTY_PROGRESS_MAP;
}

/** Look up progress for a movie from the bulk map */
export function getMovieProgress(map: Map<string, number>, item: { tmdb_id?: number; stream_id?: string }): number {
  if (item.tmdb_id) {
    const p = map.get(`tmdb_${item.tmdb_id}`);
    if (p !== undefined) return p;
  }
  if (item.stream_id) {
    const p = map.get(`stream_${item.stream_id}`);
    if (p !== undefined) return p;
  }
  return 0;
}
