import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredWatchProgress, type StoredWatchlistItem } from '../db';
import { useDataQuery } from '../data/useDataQuery';
import { groupBySeriesKey } from '../services/continue-watching/grouping';
import { selectActiveEpisode } from '../services/continue-watching/next-episode';
import { pickMissing, type MissingTitle } from '../services/sync/missing';
import { useUIStore } from '../stores/uiStore';
import { useSyncActive } from './useSyncActive';

const MAX = 30;   // same cap as Continue Watching
const NO_PROGRESS: StoredWatchProgress[] = [];
const NO_WATCHLIST: StoredWatchlistItem[] = [];
const NONE: { progress: MissingTitle[]; watchlist: MissingTitle[] } = { progress: [], watchlist: [] };

/**
 * Titles in Continue Watching or the watchlist synced from another computer that this library
 * doesn't have. Only while sync is on (without it, leftovers from a removed provider stay hidden as
 * before, and no TMDB poster lookups start). Empty when the person chose Hide, and until the library
 * has answered (so nothing flashes as missing while it loads).
 */
export function useMissingTitles(type: 'movie' | 'series'): { progress: MissingTitle[]; watchlist: MissingTitle[] } {
  const syncOn = useSyncActive();
  const hide = useUIStore((s) => s.settings.syncMissingTitles === 'hide') || !syncOn;
  const movieRecs = useLiveQuery(async () => (hide || type !== 'movie' ? NO_PROGRESS
    : (await db.watchProgress.where('type').equals('movie').and((r) => !r.completed && !!r.tmdb_id).toArray())
      .sort((a, b) => +b.updated_at - +a.updated_at).slice(0, MAX)), [type, hide]) ?? NO_PROGRESS;
  const epRecs = useLiveQuery(async () => (hide || type !== 'series' ? NO_PROGRESS
    : db.watchProgress.where('type').equals('episode').and((r) => !!r.series_tmdb_id).toArray()), [type, hide]) ?? NO_PROGRESS;
  const watchlist = useLiveQuery(async () => (hide ? NO_WATCHLIST
    : db.watchlist.where('type').equals(type).and((w) => !!w.tmdb_id).toArray()), [type, hide]) ?? NO_WATCHLIST;

  const seriesHeads = useMemo(() => [...groupBySeriesKey(epRecs).values()]
    .map((group) => selectActiveEpisode(group))
    .sort((a, b) => +b.updated_at - +a.updated_at)
    .slice(0, MAX), [epRecs]);

  const tmdbIds = useMemo(() => [...new Set([
    ...movieRecs.map((r) => r.tmdb_id!),
    ...seriesHeads.map((h) => h.series_tmdb_id!),
    ...watchlist.map((w) => w.tmdb_id!),
  ])], [movieRecs, seriesHeads, watchlist]);
  const streamIds = useMemo(() => movieRecs.map((r) => r.stream_id).filter((x): x is string => !!x), [movieRecs]);

  const byTmdb = useDataQuery(
    tmdbIds.length > 0 ? (type === 'movie'
      ? { type: 'movies', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: [] }
      : { type: 'series', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: [] }) : null,
    [type === 'movie' ? 'vod_movies' : 'vod_series'], [type, tmdbIds.join(',')],
  ).data as { tmdb_id?: number }[] | undefined;
  const byStream = useDataQuery(
    streamIds.length > 0 ? { type: 'movies', by: { kind: 'ids', streamIds }, sourceIds: [] } : null,
    ['vod_movies'], [streamIds.join(',')],
  ).data as { stream_id: string }[] | undefined;

  return useMemo(() => {
    if (tmdbIds.length === 0) return NONE;
    if (!byTmdb || (streamIds.length > 0 && !byStream)) return NONE;
    const found = new Set(byTmdb.map((m) => m.tmdb_id).filter((x): x is number => x != null));
    return pickMissing({
      movieRecs, seriesHeads, watchlist,
      libraryMovieTmdb: type === 'movie' ? found : new Set(),
      libraryMovieStreams: new Set((byStream ?? []).map((m) => m.stream_id)),
      librarySeriesTmdb: type === 'series' ? found : new Set(),
    });
  }, [tmdbIds, byTmdb, byStream, streamIds, movieRecs, seriesHeads, watchlist, type]);
}
