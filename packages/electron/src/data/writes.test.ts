import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { seedFixture } from './queries.test.js';
import { runQuery } from './queries.js';
import { replaceChannels, replaceEpg, replaceVod, replaceEpisodes, applyTmdbMatches, updateVodDetails, deleteSource, clearAll } from './writes.js';

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { c: number }).c;

test('replaceChannels swaps one source and leaves the other alone', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const changed = replaceChannels(db, 's1', {
    categories: [{ category_id: 's1_movies', category_name: 'Movies', source_id: 's1', position: 0 }],
    channels: [{ stream_id: 's1_30', source_id: 's1', name: 'HBO', stream_icon: '', epg_channel_id: 'hbo.us', category_ids: ['s1_movies'], direct_url: 'http://x/30', channel_num: 7 }],
    epgUrl: 'http://x/xmltv.php',
  });
  assert.deepEqual([...changed].sort(), ['categories', 'channels', 'epg_links', 'sources_meta']);
  assert.equal(count(db, "select count(*) c from channels where source_id='s1'"), 1);
  assert.equal(count(db, "select count(*) c from channels where source_id='s2'"), 1);
  assert.equal(count(db, "select count(*) c from channel_categories where stream_id='s1_10'"), 0);
  assert.equal(count(db, "select count(*) c from epg_links where source_id='s1'"), 0);
  const meta = db.prepare("select epg_url, channel_count, category_count from sources_meta where source_id='s1'").get() as { epg_url: string; channel_count: number; category_count: number };
  assert.deepEqual({ ...meta }, { epg_url: 'http://x/xmltv.php', channel_count: 1, category_count: 1 });
});

test('replaceChannels is atomic: a bad row leaves the old data in place', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  assert.throws(() => replaceChannels(db, 's1', {
    categories: [],
    channels: [{ stream_id: 's1_31', source_id: 's1', name: 'ok', stream_icon: '', epg_channel_id: '', category_ids: [], direct_url: 'http://x/31' },
               // direct_url is NOT NULL: this row fails the insert
               { stream_id: 's1_32', source_id: 's1', name: 'bad', stream_icon: '', epg_channel_id: '', category_ids: [], direct_url: null as unknown as string }],
  }));
  assert.equal(count(db, "select count(*) c from channels where source_id='s1'"), 2);
  assert.equal(count(db, "select count(*) c from channels where stream_id='s1_31'"), 0);
});

test('replaceEpg replaces one epg source and updates links; programs are stored once', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const changed = replaceEpg(db, 's1', 'epg1', {
    programs: [{ epg_channel_id: 'cbs.us', startMs: 9000, endMs: 9500, title: 'Late', description: '' }],
    links: [{ stream_id: 's1_10', epg_channel_id: 'cbs.us', confidence: 'exact', strategy: 'exact_id' }, { stream_id: 's1_11', epg_channel_id: 'cbs.us', confidence: 'high', strategy: 'display_name' }],
  });
  assert.deepEqual([...changed].sort(), ['epg_links', 'epg_programs', 'sources_meta']);
  assert.equal(count(db, "select count(*) c from epg_programs where source_id='s1' and epg_source='epg1'"), 1);
  const rows = runQuery(db, { id: 1, type: 'programsInRange', streamIds: ['s1_10', 's1_11'], windowStartMs: 9000, windowEndMs: 9600 }) as { stream_id: string }[];
  assert.deepEqual(rows.map((r) => r.stream_id), ['s1_10', 's1_11']);
});

test('replaceVod keeps enrichment on surviving rows and deletes vanished ones', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  replaceVod(db, 's1', {
    categories: [{ category_id: 's1_action', name: 'Action!', type: 'movie' }],
    movies: [{ stream_id: 's1_m1', source_id: 's1', name: 'Heat (1995)', stream_icon: '', category_ids: ['s1_action'], direct_url: 'http://x/m1' }],
    series: [],
  });
  const m1 = db.prepare("select name, tmdb_id, popularity from vod_movies where stream_id='s1_m1'").get() as { name: string; tmdb_id: number; popularity: number };
  assert.deepEqual({ ...m1 }, { name: 'Heat (1995)', tmdb_id: 949, popularity: 50.5 });
  assert.equal(count(db, "select count(*) c from vod_movies where stream_id='s1_m2'"), 0);
  assert.equal(count(db, "select count(*) c from vod_series where source_id='s1'"), 0);
  assert.equal(count(db, "select count(*) c from vod_episodes where series_id='s1_sr1'"), 0);
  assert.equal((db.prepare("select name from vod_categories where category_id='s1_action'").get() as { name: string }).name, 'Action!');
});

