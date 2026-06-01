import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries, type StoredEpisode } from '../db';
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

/** Merged, deduped episode list for a series — gathers all tmdb-matched series (cross-source /
 *  duplicate), preferring the primary series' episode per season+episode. Mirrors SeriesDetail's
 *  merged view so the Continue Watching card and the player resolve "next episode" from the same set. */
export async function mergedEpisodesForSeries(series: { series_id: string; tmdb_id?: number }): Promise<StoredEpisode[]> {
  let relatedIds = [series.series_id];
  if (series.tmdb_id != null) {
    const all = await db.vodSeries.where('tmdb_id').equals(series.tmdb_id).toArray();
    if (all.length) relatedIds = all.map(s => s.series_id);
  }
  const allEps = await db.vodEpisodes.where('series_id').anyOf(relatedIds).toArray();
  const prio = new Map(relatedIds.map((id, i) => [id, id === series.series_id ? -1 : i] as const));
  const byKey = new Map<string, StoredEpisode>();
  for (const ep of allEps) {
    const k = `${ep.season_num}_${ep.episode_num}`;
    const ex = byKey.get(k);
    if (!ex || (prio.get(ep.series_id) ?? 999) < (prio.get(ex.series_id) ?? 999)) byKey.set(k, ep);
  }
  return [...byKey.values()];
}

/** One card per title; series collapse to their last-played head (resume or up-next). */
export function useContinueWatchingResolved(type: 'movie' | 'series'): ContinueItem[] {
  return useLiveQuery(async () => {
    if (type === 'movie') {
      const recs = (await db.watchProgress
        .where('type').equals('movie').and(r => !r.completed).toArray())
        .sort((a, b) => +b.updated_at - +a.updated_at)
        .slice(0, MAX_ROW_ITEMS);
      // Bulk-resolve posters in ONE query (a movie progress record's stream_id IS the vodMovies PK).
      const movies = await db.vodMovies.bulkGet(recs.map(r => r.stream_id ?? ''));
      const out: ContinueItem[] = [];
      recs.forEach((r, i) => {
        const media = movies[i] ?? undefined;
        if (!media) return; // orphan (movie no longer synced)
        out.push({ kind: 'movie', key: r.id, media, resumePct: r.progress, updatedAt: r.updated_at });
      });
      return out;
    }

    // series: include ALL episode records (a completed active episode still yields an "up next").
    // Pick each series' last-played head in-memory, then resolve only the most-recent N (bounds DB work).
    const epRecs = await db.watchProgress.where('type').equals('episode').toArray();
    const heads = [...groupBySeriesKey(epRecs).entries()]
      .map(([key, group]) => ({ key, active: selectActiveEpisode(group) }))
      .sort((a, b) => +b.active.updated_at - +a.active.updated_at)
      .slice(0, MAX_ROW_ITEMS);
    // Resolve each head in parallel (series lookup + merged episodes), preserving recency order.
    const resolved = await Promise.all(heads.map(async ({ key, active }): Promise<ContinueItem | null> => {
      let series: StoredSeries | undefined;
      if (active.series_tmdb_id) series = await db.vodSeries.where('tmdb_id').equals(active.series_tmdb_id).first();
      if (!series && active.series_stream_id) series = await db.vodSeries.get(active.series_stream_id);
      if (!series) return null; // orphan (series no longer synced)
      const episodes = await mergedEpisodesForSeries(series);
      const target = computeResumeTarget(active, episodes.map(e => ({ season_num: e.season_num, episode_num: e.episode_num })));
      if (!target) return null; // finished series / no honest resume
      return {
        kind: 'series', key, media: series, resumePct: target.progressPct,
        subtitle: `S${target.seasonNum} · E${target.episodeNum}`,
        seriesTmdbId: active.series_tmdb_id, seriesStreamId: active.series_stream_id,
        playInfo: buildEpisodePlayInfo(series, episodes, target.seasonNum, target.episodeNum) ?? undefined,
        updatedAt: active.updated_at,
      };
    }));
    return resolved.filter((x): x is ContinueItem => x !== null);
  }, [type]) ?? EMPTY;
}
