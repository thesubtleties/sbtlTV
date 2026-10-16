import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReleasePlayerMemory, PLAYER_MEMORY_RELEASE_BYTES } from './player-memory.js';

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
