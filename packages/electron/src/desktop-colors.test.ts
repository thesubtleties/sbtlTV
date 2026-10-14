import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, paletteFromCaelestia, parsePortalAccent } from './desktop-colors.js';

// The user's Caelestia scheme on 2026-10-11 (dark, teal wallpaper), trimmed.
const darkTeal = {
  surfaceContainerLowest: '000000', surfaceContainer: '161d1d', surfaceContainerHigh: '202727',
  outlineVariant: '3f4948', outline: '889392', onSurface: 'dce8e7', onSurfaceVariant: 'bec9c8',
  primary: '80d5d0', onPrimary: '003735', error: 'ffb4ab', tertiary: 'b1c6ea', background: '0a0f0f',
};

test('a readable dark scheme replaces surfaces, accent, danger and the second tone', () => {
  const palette = paletteFromCaelestia(darkTeal);
  assert.equal(palette.bg, '#000000');
  assert.equal(palette.card, '#161d1d');
  assert.equal(palette.fg, '#dce8e7');
  assert.equal(palette.accent, '#80d5d0');
  assert.equal(palette.onAccent, '#003735');
  assert.equal(palette.danger, '#ffb4ab');
  assert.equal(palette.teal, '#b1c6ea');
});

test('surfaces that would make text unreadable keep the sbtl ones', () => {
  // A pale wallpaper: light surfaces with light text.
  const palette = paletteFromCaelestia({ ...darkTeal, surfaceContainer: 'd0d8d8', onSurface: 'e8f0f0' });
  assert.equal(palette.card, '#141414');
  assert.equal(palette.fg, '#ffffff');
  assert.equal(palette.accent, '#80d5d0', 'the accent still reads on the sbtl card');
});

test('an accent with poor contrast is not used, and onAccent falls back to black or white', () => {
  assert.equal(paletteFromCaelestia({ ...darkTeal, primary: '1a2020' }).accent, '#00d4ff');
  const palette = paletteFromCaelestia({ ...darkTeal, onPrimary: '70c5c0' });
  assert.equal(palette.onAccent, '#000000');
});

test('malformed colors are ignored', () => {
  const palette = paletteFromCaelestia({ ...darkTeal, primary: 'not-a-color', onSurface: '' });
  assert.equal(palette.accent, '#00d4ff');
  assert.equal(palette.fg, '#ffffff');
});

test('contrast matches WCAG for black and white', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#000000', 'rgba(0,0,0,1)'), 0);
});

test('portal accent replies are parsed, and unset or out-of-range ones are rejected', () => {
  assert.equal(parsePortalAccent('(<(0.2078431372549019, 0.5176470588235295, 0.8941176470588236)>,)\n'), '#3584e4');
  assert.equal(parsePortalAccent('(<<(1.0, 0.5, 0.0)>>,)'), '#ff8000');
  assert.equal(parsePortalAccent('(<(-1.0, -1.0, -1.0)>,)'), null);
  assert.equal(parsePortalAccent(''), null);
});
