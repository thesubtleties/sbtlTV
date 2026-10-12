import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeSubtitleSettings, parseSubtitleTracks, subtitleStyleOptions,
  loadResetOptions, SUBTITLE_BASE_OPTIONS, TrackReadSchedule, subtitleFontsDir,
} from './subtitles.js';

test('settings default to off, medium, outline', () => {
  for (const value of [undefined, null, 'x', 42, {}]) {
    assert.deepEqual(normalizeSubtitleSettings(value), { liveDefault: false, vodDefault: false, size: 'medium', style: 'outline' });
  }
});

test('settings keep valid values and drop invalid ones', () => {
  assert.deepEqual(
    normalizeSubtitleSettings({ liveDefault: true, vodDefault: 'yes', size: 'large', style: 'neon' }),
    { liveDefault: true, vodDefault: false, size: 'large', style: 'outline' },
  );
});

const LIVE_JSON = JSON.stringify([
  { id: 1, type: 'video', codec: 'h264' },
  { id: 1, type: 'audio', codec: 'ac3', lang: 'eng' },
  { id: 1, type: 'sub', codec: 'eia_608' },
]);

test('parses the live CC track from libmpv JSON', () => {
  assert.deepEqual(parseSubtitleTracks(LIVE_JSON), [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true }]);
});

test('parses VOD text tracks from the socket array', () => {
  const tracks = parseSubtitleTracks([
    { id: 1, type: 'video', codec: 'h264' },
    { id: 1, type: 'sub', codec: 'mov_text', lang: 'eng' },
    { id: 2, type: 'sub', codec: 'subrip', lang: 'spa', title: 'Spanish' },
  ]);
  assert.deepEqual(tracks, [
    { id: 1, lang: 'eng', title: null, codec: 'mov_text', isCc: false },
    { id: 2, lang: 'spa', title: 'Spanish', codec: 'subrip', isCc: false },
  ]);
});

test('bad input gives no tracks', () => {
  for (const value of [undefined, null, '', 'not json', '{}', 42, [{ type: 'sub' }], [{ id: 'x', type: 'sub' }]]) {
    assert.deepEqual(parseSubtitleTracks(value), []);
  }
});

test('base options turn on CC tracks and stop sidecar searches', () => {
  assert.deepEqual(SUBTITLE_BASE_OPTIONS, [['sub-create-cc-track', 'yes'], ['sub-auto', 'no'], ['sid', 'no']]);
});

test('loadResetOptions resets track and delay', () => {
  assert.deepEqual(loadResetOptions(), [['sid', 'no'], ['sub-delay', '0']]);
});

test('style options: medium outline in Fira', () => {
  const opts = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'medium', style: 'outline' }, 'fira'));
  assert.equal(opts.get('sub-font'), 'Fira Sans');
  assert.equal(opts.get('sub-font-size'), '46');
  assert.equal(opts.get('sub-border-style'), 'outline-and-shadow');
  assert.equal(opts.get('sub-border-size'), '2.5');
  assert.equal(opts.get('sub-shadow-offset'), '0');
  assert.equal(opts.get('sub-pos'), '92');
});

test('style options: large box in mono, small shadow in system font', () => {
  const box = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'large', style: 'box' }, 'mono'));
  assert.equal(box.get('sub-font'), 'JetBrains Mono');
  assert.equal(box.get('sub-font-size'), '56');
  assert.equal(box.get('sub-border-style'), 'opaque-box');
  const shadow = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'small', style: 'shadow' }, 'system'));
  assert.equal(shadow.get('sub-font'), 'sans-serif');
  assert.equal(shadow.get('sub-font-size'), '38');
  assert.equal(shadow.get('sub-shadow-offset'), '2');
});

test('read schedule waits for video, then reads once when a subtitle track is there', () => {
  const s = new TrackReadSchedule(10, 1000);
  assert.equal(s.shouldRead(0, false), false);
  assert.equal(s.shouldRead(0, true), true);
  s.record(0, [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true }]);
  assert.equal(s.shouldRead(5000, true), false);
});

test('keeps reading until a subtitle track appears, then stops', () => {
  const s = new TrackReadSchedule(10, 1000);
  assert.equal(s.shouldRead(0, true), true);
  s.record(0, []);
  assert.equal(s.shouldRead(500, true), false);   // too soon
  assert.equal(s.shouldRead(1000, true), true);
  s.record(1000, [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true }]);
  assert.equal(s.shouldRead(2000, true), false);
});

test('gives up after maxReads, and reset re-arms it', () => {
  const s = new TrackReadSchedule(3, 1000);
  for (let i = 0; i < 3; i++) { assert.equal(s.shouldRead(i * 1000, true), true); s.record(i * 1000, []); }
  assert.equal(s.shouldRead(10_000, true), false);
  s.reset();
  assert.equal(s.shouldRead(10_000, true), true);
});

test('subtitle fonts live in resources when packaged, in assets when not', () => {
  assert.equal(subtitleFontsDir({ isPackaged: true, resourcesPath: '/opt/sbtlTV/resources', dirname: '/x/dist' }), '/opt/sbtlTV/resources/sub-fonts');
  assert.equal(subtitleFontsDir({ isPackaged: false, resourcesPath: '/r', dirname: '/repo/packages/electron/dist' }), '/repo/packages/electron/assets/sub-fonts');
});
