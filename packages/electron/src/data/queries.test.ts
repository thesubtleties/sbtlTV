import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSchema } from './schema.js';
import { runQuery } from './queries.js';

export function seedFixture(db: DatabaseSync): void {
  createSchema(db);
  db.exec(`
    insert into sources_meta(source_id, channel_count, category_count, last_channel_sync) values ('s1', 2, 2, 1000), ('s2', 1, 1, 2000);
    insert into categories values ('s1_news', 's1', 'News', 0), ('s1_sports', 's1', 'Sports', 1), ('s2_news', 's2', 'News', 0);
    insert into channels(stream_id, source_id, name, channel_num, direct_url, epg_channel_id) values
      ('s1_10', 's1', 'CBS', 2, 'http://x/10', 'cbs.us'),
      ('s1_11', 's1', 'ABC', 1, 'http://x/11', 'abc.us'),
      ('s2_20', 's2', 'CBS HD', null, 'http://y/20', 'cbs.us');
    insert into channel_categories values ('s1_10', 's1_news'), ('s1_11', 's1_news'), ('s1_11', 's1_sports'), ('s2_20', 's2_news');
    insert into epg_links values ('s1_10', 'epg1', 'cbs.us', 's1', 'exact', 'exact_id'), ('s2_20', 'epg1', 'cbs.us', 's2', 'exact', 'exact_id');
    insert into epg_programs values
      ('s1::epg1::cbs.us::1000', 's1', 'epg1', 'cbs.us', 1000, 2000, 'Morning', ''),
      ('s1::epg1::cbs.us::2000', 's1', 'epg1', 'cbs.us', 2000, 3000, 'Noon', ''),
      ('s1::epg1::cbs.us::3000', 's1', 'epg1', 'cbs.us', 3000, 4000, 'Evening', ''),
      ('s2::epg1::cbs.us::2000', 's2', 'epg1', 'cbs.us', 2000, 3000, 'Noon', ''),
      ('s2::epg1::cbs.us::3000', 's2', 'epg1', 'cbs.us', 3000, 4000, 'Evening', '');
    insert into vod_categories values ('s1', 's1_action', 'Action', 'movie'), ('s1', 's1_empty', 'Empty', 'movie'), ('s1', 's1_drama', 'Drama', 'series');
    insert into vod_movies(stream_id, source_id, name, direct_url, tmdb_id, popularity, added) values
      ('s1_m1', 's1', 'Heat', 'http://x/m1', 949, 50.5, 5000), ('s1_m2', 's1', 'Alien', 'http://x/m2', 348, 80.1, 6000);
    insert into vod_item_categories values ('s1_m1', 'movie', 's1_action'), ('s1_m2', 'movie', 's1_action');
    insert into vod_series(series_id, source_id, name, tmdb_id, popularity) values ('s1_sr1', 's1', 'Lost', 4607, 30);
    insert into vod_item_categories values ('s1_sr1', 'series', 's1_drama');
    insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('s1_e1', 's1_sr1', 1, 1, 'Pilot', 'http://x/e1'), ('s1_e2', 's1_sr1', 1, 2, 'Pilot 2', 'http://x/e2');
  `);
}

test('categories carry channel counts filtered by source', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const all = runQuery(db, { id: 1, type: 'categories', sourceIds: [] }) as { category_id: string; channel_count: number }[];
  assert.deepEqual(all.map((c) => [c.category_id, c.channel_count]), [['s1_news', 2], ['s2_news', 1], ['s1_sports', 1]]);
  const s2 = runQuery(db, { id: 2, type: 'categories', sourceIds: ['s2'] }) as { category_id: string }[];
  assert.deepEqual(s2.map((c) => c.category_id), ['s2_news']);
});

