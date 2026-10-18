import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIB, rewindCapBytes, normalizeRewindBytes, rewindMpvProperties, MPV_DEFAULT_CACHE, parseCacheState, clampToRange } from './rewind.js';

test('cap is a quarter of the installed RAM (what the OS reports, rounded up to 2 GB), in 0.5 GB steps', () => {
  assert.equal(rewindCapBytes(62.6 * GIB), 16 * GIB);  // a "64 GB" machine
  assert.equal(rewindCapBytes(7.6 * GIB), 2 * GIB);    // an "8 GB" laptop keeps the 2 GB preset
  assert.equal(rewindCapBytes(23.4 * GIB), 6 * GIB);   // "24 GB"
  assert.equal(rewindCapBytes(5.8 * GIB), 1.5 * GIB);  // "6 GB"
  assert.equal(rewindCapBytes(1.5 * GIB), 0.5 * GIB);
  assert.equal(rewindCapBytes(0), 0);
});

test('normalize: off, presets, custom steps, clamped to the cap', () => {
  const ram = 62.6 * GIB;
  assert.equal(normalizeRewindBytes(undefined, ram), 0);
  assert.equal(normalizeRewindBytes('2147483648', ram), 0);   // not a number
  assert.equal(normalizeRewindBytes(-1, ram), 0);
  assert.equal(normalizeRewindBytes(512 * 1024 ** 2, ram), 0.5 * GIB);
  assert.equal(normalizeRewindBytes(3.7 * GIB, ram), 3.5 * GIB);  // down to a 0.5 GB step
  assert.equal(normalizeRewindBytes(0.2 * GIB, ram), 0.5 * GIB);  // on means at least 0.5 GB
  assert.equal(normalizeRewindBytes(8 * GIB, 7.6 * GIB), 2 * GIB);  // settings copied from a bigger machine
  assert.equal(normalizeRewindBytes(8 * GIB, 0), 0);                // no room at all: off
});

test('mpv cache properties: mpv defaults unless live with rewind; never on disk', () => {
  assert.deepEqual(rewindMpvProperties(0, true), MPV_DEFAULT_CACHE);
  assert.deepEqual(rewindMpvProperties(2 * GIB, false), MPV_DEFAULT_CACHE);
  assert.equal(MPV_DEFAULT_CACHE['cache-on-disk'], 'no');
  const live = rewindMpvProperties(2 * GIB, true);
  // mpv holds about twice its own count in real memory, so it gets half the chosen size.
  assert.equal(live['demuxer-max-bytes'], String(GIB));
  assert.equal(live['cache-on-disk'], 'no');
  assert.deepEqual(Object.keys(live).sort(), Object.keys(MPV_DEFAULT_CACHE).sort());
});

test('cache state: object (external mpv) and JSON string (native)', () => {
  const obj = { 'seekable-ranges': [{ start: 14.03, end: 118.1 }], 'cache-end': 119.3, 'total-bytes': 48009136, 'fw-bytes': 6498000, 'raw-input-rate': 890779 };
  assert.deepEqual(parseCacheState(obj), { rangeStart: 14.03, liveEdge: 118.1, bufferedBytes: 48009136, forwardBytes: 6498000, bytesPerSecond: 48009136 / (118.1 - 14.03) });
  assert.deepEqual(parseCacheState(JSON.stringify(obj)), parseCacheState(obj));
});

test('cache state: missing or odd shapes give null, never throw', () => {
  assert.equal(parseCacheState(undefined), null);
  assert.equal(parseCacheState(''), null);
  assert.equal(parseCacheState('not json'), null);
  assert.equal(parseCacheState({}), null);
  assert.equal(parseCacheState({ 'seekable-ranges': [] }), null);
  assert.equal(parseCacheState({ 'seekable-ranges': [{ start: 'x', end: 2 }] }), null);
  assert.equal(parseCacheState({ 'seekable-ranges': [{ start: Number.NaN, end: 2 }] }), null);
});

test('cache state: several ranges use the one reaching the live edge', () => {
  const obj = { 'seekable-ranges': [{ start: 0, end: 10 }, { start: 30, end: 90 }], 'total-bytes': 1, 'raw-input-rate': 1 };
  assert.deepEqual(parseCacheState(obj), { rangeStart: 30, liveEdge: 90, bufferedBytes: 1, forwardBytes: 0, bytesPerSecond: 1 / 60 });
});

test('clamp seeks into the buffer, a little inside the rolling start', () => {
  const r = { rangeStart: 20, liveEdge: 80 };
  assert.equal(clampToRange(5, r), 22);      // the start moves on every second: keep 2 s of margin
  assert.equal(clampToRange(50, r), 50);
  assert.equal(clampToRange(500, r), 80);
  assert.equal(clampToRange(Number.NaN, r), 80);
  assert.equal(clampToRange(5, { rangeStart: 20, liveEdge: 21 }), 20.5);  // tiny range: margin capped at half
});

test('bytes per second: the average over what is cached once there is 20 s of it, else mpv\'s instant rate', () => {
  const steady = { 'seekable-ranges': [{ start: 100, end: 400 }], 'total-bytes': 150_000_000, 'raw-input-rate': 9_999_999 };
  assert.equal(parseCacheState(steady)?.bytesPerSecond, 500_000);          // 150 MB over 300 s
  const early = { 'seekable-ranges': [{ start: 0, end: 10 }], 'total-bytes': 5_000_000, 'raw-input-rate': 640_000 };
  assert.equal(parseCacheState(early)?.bytesPerSecond, 640_000);
});
