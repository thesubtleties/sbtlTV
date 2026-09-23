import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

const DDL = `
create table if not exists meta (key text primary key, value text not null);

create table if not exists sources_meta (
  source_id text primary key,
  epg_url text,
  last_channel_sync integer,
  last_epg_sync integer,
  last_vod_sync integer,
  channel_count integer not null default 0,
  category_count integer not null default 0,
  movie_count integer not null default 0,
  series_count integer not null default 0,
  error text
);

create table if not exists categories (
  category_id text primary key,
  source_id text not null,
  name text not null,
  position integer
);
create index if not exists categories_source on categories(source_id);

create table if not exists channels (
  stream_id text primary key,
  source_id text not null,
  name text not null,
  channel_num integer,
  stream_icon text not null default '',
  epg_channel_id text not null default '',
  direct_url text not null,
  tv_archive integer not null default 0,
  tv_archive_days integer,
  is_adult integer not null default 0
);
create index if not exists channels_source on channels(source_id);
create index if not exists channels_source_name on channels(source_id, name);

create table if not exists channel_categories (
  stream_id text not null,
  category_id text not null,
  primary key (stream_id, category_id)
);
create index if not exists channel_categories_category on channel_categories(category_id);

create table if not exists epg_programs (
  id text primary key,
  source_id text not null,
  epg_source text not null,
  epg_channel_id text not null,
  start integer not null,
  end integer not null,
  title text not null,
  description text not null default ''
);
create index if not exists epg_programs_channel_start on epg_programs(source_id, epg_source, epg_channel_id, start);

create table if not exists epg_links (
  stream_id text not null,
  epg_source text not null,
  epg_channel_id text not null,
  source_id text not null,
  confidence text not null,
  strategy text not null,
  primary key (stream_id, epg_source)
);
create index if not exists epg_links_channel on epg_links(epg_source, epg_channel_id);
create index if not exists epg_links_source on epg_links(source_id);

create table if not exists vod_categories (
  source_id text not null,
  category_id text not null,
  name text not null,
  type text not null,
  primary key (source_id, category_id)
);

create table if not exists vod_movies (
  stream_id text primary key,
  source_id text not null,
  name text not null,
  title text,
  year text,
  stream_icon text not null default '',
  direct_url text not null,
  plot text, "cast" text, director text, genre text, release_date text,
  duration integer, rating text,
  tmdb_id integer, imdb_id text, added integer, backdrop_path text,
  popularity real, match_attempted integer
);
create index if not exists vod_movies_source_tmdb on vod_movies(source_id, tmdb_id);
create index if not exists vod_movies_tmdb on vod_movies(tmdb_id);
create index if not exists vod_movies_popularity on vod_movies(popularity);
create index if not exists vod_movies_name on vod_movies(name);

create table if not exists vod_series (
  series_id text primary key,
  source_id text not null,
  name text not null,
  title text,
  year text,
  cover text not null default '',
  plot text, "cast" text, genre text, release_date text, rating text,
  tmdb_id integer, imdb_id text, added integer, backdrop_path text,
  popularity real, match_attempted integer
);
create index if not exists vod_series_source_tmdb on vod_series(source_id, tmdb_id);
create index if not exists vod_series_tmdb on vod_series(tmdb_id);
create index if not exists vod_series_popularity on vod_series(popularity);
create index if not exists vod_series_name on vod_series(name);

create table if not exists vod_episodes (
  id text primary key,
  series_id text not null,
  season_num integer not null,
  episode_num integer not null,
  title text not null,
  direct_url text not null,
  plot text, duration integer, info text, tmdb_id integer
);
create index if not exists vod_episodes_series on vod_episodes(series_id, season_num, episode_num);

create table if not exists vod_item_categories (
  item_id text not null,
  item_type text not null,
  category_id text not null,
  primary key (item_id, item_type, category_id)
);
create index if not exists vod_item_categories_category on vod_item_categories(category_id, item_type);
`;

export function createSchema(db: DatabaseSync): void {
  db.exec('begin');
  try {
    db.exec(DDL);
    db.prepare("insert or replace into meta(key, value) values ('schema_version', ?)").run(String(SCHEMA_VERSION));
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

export function readSchemaVersion(db: DatabaseSync): number {
  const hasMeta = db.prepare("select count(*) as c from sqlite_master where type='table' and name='meta'").get() as { c: number };
  if (hasMeta.c === 0) return 0;
  const row = db.prepare("select value from meta where key='schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

// Migrations are numbered functions from version n to n+1. Version 1 is the
// initial schema, so the list is empty until the schema changes.
const MIGRATIONS: Array<(db: DatabaseSync) => void> = [];

export function migrate(db: DatabaseSync): void {
  const current = readSchemaVersion(db);
  if (current === 0) {
    createSchema(db);
    return;
  }
  if (current > SCHEMA_VERSION) {
    throw new Error(`database schema ${current} is newer than this build supports (${SCHEMA_VERSION})`);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('begin');
    try {
      MIGRATIONS[v - 1](db);
      db.prepare("update meta set value=? where key='schema_version'").run(String(v + 1));
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  }
}