test('channels in a category sort by name or by number with unnumbered last', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const byName = runQuery(db, { id: 1, type: 'channels', categoryId: 's1_news', sourceIds: [], sort: 'alphabetical' }) as { stream_id: string; category_ids: string[] }[];
  assert.deepEqual(byName.map((c) => c.stream_id), ['s1_11', 's1_10']);
  assert.deepEqual(byName[0].category_ids, ['s1_news', 's1_sports']);
  const byNum = runQuery(db, { id: 2, type: 'channels', categoryId: null, sourceIds: [], sort: 'number' }) as { stream_id: string }[];
  assert.deepEqual(byNum.map((c) => c.stream_id), ['s1_11', 's1_10', 's2_20']);
});

test('programsInRange joins through links and applies the lookback and overlap rules', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const rows = runQuery(db, { id: 1, type: 'programsInRange', streamIds: ['s1_10', 's2_20'], windowStartMs: 2500, windowEndMs: 3500 }) as { stream_id: string; title: string }[];
  // Noon (2000-3000) overlaps; Evening (3000-4000) starts inside; Morning ended before the window
  assert.deepEqual(rows.map((r) => [r.stream_id, r.title]), [['s1_10', 'Noon'], ['s1_10', 'Evening'], ['s2_20', 'Noon'], ['s2_20', 'Evening']]);
});

test('currentProgram picks the latest-starting programme on air', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const row = runQuery(db, { id: 1, type: 'currentProgram', streamId: 's1_10', nowMs: 2500 }) as { title: string } | null;
  assert.equal(row?.title, 'Noon');
  assert.equal(runQuery(db, { id: 2, type: 'currentProgram', streamId: 's1_11', nowMs: 2500 }), null);
});

test('movies by categories, all, and by tmdb ids', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const inCat = runQuery(db, { id: 1, type: 'movies', by: { kind: 'categories', categoryIds: ['s1_action'] }, sourceIds: [] }) as { name: string; category_ids: string[] }[];
  assert.deepEqual(inCat.map((m) => m.name), ['Alien', 'Heat']);
  assert.deepEqual(inCat[0].category_ids, ['s1_action']);
  assert.equal((runQuery(db, { id: 3, type: 'movies', by: { kind: 'all' }, sourceIds: [] }) as unknown[]).length, 2);
  const byTmdb = runQuery(db, { id: 2, type: 'movies', by: { kind: 'tmdbIds', tmdbIds: [949] }, sourceIds: [] }) as { stream_id: string }[];
  assert.deepEqual(byTmdb.map((m) => m.stream_id), ['s1_m1']);
});

test('vodCategories drops categories with nothing in them', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const cats = runQuery(db, { id: 1, type: 'vodCategories', kind: 'movie', sourceIds: [] }) as { category_id: string }[];
  assert.deepEqual(cats.map((c) => c.category_id), ['s1_action']);
});

test('episodes come back in season and episode order, carrying their series source', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const eps = runQuery(db, { id: 1, type: 'episodes', seriesIds: ['s1_sr1'] }) as { id: string; source_id: string }[];
  assert.deepEqual(eps.map((e) => e.id), ['s1_e1', 's1_e2']);
  assert.deepEqual(eps.map((e) => e.source_id), ['s1', 's1']);
});

test('control requests are refused by the read layer', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  assert.throws(() => runQuery(db, { id: 1, type: 'syncNow', what: 'all' }), /unsupported/);
});

