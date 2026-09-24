import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries, type StoredEpisode, type StoredWatchProgress } from '../db';
import { data } from '../data/client';
import { useDataQuery } from '../data/useDataQuery';
import type { VodPlayInfo } from '../types/media';
import { groupBySeriesKey } from '../services/continue-watching/grouping';
import { selectActiveEpisode, computeResumeTarget } from '../services/continue-watching/next-episode';
import { buildEpisodePlayInfo } from '../services/continue-watching/next-episode.playinfo';

const MAX_ROW_ITEMS = 30; // cap resolution work for power users with many in-progress titles

export interface ContinueItem {
  kind: 'movie' | 'series';
  key: string;                    // unique row key (movie id or seriesKey)
  media: StoredMovie | StoredSeries;
  resumePct: number;
  subtitle?: string;              // "S2 · E5" for series
  seriesTmdbId?: number;          // series identity for indexed clearSeries (series cards only)
  seriesStreamId?: string;
  playInfo?: VodPlayInfo;         // series: ready-to-play resume episode (resume pos handled on play)
  updatedAt: Date;
}

const EMPTY: ContinueItem[] = [];
const NO_RECORDS: StoredWatchProgress[] = [];

/** Merged, deduped episode list for a series: one episode per season+episode, preferring the
 *  primary series' copy, then the others in `relatedIds` order. Pure; callers fetch the rows. */
export function mergeEpisodes(primarySeriesId: string, relatedIds: string[], episodes: StoredEpisode[]): StoredEpisode[] {
  const prio = new Map(relatedIds.map((id, i) => [id, id === primarySeriesId ? -1 : i] as const));
  const byKey = new Map<string, StoredEpisode>();
  for (const ep of episodes) {
    if (!prio.has(ep.series_id)) continue;
    const k = `${ep.season_num}_${ep.episode_num}`;
    const ex = byKey.get(k);
    if (!ex || (prio.get(ep.series_id) ?? 999) < (prio.get(ex.series_id) ?? 999)) byKey.set(k, ep);
  }
  return [...byKey.values()];
}

/** Merged, deduped episode list for a series — gathers all tmdb-matched series (cross-source /
 *  duplicate), preferring the primary series' episode per season+episode. Mirrors SeriesDetail's
 *  merged view so the Continue Watching card and the player resolve "next episode" from the same set. */
export async function mergedEpisodesForSeries(series: { series_id: string; tmdb_id?: number }): Promise<StoredEpisode[]> {
  let relatedIds = [series.series_id];
  if (series.tmdb_id != null) {
    const all = await data.query({ type: 'series', by: { kind: 'tmdbIds', tmdbIds: [series.tmdb_id] }, sourceIds: [] });
    if (all.length) relatedIds = all.map((s) => s.series_id);
  }
  const allEps = await data.query({ type: 'episodes', seriesIds: relatedIds });
  return mergeEpisodes(series.series_id, relatedIds, allEps);
}

function useMovieItems(active: boolean): ContinueItem[] {
  const recs = useLiveQuery(async () => {
    if (!active) return NO_RECORDS;
    return (await db.watchProgress.where('type').equals('movie').and((r) => !r.completed).toArray())
      .sort((a, b) => +b.updated_at - +a.updated_at)
      .slice(0, MAX_ROW_ITEMS);
  }, [active]) ?? NO_RECORDS;
  const streamIds = useMemo(() => recs.map((r) => r.stream_id ?? '').filter(Boolean), [recs]);
  // A movie progress record's stream_id IS the movie's id.
  const { data: movies } = useDataQuery(
    streamIds.length > 0 ? { type: 'movies', by: { kind: 'ids', streamIds }, sourceIds: [] } : null,
    ['vod_movies'], [streamIds.join(',')],
  );
  return useMemo(() => {
    if (recs.length === 0 || !movies) return EMPTY;
    const byId = new Map(movies.map((m) => [m.stream_id, m]));
    const out: ContinueItem[] = [];
    for (const r of recs) {
      const media = r.stream_id ? byId.get(r.stream_id) : undefined;
      if (!media) continue; // orphan (movie no longer synced)
      out.push({ kind: 'movie', key: r.id, media, resumePct: r.progress, updatedAt: r.updated_at });
    }
    return out;
  }, [recs, movies]);
}

