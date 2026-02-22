import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useEnabledSourceIds } from './useSourceFiltering';

function wlId(type: 'movie' | 'series', key: string): string {
  return `${type}_${key}`;
}

export function useIsOnWatchlist(type: 'movie' | 'series', tmdbId?: number, streamId?: string): boolean {
  const key = tmdbId ? String(tmdbId) : streamId;
  const item = useLiveQuery(
    () => key ? db.watchlist.get(wlId(type, key)) : undefined,
    [type, key]
  );
  return item !== undefined && item !== null;
}

export function useToggleWatchlist() {
  return useCallback(async (
    type: 'movie' | 'series',
    opts: { tmdbId?: number; streamId?: string; name: string; posterPath?: string }
  ) => {
    const key = opts.tmdbId ? String(opts.tmdbId) : opts.streamId;
    if (!key) return;

    const id = wlId(type, key);
    const existing = await db.watchlist.get(id);
    if (existing) {
      await db.watchlist.delete(id);
    } else {
      await db.watchlist.put({
        id,
        type,
        tmdb_id: opts.tmdbId,
        stream_id: opts.streamId,
        name: opts.name,
        poster_path: opts.posterPath,
        added: new Date(),
      });
    }
  }, []);
}

export function useWatchlistMovies() {
  const enabledIds = useEnabledSourceIds();
  return useLiveQuery(async () => {
    const items = await db.watchlist.where('type').equals('movie').toArray();
    if (items.length === 0) return [];

    const byTmdb = items.filter(i => i.tmdb_id).map(i => i.tmdb_id!);
    const byStream = items.filter(i => !i.tmdb_id && i.stream_id).map(i => i.stream_id!);

    const [tmdbMovies, streamMovies] = await Promise.all([
      byTmdb.length > 0 ? db.vodMovies.where('tmdb_id').anyOf(byTmdb).toArray() : [],
      byStream.length > 0 ? db.vodMovies.where('stream_id').anyOf(byStream).toArray() : [],
    ]);

    let all = [...tmdbMovies, ...streamMovies];

    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      all = all.filter(m => enabledSet.has(m.source_id));
    }

    const seen = new Set<string>();
    return all.filter(m => {
      if (seen.has(m.stream_id)) return false;
      seen.add(m.stream_id);
      return true;
    });
  }, [enabledIds.join(',')]) ?? [];
}

export function useWatchlistSeries() {
  const enabledIds = useEnabledSourceIds();
  return useLiveQuery(async () => {
    const items = await db.watchlist.where('type').equals('series').toArray();
    if (items.length === 0) return [];

    const byTmdb = items.filter(i => i.tmdb_id).map(i => i.tmdb_id!);
    const byStream = items.filter(i => !i.tmdb_id && i.stream_id).map(i => i.stream_id!);

    const [tmdbSeries, streamSeries] = await Promise.all([
      byTmdb.length > 0 ? db.vodSeries.where('tmdb_id').anyOf(byTmdb).toArray() : [],
      byStream.length > 0 ? db.vodSeries.where('series_id').anyOf(byStream).toArray() : [],
    ]);

    let all = [...tmdbSeries, ...streamSeries];

    if (enabledIds.length > 0) {
      const enabledSet = new Set(enabledIds);
      all = all.filter(s => enabledSet.has(s.source_id));
    }

    const seen = new Set<string>();
    return all.filter(s => {
      if (seen.has(s.series_id)) return false;
      seen.add(s.series_id);
      return true;
    });
  }, [enabledIds.join(',')]) ?? [];
}
