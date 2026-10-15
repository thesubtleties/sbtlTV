import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIB, rewindCapBytes, normalizeRewindBytes, rewindLoadOptions, parseCacheState, clampToRange } from './rewind.js';

test('cap is a quarter of RAM, rounded down to 0.5 GB', () => {
  assert.equal(rewindCapBytes(64 * GIB), 16 * GIB);
  assert.equal(rewindCapBytes(8 * GIB), 2 * GIB);
  assert.equal(rewindCapBytes(7 * GIB), 1.5 * GIB);
  assert.equal(rewindCapBytes(1 * GIB), 0);          // under 2 GB of RAM: rewind cannot be turned on
});

test('normalize: off, presets, custom steps, clamped to the cap', () => {
  const ram = 64 * GIB;
  assert.equal(normalizeRewindBytes(undefined, ram), 0);
  assert.equal(normalizeRewindBytes('2147483648', ram), 0);   // not a number
  assert.equal(normalizeRewindBytes(-1, ram), 0);
  assert.equal(normalizeRewindBytes(512 * 1024 ** 2, ram), 0.5 * GIB);
  assert.equal(normalizeRewindBytes(3.7 * GIB, ram), 3.5 * GIB);  // down to a 0.5 GB step
  assert.equal(normalizeRewindBytes(0.2 * GIB, ram), 0.5 * GIB);  // on means at least 0.5 GB
  assert.equal(normalizeRewindBytes(8 * GIB, 8 * GIB), 2 * GIB);  // settings copied from a bigger machine
  assert.equal(normalizeRewindBytes(8 * GIB, 1 * GIB), 0);        // no room at all: off
});

test('load options: live with rewind only', () => {
  assert.equal(rewindLoadOptions(0, true), '');
  assert.equal(rewindLoadOptions(2 * GIB, false), '');
  assert.equal(rewindLoadOptions(2 * GIB, true), 'demuxer-max-back-bytes=2147483648,demuxer-donate-buffer=no');
});

test('cache state: object (external mpv) and JSON string (native)', () => {
  const obj = { 'seekable-ranges': [{ start: 14.03, end: 118.1 }], 'cache-end': 119.3, 'total-bytes': 48009136, 'raw-input-rate': 890779 };
  assert.deepEqual(parseCacheState(obj), { rangeStart: 14.03, liveEdge: 118.1, bufferedBytes: 48009136, bytesPerSecond: 890779 });
  assert.deepEqual(parseCacheState(JSON.stringify(obj)), parseCacheState(obj));
});

test('cache state: missing or odd shapes give null, never throw', () => {
  assert.equal(parseCacheState(undefined), null);
  assert.equal(parseCacheState(''), null);
  assert.equal(parseCacheState('not json'), null);
  assert.equal(parseCacheState({}), null);
  assert.equal(parseCacheState({ 'seekable-ranges': [] }), null);
  assert.equal(parseCacheState({ 'seekable-ranges': [{ start: 'x', end: 2 }] }), null);
});

test('cache state: several ranges use the one reaching the live edge', () => {
  const obj = { 'seekable-ranges': [{ start: 0, end: 10 }, { start: 30, end: 90 }], 'total-bytes': 1, 'raw-input-rate': 1 };
  assert.deepEqual(parseCacheState(obj), { rangeStart: 30, liveEdge: 90, bufferedBytes: 1, bytesPerSecond: 1 });
});

test('clamp seeks into the buffer', () => {
  const r = { rangeStart: 20, liveEdge: 80 };
  assert.equal(clampToRange(5, r), 20);
  assert.equal(clampToRange(50, r), 50);
  assert.equal(clampToRange(500, r), 80);
});