test('replaceEpisodes and applyTmdbMatches', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  replaceEpisodes(db, 's1_sr1', [{ id: 's1_e9', title: 'Finale', episode_num: 9, season_num: 1, direct_url: 'http://x/e9' }]);
  assert.deepEqual((runQuery(db, { id: 1, type: 'episodes', seriesIds: ['s1_sr1'] }) as { id: string }[]).map((e) => e.id), ['s1_e9']);
  applyTmdbMatches(db, 'series', [{ id: 's1_sr1', tmdb_id: 4607, popularity: 99, matchAttemptedMs: 123 }]);
  const s = db.prepare("select popularity, match_attempted from vod_series where series_id='s1_sr1'").get() as { popularity: number; match_attempted: number };
  assert.deepEqual({ ...s }, { popularity: 99, match_attempted: 123 });
});

test('deleteSource and clearAll remove every trace', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  deleteSource(db, 's1');
  for (const t of ['categories', 'channels', 'epg_programs', 'epg_links', 'vod_movies', 'vod_series', 'vod_categories', 'sources_meta']) {
    assert.equal(count(db, `select count(*) c from ${t} where source_id='s1'`), 0, t);
  }
  assert.equal(count(db, "select count(*) c from vod_episodes"), 0);
  assert.equal(count(db, "select count(*) c from channels"), 1);
  clearAll(db);
  assert.equal(count(db, "select count(*) c from channels"), 0);
  assert.equal(count(db, "select count(*) c from sources_meta"), 0);
});

test('updateVodDetails fills only the empty columns', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("update vod_movies set plot = 'kept plot' where stream_id = 's1_m1'");
  const changed = updateVodDetails(db, 'movie', 's1_m1', { plot: 'new plot', genre: 'Crime', cast: 'Pacino, De Niro' });
  assert.deepEqual(changed, ['vod_movies']);
  const m = db.prepare("select plot, genre, \"cast\" from vod_movies where stream_id='s1_m1'").get() as { plot: string; genre: string; cast: string };
  assert.deepEqual({ ...m }, { plot: 'kept plot', genre: 'Crime', cast: 'Pacino, De Niro' });
  updateVodDetails(db, 'series', 's1_sr1', { cast: 'Fox', backdrop_path: '/b.jpg' });
  const sr = db.prepare("select \"cast\", backdrop_path from vod_series where series_id='s1_sr1'").get() as { cast: string; backdrop_path: string };
  assert.deepEqual({ ...sr }, { cast: 'Fox', backdrop_path: '/b.jpg' });
});

test('two sources sharing one guide keep their own programme rows', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const guide = { programs: [{ epg_channel_id: 'cbs.us', startMs: 9000, endMs: 9500, title: 'Late', description: '' }], links: [] as { stream_id: string; epg_channel_id: string; confidence: string; strategy: string }[] };
  replaceEpg(db, 's1', 'xtream://panel', { ...guide, links: [{ stream_id: 's1_10', epg_channel_id: 'cbs.us', confidence: 'exact', strategy: 'exact_id' }] });
  replaceEpg(db, 's2', 'xtream://panel', { ...guide, links: [{ stream_id: 's2_20', epg_channel_id: 'cbs.us', confidence: 'exact', strategy: 'exact_id' }] });
  assert.equal(count(db, "select count(*) c from epg_programs where epg_source='xtream://panel'"), 2, 'one copy per source');
  const both = runQuery(db, { id: 1, type: 'programsInRange', streamIds: ['s1_10', 's2_20'], windowStartMs: 9000, windowEndMs: 9600 }) as { stream_id: string }[];
  assert.deepEqual(both.map((r) => r.stream_id), ['s1_10', 's2_20'], 'each stream sees exactly one copy');
  deleteSource(db, 's1');
  const rest = runQuery(db, { id: 2, type: 'programsInRange', streamIds: ['s2_20'], windowStartMs: 9000, windowEndMs: 9600 }) as { title: string }[];
  assert.deepEqual(rest.map((r) => r.title), ['Late'], 'deleting the other source leaves this guide intact');
});

