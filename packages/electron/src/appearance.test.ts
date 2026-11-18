import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance } from './appearance.js';
import { fitAppearance } from './sync-appearance.js';

test('the Movies & Series header defaults to Simple; Floating is kept; anything else is Simple', () => {
  assert.equal(normalizeAppearance(undefined).header, 'simple');
  assert.equal(normalizeAppearance({ palette: 'nord' }).header, 'simple');
  assert.equal(normalizeAppearance({ header: 'floating' }).header, 'floating');
  assert.equal(normalizeAppearance({ header: 'boxed' as never }).header, 'simple');
});

test('the header choice travels with the rest of the look between computers', () => {
  const out = fitAppearance({ palette: 'nord', typeface: 'fira', accent: 'palette', header: 'floating' }, { palette: 'sbtl' }, { caelestia: false, accent: false });
  assert.equal(out.header, 'floating');
});

test("an older app's look (no header in it) keeps this computer's header choice", () => {
  const out = fitAppearance({ palette: 'nord', typeface: 'fira', accent: 'palette' }, { palette: 'sbtl', header: 'floating' }, { caelestia: false, accent: false });
  assert.equal((out as { header?: string }).header, 'floating');
});
