import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSchema, reindexGuide } from './schema.js';
import { runQuery } from './queries.js';
import type { GuideSearchResult } from '@sbtltv/core';

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
  reindexGuide(db);
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

test('playlistRows lists a source as one row per channel and group, for rebuilding a playlist', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const rows = runQuery(db, { id: 1, type: 'playlistRows', sourceId: 's1' }) as { name: string; group_name: string | null; direct_url: string; epg_channel_id: string | null }[];
  assert.deepEqual(rows.map((r) => [r.group_name, r.name]), [['News', 'ABC'], ['News', 'CBS'], ['Sports', 'ABC']]);
  assert.equal(rows[0].direct_url, 'http://x/11');
  assert.equal(rows[0].epg_channel_id, 'abc.us');
  db.exec(`insert into channels(stream_id, source_id, name, direct_url) values ('s1_99', 's1', 'Loose', 'http://x/99')`);
  const withLoose = runQuery(db, { id: 2, type: 'playlistRows', sourceId: 's1' }) as { name: string; group_name: string | null }[];
  assert.deepEqual([withLoose.at(-1)?.name, withLoose.at(-1)?.group_name], ['Loose', null]);
});

function seedSearch(db: DatabaseSync): void {
  seedFixture(db);
  db.exec(`
    insert into categories values ('s1_adult', 's1', 'Adults (18+)', 2);
    insert into channels(stream_id, source_id, name, direct_url, epg_channel_id) values ('s1_90', 's1', 'Night Football XX', 'http://x/secret', 'x.us');
    insert into channel_categories values ('s1_90', 's1_adult');
    insert into epg_links values ('s1_90', 'epg1', 'x.us', 's1', 'exact', 'exact_id');
    insert into epg_programs values
      ('f1', 's1', 'epg1', 'cbs.us', 100, 900, 'Football Tonight', 'kickoff'),
      ('f2', 's2', 'epg1', 'cbs.us', 100, 900, 'Football Tonight', 'kickoff'),
      ('f3', 's1', 'epg1', 'cbs.us', 5000, 6000, 'Football Late', ''),
      ('f4', 's1', 'epg1', 'cbs.us', 50, 90, 'Football Past', ''),
      ('f5', 's1', 'epg1', 'cbs.us', 200, 800, 'Sunday Show', 'all the football'),
      ('f6', 's1', 'epg1', 'x.us', 100, 900, 'Football After Dark', '');
  `);
  reindexGuide(db);
}
const search = (db: DatabaseSync, over: Record<string, unknown> = {}) =>
  runQuery(db, { id: 1, type: 'guideSearch', query: 'football', sourceIds: [], nowMs: 500, hideAdult: false, ...over } as never) as GuideSearchResult;

test('guideSearch groups an airing across channels and sorts it into sections', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  const r = search(db);
  const tonight = r.onNow.find((a) => a.title === 'Football Tonight')!;
  assert.deepEqual(tonight.channels.map((c) => c.stream_id).sort(), ['s1_10', 's2_20']);
  assert.deepEqual(r.later.map((a) => a.title), ['Football Late']);
  const sunday = r.onNow.find((a) => a.title === 'Sunday Show');
  assert.equal(sunday?.byDescription, true);
  assert.equal(r.mentions.length, 0);
  assert.ok(![...r.onNow, ...r.later].some((a) => a.title === 'Football Past'));
});

test('guideSearch finds channels by name and counts them all', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  const r = search(db, { query: 'cbs' });
  assert.deepEqual(r.channels.map((c) => c.name), ['CBS', 'CBS HD']);
  assert.equal(r.channelTotal, 2);
});

test('guideSearch respects enabled sources', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  const r = search(db, { sourceIds: ['s1'] });
  assert.deepEqual(r.onNow.find((a) => a.title === 'Football Tonight')!.channels.map((c) => c.stream_id), ['s1_10']);
  assert.deepEqual(search(db, { query: 'cbs', sourceIds: ['s1'] }).channels.map((c) => c.name), ['CBS']);
});

test('guideSearch hides adult categories only when asked, in both programmes and channels', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  assert.ok(search(db).onNow.some((a) => a.title === 'Football After Dark'));
  assert.ok(search(db).channels.some((c) => c.stream_id === 's1_90'));
  const hidden = search(db, { hideAdult: true });
  assert.ok(!hidden.onNow.some((a) => a.title === 'Football After Dark'));
  assert.ok(!hidden.channels.some((c) => c.stream_id === 's1_90'));
  db.exec(`update channels set is_adult = 1 where stream_id = 's1_10'`);
  assert.ok(!search(db, { hideAdult: true }).channels.some((c) => c.stream_id === 's1_10'));
});

