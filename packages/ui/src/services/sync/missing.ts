// packages/ui/src/services/sync/missing.ts
/** Titles in the user's lists (often from another computer) that this computer's library doesn't have. */
import type { StoredWatchProgress, StoredWatchlistItem } from '../../db';

export interface MissingTitle {
  key: string; from: 'progress' | 'watchlist'; type: 'movie' | 'series'; tmdbId: number; name: string;
  pct?: number; progressIds?: string[];
}

export function pickMissing(o: {
  movieRecs: StoredWatchProgress[]; seriesHeads: StoredWatchProgress[]; watchlist: StoredWatchlistItem[];
  libraryMovieTmdb: Set<number>; libraryMovieStreams: Set<string>; librarySeriesTmdb: Set<number>;
}): { progress: MissingTitle[]; watchlist: MissingTitle[] } {
  const progress: MissingTitle[] = [];
  const seen = new Set<string>();
  for (const r of o.movieRecs) {
    if (!r.tmdb_id || (r.stream_id && o.libraryMovieStreams.has(r.stream_id)) || o.libraryMovieTmdb.has(r.tmdb_id)) continue;
    const key = `missing-movie-${r.tmdb_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    progress.push({ key, from: 'progress', type: 'movie', tmdbId: r.tmdb_id, name: r.name ?? '', pct: r.progress, progressIds: [r.id] });
  }
  for (const h of o.seriesHeads) {
    const t = h.series_tmdb_id;
    if (!t || o.librarySeriesTmdb.has(t)) continue;
    const key = `missing-series-${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    progress.push({ key, from: 'progress', type: 'series', tmdbId: t, name: (h.name ?? '').replace(/\s+S\d+\s*E\d+.*$/i, ''), pct: h.progress });
  }
  const watchlist = o.watchlist
    .filter((w) => w.tmdb_id && !(w.type === 'movie' ? o.libraryMovieTmdb : o.librarySeriesTmdb).has(w.tmdb_id))
    .map((w) => ({ key: `missing-wl-${w.type}-${w.tmdb_id}`, from: 'watchlist' as const, type: w.type, tmdbId: w.tmdb_id!, name: w.name }));
  return { progress, watchlist };
}
