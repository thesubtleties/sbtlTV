import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKind } from './build-kind.js';

test('a build from a version tag is a release, betas included', () => {
  assert.equal(buildKind({ ref: 'v0.17.0' }), 'release');
  assert.equal(buildKind({ ref: 'v0.17.0-beta.2' }), 'release');
});

test('a branch build is a test build; no build info is local', () => {
  assert.equal(buildKind({ ref: 'feat/sync' }), 'test');
  assert.equal(buildKind({ ref: 'dev' }), 'test');
  assert.equal(buildKind({}), 'test');
  assert.equal(buildKind('local'), 'local');
});