test('guideSearch never fails on symbols and carries no stream address', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  for (const query of ['c++', '"', '(', 'NOT', '-', '*', 'AT&T', 'a']) search(db, { query });
  assert.equal(search(db, { query: '***' }).onNow.length, 0);
  assert.ok(!JSON.stringify(search(db)).includes('secret'));
});

test('guideSearch keeps each section when a word matches thousands of airings', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec('begin');
  const add = db.prepare(`insert into epg_programs values (?, 's1', 'epg1', 'cbs.us', ?, ?, ?, ?)`);
  // Thousands of short, best-ranked title matches, all starting soon
  for (let i = 0; i < 4000; i++) add.run(`m${i}`, 10_000 + i, 10_001 + i, 'News', '');
  add.run('live', 100, 900_000, 'A very long winded evening programme about local news', '');
  add.run('desc', 900_000, 900_500, 'Sunday Show', 'with the news');
  db.exec('commit');
  reindexGuide(db);
  const r = runQuery(db, { id: 1, type: 'guideSearch', query: 'news', sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult;
  assert.ok(r.onNow.some((a) => a.title.startsWith('A very long')), 'on now');
  assert.ok(r.later.some((a) => a.title === 'News'), 'later');
  assert.ok(r.mentions.some((a) => a.title === 'Sunday Show'), 'mentions');
});

test('guideSearch: a short word finds an exact description word but not longer words', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec(`insert into epg_programs values
    ('t1', 's1', 'epg1', 'cbs.us', 100, 900, 'State Game', 'Live from Nashville, TN tonight'),
    ('t2', 's1', 'epg1', 'cbs.us', 100, 900, 'Other Game', 'On TNT tonight'),
    ('t3', 's1', 'epg1', 'cbs.us', 100, 900, 'TNT Classics', '')`);
  reindexGuide(db);
  const r = runQuery(db, { id: 1, type: 'guideSearch', query: 'tn', sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult;
  assert.deepEqual(r.onNow.map((a) => a.title), ['TNT Classics', 'State Game']);
});

test('guideSearch: very common short words skip descriptions', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec(`insert into epg_programs values ('c1', 's1', 'epg1', 'cbs.us', 100, 900, 'The Game', ''), ('c2', 's1', 'epg1', 'cbs.us', 100, 900, 'Other', 'the game')`);
  reindexGuide(db);
  const r = runQuery(db, { id: 1, type: 'guideSearch', query: 'the', sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult;
  assert.deepEqual(r.onNow.map((a) => a.title), ['The Game']);
  assert.equal(r.mentions.length, 0);
});

test('guideSearch: channels follow the same matching, and work without any guide words', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec(`insert into channels(stream_id, source_id, name, direct_url, epg_channel_id) values
    ('s1_50', 's1', 'UK: BBC One', '', ''), ('s1_51', 's1', 'РОССИЯ 1', '', ''), ('s1_52', 's1', 'USA E! HD', '', ''), ('s1_53', 's1', 'Fútbol TV', '', '')`);
  const names = (query: string) => (runQuery(db, { id: 1, type: 'guideSearch', query, sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult).channels.map((c) => c.name);
  assert.deepEqual(names('uk bbc'), ['UK: BBC One']);
  assert.deepEqual(names('россия'), ['РОССИЯ 1']);
  assert.deepEqual(names('e!'), ['USA E! HD']);
  assert.deepEqual(names('futbol'), ['Fútbol TV']);
  assert.deepEqual(names('c'), []);
});

// One programme on one channel, then a search for it
function searchTitle(title: string, query: string, description = ''): GuideSearchResult {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.prepare(`insert into epg_programs values ('t', 's1', 'epg1', 'cbs.us', 100, 900, ?, ?)`).run(title, description);
  reindexGuide(db);
  return runQuery(db, { id: 1, type: 'guideSearch', query, sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult;
}

test('guideSearch ignores Latin accents whichever side has them', () => {
  assert.equal(searchTitle('Fútbol Liga', 'futb').onNow.length, 1);
  assert.equal(searchTitle('Fútbol Liga', 'fútbol').onNow.length, 1);
  assert.equal(searchTitle('Futbol Liga', 'fútbol').onNow.length, 1);
  assert.equal(searchTitle('Sunday', 'cafe', 'at the Café').onNow[0]?.byDescription, true);
});

// FAILS on 13479b4: toFtsQuery strips marks from every alphabet, unicode61 only from Latin,
// so the word sent to the index is not the word in the index.
for (const [title, query] of [
  ['Чайка', 'чайка'], ['Ёлки', 'ёлки'], ['Новый день', 'новый'], ['Майами', 'майами'],
  ['한국 뉴스', '뉴스'], ['ガンダム', 'ガンダム'], ['ゲーム', 'ゲーム'],
  ['กีฬา', 'กีฬา'], ['हिन्दी समाचार', 'समाचार'], ['الأخبار', 'الأخبار'], ['Ελλάδα', 'ελλάδα'],
]) {
  test(`guideSearch finds a title typed exactly as written: ${query}`, () => {
    assert.deepEqual(searchTitle(title, query).onNow.map((a) => a.title), [title]);
  });
}

test('guideSearch at the edges of now: starting this minute is on, ending this minute is gone', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  db.exec(`insert into epg_programs values
    ('e1', 's1', 'epg1', 'cbs.us', 500, 900, 'Football Starting', ''),
    ('e2', 's1', 'epg1', 'cbs.us', 100, 500, 'Football Ended', '')`);
  reindexGuide(db);
  const r = search(db);
  const starting = r.onNow.find((a) => a.title === 'Football Starting');
  assert.deepEqual(starting?.programIds, ['e1']);   // once: not from both queries
  assert.ok(![...r.onNow, ...r.later].some((a) => a.title === 'Football Ended'));
});

test('guideSearch keeps the soonest airings when Later is capped', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec('begin');
  const add = db.prepare(`insert into epg_programs values (?, 's1', 'epg1', 'cbs.us', ?, ?, 'News', '')`);
  for (let i = 0; i < 700; i++) add.run(`l${i}`, 10_000 + i, 20_000);
  db.exec('commit');
  reindexGuide(db);
  const { later } = search(db, { query: 'news' });
  assert.ok(later.length > 0 && later.length <= 600, `${later.length} rows`);
  assert.equal(later[0].startMs, 10_000);
  assert.equal(later.at(-1)?.startMs, 10_000 + later.length - 1);
});

test('guideSearch: mentions airing sooner never crowd out a title match in Later', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec('begin');
  const add = db.prepare(`insert into epg_programs values (?, 's1', 'epg1', 'cbs.us', ?, ?, ?, ?)`);
  for (let i = 0; i < 700; i++) add.run(`d${i}`, 10_000 + i, 20_000, 'Sunday Show', 'with the news');
  add.run('title', 50_000, 60_000, 'News', '');
  db.exec('commit');
  reindexGuide(db);
  assert.deepEqual(search(db, { query: 'news' }).later.map((a) => a.title), ['News']);
});

test('guideSearch: when On now is capped the best matches stay', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec('begin');
  const add = db.prepare(`insert into epg_programs values (?, 's1', 'epg1', 'cbs.us', ?, ?, ?, ?)`);
  for (let i = 0; i < 3000; i++) add.run(`x${i}`, 100, 900, 'Other', 'nothing here');   // keeps the word rare enough to rank
  for (let i = 0; i < 2100; i++) add.run(`d${i}`, 100 + (i % 300), 900, 'Sunday Show', `a long report on many things with some news ${i}`);
  add.run('title', 100, 900, 'News at Noon', '');
  db.exec('commit');
  reindexGuide(db);
  assert.deepEqual(search(db, { query: 'news' }).onNow.filter((a) => !a.byDescription).map((a) => a.title), ['News at Noon']);
});

test('guideSearch: on now, a word in the title beats the same word all over a description', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec(`insert into epg_programs values
    ('a', 's1', 'epg1', 'cbs.us', 100, 900, 'A long evening programme of local and national news', 'news news news news news news'),
    ('b', 's1', 'epg1', 'cbs.us', 100, 900, 'News', ''),
    ('c', 's1', 'epg1', 'cbs.us', 100, 900, 'Weather', 'nothing')`);
  reindexGuide(db);
  assert.deepEqual(search(db, { query: 'news' }).onNow.map((a) => a.title)[0], 'News');
});

test('guideSearch caps the channel list but counts them all, in name order', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec('begin');
  const add = db.prepare(`insert into channels(stream_id, source_id, name, direct_url, epg_channel_id) values (?, 's1', ?, '', '')`);
  for (let i = 0; i < 205; i++) add.run(`z${i}`, `Sports ${String(i).padStart(3, '0')}`);
  db.exec('commit');
  const r = search(db, { query: 'sports' });
  assert.equal(r.channels.length, 200);
  assert.equal(r.channelTotal, 205);
  assert.equal(r.channels[0].name, 'Sports 000');
});

