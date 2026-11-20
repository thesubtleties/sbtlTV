import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFirstRun, normalizeSeenVersion } from './settings-markers.js';

test('the first-run marker takes only its two values', () => {
  assert.equal(normalizeFirstRun('done'), 'done');
  assert.equal(normalizeFirstRun('offer-sync'), 'offer-sync');
  assert.equal(normalizeFirstRun('yes'), undefined);
  assert.equal(normalizeFirstRun(true), undefined);
  assert.equal(normalizeFirstRun(undefined), undefined);
});

test('the last seen version is kept only when it looks like a version', () => {
  assert.equal(normalizeSeenVersion('0.17.0'), '0.17.0');
  assert.equal(normalizeSeenVersion('0.17.0-beta.2'), '0.17.0-beta.2');
  assert.equal(normalizeSeenVersion('latest'), undefined);
  assert.equal(normalizeSeenVersion(17), undefined);
  assert.equal(normalizeSeenVersion('1'.repeat(80)), undefined);
  // Version-shaped but too long: only the length check stops it
  assert.equal(normalizeSeenVersion(`0.17.0-${'a'.repeat(34)}`), undefined);
  assert.equal(normalizeSeenVersion(`0.17.0-${'a'.repeat(33)}`), `0.17.0-${'a'.repeat(33)}`);
  assert.equal(normalizeSeenVersion('0.17'), undefined);
  assert.equal(normalizeSeenVersion(' 0.17.0'), undefined);
});
