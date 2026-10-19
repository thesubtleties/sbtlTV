import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport, reportLogText, validateSyncStatus, type ReportInputs } from './bug-report.js';
import { LogPolicy } from './log-policy.js';
import type { SourceMetaRow } from '@sbtltv/core';

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
  player: { mode: 'in-window', why: 'default', error: 'Native bridge failed opening http://prov.example:8080/live/bob/s3cret/1.ts', hwdec: 'vaapi', mpv: 'mpv 0.41.0', ffmpeg: '7.1' },
  hardware: { cpu: 'AMD Ryzen 7 5800X', threads: 16, ramGB: 31, gpus: [{ vendor: 'AMD', device: '0x73df', active: true }, { renderer: 'AMD Radeon RX 6700 XT', vendor: 'AMD', usedFor: 'video (high-performance WebGL)' }], displays: { count: 2, window: { width: 2560, height: 1440, scale: 1, hz: 144 } } },
  keyring: { backend: 'kwallet6', available: true, from: 'kept' },
  debugLoggingEnabled: true,
  addressesIncluded: false,
  settings: { tmdbApiKey: 'tk-secret', liveSourceOrder: [M, X, 'gone-id-0000'], vodSourceOrder: [X], lastSourceId: M, channelSortOrder: 'number', guideOpacity: 0.9 } as never,
  sources: [
    { id: X, type: 'xtream', enabled: true, hasLogin: true },
    { id: M, type: 'm3u', enabled: false, epg_url: 'http://epg.example/guide.xml', auto_load_epg: false, hasLogin: false },
  ],
  syncStatus: [
    { source_id: X, last_synced: Date.UTC(2026, 9, 19, 12), channel_count: 1200, category_count: 40, movie_count: 300, series_count: 50, error: null },
    { source_id: M, last_synced: null, channel_count: 0, error: 'fetch failed: http://bob:s3cret@lists.example:8080/get.php?username=bob&password=s3cret' },
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
  assert.equal((r.sources[0].lastSync as { channelsOrGuide: string }).channelsOrGuide, '2026-10-19T12:00:00.000Z');
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
  assert.equal(r.hardware.gpus[1].renderer, 'AMD Radeon RX 6700 XT');
  assert.equal(r.hardware.gpus[0].device, '0x73df');
  assert.equal(r.player.hwdec, 'vaapi');
  assert.equal(String(r.player.error).includes('s3cret'), false);
});

test('unreadable settings or sources still give a report', () => {
  const r = buildReport({ ...inputs(), settings: 'unreadable', sources: 'unreadable' }, clean, new Date()) as Record<string, unknown>;
  assert.equal(r.settings, 'unreadable');
  assert.equal(r.sources, 'unreadable');
});

test('sync status from the page is checked: known fields of the right type only, capped', () => {
  assert.equal(validateSyncStatus('x'), 'unavailable');
  assert.deepEqual(validateSyncStatus([{ source_id: 'a', channel_count: 3, error: 'e', evil: '<b>', last_channel_sync: 'soon' }, { nope: 1 }, null]),
    [{ source_id: 'a', channel_count: 3, error: 'e' }]);
  assert.equal(validateSyncStatus(Array(600).fill({ source_id: 'a' })).length, 500);
});

test('guide mode follows the sync worker: auto-load wins, own address only when auto-load is off', () => {
  const guideOf = (s: Partial<Exclude<ReportInputs['sources'], 'unreadable'>[number]>) => {
    const r = buildReport({ ...inputs(), sources: [{ id: X, type: 'm3u', enabled: true, hasLogin: false, ...s }] }, clean, new Date()) as { sources: { guide: string }[] };
    return r.sources[0].guide;
  };
  assert.equal(guideOf({ type: 'xtream' }), 'provider');                                  // default on for Xtream
  assert.equal(guideOf({ type: 'xtream', auto_load_epg: false }), 'none');
  assert.equal(guideOf({ type: 'xtream', auto_load_epg: false, epg_url: 'http://e/x' }), 'own address');
  assert.equal(guideOf({ type: 'm3u', auto_load_epg: true }), 'provider');                // the playlist's url-tvg
  assert.equal(guideOf({ type: 'm3u', auto_load_epg: true, epg_url: 'http://e/x' }), 'provider');
  assert.equal(guideOf({ type: 'm3u' }), 'none');
});

test('sync times: 0 is a time, null/missing/non-finite is null; a row counts missing numbers as 0; no row is "never synced" with no counts', () => {
  const r = buildReport({
    ...inputs(),
    syncStatus: [{ source_id: X, last_synced: 0, last_vod_sync: Infinity }],
  }, clean, new Date()) as { sources: { lastSync: unknown; counts: unknown; error: unknown; sync: unknown }[] };
  assert.deepEqual(r.sources[0].lastSync, { channelsOrGuide: '1970-01-01T00:00:00.000Z', library: null });
  assert.deepEqual(r.sources[0].counts, { channels: 0, categories: 0, movies: 0, series: 0 });
  assert.deepEqual(r.sources[1].lastSync, { channelsOrGuide: null, library: null });
  assert.deepEqual(r.sources[1].counts, { channels: null, categories: null, movies: null, series: null });
  assert.equal(r.sources[1].sync, 'never synced');
  assert.equal(r.sources[1].error, null);
});

test('when the data process did not answer, every source says so instead of looking never synced', () => {
  const r = buildReport({ ...inputs(), syncStatus: validateSyncStatus(undefined) }, clean, new Date()) as { sources: { sync: string; counts: unknown }[] };
  assert.ok(r.sources.every((s) => s.sync.startsWith('unavailable')));
  assert.deepEqual(r.sources[0].counts, { channels: null, categories: null, movies: null, series: null });
});