test("guideSearch: a programme shows only on its own source's linked channel", () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  // cbs.us is linked on both sources; Football Late is only in s1's guide
  assert.deepEqual(search(db).later.find((a) => a.title === 'Football Late')?.channels.map((c) => c.stream_id), ['s1_10']);
});

test('guideSearch hideAdult leaves everything else alone, and any one adult category is enough', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  assert.deepEqual(search(db, { query: 'cbs', hideAdult: true }).channels.map((c) => c.name), ['CBS', 'CBS HD']);
  assert.ok(search(db, { hideAdult: true }).onNow.some((a) => a.title === 'Football Tonight'));
  db.exec(`insert into channel_categories values ('s2_20', 's1_adult')`);   // also in News
  assert.deepEqual(search(db, { query: 'cbs', hideAdult: true }).channels.map((c) => c.name), ['CBS']);
});

test('guideSearch hideAdult follows the provider flag, in channels and programmes', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  db.exec(`update channels set is_adult = 1 where stream_id = 's1_10'`);
  assert.deepEqual(search(db, { query: 'cbs', hideAdult: true }).channels.map((c) => c.name), ['CBS HD']);
  assert.deepEqual(search(db, { hideAdult: true }).onNow.find((a) => a.title === 'Football Tonight')?.channels.map((c) => c.stream_id), ['s2_20']);
  assert.equal(search(db, { query: 'cbs' }).channels.length, 2);
});

