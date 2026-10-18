import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReleasePlayerMemory, PLAYER_MEMORY_RELEASE_BYTES, PlayerMemoryTracker } from './player-memory.js';

const big = PLAYER_MEMORY_RELEASE_BYTES;
const small = PLAYER_MEMORY_RELEASE_BYTES - 1;

test('stop releases after a big cache, live or not', () => {
  assert.equal(shouldReleasePlayerMemory({ peakBytes: big, event: 'stop' }), true);
  assert.equal(shouldReleasePlayerMemory({ peakBytes: small, event: 'stop' }), false);
});

test('switching between live TV and movies releases; channel surfing and next episode do not', () => {
  assert.equal(shouldReleasePlayerMemory({ peakBytes: big, event: 'load', wasLive: true, nextLive: false }), true);
  assert.equal(shouldReleasePlayerMemory({ peakBytes: big, event: 'load', wasLive: false, nextLive: true }), true);
  assert.equal(shouldReleasePlayerMemory({ peakBytes: big, event: 'load', wasLive: true, nextLive: true }), false);
  assert.equal(shouldReleasePlayerMemory({ peakBytes: big, event: 'load', wasLive: false, nextLive: false }), false);
});

test('nothing played yet: nothing to release', () => {
  assert.equal(shouldReleasePlayerMemory({ peakBytes: 0, event: 'stop' }), false);
});

test('the pool keeps the biggest stream since the last restart, not just the last one', () => {
  const t = new PlayerMemoryTracker();
  t.startStream(true);
  t.noteCached(PLAYER_MEMORY_RELEASE_BYTES * 10);   // a big channel
  t.startStream(true);                                // surf to a short one (no release: live to live)
  t.noteCached(1024);
  assert.equal(t.shouldRelease({ event: 'stop' }), true);
});

test('after a release the high-water mark starts over', () => {
  const t = new PlayerMemoryTracker();
  t.startStream(true);
  t.noteCached(PLAYER_MEMORY_RELEASE_BYTES * 2);
  assert.equal(t.shouldRelease({ event: 'load', nextLive: false }), true);
  t.released();
  t.startStream(false);
  t.noteCached(1024);
  assert.equal(t.shouldRelease({ event: 'stop' }), false);
});

test('channel surfing never releases, whatever was cached', () => {
  const t = new PlayerMemoryTracker();
  t.startStream(true);
  t.noteCached(PLAYER_MEMORY_RELEASE_BYTES * 5);
  assert.equal(t.shouldRelease({ event: 'load', nextLive: true }), false);
});

test('nothing played: nothing to release', () => {
  assert.equal(new PlayerMemoryTracker().shouldRelease({ event: 'stop' }), false);
});
