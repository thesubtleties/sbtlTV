import type { Source, Category, Movie, Series, Season } from '@sbtltv/core';
import { getEnrichedMovieExports, getEnrichedTvExports, extractMatchParams, findBestMatch } from '@sbtltv/core';
import type { StageContext } from './sync-channels.js';
import { replaceVod, replaceEpisodes, applyTmdbMatches } from './writes.js';
import type { VodCategoryInput } from './writes.js';

export interface VodClient {
  getVodCategories(): Promise<Category[]>;
  getVodStreams(): Promise<Movie[]>;
  getSeriesCategories(): Promise<Category[]>;
  getSeries(): Promise<Series[]>;
  getSeriesInfo(seriesId: string): Promise<Season[]>;
}

const count = (db: StageContext['db'], sql: string, id: string) => (db.prepare(sql).get(id) as { c: number }).c;
const orUndef = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

// Re-reads a source's stored rows in the provider shape, so a skipped half of the
// sync can be handed back to replaceVod unchanged (every provider column, not
// just the keys, or the upsert would blank them).
function storedMovies(db: StageContext['db'], sourceId: string): Movie[] {
  const rows = db.prepare(`
    select m.stream_id, m.source_id, m.name, m.title, m.year, m.stream_icon, m.direct_url, m.plot, m."cast", m.director, m.genre, m.release_date, m.duration, m.rating, m.tmdb_id,
           (select json_group_array(category_id) from vod_item_categories ic where ic.item_id = m.stream_id and ic.item_type = 'movie') as cats
    from vod_movies m where m.source_id = ?`).all(sourceId) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    stream_id: r.stream_id as string, source_id: r.source_id as string, name: r.name as string, stream_icon: (r.stream_icon as string) ?? '', direct_url: r.direct_url as string,
    title: orUndef(r.title as string | null), year: orUndef(r.year as string | null), plot: orUndef(r.plot as string | null), cast: orUndef(r.cast as string | null),
    director: orUndef(r.director as string | null), genre: orUndef(r.genre as string | null), release_date: orUndef(r.release_date as string | null),
    duration: orUndef(r.duration as number | null), rating: orUndef(r.rating as string | null), tmdb_id: orUndef(r.tmdb_id as number | null),
    category_ids: JSON.parse(r.cats as string) as string[],
  }));
}
function storedSeries(db: StageContext['db'], sourceId: string): Series[] {
  const rows = db.prepare(`
    select s.series_id, s.source_id, s.name, s.title, s.year, s.cover, s.plot, s."cast", s.genre, s.release_date, s.rating, s.tmdb_id,
           (select json_group_array(category_id) from vod_item_categories ic where ic.item_id = s.series_id and ic.item_type = 'series') as cats
    from vod_series s where s.source_id = ?`).all(sourceId) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    series_id: r.series_id as string, source_id: r.source_id as string, name: r.name as string, cover: (r.cover as string) ?? '',
    title: orUndef(r.title as string | null), year: orUndef(r.year as string | null), plot: orUndef(r.plot as string | null), cast: orUndef(r.cast as string | null),
    genre: orUndef(r.genre as string | null), release_date: orUndef(r.release_date as string | null), rating: orUndef(r.rating as string | null), tmdb_id: orUndef(r.tmdb_id as number | null),
    category_ids: JSON.parse(r.cats as string) as string[],
  }));
}

