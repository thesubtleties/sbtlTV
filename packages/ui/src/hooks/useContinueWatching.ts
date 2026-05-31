import { useLiveQuery } from 'dexie-react-hooks';
import { db, type StoredMovie, type StoredSeries } from '../db';
import { groupBySeriesKey } from '../services/continue-watching/grouping';
import { selectActiveEpisode, computeResumeTarget } from '../services/continue-watching/next-episode';

const MAX_ROW_ITEMS = 30; // cap resolution work for power users with many in-progress titles

export interface ContinueItem {
  kind: 'movie' | 'series';
  key: string;                    // unique row key (movie id or seriesKey)
  media: StoredMovie | StoredSeries;
  resumePct: number;
  subtitle?: string;              // "S2 · E5" for series
  seriesTmdbId?: number;          // series identity for indexed clearSeries (series cards only)
  seriesStreamId?: string;
  updatedAt: Date;
}

const EMPTY: ContinueItem[] = [];

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
    const out: ContinueItem[] = [];
    for (const { key, active } of heads) {
      let series: StoredSeries | undefined;
      if (active.series_tmdb_id) series = await db.vodSeries.where('tmdb_id').equals(active.series_tmdb_id).first();
      if (!series && active.series_stream_id) series = await db.vodSeries.get(active.series_stream_id);
      if (!series) continue; // orphan (series no longer synced)
      const episodes = await db.vodEpisodes.where('series_id').equals(series.series_id).toArray();
      const target = computeResumeTarget(active, episodes.map(e => ({ season_num: e.season_num, episode_num: e.episode_num })));
      if (!target) continue; // finished series / no honest resume
      out.push({
        kind: 'series', key, media: series, resumePct: target.progressPct,
        subtitle: `S${target.seasonNum} · E${target.episodeNum}`,
        seriesTmdbId: active.series_tmdb_id, seriesStreamId: active.series_stream_id,
        updatedAt: active.updated_at,
      });
    }
    return out;
  }, [type]) ?? EMPTY;
}
