import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, validateSyncStatus, type ReportInputs } from './bug-report.js';
import { LogPolicy } from './log-policy.js';

const X = '11111111-aaaa-4bbb-8ccc-222222222222';
const M = '33333333-dddd-4eee-8fff-444444444444';
const policy = new LogPolicy([
  { id: X, name: 'Acme Premium TV', url: 'http://prov.example:8080' },
  { id: M, name: 'Family List', url: 'http://lists.example/get.php?username=bob&password=s3cret', epg_url: 'http://epg.example/guide.xml' },
]);
const clean = (t: string) => policy.forLog(t);

const inputs = (): ReportInputs => ({
  app: { version: '0.13.1', build: { sha: 'abc1234', run: '42', ref: 'dev' } },
  system: { platform: 'linux', arch: 'x64', osVersion: '6.12.1', electron: '44.3.0', chrome: '140', node: '24.1.0' },
  player: { mode: 'native', why: 'default', error: 'Native bridge failed opening http://prov.example:8080/live/bob/s3cret/1.ts', hwdec: 'vaapi', mpv: 'mpv 0.41.0', ffmpeg: '7.1' },
  hardware: { cpu: 'AMD Ryzen 7 5800X', threads: 16, ramGB: 31.2, freeRamGB: 12.4, gpus: [{ renderer: 'AMD Radeon RX 6700 XT', vendor: 'AMD', driver: 'Mesa', driverVersion: '24.2.3', gl: '4.6', active: true }], displays: [{ width: 2560, height: 1440, scale: 1, hz: 144 }] },
  keyring: { backend: 'kwallet6', available: true, from: 'kept' },
  debugLoggingEnabled: true,
  addressesIncluded: false,
  settings: { tmdbApiKey: 'tk-secret', liveSourceOrder: [M, X, 'gone-id-0000'], vodSourceOrder: [X], lastSourceId: M, channelSortOrder: 'number', guideOpacity: 0.9 } as never,
  sources: [
    { id: X, type: 'xtream', enabled: true, hasLogin: true },
    { id: M, type: 'm3u', enabled: false, epg_url: 'http://epg.example/guide.xml', auto_load_epg: false, hasLogin: false },
  ],
  syncStatus: [
    { source_id: X, last_channel_sync: Date.UTC(2026, 9, 19, 12), channel_count: 1200, category_count: 40, movie_count: 300, series_count: 50, error: null },
    { source_id: M, last_channel_sync: null, channel_count: 0, error: 'fetch failed: http://bob:s3cret@lists.example:8080/get.php?username=bob&password=s3cret' },
  ],
});

test('report.json carries no login, host, path, URL, source name or source id', () => {
  const json = JSON.stringify(buildReport(inputs(), clean, new Date(Date.UTC(2026, 9, 19, 13))));
  for (const bad of ['s3cret', 'bob', 'prov.example', 'lists.example', 'epg.example', 'get.php', 'Acme', 'Family List', X, M, 'tk-secret']) {
    assert.equal(json.includes(bad), false, `${bad} in ${json}`);
  }
  // A scheme may stay (it says a link failed), never an address after it: only a label or "…".
  assert.doesNotMatch(json, /:\/\/(?!\[(?:source|host) \d+\]|…)/);
});

test('sources are [source N] in list order, with guide mode, sync times, counts and a cleaned error', () => {
  const r = buildReport(inputs(), clean, new Date()) as { sources: Record<string, unknown>[] };
  assert.deepEqual(r.sources.map((s) => [s.source, s.type, s.enabled, s.login, s.guide]), [
    ['[source 1]', 'xtream', true, 'set', 'provider'],
    ['[source 2]', 'm3u', false, 'not set', 'own address'],
  ]);
  assert.deepEqual(r.sources[0].counts, { channels: 1200, categories: 40, movies: 300, series: 50 });
  assert.equal((r.sources[0].lastSync as { channels: string }).channels, '2026-10-19T12:00:00.000Z');
  assert.match(String(r.sources[1].error), /^fetch failed: http:\/\/…/);
});

test('settings: secrets as set/not set, source ids as labels (unknown ones dropped), the rest as they are', () => {
  const r = buildReport(inputs(), clean, new Date()) as { settings: Record<string, unknown> };
  assert.equal(r.settings.tmdbApiKey, 'set');
  assert.equal(r.settings.posterDbApiKey, 'not set');
  assert.deepEqual(r.settings.liveSourceOrder, ['[source 2]', '[source 1]']);
  assert.deepEqual(r.settings.vodSourceOrder, ['[source 1]']);
  assert.equal(r.settings.lastSourceId, '[source 2]');
  assert.equal(r.settings.channelSortOrder, 'number');
});

test('flags, hardware and player carried; free text cleaned', () => {
  const r = buildReport({ ...inputs(), addressesIncluded: true, debugLoggingEnabled: false }, clean, new Date()) as Record<string, any>;
  assert.equal(r.addressesIncluded, true);
  assert.equal(r.debugLoggingEnabled, false);
  assert.equal(r.hardware.gpus[0].renderer, 'AMD Radeon RX 6700 XT');
  assert.equal(r.player.hwdec, 'vaapi');
  assert.equal(String(r.player.error).includes('s3cret'), false);
});

test('unreadable settings or sources still give a report', () => {
  const r = buildReport({ ...inputs(), settings: 'unreadable', sources: 'unreadable' }, clean, new Date()) as Record<string, unknown>;
  assert.equal(r.settings, 'unreadable');
  assert.equal(r.sources, 'unreadable');
});

test('sync status from the page is checked: known fields of the right type only, capped', () => {
  assert.deepEqual(validateSyncStatus('x'), []);
  assert.deepEqual(validateSyncStatus([{ source_id: 'a', channel_count: 3, error: 'e', evil: '<b>', last_channel_sync: 'soon' }, { nope: 1 }, null]),
    [{ source_id: 'a', channel_count: 3, error: 'e' }]);
  assert.equal(validateSyncStatus(Array(600).fill({ source_id: 'a' })).length, 500);
});