test('settings: every string is cleaned (nested too); an unknown lastSourceId is null', () => {
  const settings = { ...(inputs().settings as object), lastSourceId: 'gone-id-0000', note: 'from http://prov.example:8080/x', nested: { list: ['http://lists.example/a'] } };
  const r = buildReport({ ...inputs(), settings: settings as never }, clean, new Date()) as { settings: Record<string, unknown> };
  const json = JSON.stringify(r.settings);
  assert.equal(json.includes('prov.example'), false, json);
  assert.equal(json.includes('lists.example'), false, json);
  assert.equal(r.settings.lastSourceId, null);
});

// Fails at 52866c9: a non-array liveSourceOrder/vodSourceOrder is passed through raw (bug-report.ts:46 `: value`).
test('settings: a corrupt (non-list) source order or lastSourceId never carries a raw id', () => {
  const odd = buildReport({ ...inputs(), settings: { liveSourceOrder: X, lastSourceId: 7 } as never }, clean, new Date()) as { settings: Record<string, unknown> };
  assert.equal(JSON.stringify(odd.settings).includes(X), false, 'a corrupt (non-array) order must not carry the raw id');
  assert.equal(odd.settings.lastSourceId, null);
});

test('system, hardware and every player field go through the log policy', () => {
  const leak = 'http://prov.example:8080/live/bob/s3cret/1.ts';
  const base = inputs();
  const r = buildReport({
    ...base,
    system: { ...base.system, osVersion: leak },
    hardware: { ...base.hardware, cpu: leak, gpus: [{ renderer: leak }] },
    player: { ...base.player, why: leak, mpv: leak },
  }, clean, new Date());
  const json = JSON.stringify(r);
  for (const bad of ['prov.example', 's3cret', 'bob']) assert.equal(json.includes(bad), false, `${bad} in ${json}`);
});

test('the header, app, keyring and createdAt are carried as given', () => {
  const r = buildReport(inputs(), clean, new Date(Date.UTC(2026, 9, 19, 13))) as Record<string, unknown>;
  assert.equal(r.report, 'sbtltv-bug-report');
  assert.equal(r.version, 1);
  assert.equal(r.createdAt, '2026-10-19T13:00:00.000Z');
  assert.deepEqual(r.app, { version: '0.13.1', build: { sha: 'abc1234', run: '42', ref: 'dev' } });
  assert.deepEqual(r.keyring, { backend: 'kwallet6', available: true, from: 'kept' });
  // lists stay lists after cleaning
  assert.deepEqual((r.hardware as { displays: unknown }).displays, { count: 2, window: { width: 2560, height: 1440, scale: 1, hz: 144 } });
  assert.ok(Array.isArray((r.hardware as { gpus: unknown }).gpus));
});

test('sync status: wrong types, non-finite numbers and over-long text are dropped or capped', () => {
  assert.deepEqual(validateSyncStatus([
    { source_id: 5 },
    { source_id: 'b', channel_count: Infinity, movie_count: NaN, series_count: '3', error: 42 },
  ]), [{ source_id: 'b' }]);
  const [row] = validateSyncStatus([{ source_id: 'x'.repeat(300), error: 'e'.repeat(3000) }]) as { source_id: string; error?: string | null }[];
  assert.equal(row.source_id.length, 200);
  assert.equal(row.error?.length, 2000);
});

// Fails at 52866c9: DebugTab sends data.query({ type: 'syncStatus' }), which the renderer's
// client revives into SourceMetaRow (last_synced/vod_last_synced Dates, vod_movie_count,
// vod_series_count), not the DB columns validateSyncStatus reads. Sync times come out null
// and movies/series 0 for every source.
test('sync status in the shape the page actually sends (SourceMetaRow) keeps times and VOD counts', () => {
  const sent: SourceMetaRow[] = [{
    source_id: X, last_synced: new Date(Date.UTC(2026, 9, 19, 12)), vod_last_synced: new Date(Date.UTC(2026, 9, 18)),
    channel_count: 1200, category_count: 40, vod_movie_count: 300, vod_series_count: 50,
  }];
  const r = buildReport({ ...inputs(), syncStatus: validateSyncStatus(structuredClone(sent)) }, clean, new Date()) as { sources: Record<string, any>[] };
  assert.deepEqual(r.sources[0].counts, { channels: 1200, categories: 40, movies: 300, series: 50 });
  assert.notEqual(r.sources[0].lastSync.library, null);
  assert.notEqual(r.sources[0].lastSync.channelsOrGuide, null);
});

test('a log for the zip: its last part from a whole line, every line labelled again (an address written while they were included does not ship)', () => {
  const raw = Buffer.from('first line\n2026 [app] Failed http://prov.example:8080/live/bob/s3cret/1.ts\nC:\\Users\\Alice Smith\\x\nlast\n');
  const fresh = new LogPolicy([{ id: X, name: 'Acme Premium TV', url: 'http://prov.example:8080' }]);
  const whole = reportLogText(raw, 1_000_000, (l) => fresh.forDisplay(l));
  assert.equal(whole.includes('prov.example') || whole.includes('s3cret') || whole.includes('Alice'), false, whole);
  assert.ok(whole.startsWith('first line\n'));
  const tail = reportLogText(raw, 20, (l) => l);
  assert.equal(tail, 'last\n');  // cut to the tail, starting at a whole line
  assert.equal(reportLogText(Buffer.alloc(0), 10, (l) => l), '');
});
