import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Source, DataTable, SyncProgress } from '@sbtltv/core';
import { createSchema } from '../src/schema.js';
import { nodePlatform } from '../src/node/index.js';
import { openTitles } from '../src/tmdb-store.js';
import { syncChannels, syncVod, syncEpisodes, matchTmdb, type StageContext, type ChannelClient, type VodClient } from '../src/sync-stages.js';

function ctx(db: DatabaseSync) {
  const changed: [DataTable[], string | null][] = [];
  const progress: SyncProgress[] = [];
  const c: StageContext = { db, platform: nodePlatform(), tempDir: '/tmp', tmdbPath: '/nonexistent/tmdb-titles.sqlite', stagingDir: mkdtempSync(path.join(tmpdir(), 'stg-')), allowLanSources: false, log: () => {}, progress: (p) => progress.push(p), changed: (t, s) => changed.push([t, s]) };
  return { c, changed, progress };
}
const source: Source = { id: 's1', name: 'P', type: 'xtream', url: 'http://x', username: 'u', password: 'p', enabled: true };

test('syncChannels stores categories and channels and reports progress', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c, changed, progress } = ctx(db);
  const client: ChannelClient = {
    async testConnection() { return {}; },
    async getLiveCategories() { return [{ category_id: 's1_1', category_name: 'News', source_id: 's1' }]; },
    async getLiveStreams() { return [{ stream_id: 's1_10', name: 'CBS', stream_icon: '', epg_channel_id: 'cbs.us', category_ids: ['s1_1'], direct_url: 'http://x/10', source_id: 's1' }]; },
    getServerEpgUrl() { return 'http://x/xmltv.php'; },
  };
  const out = await syncChannels(c, source, client);
  assert.equal(out?.channels.length, 1);
  assert.equal(out?.epgUrl, 'http://x/xmltv.php');
  assert.equal((db.prepare("select count(*) c from channels").get() as { c: number }).c, 1);
  assert.deepEqual(progress.map((p) => p.state), ['started', 'finished']);
  assert.ok(changed.some(([t]) => t.includes('channels')));
});

test('syncChannels keeps the old data and records the error when the fetch fails', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into channels(stream_id, source_id, name, direct_url) values ('s1_old', 's1', 'Old', 'u')");
  const { c, progress } = ctx(db);
  const client: ChannelClient = { async testConnection() { throw new Error('boom'); }, async getLiveCategories() { return []; }, async getLiveStreams() { return []; } };
  assert.equal(await syncChannels(c, source, client), null);
  assert.equal((db.prepare("select count(*) c from channels where stream_id='s1_old'").get() as { c: number }).c, 1);
  assert.equal((db.prepare("select error from sources_meta where source_id='s1'").get() as { error: string }).error, 'boom');
  assert.equal(progress.at(-1)?.state, 'failed');
});

test('syncChannels treats a failed connection test result as an error', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c } = ctx(db);
  const client: ChannelClient = { async testConnection() { return { success: false, error: 'Authentication failed' }; }, async getLiveCategories() { return []; }, async getLiveStreams() { return []; } };
  assert.equal(await syncChannels(c, source, client), null);
  assert.equal((db.prepare("select error from sources_meta where source_id='s1'").get() as { error: string }).error, 'Authentication failed');
});

test('syncVod skips an empty list when data already exists, and syncEpisodes replaces a series', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into vod_movies(stream_id, source_id, name, title, year, direct_url, plot) values ('s1_m0', 's1', 'Kept (1999)', 'Kept', '1999', 'u', 'a plot')");
  const { c } = ctx(db);
  const vod: VodClient = {
    async getVodCategories() { return []; }, async getVodStreams() { return []; },
    async getSeriesCategories() { return [{ category_id: 's1_d', category_name: 'Drama', source_id: 's1' }]; },
    async getSeries() { return [{ series_id: 's1_sr', name: 'Lost', cover: '', category_ids: ['s1_d'], source_id: 's1' }]; },
    async getSeriesInfo() { return [{ season_number: 1, episodes: [{ id: 's1_e1', title: 'Pilot', episode_num: 1, season_num: 1, direct_url: 'u' }] }]; },
  };
  const out = await syncVod(c, source, vod);
  assert.deepEqual(out, { movies: 1, series: 1 });
  assert.equal((db.prepare("select count(*) c from vod_movies").get() as { c: number }).c, 1, 'empty movie list did not wipe existing movies');
  const kept = db.prepare("select title, year, plot from vod_movies where stream_id='s1_m0'").get() as { title: string; year: string; plot: string };
  assert.deepEqual({ ...kept }, { title: 'Kept', year: '1999', plot: 'a plot' }, 'kept rows keep their provider fields');
  assert.equal(await syncEpisodes(c, source, vod, 's1_sr'), 1);
  assert.equal((db.prepare("select title from vod_episodes where series_id='s1_sr'").get() as { title: string }).title, 'Pilot');
});