export async function syncVod(ctx: StageContext, source: Source, client: VodClient): Promise<{ movies: number; series: number } | null> {
  ctx.progress({ sourceId: source.id, stage: 'vod', state: 'started' });
  try {
    const fail = (what: string) => (e: unknown) => { ctx.log('vod', `${what} fetch failed, keeping existing data: ${e instanceof Error ? e.message : String(e)}`); return null; };
    const [movieCats, movies, seriesCats, series] = await Promise.all([
      client.getVodCategories().catch(fail('Movie category')), client.getVodStreams().catch(fail('Movie')),
      client.getSeriesCategories().catch(fail('Series category')), client.getSeries().catch(fail('Series')),
    ]);
    // Same rule as sync.ts: an empty list when data exists is treated as a bad response and skipped.
    const existingMovies = count(ctx.db, 'select count(*) c from vod_movies where source_id = ?', source.id);
    const existingSeries = count(ctx.db, 'select count(*) c from vod_series where source_id = ?', source.id);
    const useMovies = movies !== null && movieCats !== null && !(movies.length === 0 && existingMovies > 0);
    const useSeries = series !== null && seriesCats !== null && !(series.length === 0 && existingSeries > 0);
    if (movies !== null && movies.length === 0 && existingMovies > 0) ctx.log('vod', 'Movie fetch returned empty but we have existing data, keeping it');
    if (series !== null && series.length === 0 && existingSeries > 0) ctx.log('vod', 'Series fetch returned empty but we have existing data, keeping it');
    if (!useMovies && !useSeries) {
      ctx.log('vod', 'Movie and series fetch failed or came back empty, keeping existing data');
      ctx.progress({ sourceId: source.id, stage: 'vod', state: 'finished', counts: { movies: existingMovies, series: existingSeries } });
      return { movies: existingMovies, series: existingSeries };
    }
    if (useMovies) ctx.log('vod', `Fetched ${movies!.length} movies, ${movieCats!.length} categories`);
    if (useSeries) ctx.log('vod', `Fetched ${series!.length} series, ${seriesCats!.length} categories`);
    const keepMovies: Movie[] = useMovies ? movies! : storedMovies(ctx.db, source.id);
    const keepSeries: Series[] = useSeries ? series! : storedSeries(ctx.db, source.id);
    const existingCats = ctx.db.prepare('select category_id, name, type from vod_categories where source_id = ?').all(source.id) as unknown as VodCategoryInput[];
    const categories: VodCategoryInput[] = [
      ...(useMovies ? movieCats!.map((c) => ({ category_id: c.category_id, name: c.category_name, type: 'movie' as const })) : existingCats.filter((c) => c.type === 'movie')),
      ...(useSeries ? seriesCats!.map((c) => ({ category_id: c.category_id, name: c.category_name, type: 'series' as const })) : existingCats.filter((c) => c.type === 'series')),
    ];
    const removedMovies = useMovies ? existingMovies - count(ctx.db, `select count(*) c from vod_movies where source_id = ? and stream_id in (select value from json_each('${JSON.stringify(keepMovies.map((m) => m.stream_id)).replace(/'/g, "''")}'))`, source.id) : 0;
    const t0 = Date.now();
    const tables = replaceVod(ctx.db, source.id, { movies: keepMovies, series: keepSeries, categories });
    ctx.changed(tables, source.id);
    if (removedMovies > 0) ctx.log('vod', `Removed ${removedMovies} movies no longer in source`);
    ctx.log('vod', `VOD stored: ${keepMovies.length} movies, ${keepSeries.length} series, ${categories.length} categories in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    ctx.progress({ sourceId: source.id, stage: 'vod', state: 'finished', counts: { movies: keepMovies.length, series: keepSeries.length } });
    return { movies: keepMovies.length, series: keepSeries.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.log('vod', `VOD sync failed: ${message}`);
    ctx.progress({ sourceId: source.id, stage: 'vod', state: 'failed', message });
    return null;
  }
}

export async function syncEpisodes(ctx: StageContext, source: Source, client: VodClient, seriesId: string): Promise<number> {
  const seasons = await client.getSeriesInfo(seriesId);
  const episodes = seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, source_id: source.id })));
  ctx.changed(replaceEpisodes(ctx.db, seriesId, episodes), source.id);
  return episodes.length;
}

// Matches rows that have never been attempted. match_attempted survives resyncs now
// (the replaceVod upsert leaves it alone), so this is incremental for real.
export async function matchTmdb(ctx: StageContext, source: Source): Promise<void> {
  ctx.progress({ sourceId: source.id, stage: 'tmdb', state: 'started' });
  try {
    for (const kind of ['movie', 'series'] as const) {
      const table = kind === 'movie' ? 'vod_movies' : 'vod_series';
      const key = kind === 'movie' ? 'stream_id' : 'series_id';
      const rows = ctx.db.prepare(`select ${key} as id, name, title, year from ${table} where source_id = ? and tmdb_id is null and match_attempted is null`).all(source.id) as { id: string; name: string; title: string | null; year: string | null }[];
      if (rows.length === 0) { ctx.log('vod', `TMDB match: no new ${kind} rows to match`); continue; }
      ctx.log('vod', `TMDB match: downloading ${kind} exports for ${rows.length} rows...`);
      const exports = kind === 'movie' ? await getEnrichedMovieExports() : await getEnrichedTvExports();
      const now = Date.now();
      let matched = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) => {
          const params = extractMatchParams({ name: r.name, title: orUndef(r.title), year: orUndef(r.year) });
          const hit = findBestMatch(exports, params.title, params.year);
          if (hit) matched++;
          return { id: r.id, tmdb_id: hit?.id, popularity: hit?.popularity, matchAttemptedMs: now };
        });
        ctx.changed(applyTmdbMatches(ctx.db, kind, batch), source.id);
      }
      ctx.log('vod', `TMDB match: ${matched}/${rows.length} ${kind} rows matched`);
    }
    ctx.progress({ sourceId: source.id, stage: 'tmdb', state: 'finished' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.log('vod', `TMDB match failed: ${message}`);
    ctx.progress({ sourceId: source.id, stage: 'tmdb', state: 'failed', message });
  }
}
