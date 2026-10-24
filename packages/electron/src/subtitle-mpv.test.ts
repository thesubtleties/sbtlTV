import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { parseSubtitleTracks, subtitleStyleOptions, loadResetOptions, SUBTITLE_BASE_OPTIONS, TrackReadSchedule, TrackListWaiter, subtitleFontsDir } from './subtitle-mpv.js';
import { normalizeSubtitleSettings } from './subtitle-settings.js';

const LIVE_JSON = JSON.stringify([
  { id: 1, type: 'video', codec: 'h264' },
  { id: 1, type: 'audio', codec: 'ac3', lang: 'eng' },
  { id: 1, type: 'sub', codec: 'eia_608' },
]);

test('parses the live CC track from libmpv JSON', () => {
  assert.deepEqual(parseSubtitleTracks(LIVE_JSON), [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false }]);
});

test('parses VOD text tracks from the socket array', () => {
  const tracks = parseSubtitleTracks([
    { id: 1, type: 'video', codec: 'h264' },
    { id: 1, type: 'sub', codec: 'mov_text', lang: 'eng' },
    { id: 2, type: 'sub', codec: 'subrip', lang: 'spa', title: 'Spanish' },
  ]);
  assert.deepEqual(tracks, [
    { id: 1, lang: 'eng', title: null, codec: 'mov_text', isCc: false, external: false, externalFile: null, hearingImpaired: false },
    { id: 2, lang: 'spa', title: 'Spanish', codec: 'subrip', isCc: false, external: false, externalFile: null, hearingImpaired: false },
  ]);
});

test('bad input gives no tracks', () => {
  for (const value of [undefined, null, '', 'not json', '{}', 42, [{ type: 'sub' }], [{ id: 'x', type: 'sub' }]]) {
    assert.deepEqual(parseSubtitleTracks(value), []);
  }
});

test('base options turn on CC tracks, stop sidecar searches and ignore fonts inside files', () => {
  assert.deepEqual(SUBTITLE_BASE_OPTIONS, [['sub-create-cc-track', 'yes'], ['sub-auto', 'no'], ['embeddedfonts', 'no'], ['sid', 'no']]);
});

test('style options: medium outline in Fira', () => {
  const opts = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto', preferSdh: false, subdlWait: 10 }, 'fira'));
  assert.equal(opts.get('sub-font'), 'Fira Sans');
  assert.equal(opts.get('sub-font-size'), '46');
  assert.equal(opts.get('sub-border-style'), 'outline-and-shadow');
  assert.equal(opts.get('sub-border-size'), '2.5');
  assert.equal(opts.get('sub-shadow-offset'), '0');
  assert.equal(opts.get('sub-pos'), '92');
});

test('style options: large box in mono, small shadow in system font', () => {
  const box = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'large', style: 'box', language: 'auto', preferSdh: false, subdlWait: 10 }, 'mono'));
  assert.equal(box.get('sub-font'), 'JetBrains Mono');
  assert.equal(box.get('sub-font-size'), '56');
  assert.equal(box.get('sub-border-style'), 'opaque-box');
  const shadow = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'small', style: 'shadow', language: 'auto', preferSdh: false, subdlWait: 10 }, 'system'));
  assert.equal(shadow.get('sub-font'), 'sans-serif');
  assert.equal(shadow.get('sub-font-size'), '38');
  assert.equal(shadow.get('sub-shadow-offset'), '2');
});

test('read schedule waits for video, then reads once when a subtitle track is there', () => {
  const s = new TrackReadSchedule(10, 1000);
  assert.equal(s.shouldRead(0, false), false);
  assert.equal(s.shouldRead(0, true), true);
  s.record(0, [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false }]);
  assert.equal(s.shouldRead(5000, true), false);
});

test('keeps reading until a subtitle track appears, then stops', () => {
  const s = new TrackReadSchedule(10, 1000);
  assert.equal(s.shouldRead(0, true), true);
  s.record(0, []);
  assert.equal(s.shouldRead(500, true), false);   // too soon
  assert.equal(s.shouldRead(1000, true), true);
  s.record(1000, [{ id: 1, lang: null, title: null, codec: 'eia_608', isCc: true, external: false, externalFile: null, hearingImpaired: false }]);
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
  // path.join: Windows CI joins with backslashes
  assert.equal(subtitleFontsDir({ isPackaged: true, resourcesPath: '/opt/sbtlTV/resources', dirname: '/x/dist' }), path.join('/opt/sbtlTV/resources', 'sub-fonts'));
  assert.equal(subtitleFontsDir({ isPackaged: false, resourcesPath: '/r', dirname: '/repo/packages/electron/dist' }), path.join('/repo/packages/electron', 'assets', 'sub-fonts'));
});

test('loadResetOptions also shows subtitles again and resets a synced speed', () => {
  assert.deepEqual(loadResetOptions(), [['sid', 'no'], ['sub-delay', '0'], ['sub-speed', '1'], ['sub-visibility', 'yes']]);
});

// Real caption lines, 2026-10-12 language sample (field 1 / field 2 decoded separately).

test('external and hearing-impaired flags are kept', () => {
  const tracks = parseSubtitleTracks([
    { id: 1, type: 'sub', codec: 'subrip', lang: 'eng', external: true, 'external-filename': '/u/subtitles/movie_1/a.srt' },
    { id: 2, type: 'sub', codec: 'subrip', lang: 'eng', 'hearing-impaired': true },
  ]);
  assert.equal(tracks[0].external, true);
  assert.equal(tracks[0].externalFile, '/u/subtitles/movie_1/a.srt');
  assert.equal(tracks[1].hearingImpaired, true);
  assert.equal(tracks[1].external, false);
  assert.equal(tracks[1].externalFile, null);
});

test('track reads go on until the duration is known too (a list without it is not the real one yet)', () => {
  const s = new TrackReadSchedule(10, 1000);
  const sub = parseSubtitleTracks([{ id: 1, type: 'sub', codec: 'subrip', lang: 'eng' }]);
  assert.equal(s.shouldRead(0, true), true);
  s.record(0, sub, 0);
  assert.equal(s.shouldRead(1000, true), true);   // tracks but no duration: read again
  s.record(1000, sub, 5400);
  assert.equal(s.shouldRead(2000, true), false);
});

test('TrackListWaiter: resolves when a pushed list holds the file, null on timeout or cancel', async () => {
  const w = new TrackListWaiter();
  const found = w.wait('/c/a.srt', 1000);
  w.offer(parseSubtitleTracks([{ id: 1, type: 'sub', codec: 'subrip' }]));
  w.offer(parseSubtitleTracks([{ id: 1, type: 'sub', codec: 'subrip' }, { id: 2, type: 'sub', codec: 'subrip', external: true, 'external-filename': '/c/a.srt' }]));
  assert.equal((await found)?.id, 2);
  assert.equal(await w.wait('/c/b.srt', 20), null);
  const cancelled = w.wait('/c/c.srt', 1000);
  w.cancelAll();
  assert.equal(await cancelled, null);
});