test('syncChannels stores an imported playlist from its content and skips it when there is none', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c, progress } = ctx(db);
  const imported: Source = { id: 's9', name: 'File', type: 'm3u', url: 'imported:File', enabled: true };
  const m3u = '#EXTM3U url-tvg="http://x/guide.xml"\n#EXTINF:-1 tvg-id="cbs.us" group-title="News",CBS\nhttp://x/cbs\n';
  const out = await syncChannels(c, imported, null, m3u);
  assert.equal(out?.channels.length, 1);
  assert.equal(out?.epgUrl, 'http://x/guide.xml');
  assert.equal((db.prepare("select count(*) c from channels where source_id='s9'").get() as { c: number }).c, 1);
  // A scheduled sync has nothing to fetch for an imported file: keep the rows, no error, no progress.
  progress.length = 0;
  assert.equal(await syncChannels(c, imported, null), null);
  assert.equal((db.prepare("select count(*) c from channels where source_id='s9'").get() as { c: number }).c, 1);
  assert.equal((db.prepare("select error from sources_meta where source_id='s9'").get() as { error: string | null }).error, null);
  assert.deepEqual(progress, []);
});

import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncEpg } from '../src/sync-stages.js';

test('syncVod replaces movies and keeps series untouched when the series fetch rejects', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into vod_series(series_id, source_id, name, tmdb_id, plot) values ('s1_sr', 's1', 'Kept', 4607, 'a plot'); insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('s1_e1', 's1_sr', 1, 1, 'Pilot', 'u')");
  const { c, progress } = ctx(db);
  const vod: VodClient = {
    async getVodCategories() { return [{ category_id: 's1_a', category_name: 'Action', source_id: 's1' }]; },
    async getVodStreams() { return [{ stream_id: 's1_m1', name: 'Heat', stream_icon: '', category_ids: ['s1_a'], direct_url: 'u', source_id: 's1' }]; },
    async getSeriesCategories() { throw new Error('panel down'); },
    async getSeries() { throw new Error('panel down'); },
    async getSeriesInfo() { return []; },
  };
  assert.deepEqual(await syncVod(c, source, vod), { movies: 1, series: 1 });
  const kept = db.prepare("select name, tmdb_id, plot from vod_series where series_id='s1_sr'").get() as { name: string; tmdb_id: number; plot: string };
  assert.deepEqual({ ...kept }, { name: 'Kept', tmdb_id: 4607, plot: 'a plot' });
  assert.equal((db.prepare("select count(*) c from vod_episodes where series_id='s1_sr'").get() as { c: number }).c, 1);
  assert.equal((db.prepare("select count(*) c from vod_movies where stream_id='s1_m1'").get() as { c: number }).c, 1);
  assert.equal(progress.at(-1)?.state, 'finished');
});

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?><tv>
  <channel id="cbs.us"><display-name>CBS</display-name></channel>
  <programme start="20260921120000 +0000" stop="20260921130000 +0000" channel="cbs.us"><title>Noon</title></programme>
