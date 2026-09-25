import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLinuxPlayerMode } from './linux-player-mode.js';

test('keeps the two known modes', () => {
  assert.equal(normalizeLinuxPlayerMode('native'), 'native');
  assert.equal(normalizeLinuxPlayerMode('compatibility'), 'compatibility');
});

test('anything else falls back to the native player', () => {
  for (const value of [undefined, null, '', 'legacy', 'COMPATIBILITY', 1, true, {}]) {
    assert.equal(normalizeLinuxPlayerMode(value), 'native');
  }
});
