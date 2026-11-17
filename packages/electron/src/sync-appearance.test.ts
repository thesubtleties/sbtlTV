import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitAppearance } from './sync-appearance.js';

const local = { palette: 'nord', typeface: 'fira', accent: 'palette' } as const;

test('a palette read from the desktop shell (Caelestia) is not taken by a computer without it', () => {
  const incoming = { palette: 'caelestia', typeface: 'inter', accent: 'palette' };
  assert.deepEqual(fitAppearance(incoming, local, { caelestia: false, accent: true }), { palette: 'nord', typeface: 'inter', accent: 'palette' });
  assert.deepEqual(fitAppearance(incoming, local, { caelestia: true, accent: true }), { palette: 'caelestia', typeface: 'inter', accent: 'palette' });
});

test("the system accent is not taken by a computer whose desktop doesn't give one", () => {
  const incoming = { palette: 'mocha', typeface: 'fira', accent: 'system' };
  assert.deepEqual(fitAppearance(incoming, local, { caelestia: false, accent: false }), { palette: 'mocha', typeface: 'fira', accent: 'palette' });
  assert.deepEqual(fitAppearance(incoming, local, { caelestia: false, accent: true }), { palette: 'mocha', typeface: 'fira', accent: 'system' });
});

test('if this computer is itself on Caelestia without it, it falls back to the default palette', () => {
  assert.equal(fitAppearance({ palette: 'caelestia' }, { palette: 'caelestia' }, { caelestia: false, accent: false }).palette, 'sbtl');
});
