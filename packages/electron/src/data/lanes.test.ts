import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JobLanes, laneFor, type LaneName } from './lanes.js';
import type { SyncJob } from './router.js';

function harness() {
  const sent: [LaneName, SyncJob][] = [];
  const failed: SyncJob[] = [];
  const lanes = new JobLanes({ send: (lane, job) => sent.push([lane, job]), failed: (job) => failed.push(job) });
  return { lanes, sent, failed };
}

test('on-demand jobs go to the quick lane, bulk syncs to the sync lane', () => {
  assert.equal(laneFor({ kind: 'channels', sourceId: 'a' }), 'sync');
  assert.equal(laneFor({ kind: 'vod', sourceId: 'a' }), 'sync');
  assert.equal(laneFor({ kind: 'deleteSource', sourceId: 'a' }), 'sync');
  assert.equal(laneFor({ kind: 'episodes', sourceId: 'a', seriesId: 'a_1' }), 'quick');
  assert.equal(laneFor({ kind: 'vodDetails', itemKind: 'movie', itemId: 'a_m', fields: {} }), 'quick');
  assert.equal(laneFor({ kind: 'importPlaylist', sourceId: 'a', content: '#EXTM3U' }), 'quick');
});

test('jobs wait until the lane is ready and run one at a time', () => {
  const { lanes, sent } = harness();
  lanes.enqueue({ kind: 'channels', sourceId: 'a' });
  lanes.enqueue({ kind: 'vod', sourceId: 'a' });
  assert.equal(sent.length, 0);
  lanes.setReady('sync');
  assert.deepEqual(sent.map(([, j]) => j.kind), ['channels']);
  lanes.finished('sync');
  assert.deepEqual(sent.map(([, j]) => j.kind), ['channels', 'vod']);
});

test('identical jobs collapse against the queue and the job in flight', () => {
  const { lanes, sent } = harness();
  lanes.setReady('sync');
  assert.equal(lanes.enqueue({ kind: 'channels', sourceId: 'a' }), true);   // in flight now
  assert.equal(lanes.enqueue({ kind: 'channels', sourceId: 'a' }), false);  // same as in flight
  assert.equal(lanes.enqueue({ kind: 'vod', sourceId: 'a' }), true);        // queued
  assert.equal(lanes.enqueue({ kind: 'vod', sourceId: 'a' }), false);       // same as queued
  assert.equal(sent.length, 1);
});

test('a crash reports the in-flight job as failed and runs it again first once the lane is back', () => {
  const { lanes, sent, failed } = harness();
  lanes.setReady('sync');
  lanes.enqueue({ kind: 'channels', sourceId: 'a' });
  lanes.enqueue({ kind: 'vod', sourceId: 'a' });
  lanes.crashed('sync');
  assert.deepEqual(failed, [{ kind: 'channels', sourceId: 'a' }]);
  assert.equal(sent.length, 1);
  lanes.setReady('sync');
  assert.deepEqual(sent.map(([, j]) => j.kind), ['channels', 'channels']);
  lanes.finished('sync');
  assert.deepEqual(sent.map(([, j]) => j.kind), ['channels', 'channels', 'vod']);
});

test('a dead quick lane hands its jobs to the sync lane', () => {
  const { lanes, sent } = harness();
  lanes.setReady('sync');
  lanes.dead('quick');
  lanes.enqueue({ kind: 'episodes', sourceId: 'a', seriesId: 'a_1' });
  assert.deepEqual(sent, [['sync', { kind: 'episodes', sourceId: 'a', seriesId: 'a_1' }]]);
});

test('drain returns every job that has not finished, in-flight first', () => {
  const { lanes } = harness();
  lanes.setReady('sync');
  lanes.enqueue({ kind: 'channels', sourceId: 'a' });
  lanes.enqueue({ kind: 'vod', sourceId: 'a' });
  assert.deepEqual(lanes.pending('sync').map((j) => j.kind), ['channels', 'vod']);
});
