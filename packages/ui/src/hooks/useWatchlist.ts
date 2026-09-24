import { useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredWatchlistItem } from '../db';
import { useDataQuery } from '../data/useDataQuery';
import { useEnabledSourceIds } from './useSourceFiltering';

const NO_ITEMS: StoredWatchlistItem[] = [];

function wlId(type: 'movie' | 'series', key: string): string {
  return `${type}_${key}`;
}

/**
 * Build a dedup/sort key for watchlist items.
 * Movies use stream_id, series use series_id — but watchlist entries store the
 * id as `stream_id` for both (it's how the toggle persists the value).
 * This helper makes the coupling between storage key and lookup key explicit.
 */
function wlSortKey(tmdbId: number | undefined, streamOrSeriesId: string | undefined): string {
  return tmdbId ? `tmdb_${tmdbId}` : streamOrSeriesId ?? '';
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

// Watchlist entries stay on Dexie; the movie and series rows come from the data
// process by tmdb_id (cross-source) or by the stored id when there is no match.
function useWatchlistKeys(type: 'movie' | 'series') {
  const items = useLiveQuery(() => db.watchlist.where('type').equals(type).toArray(), [type]) ?? NO_ITEMS;
  const byTmdb = useMemo(() => items.filter((i) => i.tmdb_id).map((i) => i.tmdb_id!), [items]);
  const byStream = useMemo(() => items.filter((i) => !i.tmdb_id && i.stream_id).map((i) => i.stream_id!), [items]);
  return { items, byTmdb, byStream };
}

function orderByAdded<T>(items: StoredWatchlistItem[], rows: T[], keyOf: (row: T) => string): T[] {
  // Dedup by tmdb_id (cross-source), fall back to the stored id
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = keyOf(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Sort by watchlist added date (oldest first, newest last)
  const addedMap = new Map(items.map((i) => [wlSortKey(i.tmdb_id, i.stream_id), i.added]));
  return deduped.sort((a, b) => (addedMap.get(keyOf(a))?.getTime() ?? 0) - (addedMap.get(keyOf(b))?.getTime() ?? 0));
}

export function useWatchlistMovies() {
  const enabledIds = useEnabledSourceIds();
  const { items, byTmdb, byStream } = useWatchlistKeys('movie');
  const { data: tmdbMovies } = useDataQuery(
    byTmdb.length > 0 ? { type: 'movies', by: { kind: 'tmdbIds', tmdbIds: byTmdb }, sourceIds: enabledIds } : null,
    ['vod_movies'], [byTmdb.join(','), enabledIds.join(',')],
  );
  const { data: streamMovies } = useDataQuery(
    byStream.length > 0 ? { type: 'movies', by: { kind: 'ids', streamIds: byStream }, sourceIds: enabledIds } : null,
    ['vod_movies'], [byStream.join(','), enabledIds.join(',')],
  );
  return useMemo(() => {
    if (items.length === 0) return [];
    return orderByAdded(items, [...(tmdbMovies ?? []), ...(streamMovies ?? [])], (m) => wlSortKey(m.tmdb_id, m.stream_id));
  }, [items, tmdbMovies, streamMovies]);
}

export function useWatchlistSeries() {
  const enabledIds = useEnabledSourceIds();
  const { items, byTmdb, byStream } = useWatchlistKeys('series');
  const { data: tmdbSeries } = useDataQuery(
    byTmdb.length > 0 ? { type: 'series', by: { kind: 'tmdbIds', tmdbIds: byTmdb }, sourceIds: enabledIds } : null,
    ['vod_series'], [byTmdb.join(','), enabledIds.join(',')],
  );
  const { data: streamSeries } = useDataQuery(
    byStream.length > 0 ? { type: 'series', by: { kind: 'ids', seriesIds: byStream }, sourceIds: enabledIds } : null,
    ['vod_series'], [byStream.join(','), enabledIds.join(',')],
  );
  // Note: watchlist entries store the id as stream_id for both movies and series
  return useMemo(() => {
    if (items.length === 0) return [];
    return orderByAdded(items, [...(tmdbSeries ?? []), ...(streamSeries ?? [])], (s) => wlSortKey(s.tmdb_id, s.series_id));
  }, [items, tmdbSeries, streamSeries]);
}
