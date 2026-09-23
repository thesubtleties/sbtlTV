import type { DatabaseSync, StatementSync, SQLInputValue } from 'node:sqlite';
import type { DataRequest } from '@sbtltv/core';

// Every request compiles to a fixed statement. Lists travel as JSON text and
// are expanded with json_each, so a 10-id and a 10,000-id request are the
// same statement. An empty sourceIds list means "all sources".
const cache = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let m = cache.get(db);
  if (!m) { m = new Map(); cache.set(db, m); }
  let s = m.get(sql);
  if (!s) { s = db.prepare(sql); m.set(sql, s); }
  return s;
}
const j = (ids: readonly (string | number)[]) => JSON.stringify(ids);
const SRC = `(json_array_length($sources) = 0 or source_id in (select value from json_each($sources)))`;

function withCategoryIds<T extends { stream_id?: string; series_id?: string }>(db: DatabaseSync, rows: T[], itemType: 'channel' | 'movie' | 'series'): (T & { category_ids: string[] })[] {
  if (rows.length === 0) return [];
  const idOf = (r: T) => (itemType === 'series' ? r.series_id : r.stream_id) as string;
  const links = itemType === 'channel'
    ? stmt(db, `select stream_id as item_id, category_id from channel_categories where stream_id in (select value from json_each(?)) order by category_id`).all(j(rows.map(idOf)))
    : stmt(db, `select item_id, category_id from vod_item_categories where item_type = ? and item_id in (select value from json_each(?)) order by category_id`).all(itemType, j(rows.map(idOf)));
  const by = new Map<string, string[]>();
  for (const l of links as { item_id: string; category_id: string }[]) {
    (by.get(l.item_id) ?? by.set(l.item_id, []).get(l.item_id)!).push(l.category_id);
  }
  return rows.map((r) => ({ ...r, category_ids: by.get(idOf(r)) ?? [] }));
}

const CHANNEL_COLS = `stream_id, source_id, name, channel_num, stream_icon, epg_channel_id, direct_url, tv_archive, tv_archive_days, is_adult`;
const PROGRAM_COLS = `p.id, l.stream_id, p.title, p.description, p.start, p.end, p.source_id`;
const MOVIE_COLS = `stream_id, source_id, name, title, year, stream_icon, direct_url, plot, "cast", director, genre, release_date, duration, rating, tmdb_id, imdb_id, added, backdrop_path, popularity, match_attempted`;
const SERIES_COLS = `series_id, source_id, name, title, year, cover, plot, "cast", genre, release_date, rating, tmdb_id, imdb_id, added, backdrop_path, popularity, match_attempted`;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

function channelSort(sort: 'alphabetical' | 'number'): string {
  return sort === 'number'
    ? `order by channel_num is null, channel_num, name collate nocase`
    : `order by name collate nocase`;
}

type ChannelWire = { stream_id: string; tv_archive: number; is_adult: number };
function fixChannel<T extends { tv_archive: number; is_adult: number }>(r: T) {
  return { ...r, tv_archive: r.tv_archive === 1, is_adult: r.is_adult === 1 };
}

