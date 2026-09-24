import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueSyncs } from './scheduler.js';
import type { Source } from '@sbtltv/core';

const H = 3600_000;
const xt: Source = { id: 'a', name: 'A', type: 'xtream', url: 'u', username: 'x', password: 'y', enabled: true };
const m3u: Source = { id: 'b', name: 'B', type: 'm3u', url: 'u', enabled: true };
const settings = { epgRefreshHours: 6, vodRefreshHours: 24, allowLanSources: false, debugLoggingEnabled: false };

test('a source with no meta row is due for everything it supports', () => {
  assert.deepEqual(dueSyncs([], [xt, m3u], settings, 100 * H), [
    { sourceId: 'a', channels: true, vod: true },
    { sourceId: 'b', channels: true, vod: false },
  ]);
});

test('fresh sources are not due; stale ones are', () => {
  const metas = [{ source_id: 'a', last_channel_sync: 99 * H, last_epg_sync: 99 * H, last_vod_sync: 70 * H }];
  assert.deepEqual(dueSyncs(metas, [xt], settings, 100 * H), [{ sourceId: 'a', channels: false, vod: true }]);
});

test('zero refresh hours means never automatic', () => {
  assert.deepEqual(dueSyncs([], [xt], { ...settings, epgRefreshHours: 0, vodRefreshHours: 0 }, 100 * H), [{ sourceId: 'a', channels: false, vod: false }]);
});

test('disabled sources are skipped', () => {
  assert.deepEqual(dueSyncs([], [{ ...xt, enabled: false }], settings, 100 * H), []);
});
