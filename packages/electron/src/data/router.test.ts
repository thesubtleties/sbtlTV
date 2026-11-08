import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { seedFixture } from './queries.test.js';
import { routeRendererMessage, isSameJob, type SyncJob } from './router.js';
import type { DataReply } from '@sbtltv/core';

test('a read request is answered from the database', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = []; const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 7, type: 'channelCount', sourceIds: [] }, (r) => replies.push(r), (j) => jobs.push(j));
  assert.deepEqual(replies, [{ id: 7, ok: true, data: 3 }]);
  assert.deepEqual(jobs, []);
});

test('a control request is acknowledged and queued', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = []; const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 8, type: 'syncNow', what: 'all', sourceId: 's1' }, (r) => replies.push(r), (j) => jobs.push(j));
  assert.deepEqual(replies, [{ id: 8, ok: true, data: { accepted: true } }]);
  assert.deepEqual(jobs, [{ kind: 'channels', sourceId: 's1' }, { kind: 'vod', sourceId: 's1' }]);
});

test('syncNow without a source fans out to every enabled source', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 10, type: 'syncNow', what: 'channels' }, () => {}, (j) => jobs.push(j), () => ['s1', 's2']);
  assert.deepEqual(jobs, [{ kind: 'channels', sourceId: 's1' }, { kind: 'channels', sourceId: 's2' }]);
});

test('garbage is refused without throwing', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 9, type: 'drop table' }, (r) => replies.push(r), () => {});
  assert.equal(replies[0].ok, false);
  routeRendererMessage(db, 'nonsense', (r) => replies.push(r), () => {});
  assert.equal(replies.length, 1, 'no id means no reply');
});

test('syncEpisodes resolves the source from the stored series', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 11, type: 'syncEpisodes', seriesId: 's1_sr1' }, () => {}, (j) => jobs.push(j));
  assert.deepEqual(jobs, [{ kind: 'episodes', sourceId: 's1', seriesId: 's1_sr1' }]);
});

test('syncEpisodes with maxAgeMs skips a list fetched recently and refreshes an old or unstamped one', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const jobs: SyncJob[] = []; const replies: DataReply[] = [];
  const now = () => 100 * 3_600_000;
  const ask = (id: number, extra: Record<string, unknown> = {}) => routeRendererMessage(db, { id, type: 'syncEpisodes', seriesId: 's1_sr1', ...extra }, (r) => replies.push(r), (j) => jobs.push(j), undefined, now);
  ask(1, { maxAgeMs: 86_400_000 });                     // never stamped: fetch
  db.prepare(`update vod_series set episodes_fetched = ? where series_id = 's1_sr1'`).run(now() - 3_600_000);
  ask(2, { maxAgeMs: 86_400_000 });                     // an hour old: fresh, skipped
  ask(3);                                               // no maxAgeMs (Try again): always
  db.prepare(`update vod_series set episodes_fetched = ? where series_id = 's1_sr1'`).run(now() - 25 * 3_600_000);
  ask(4, { maxAgeMs: 86_400_000, prefetch: true });     // a day old: refresh, marked as prefetch
  assert.deepEqual(jobs, [
    { kind: 'episodes', sourceId: 's1', seriesId: 's1_sr1' },
    { kind: 'episodes', sourceId: 's1', seriesId: 's1_sr1' },
    { kind: 'episodes', sourceId: 's1', seriesId: 's1_sr1', prefetch: true },
  ]);
  assert.ok(replies.every((r) => r.ok), 'a skipped request is still acknowledged');
});

test('syncEpisodes refuses a bad maxAgeMs or prefetch', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = []; const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 1, type: 'syncEpisodes', seriesId: 's1_sr1', maxAgeMs: 'soon' }, (r) => replies.push(r), (j) => jobs.push(j));
  routeRendererMessage(db, { id: 2, type: 'syncEpisodes', seriesId: 's1_sr1', maxAgeMs: -1 }, (r) => replies.push(r), (j) => jobs.push(j));
  routeRendererMessage(db, { id: 3, type: 'syncEpisodes', seriesId: 's1_sr1', prefetch: 'yes' }, (r) => replies.push(r), (j) => jobs.push(j));
  assert.deepEqual(replies.map((r) => r.ok), [false, false, false]);
  assert.deepEqual(jobs, []);
});

test('updateVodDetails is acknowledged and queued', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = []; const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 12, type: 'updateVodDetails', kind: 'movie', itemId: 's1_m1', fields: { plot: 'p' } }, (r) => replies.push(r), (j) => jobs.push(j));
  assert.deepEqual(replies, [{ id: 12, ok: true, data: { accepted: true } }]);
  assert.deepEqual(jobs, [{ kind: 'vodDetails', itemKind: 'movie', itemId: 's1_m1', fields: { plot: 'p' } }]);
});