test('guideSearch needs two characters after trimming', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  assert.deepEqual(search(db, { query: 'c ' }).channels, []);
});

test('guideSearch hands out the ids the guide grid uses, or a jump lights nothing', () => {
  const db = new DatabaseSync(':memory:'); seedSearch(db);
  const later = search(db).later.find((a) => a.title === 'Football Late')!;
  const grid = runQuery(db, { id: 2, type: 'programsInRange', streamIds: ['s1_10'], windowStartMs: 5000, windowEndMs: 6000 }) as { id: string }[];
  assert.ok(grid.some((p) => later.programIds.includes(p.id)));
});

test('guideSearch finds what symbols and apostrophes split', () => {
  const find = (title: string, query: string) => searchTitle(title, query).onNow.map((a) => a.title);
  assert.deepEqual(find('9-1-1: Nashville', '9-1-1'), ['9-1-1: Nashville']);
  assert.deepEqual(find('M*A*S*H', 'm*a*s*h'), ['M*A*S*H']);
  assert.deepEqual(find("Grey's Anatomy", 'greys anatomy'), ["Grey's Anatomy"]);
  assert.deepEqual(find("Bob's Burgers", 'bobs burgers'), ["Bob's Burgers"]);
  assert.deepEqual(find('Law & Order: SVU', 'law and order'), ['Law & Order: SVU']);
  assert.equal(searchTitle("Grey's Anatomy", 'greys anatomy').onNow[0].byDescription, undefined);
});

test('guideSearch lists channels by a word starting so, then by having a guide', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.exec(`insert into channels(stream_id, source_id, name, direct_url, epg_channel_id) values
    ('s1_60', 's1', 'A Conflict', '', ''), ('s1_61', 's1', 'NFL Network', '', ''), ('s1_62', 's1', 'NFL Now', '', 'n.us')`);
  db.exec(`insert into epg_links values ('s1_62', 'epg1', 'n.us', 's1', 'exact', 'exact_id')`);
  const names = (runQuery(db, { id: 1, type: 'guideSearch', query: 'nfl', sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult).channels.map((c) => c.name);
  assert.deepEqual(names.slice(0, 2), ['NFL Now', 'NFL Network']);
});

test('guideSearch caps a very long description', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  db.prepare(`insert into epg_programs values ('big', 's1', 'epg1', 'cbs.us', 5000, 6000, 'Big News', ?)`).run('x'.repeat(100_000));
  reindexGuide(db);
  const r = runQuery(db, { id: 1, type: 'guideSearch', query: 'big news', sourceIds: [], nowMs: 500, hideAdult: false }) as GuideSearchResult;
  assert.ok(r.later[0].description.length <= 600);
});