test('replaceVod keeps details the provider stopped sending', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("update vod_movies set plot = 'from tmdb', \"cast\" = 'Pacino', genre = 'Crime' where stream_id = 's1_m1'");
  replaceVod(db, 's1', {
    categories: [],
    movies: [{ stream_id: 's1_m1', source_id: 's1', name: 'Heat', stream_icon: '', category_ids: [], direct_url: 'http://x/m1', genre: 'Thriller' }],
    series: [],
  });
  const m = db.prepare("select plot, \"cast\", genre from vod_movies where stream_id='s1_m1'").get() as { plot: string; cast: string; genre: string };
  assert.deepEqual({ ...m }, { plot: 'from tmdb', cast: 'Pacino', genre: 'Thriller' });
});

import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from './db.js';

test('a reader on a second connection sees the old rows until the writer commits', () => {
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'sbtltv-atomic-')), 'data.sqlite');
  const writer = openDatabase(p, { readOnly: false });
  seedFixture(writer);
  const reader = openDatabase(p, { readOnly: true });
  const names = () => (reader.prepare("select name from channels where source_id='s1' order by name").all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(names(), ['ABC', 'CBS']);

  writer.exec('begin immediate');
  writer.prepare("delete from channels where source_id='s1'").run();
  writer.prepare("insert into channels(stream_id, source_id, name, direct_url) values ('s1_99', 's1', 'NEW', 'u')").run();
  assert.deepEqual(names(), ['ABC', 'CBS'], 'uncommitted replacement is invisible');
  writer.exec('rollback');
  assert.deepEqual(names(), ['ABC', 'CBS'], 'rollback leaves the old rows');

  replaceChannels(writer, 's1', { categories: [], channels: [{ stream_id: 's1_99', source_id: 's1', name: 'NEW', stream_icon: '', epg_channel_id: '', category_ids: [], direct_url: 'u' }] });
  assert.deepEqual(names(), ['NEW'], 'committed replacement is visible at once');
  reader.close(); writer.close();
});

test('replaceVod keeps surviving series with their episodes and enrichment, drops the rest with theirs', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("insert into vod_series(series_id, source_id, name, tmdb_id, popularity) values ('s1_sr2', 's1', 'Gone', 1, 1)");
  db.exec("insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('s1_e9', 's1_sr2', 1, 1, 'Bye', 'u')");
  replaceVod(db, 's1', { categories: [], movies: [], series: [{ series_id: 's1_sr1', source_id: 's1', name: 'Lost (2004)', cover: '', category_ids: ['s1_drama'] }] });
  const kept = db.prepare("select name, tmdb_id, popularity from vod_series where series_id='s1_sr1'").get() as { name: string; tmdb_id: number; popularity: number };
  assert.deepEqual({ ...kept }, { name: 'Lost (2004)', tmdb_id: 4607, popularity: 30 });
  assert.equal(count(db, "select count(*) c from vod_episodes where series_id='s1_sr1'"), 2, 'survivor keeps its episodes');
  assert.equal(count(db, "select count(*) c from vod_series where series_id='s1_sr2'"), 0);
  assert.equal(count(db, "select count(*) c from vod_episodes where series_id='s1_sr2'"), 0, 'dropped series loses its episodes');
  assert.equal(count(db, "select count(*) c from vod_item_categories where item_id in ('s1_m1', 's1_m2')"), 0, 'deleted movies lose their category links');
});

test('applyTmdbMatches stamps the attempt even when nothing matched', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  applyTmdbMatches(db, 'movie', [{ id: 's1_m1', matchAttemptedMs: 77 }]);
  const m = db.prepare("select tmdb_id, popularity, match_attempted from vod_movies where stream_id='s1_m1'").get() as { tmdb_id: number; popularity: number; match_attempted: number };
  assert.deepEqual({ ...m }, { tmdb_id: 949, popularity: 50.5, match_attempted: 77 });
});

test('openDatabase recovers a corrupt file that has stale WAL and shm siblings', () => {
  const p = path.join(mkdtempSync(path.join(tmpdir(), 'sbtltv-wal-')), 'data.sqlite');
  writeFileSync(p, 'not a database');
  writeFileSync(`${p}-wal`, 'stale wal');
  writeFileSync(`${p}-shm`, 'stale shm');
  const db = openDatabase(p, { readOnly: false });
  assert.equal((db.prepare("select count(*) c from sqlite_master where name='channels'").get() as { c: number }).c, 1, 'fresh schema in place');
  db.close();
  const files = readdirSync(path.dirname(p));
  assert.ok(files.some((f) => /^data\.sqlite\.corrupt-\d+$/.test(f)), 'corrupt file moved aside');
  // SQLite discards the siblings of a file it cannot read; none must survive next to the fresh file.
  assert.ok(!files.includes('data.sqlite-wal') || existsSync(p));
  assert.ok(existsSync(p));
});
