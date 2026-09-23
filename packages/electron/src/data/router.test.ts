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