function useSeriesItems(active: boolean): ContinueItem[] {
  // Include ALL episode records (a completed active episode still yields an "up next").
  // Pick each series' last-played head in-memory, then resolve only the most-recent N.
  const epRecs = useLiveQuery(async () => (active ? db.watchProgress.where('type').equals('episode').toArray() : NO_RECORDS), [active]) ?? NO_RECORDS;
  const heads = useMemo(() => [...groupBySeriesKey(epRecs).entries()]
    .map(([key, group]) => ({ key, active: selectActiveEpisode(group) }))
    .sort((a, b) => +b.active.updated_at - +a.active.updated_at)
    .slice(0, MAX_ROW_ITEMS), [epRecs]);

  const tmdbIds = useMemo(() => [...new Set(heads.map((h) => h.active.series_tmdb_id).filter((x): x is number => x != null))], [heads]);
  const streamIds = useMemo(() => [...new Set(heads.map((h) => h.active.series_stream_id).filter((x): x is string => !!x))], [heads]);
  const { data: byTmdb } = useDataQuery(
    tmdbIds.length > 0 ? { type: 'series', by: { kind: 'tmdbIds', tmdbIds }, sourceIds: [] } : null,
    ['vod_series'], [tmdbIds.join(',')],
  );
  const { data: byStream } = useDataQuery(
    streamIds.length > 0 ? { type: 'series', by: { kind: 'ids', seriesIds: streamIds }, sourceIds: [] } : null,
    ['vod_series'], [streamIds.join(',')],
  );
  const seriesReady = (tmdbIds.length === 0 || byTmdb !== undefined) && (streamIds.length === 0 || byStream !== undefined);

  // Each head resolves to one series (tmdb match first, then the stored series id) and the
  // related series that share its tmdb_id.
  const resolvedHeads = useMemo(() => {
    if (!seriesReady) return [];
    const tmdbRows = byTmdb ?? [];
    const streamRows = new Map((byStream ?? []).map((s) => [s.series_id, s]));
    return heads.map(({ key, active }) => {
      let series: StoredSeries | undefined;
      if (active.series_tmdb_id) series = tmdbRows.find((s) => s.tmdb_id === active.series_tmdb_id);
      if (!series && active.series_stream_id) series = streamRows.get(active.series_stream_id);
      if (!series) return null; // orphan (series no longer synced)
      const relatedIds = series.tmdb_id != null
        ? (() => { const ids = tmdbRows.filter((s) => s.tmdb_id === series!.tmdb_id).map((s) => s.series_id); return ids.length ? ids : [series!.series_id]; })()
        : [series.series_id];
      return { key, active, series, relatedIds };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [heads, byTmdb, byStream, seriesReady]);

  const allSeriesIds = useMemo(() => [...new Set(resolvedHeads.flatMap((h) => h.relatedIds))], [resolvedHeads]);
  const { data: episodes } = useDataQuery(
    allSeriesIds.length > 0 ? { type: 'episodes', seriesIds: allSeriesIds } : null,
    ['vod_episodes'], [allSeriesIds.join(',')],
  );

  return useMemo(() => {
    if (resolvedHeads.length === 0 || !episodes) return EMPTY;
    const out: ContinueItem[] = [];
    for (const { key, active, series, relatedIds } of resolvedHeads) {
      const merged = mergeEpisodes(series.series_id, relatedIds, episodes);
      const target = computeResumeTarget(active, merged.map((e) => ({ season_num: e.season_num, episode_num: e.episode_num })));
      if (!target) continue; // finished series / no honest resume
      out.push({
        kind: 'series', key, media: series, resumePct: target.progressPct,
        subtitle: `S${target.seasonNum} · E${target.episodeNum}`,
        seriesTmdbId: active.series_tmdb_id, seriesStreamId: active.series_stream_id,
        playInfo: buildEpisodePlayInfo(series, merged, target.seasonNum, target.episodeNum) ?? undefined,
        updatedAt: active.updated_at,
      });
    }
    return out;
  }, [resolvedHeads, episodes]);
}

/** One card per title; series collapse to their last-played head (resume or up-next). */
export function useContinueWatchingResolved(type: 'movie' | 'series'): ContinueItem[] {
  const movies = useMovieItems(type === 'movie');
  const series = useSeriesItems(type === 'series');
  return type === 'movie' ? movies : series;
}