</tv>`;

function serve(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const cbs = { stream_id: 's1_10', name: 'CBS', stream_icon: '', epg_channel_id: 'cbs.us', category_ids: [], direct_url: 'u', source_id: 's1' };

test('syncEpg stores the guide from the URLs that work when one of several fails', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c, progress } = ctx(db);
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'epg-stage-')); c.allowLanSources = true;
  const logs: string[] = []; c.log = (_cat, m) => logs.push(m);
  const { url, close } = await serve((req, res) => {
    if (req.url === '/bad') { res.writeHead(500); res.end(); return; }
    res.writeHead(200); res.end(GUIDE);
  });
  try {
    const stored = await syncEpg(c, source, [cbs], `${url}/bad, ${url}/good.xml`, 'override');
    assert.equal(stored, 1);
    assert.equal((db.prepare("select count(*) c from epg_links where stream_id='s1_10'").get() as { c: number }).c, 1);
    assert.ok(logs.some((m) => /1\/2 EPG URLs failed/.test(m)));
    assert.equal(progress.at(-1)?.state, 'finished');
  } finally { close(); }
});

test('syncEpg keeps the old guide when nothing in the new one matches, and fails cleanly when every URL fails', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into epg_programs values ('s1::old::x::1', 's1', 'old', 'x', 1, 2, 'Old', ''); insert into epg_links values ('s1_10', 'old', 'x', 's1', 'exact', 'exact_id')");
  const { c, progress } = ctx(db);
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'epg-stage-')); c.allowLanSources = true;
  const { url, close } = await serve((_req, res) => { res.writeHead(200); res.end(GUIDE); });
  try {
    const unrelated = { ...cbs, stream_id: 's1_10', name: 'Zzz', epg_channel_id: 'nothing.here' };
    assert.equal(await syncEpg(c, source, [unrelated], `${url}/guide.xml`, 'override'), 0);
    assert.equal((db.prepare("select title from epg_programs").get() as { title: string }).title, 'Old', 'old programmes survive');
    assert.equal(progress.at(-1)?.state, 'finished');
  } finally { close(); }
  assert.equal(await syncEpg(c, source, [cbs], 'http://127.0.0.1:1/nothing', 'override'), 0);
  assert.equal(progress.at(-1)?.state, 'failed');
  assert.equal((db.prepare("select count(*) c from epg_programs").get() as { c: number }).c, 1, 'a failed download keeps the old guide');
});

test('data-process log lines name a source by id, never by its name', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c } = ctx(db);
  const logs: string[] = []; c.log = (_cat, m) => logs.push(m);
  const named: Source = { ...source, name: 'Acme Premium TV' };
  const failing: ChannelClient = { async testConnection() { throw new Error('boom'); }, async getLiveCategories() { return []; }, async getLiveStreams() { return []; } };
  await syncChannels(c, named, failing);
  await syncChannels(c, { ...named, type: 'm3u', url: 'imported:x' }, null);
  await syncEpg(c, named, [], 'http://127.0.0.1:1/nothing', 'override');
  assert.ok(logs.length >= 4, logs.join('\n'));
  assert.deepEqual(logs.filter((m) => m.includes('Acme')), []);
  // The rematch line lives in the worker (not callable here): no log call in src/data prints a name (source.name, or a name copied from it).
  // The shared code and what stays in Electron's data folder (data-process, sync-worker).
  for (const dir of [fileURLToPath(new URL('../src/', import.meta.url)), fileURLToPath(new URL('../../electron/src/data/', import.meta.url))]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      assert.doesNotMatch(readFileSync(path.join(dir, f), 'utf8'), /\b(?:log\(|message:)[^\n]*(?:\.name\b|\$\{name\})/, f);
    }
  }
});

test('syncEpisodes keeps a stored list when the provider sends none, leaves it unstamped, and says so', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into vod_series(series_id, source_id, name, episodes_fetched) values ('s1_sr', 's1', 'Lost', 5)");
  db.exec("insert into vod_episodes(id, series_id, season_num, episode_num, title, direct_url) values ('s1_e1', 's1_sr', 1, 1, 'Pilot', 'u')");
  const { c, changed, progress } = ctx(db);
  const vod = { async getSeriesInfo() { return []; } } as unknown as VodClient;
  assert.equal(await syncEpisodes(c, source, vod, 's1_sr'), 0);
  assert.equal((db.prepare("select count(*) c from vod_episodes where series_id='s1_sr'").get() as { c: number }).c, 1, 'stored list kept');
  assert.equal((db.prepare("select episodes_fetched t from vod_series").get() as { t: number }).t, 5, 'not stamped fresh');
  assert.deepEqual(changed, []);
  assert.deepEqual(progress.at(-1), { sourceId: 's1', stage: 'episodes', state: 'finished', seriesId: 's1_sr', counts: { episodes: 0 } });
});

// The TMDB tests never reach the network: a download means the cache logic slipped, and fails loudly here.
const offline = { async downloadToFile(): Promise<never> { throw new Error('offline'); } };
function titlesCache(c: StageContext, loadedAt: number, origin = 'enriched') {
  c.tmdbPath = path.join(mkdtempSync(path.join(tmpdir(), 'tmdb-')), 'tmdb-titles.sqlite');
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'tmdb-tmp-'));
  c.platform = { ...c.platform, net: offline };
  const t = openTitles(c.platform, c.tmdbPath, () => {});
  t.exec(`create table movie_titles(norm text not null, id integer not null, year integer, popularity real not null);
    insert into movie_titles values ('heat', 1, 1986, 99), ('heat', 949, 1995, 50);
    create table series_titles(norm text not null, id integer not null, year integer, popularity real not null);
    insert into series_titles values ('lost', 4607, 2004, 30);
    insert into meta values ('movie', ${loadedAt}, '${origin}'), ('series', ${loadedAt}, '${origin}')`);
  t.close();
}

test('matchTmdb matches new movie and series rows from the titles cache, stamps every attempt, and leaves rows already tried alone', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec(`insert into vod_movies(stream_id, source_id, name, title, year, direct_url, match_attempted) values
    ('s1_m1', 's1', 'Heat (1995)', 'Heat', '1995', 'u', null), ('s1_m2', 's1', 'Nothing Like It', null, null, 'u', null),
    ('s1_m3', 's1', 'Heat', 'Heat', null, 'u', 5)`);
  db.exec("insert into vod_series(series_id, source_id, name) values ('s1_sr1', 's1', 'Lost')");
  const { c, progress } = ctx(db);
  titlesCache(c, Date.now());
  await matchTmdb(c, source);
  const got = db.prepare('select stream_id, tmdb_id, popularity, match_attempted from vod_movies order by stream_id').all().map((r) => ({ ...(r as object) })) as { match_attempted: number | null }[];
  assert.deepEqual(got.map((r) => ({ ...r, match_attempted: r.match_attempted === 5 ? 5 : r.match_attempted !== null })),
    [{ stream_id: 's1_m1', tmdb_id: 949, popularity: 50, match_attempted: true }, { stream_id: 's1_m2', tmdb_id: null, popularity: null, match_attempted: true },
     { stream_id: 's1_m3', tmdb_id: null, popularity: null, match_attempted: 5 }]);
  assert.equal((db.prepare("select tmdb_id from vod_series where series_id = 's1_sr1'").get() as { tmdb_id: number }).tmdb_id, 4607);
  assert.deepEqual(progress.map((p) => p.state), ['started', 'finished']);
});

test('matchTmdb matches from a stale table while the cache repo is unreachable', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into vod_movies(stream_id, source_id, name, title, year, direct_url) values ('s1_m1', 's1', 'Heat (1995)', 'Heat', '1995', 'u')");
  const { c, progress } = ctx(db);
  const logs: string[] = []; c.log = (_cat, m) => logs.push(m);
  titlesCache(c, Date.now() - 3 * 24 * 60 * 60 * 1000);
  await matchTmdb(c, source);
  assert.equal((db.prepare("select tmdb_id from vod_movies").get() as { tmdb_id: number }).tmdb_id, 949);
  assert.ok(logs.some((m) => m.startsWith('TMDB match: using cached movie titles')));
  assert.equal(progress.at(-1)?.state, 'finished');
});

test('matchTmdb with nothing new to match never opens the titles cache', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c, progress } = ctx(db);
  c.tmdbPath = path.join(mkdtempSync(path.join(tmpdir(), 'tmdb-')), 'tmdb-titles.sqlite');
  await matchTmdb(c, source);
  assert.equal(readdirSync(path.dirname(c.tmdbPath)).length, 0);
  assert.equal(progress.at(-1)?.state, 'finished');
});

test('matchTmdb fails the stage cleanly when no titles can be had', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into vod_movies(stream_id, source_id, name, direct_url) values ('s1_m1', 's1', 'Heat', 'u')");
  const { c, progress } = ctx(db);
  c.tmdbPath = path.join(mkdtempSync(path.join(tmpdir(), 'tmdb-')), 'tmdb-titles.sqlite');
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'tmdb-tmp-'));
  // Both sources fail (no network), and there is no cached table: the stage fails with a clear message.
  c.platform = { ...c.platform, net: { async downloadToFile() { throw new Error('offline'); } } };
  await matchTmdb(c, source);
  assert.equal(progress.at(-1)?.state, 'failed');
  assert.match(progress.at(-1)?.message ?? '', /TMDB movie titles unavailable/);
  // Not stamped: the row is matched on the next run, once titles can be had
  assert.equal((db.prepare('select match_attempted from vod_movies').get() as { match_attempted: number | null }).match_attempted, null);
});

test('syncEpg writes programmes to staging while the guide file is still being read, and stores them all', { timeout: 20_000 }, async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c, progress } = ctx(db);
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'epg-stage-')); c.allowLanSources = true;
  const n = 12_000;
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const base = Date.UTC(2026, 8, 21);
  const progs = Array.from({ length: n }, (_, i) => `<programme start="${stamp(base + i * 60_000)}" stop="${stamp(base + i * 60_000 + 59_000)}" channel="cbs.us"><title>P${i}</title></programme>`).join('\n');
  const big = `<?xml version="1.0"?><tv><channel id="cbs.us"><display-name>CBS</display-name></channel>\n${progs}\n</tv>`;
  const { url, close } = await serve((_req, res) => { res.writeHead(200); res.end(big); });
  const seen: number[] = [];
  c.platform = { ...c.platform, files: { ...c.platform.files, readText: async function* (p, size) {
    for await (const chunk of nodePlatform().files.readText(p, size)) {
      const att = (db.prepare('pragma database_list').all() as { name: string }[]).find((r) => r.name.startsWith('stage_'));
      seen.push(att ? (db.prepare(`select count(*) c from ${att.name}.epg_staging`).get() as { c: number }).c : 0);
      yield chunk;
    }
  } } };
  try {
    const stored = await syncEpg(c, source, [cbs], `${url}/guide.xml`, 'override');
    assert.equal(stored, n);
    assert.ok(seen.at(-1)! > 0, `staged before the read finished: ${seen.join(',')}`);
    assert.equal((db.prepare('select count(*) c from epg_programs').get() as { c: number }).c, n);
    assert.equal(progress.at(-1)?.state, 'finished');
  } finally { close(); }
});

test('staging is discarded on every exit: a later failing URL after a good one leaves nothing staged', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  const { c } = ctx(db);
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'epg-stage-')); c.allowLanSources = true;
  const { url, close } = await serve((req, res) => { res.writeHead(200); res.end(GUIDE); });
  const exists = () => readdirSync(c.stagingDir).filter((f) => f.startsWith('guide-staging-')).length
    + (db.prepare('pragma database_list').all() as { name: string }[]).filter((r) => r.name !== 'main' && r.name !== 'temp').length;
  try {
    const unrelated = { ...cbs, name: 'Zzz', epg_channel_id: 'nothing.here' };
    await syncEpg(c, source, [unrelated], `${url}/g.xml`, 'override');   // nothing links -> old guide kept
    assert.equal(exists(), 0);
    await syncEpg(c, source, [cbs], `${url}/g.xml`, 'override');         // success
    assert.equal(exists(), 0);
    await syncEpg(c, source, [cbs], 'http://127.0.0.1:1/down', 'override'); // every URL fails
    assert.equal(exists(), 0);
  } finally { close(); }
});

test('a guide whose channels match but that has no programmes keeps the old guide (and leaves no scratch file)', async () => {
  const db = new DatabaseSync(':memory:'); createSchema(db);
  db.exec("insert into epg_programs values ('s1::old::cbs.us::1', 's1', 'old', 'cbs.us', 1, 2, 'Old', ''); insert into epg_links values ('s1_10', 'old', 'cbs.us', 's1', 'exact', 'exact_id')");
  const { c, progress } = ctx(db);
  c.tempDir = mkdtempSync(path.join(tmpdir(), 'epg-stage-')); c.allowLanSources = true;
  const empty = '<?xml version="1.0"?><tv><channel id="cbs.us"><display-name>CBS</display-name></channel></tv>';
  const { url, close } = await serve((_req, res) => { res.writeHead(200); res.end(empty); });
  try {
    assert.equal(await syncEpg(c, source, [cbs], `${url}/g.xml`, 'override'), 0);
    assert.equal((db.prepare("select title from epg_programs").get() as { title: string }).title, 'Old');
    assert.equal(progress.at(-1)?.state, 'finished');
    assert.deepEqual(readdirSync(c.stagingDir).filter((f) => f.startsWith('guide-staging-')), []);
  } finally { close(); }
});