export function runQuery(db: DatabaseSync, req: DataRequest): unknown {
  switch (req.type) {
    case 'categories': {
      const rows = stmt(db, `
        select c.category_id, c.source_id, c.name as category_name, c.position,
               (select count(*) from channel_categories cc join channels ch on ch.stream_id = cc.stream_id
                 where cc.category_id = c.category_id
                   and (json_array_length($sources) = 0 or ch.source_id in (select value from json_each($sources)))) as channel_count
        from categories c
        where (json_array_length($sources) = 0 or c.source_id in (select value from json_each($sources)))
        order by c.name collate nocase, c.source_id`).all({ $sources: j(req.sourceIds) });
      return rows;
    }
    case 'channels': {
      const base = req.categoryId === null
        ? stmt(db, `select ${CHANNEL_COLS} from channels where ${SRC} ${channelSort(req.sort)}`).all({ $sources: j(req.sourceIds) })
        : stmt(db, `select ${CHANNEL_COLS} from channels where stream_id in (select stream_id from channel_categories where category_id = $cat) and ${SRC} ${channelSort(req.sort)}`).all({ $cat: req.categoryId, $sources: j(req.sourceIds) });
      return withCategoryIds(db, (base as ChannelWire[]).map(fixChannel), 'channel');
    }
    case 'channelsByIds': {
      const rows = stmt(db, `select ${CHANNEL_COLS} from channels where stream_id in (select value from json_each(?)) order by name collate nocase`).all(j(req.streamIds));
      return withCategoryIds(db, (rows as ChannelWire[]).map(fixChannel), 'channel');
    }
    case 'channelCount':
      return (stmt(db, `select count(*) as c from channels where ${SRC}`).get({ $sources: j(req.sourceIds) }) as { c: number }).c;
    case 'channelSearch': {
      const rows = stmt(db, `select ${CHANNEL_COLS} from channels where ${SRC} and name like $q escape '\\' order by name collate nocase limit $limit`)
        .all({ $sources: j(req.sourceIds), $q: `%${req.query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`, $limit: req.limit });
      return withCategoryIds(db, (rows as ChannelWire[]).map(fixChannel), 'channel');
    }
    case 'programsInRange':
      return stmt(db, `
        select ${PROGRAM_COLS}
        from epg_links l
        join epg_programs p on p.source_id = l.source_id and p.epg_source = l.epg_source and p.epg_channel_id = l.epg_channel_id
        where l.stream_id in (select value from json_each($ids))
          and p.start >= $lower and p.start < $upper and p.end > $winStart
        order by l.stream_id, p.start`).all({ $ids: j(req.streamIds), $lower: req.windowStartMs - LOOKBACK_MS, $upper: req.windowEndMs, $winStart: req.windowStartMs });
    case 'currentProgram': {
      const row = stmt(db, `
        select ${PROGRAM_COLS}
        from epg_links l
        join epg_programs p on p.source_id = l.source_id and p.epg_source = l.epg_source and p.epg_channel_id = l.epg_channel_id
        where l.stream_id = $id and p.start >= $lower and p.start <= $now and p.end > $now
        order by p.start desc limit 1`).get({ $id: req.streamId, $lower: req.nowMs - LOOKBACK_MS, $now: req.nowMs });
      return row ?? null;
    }
    case 'syncStatus':
      return stmt(db, `select source_id, epg_url, last_channel_sync, last_epg_sync, last_vod_sync, channel_count, category_count, movie_count, series_count, error from sources_meta`).all();
    case 'movies': {
      const b = req.by; const p: Record<string, SQLInputValue> = { $sources: j(req.sourceIds) }; const limit = req.limit ?? 1000;
      let rows: unknown[];
      if (b.kind === 'categories') rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where stream_id in (select item_id from vod_item_categories where item_type='movie' and category_id in (select value from json_each($cats))) and ${SRC} order by name collate nocase`).all({ ...p, $cats: j(b.categoryIds) });
      else if (b.kind === 'all') rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where ${SRC} order by name collate nocase`).all(p);
      else if (b.kind === 'tmdbIds') rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where tmdb_id in (select value from json_each($ids)) and ${SRC}`).all({ ...p, $ids: j(b.tmdbIds) });
      else if (b.kind === 'ids') rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where stream_id in (select value from json_each($ids)) and ${SRC}`).all({ ...p, $ids: j(b.streamIds) });
      else if (b.kind === 'search') rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where ${SRC} and name like $q escape '\\' order by name collate nocase limit $limit`).all({ ...p, $limit: limit, $q: `%${b.text.replace(/[%_\\]/g, (m) => `\\${m}`)}%` });
      else rows = stmt(db, `select ${MOVIE_COLS} from vod_movies where ${SRC} and popularity > 0 order by popularity desc limit $limit`).all({ ...p, $limit: limit });
      return withCategoryIds(db, rows as { stream_id: string }[], 'movie');
    }
    case 'series': {
      const b = req.by; const p: Record<string, SQLInputValue> = { $sources: j(req.sourceIds) }; const limit = req.limit ?? 1000;
      let rows: unknown[];
      if (b.kind === 'categories') rows = stmt(db, `select ${SERIES_COLS} from vod_series where series_id in (select item_id from vod_item_categories where item_type='series' and category_id in (select value from json_each($cats))) and ${SRC} order by name collate nocase`).all({ ...p, $cats: j(b.categoryIds) });
      else if (b.kind === 'all') rows = stmt(db, `select ${SERIES_COLS} from vod_series where ${SRC} order by name collate nocase`).all(p);
      else if (b.kind === 'tmdbIds') rows = stmt(db, `select ${SERIES_COLS} from vod_series where tmdb_id in (select value from json_each($ids)) and ${SRC}`).all({ ...p, $ids: j(b.tmdbIds) });
      else if (b.kind === 'ids') rows = stmt(db, `select ${SERIES_COLS} from vod_series where series_id in (select value from json_each($ids)) and ${SRC}`).all({ ...p, $ids: j(b.seriesIds) });
      else if (b.kind === 'search') rows = stmt(db, `select ${SERIES_COLS} from vod_series where ${SRC} and name like $q escape '\\' order by name collate nocase limit $limit`).all({ ...p, $limit: limit, $q: `%${b.text.replace(/[%_\\]/g, (m) => `\\${m}`)}%` });
      else rows = stmt(db, `select ${SERIES_COLS} from vod_series where ${SRC} and popularity > 0 order by popularity desc limit $limit`).all({ ...p, $limit: limit });
      return withCategoryIds(db, rows as { series_id: string }[], 'series');
    }
    case 'episodes':
      return stmt(db, `
        select e.id, e.series_id, e.season_num, e.episode_num, e.title, e.direct_url, e.plot, e.duration, e.info, e.tmdb_id, s.source_id
        from vod_episodes e join vod_series s on s.series_id = e.series_id
        where e.series_id in (select value from json_each(?))
        order by e.series_id, e.season_num, e.episode_num`).all(j(req.seriesIds));
    case 'vodCategories':
      return stmt(db, `
        select vc.category_id, vc.source_id, vc.name, vc.type
        from vod_categories vc
        where vc.type = $kind and ${SRC.replaceAll('source_id', 'vc.source_id')}
          and exists (select 1 from vod_item_categories ic where ic.category_id = vc.category_id and ic.item_type = $kind)
        order by vc.name collate nocase, vc.source_id`).all({ $kind: req.kind, $sources: j(req.sourceIds) });
    case 'vodCounts':
      return {
        movies: (stmt(db, `select count(*) as c from vod_movies where ${SRC}`).get({ $sources: j(req.sourceIds) }) as { c: number }).c,
        series: (stmt(db, `select count(*) as c from vod_series where ${SRC}`).get({ $sources: j(req.sourceIds) }) as { c: number }).c,
      };
    case 'syncNow': case 'syncEpisodes': case 'rematchEpg': case 'clearAll':
      throw new Error(`unsupported on the read connection: ${req.type}`);
  }
}
