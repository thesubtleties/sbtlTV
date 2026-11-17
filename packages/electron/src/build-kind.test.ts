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

test('only a whole version tag counts: anything else that mentions a version is a test build', () => {
  for (const ref of ['0.17.0', 'v0.17', 'v0.17.0.1', 'refs/tags/v0.17.0', 'release/v0.17.0', 'v0.17.0-', 'v0.17.0 ']) {
    assert.equal(buildKind({ ref }), 'test', ref);
  }
});
