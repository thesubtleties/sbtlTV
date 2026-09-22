import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { Source, DataTable, SyncProgress } from '@sbtltv/core';
import { createSchema } from './schema.js';
import { syncChannels, syncVod, syncEpisodes, type StageContext, type ChannelClient, type VodClient } from './sync-stages.js';

function ctx(db: DatabaseSync) {
  const changed: [DataTable[], string | null][] = [];
  const progress: SyncProgress[] = [];
  const c: StageContext = { db, tempDir: '/tmp', allowLanSources: false, log: () => {}, progress: (p) => progress.push(p), changed: (t, s) => changed.push([t, s]) };
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
