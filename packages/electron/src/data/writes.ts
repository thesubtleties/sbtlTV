import type { DatabaseSync } from 'node:sqlite';
import type { Category, Channel, Movie, Series, Episode, DataTable, VodDetailFields } from '@sbtltv/core';

export interface EpgProgramInput { epg_channel_id: string; startMs: number; endMs: number; title: string; description: string }
export interface EpgLinkInput { stream_id: string; epg_channel_id: string; confidence: string; strategy: string }
export interface VodCategoryInput { category_id: string; name: string; type: 'movie' | 'series' }

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('begin immediate');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}
const j = (ids: readonly string[]) => JSON.stringify(ids);
const b = (v: boolean | undefined) => (v ? 1 : 0);

export function replaceChannels(db: DatabaseSync, sourceId: string, input: { categories: Category[]; channels: Channel[]; epgUrl?: string }): DataTable[] {
  return tx(db, () => {
    db.prepare(`delete from channel_categories where stream_id in (select stream_id from channels where source_id = ?)`).run(sourceId);
    db.prepare(`delete from epg_links where source_id = ?`).run(sourceId);
    db.prepare(`delete from channels where source_id = ?`).run(sourceId);
    db.prepare(`delete from categories where source_id = ?`).run(sourceId);
    const insCat = db.prepare(`insert into categories(category_id, source_id, name, position) values (?, ?, ?, ?)`);
    for (const c of input.categories) insCat.run(c.category_id, sourceId, c.category_name, c.position ?? null);
    const insCh = db.prepare(`insert into channels(stream_id, source_id, name, channel_num, stream_icon, epg_channel_id, direct_url, tv_archive, tv_archive_days, is_adult) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insLink = db.prepare(`insert or ignore into channel_categories(stream_id, category_id) values (?, ?)`);
    for (const ch of input.channels) {
      insCh.run(ch.stream_id, sourceId, ch.name, ch.channel_num ?? null, ch.stream_icon ?? '', ch.epg_channel_id ?? '', ch.direct_url, b(ch.tv_archive), (ch as { tv_archive_days?: number }).tv_archive_days ?? null, b(ch.is_adult));
      for (const cat of ch.category_ids) insLink.run(ch.stream_id, cat);
    }
    db.prepare(`
      insert into sources_meta(source_id, epg_url, last_channel_sync, channel_count, category_count, error)
      values (?, ?, ?, ?, ?, null)
      on conflict(source_id) do update set epg_url = excluded.epg_url, last_channel_sync = excluded.last_channel_sync,
        channel_count = excluded.channel_count, category_count = excluded.category_count, error = null`)
      .run(sourceId, input.epgUrl ?? null, Date.now(), input.channels.length, input.categories.length);
    return ['categories', 'channels', 'epg_links', 'sources_meta'];
  });
}

// A source has one guide at a time (several URLs are merged into one guide named
// `epgSource`), so the whole source's programmes and links are replaced. This keeps
// a guide switch (built-in to override, or back) from leaving stale links behind.
export function replaceEpg(db: DatabaseSync, sourceId: string, epgSource: string, input: { programs: EpgProgramInput[]; links: EpgLinkInput[] }): DataTable[] {
  return tx(db, () => {
    db.prepare(`delete from epg_programs where source_id = ?`).run(sourceId);
    db.prepare(`delete from epg_links where source_id = ?`).run(sourceId);
    const insP = db.prepare(`insert or ignore into epg_programs(id, source_id, epg_source, epg_channel_id, start, end, title, description) values (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of input.programs) insP.run(`${epgSource}::${p.epg_channel_id}::${p.startMs}`, sourceId, epgSource, p.epg_channel_id, p.startMs, p.endMs, p.title, p.description);
    const insL = db.prepare(`insert or replace into epg_links(stream_id, epg_source, epg_channel_id, source_id, confidence, strategy) values (?, ?, ?, ?, ?, ?)`);
    for (const l of input.links) insL.run(l.stream_id, epgSource, l.epg_channel_id, sourceId, l.confidence, l.strategy);
    db.prepare(`insert into sources_meta(source_id, last_epg_sync) values (?, ?) on conflict(source_id) do update set last_epg_sync = excluded.last_epg_sync`).run(sourceId, Date.now());
    return ['epg_programs', 'epg_links', 'sources_meta'];
  });
}

export function replaceVod(db: DatabaseSync, sourceId: string, input: { movies: Movie[]; series: Series[]; categories: VodCategoryInput[] }): DataTable[] {
  return tx(db, () => {
    // Enrichment columns (imdb_id, backdrop_path, popularity, match_attempted, added) are never
    // overwritten here; the upsert only touches provider fields. A provider-supplied tmdb_id is
    // stored on insert and never replaces one already on the row.
    const upM = db.prepare(`
      insert into vod_movies(stream_id, source_id, name, title, year, stream_icon, direct_url, plot, "cast", director, genre, release_date, duration, rating, tmdb_id, added)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(stream_id) do update set name = excluded.name, title = excluded.title, year = excluded.year, stream_icon = excluded.stream_icon,
        direct_url = excluded.direct_url, plot = excluded.plot, "cast" = excluded."cast", director = excluded.director, genre = excluded.genre,
        release_date = excluded.release_date, duration = excluded.duration, rating = excluded.rating,
        tmdb_id = coalesce(vod_movies.tmdb_id, excluded.tmdb_id)`);
    const now = Date.now();
    for (const m of input.movies) upM.run(m.stream_id, sourceId, m.name, m.title ?? null, m.year ?? null, m.stream_icon ?? '', m.direct_url, m.plot ?? null, m.cast ?? null, m.director ?? null, m.genre ?? null, m.release_date ?? null, m.duration ?? null, m.rating ?? null, m.tmdb_id ?? null, now);
    db.prepare(`delete from vod_movies where source_id = ? and stream_id not in (select value from json_each(?))`).run(sourceId, j(input.movies.map((m) => m.stream_id)));

    const upS = db.prepare(`
      insert into vod_series(series_id, source_id, name, title, year, cover, plot, "cast", genre, release_date, rating, tmdb_id, added)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(series_id) do update set name = excluded.name, title = excluded.title, year = excluded.year, cover = excluded.cover,
        plot = excluded.plot, "cast" = excluded."cast", genre = excluded.genre, release_date = excluded.release_date, rating = excluded.rating,
        tmdb_id = coalesce(vod_series.tmdb_id, excluded.tmdb_id)`);
    for (const s of input.series) upS.run(s.series_id, sourceId, s.name, s.title ?? null, s.year ?? null, s.cover ?? '', s.plot ?? null, s.cast ?? null, s.genre ?? null, s.release_date ?? null, s.rating ?? null, s.tmdb_id ?? null, now);
    const keepSeries = j(input.series.map((s) => s.series_id));
    db.prepare(`delete from vod_episodes where series_id in (select series_id from vod_series where source_id = ? and series_id not in (select value from json_each(?)))`).run(sourceId, keepSeries);
    db.prepare(`delete from vod_series where source_id = ? and series_id not in (select value from json_each(?))`).run(sourceId, keepSeries);

    db.prepare(`delete from vod_item_categories where item_id in (select stream_id from vod_movies where source_id = ?) or item_id in (select series_id from vod_series where source_id = ?)`).run(sourceId, sourceId);
    const insIC = db.prepare(`insert or ignore into vod_item_categories(item_id, item_type, category_id) values (?, ?, ?)`);
    for (const m of input.movies) for (const c of m.category_ids) insIC.run(m.stream_id, 'movie', c);
    for (const s of input.series) for (const c of s.category_ids) insIC.run(s.series_id, 'series', c);

    db.prepare(`delete from vod_categories where source_id = ?`).run(sourceId);
    const insC = db.prepare(`insert into vod_categories(source_id, category_id, name, type) values (?, ?, ?, ?)`);
    for (const c of input.categories) insC.run(sourceId, c.category_id, c.name, c.type);

    db.prepare(`
      insert into sources_meta(source_id, last_vod_sync, movie_count, series_count) values (?, ?, ?, ?)
      on conflict(source_id) do update set last_vod_sync = excluded.last_vod_sync, movie_count = excluded.movie_count, series_count = excluded.series_count`)
      .run(sourceId, now, input.movies.length, input.series.length);
    return ['vod_movies', 'vod_series', 'vod_episodes', 'vod_categories', 'sources_meta'];
  });
}

export function replaceEpisodes(db: DatabaseSync, seriesId: string, episodes: Episode[]): DataTable[] {
  return tx(db, () => {
    db.prepare(`delete from vod_episodes where series_id = ?`).run(seriesId);
    const ins = db.prepare(`insert or replace into vod_episodes(id, series_id, season_num, episode_num, title, direct_url, plot, duration, info, tmdb_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of episodes) ins.run(e.id, seriesId, e.season_num, e.episode_num, e.title, e.direct_url, e.plot ?? null, e.duration ?? null, e.info ? JSON.stringify(e.info) : null, e.tmdb_id ?? null);
    return ['vod_episodes'];
  });
}

export function applyTmdbMatches(db: DatabaseSync, kind: 'movie' | 'series', matches: { id: string; tmdb_id?: number; popularity?: number; matchAttemptedMs: number }[]): DataTable[] {
  const table = kind === 'movie' ? 'vod_movies' : 'vod_series';
  const key = kind === 'movie' ? 'stream_id' : 'series_id';
  return tx(db, () => {
    const up = db.prepare(`update ${table} set tmdb_id = coalesce(?, tmdb_id), popularity = coalesce(?, popularity), match_attempted = ? where ${key} = ?`);
    for (const m of matches) up.run(m.tmdb_id ?? null, m.popularity ?? null, m.matchAttemptedMs, m.id);
    return [table];
  });
}

// Details fetched lazily from TMDB (plot, genre, cast, director) fill empty columns only.
export function updateVodDetails(db: DatabaseSync, kind: 'movie' | 'series', itemId: string, fields: VodDetailFields): DataTable[] {
  const table = kind === 'movie' ? 'vod_movies' : 'vod_series';
  const key = kind === 'movie' ? 'stream_id' : 'series_id';
  const director = kind === 'movie' ? `, director = coalesce(nullif(director, ''), ?)` : '';
  const params = [fields.plot ?? null, fields.genre ?? null, fields.cast ?? null, fields.backdrop_path ?? null, ...(kind === 'movie' ? [fields.director ?? null] : []), itemId];
  db.prepare(`update ${table} set plot = coalesce(nullif(plot, ''), ?), genre = coalesce(nullif(genre, ''), ?), "cast" = coalesce(nullif("cast", ''), ?), backdrop_path = coalesce(nullif(backdrop_path, ''), ?)${director} where ${key} = ?`).run(...params);
  return [table];
}

export function setSourceError(db: DatabaseSync, sourceId: string, error: string | null): DataTable[] {
  db.prepare(`insert into sources_meta(source_id, error) values (?, ?) on conflict(source_id) do update set error = excluded.error`).run(sourceId, error);
  return ['sources_meta'];
}

export function deleteSource(db: DatabaseSync, sourceId: string): DataTable[] {
  return tx(db, () => {
    db.prepare(`delete from vod_episodes where series_id in (select series_id from vod_series where source_id = ?)`).run(sourceId);
    db.prepare(`delete from vod_item_categories where item_id in (select stream_id from vod_movies where source_id = ?) or item_id in (select series_id from vod_series where source_id = ?)`).run(sourceId, sourceId);
    db.prepare(`delete from channel_categories where stream_id in (select stream_id from channels where source_id = ?)`).run(sourceId);
    for (const t of ['vod_movies', 'vod_series', 'vod_categories', 'epg_programs', 'epg_links', 'channels', 'categories', 'sources_meta']) {
      db.prepare(`delete from ${t} where source_id = ?`).run(sourceId);
    }
    return ['vod_movies', 'vod_series', 'vod_episodes', 'vod_categories', 'epg_programs', 'epg_links', 'channels', 'categories', 'sources_meta'];
  });
}

export function clearAll(db: DatabaseSync): DataTable[] {
  return tx(db, () => {
    for (const t of ['vod_episodes', 'vod_item_categories', 'vod_movies', 'vod_series', 'vod_categories', 'epg_programs', 'epg_links', 'channel_categories', 'channels', 'categories', 'sources_meta']) db.exec(`delete from ${t}`);
    return ['vod_movies', 'vod_series', 'vod_episodes', 'vod_categories', 'epg_programs', 'epg_links', 'channels', 'categories', 'sources_meta'];
  });
}