test('importPlaylist is acknowledged and queued with its content', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = []; const jobs: SyncJob[] = [];
  routeRendererMessage(db, { id: 13, type: 'importPlaylist', sourceId: 's9', content: '#EXTM3U' }, (r) => replies.push(r), (j) => jobs.push(j));
  assert.deepEqual(replies, [{ id: 13, ok: true, data: { accepted: true } }]);
  assert.deepEqual(jobs, [{ kind: 'importPlaylist', sourceId: 's9', content: '#EXTM3U' }]);
});

test('isSameJob matches jobs that would do identical work', () => {
  assert.ok(isSameJob({ kind: 'vod', sourceId: 's1' }, { kind: 'vod', sourceId: 's1' }));
  assert.ok(!isSameJob({ kind: 'vod', sourceId: 's1' }, { kind: 'channels', sourceId: 's1' }));
  assert.ok(!isSameJob({ kind: 'episodes', sourceId: 's1', seriesId: 'a' }, { kind: 'episodes', sourceId: 's1', seriesId: 'b' }));
  assert.ok(isSameJob({ kind: 'clearAll' }, { kind: 'clearAll' }));
  // Content-bearing jobs are never collapsed: two imports may carry different playlists.
  assert.ok(!isSameJob({ kind: 'importPlaylist', sourceId: 's1', content: 'a' }, { kind: 'importPlaylist', sourceId: 's1', content: 'b' }));
});

test('malformed but well-typed requests are refused before they reach the database', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 20, type: 'channels', categoryId: null, sourceIds: 'oops', sort: 'alphabetical' }, (r) => replies.push(r), () => {});
  routeRendererMessage(db, { id: 21, type: 'channelSearch', query: 'a', sourceIds: [], limit: -1 }, (r) => replies.push(r), () => {});
  routeRendererMessage(db, { id: 22, type: 'channelsByIds', streamIds: new Array(100_001).fill('x') }, (r) => replies.push(r), () => {});
  routeRendererMessage(db, { id: 23, type: 'programsInRange', streamIds: ['s1_10'], windowStartMs: 'now', windowEndMs: 1 }, (r) => replies.push(r), () => {});
  assert.deepEqual(replies.map((r) => [r.id, r.ok]), [[20, false], [21, false], [22, false], [23, false]]);
  assert.ok(replies.every((r) => !r.ok && /invalid request/.test(r.error)));
});

test('a limit above the cap is clamped rather than refused', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 24, type: 'movies', by: { kind: 'popular' }, sourceIds: [], limit: 1_000_000 }, (r) => replies.push(r), () => {});
  assert.equal(replies[0].ok, true);
});

test('playlistRows needs a source id and is answered from the database', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 30, type: 'playlistRows', sourceId: 's1' }, (r) => replies.push(r), () => {});
  routeRendererMessage(db, { id: 31, type: 'playlistRows', sourceId: 5 }, (r) => replies.push(r), () => {});
  assert.deepEqual(replies.map((r) => [r.id, r.ok]), [[30, true], [31, false]]);
  assert.equal(((replies[0] as { data: unknown[] }).data).length, 3);
});

test('guideSearch is routed and its fields are checked', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 1, type: 'guideSearch', query: 'noon', sourceIds: [], nowMs: 2500, hideAdult: false }, (r) => replies.push(r), () => {});
  assert.equal(replies[0].ok, true);
  routeRendererMessage(db, { id: 2, type: 'guideSearch', query: 'noon', sourceIds: 's1', nowMs: 2500, hideAdult: false }, (r) => replies.push(r), () => {});
  assert.equal(replies[1].ok, false);
});

test('guideSearch refuses each wrong field', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const good = { type: 'guideSearch', query: 'noon', sourceIds: [], nowMs: 2500, hideAdult: false };
  for (const [i, bad] of [{ query: 1 }, { nowMs: 'soon' }, { hideAdult: 'yes' }].entries()) {
    const replies: DataReply[] = [];
    routeRendererMessage(db, { ...good, ...bad, id: i + 1 }, (r) => replies.push(r), () => {});
    assert.equal(replies[0].ok, false, JSON.stringify(bad));
  }
});

test('guideSearch refuses a query far longer than anyone types', () => {
  const db = new DatabaseSync(':memory:'); seedFixture(db);
  const replies: DataReply[] = [];
  routeRendererMessage(db, { id: 1, type: 'guideSearch', query: 'x'.repeat(201), sourceIds: [], nowMs: 1, hideAdult: false }, (r) => replies.push(r), () => {});
  assert.equal(replies[0].ok, false);
});