test('series selectors: all, ids, tmdb ids, categories, search, popular', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("insert into vod_series(series_id, source_id, name, tmdb_id, popularity) values ('s2_sr9', 's2', 'Lost in Space', 9, 0)");
  const ids = (rows: unknown) => (rows as { series_id: string }[]).map((s) => s.series_id);
  assert.deepEqual(ids(runQuery(db, { id: 1, type: 'series', by: { kind: 'all' }, sourceIds: [] })), ['s1_sr1', 's2_sr9']);
  assert.deepEqual(ids(runQuery(db, { id: 2, type: 'series', by: { kind: 'all' }, sourceIds: ['s2'] })), ['s2_sr9']);
  assert.deepEqual(ids(runQuery(db, { id: 3, type: 'series', by: { kind: 'ids', seriesIds: ['s1_sr1'] }, sourceIds: [] })), ['s1_sr1']);
  assert.deepEqual(ids(runQuery(db, { id: 4, type: 'series', by: { kind: 'tmdbIds', tmdbIds: [4607] }, sourceIds: [] })), ['s1_sr1']);
  const inCat = runQuery(db, { id: 5, type: 'series', by: { kind: 'categories', categoryIds: ['s1_drama'] }, sourceIds: [] }) as { series_id: string; category_ids: string[] }[];
  assert.deepEqual(inCat.map((s) => [s.series_id, s.category_ids]), [['s1_sr1', ['s1_drama']]]);
  assert.deepEqual(ids(runQuery(db, { id: 6, type: 'series', by: { kind: 'search', text: 'space' }, sourceIds: [] })), ['s2_sr9']);
  assert.deepEqual(ids(runQuery(db, { id: 7, type: 'series', by: { kind: 'popular' }, sourceIds: [] })), ['s1_sr1'], 'popular skips rows with no popularity');
});

test('channelSearch treats % and _ in the query literally', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("insert into channels(stream_id, source_id, name, direct_url) values ('s1_pct', 's1', '100% Sports', 'u'), ('s1_us', 's1', 'A_B', 'u')");
  const names = (q: string) => (runQuery(db, { id: 1, type: 'channelSearch', query: q, sourceIds: [], limit: 10 }) as { name: string }[]).map((c) => c.name);
  assert.deepEqual(names('100%'), ['100% Sports']);
  assert.deepEqual(names('%'), ['100% Sports'], 'a bare % is not a wildcard');
  assert.deepEqual(names('A_B'), ['A_B']);
  assert.deepEqual(names('AXB'), [], '_ does not match any character');
});

test('programsInRange and currentProgram apply the 24h lookback at the boundary', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const DAY = 24 * 60 * 60 * 1000;
  const now = 5_000_000;
  db.exec(`insert into epg_programs values
    ('s1::epg1::cbs.us::edge', 's1', 'epg1', 'cbs.us', ${now - DAY}, ${now + 1000}, 'Edge', ''),
    ('s1::epg1::cbs.us::old', 's1', 'epg1', 'cbs.us', ${now - DAY - 1}, ${now + 1000}, 'Too old', '')`);
  const titles = (runQuery(db, { id: 1, type: 'programsInRange', streamIds: ['s1_10'], windowStartMs: now, windowEndMs: now + 10 }) as { title: string }[]).map((p) => p.title);
  assert.deepEqual(titles, ['Edge']);
  assert.equal((runQuery(db, { id: 2, type: 'currentProgram', streamId: 's1_10', nowMs: now }) as { title: string }).title, 'Edge');
});

test('sourceIds filters every table that carries a source', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec("insert into vod_movies(stream_id, source_id, name, direct_url) values ('s2_m1', 's2', 'Other', 'u'); insert into vod_categories values ('s2', 's2_cat', 'Other', 'movie'); insert into vod_item_categories values ('s2_m1', 'movie', 's2_cat')");
  assert.deepEqual((runQuery(db, { id: 1, type: 'channels', categoryId: null, sourceIds: ['s2'], sort: 'alphabetical' }) as { stream_id: string }[]).map((c) => c.stream_id), ['s2_20']);
  assert.deepEqual((runQuery(db, { id: 2, type: 'movies', by: { kind: 'all' }, sourceIds: ['s2'] }) as { stream_id: string }[]).map((m) => m.stream_id), ['s2_m1']);
  assert.deepEqual((runQuery(db, { id: 3, type: 'vodCategories', kind: 'movie', sourceIds: ['s2'] }) as { category_id: string }[]).map((c) => c.category_id), ['s2_cat']);
  assert.equal(runQuery(db, { id: 4, type: 'channelCount', sourceIds: ['s2'] }), 1);
  assert.deepEqual(runQuery(db, { id: 5, type: 'vodCounts', sourceIds: ['s2'] }), { movies: 1, series: 0 });
});
