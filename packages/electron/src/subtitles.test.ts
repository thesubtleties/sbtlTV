import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeSubtitleSettings, parseSubtitleTracks, subtitleStyleOptions,
  loadResetOptions, SUBTITLE_BASE_OPTIONS, TrackReadSchedule, subtitleFontsDir, judgeCaptionText, CaptionCheck,
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

// Texts seen on 12 US channels (2026-10-12 sample): field-2/XDS junk vs real captions.
const JUNK = [
  'CNNPACN', 'CNNCNN', 'H@ABC NetworkGMA 3H@', 'kH@GMA 3  H@ABC Network', 'A 3H@  ABC NetworkH@', 'HEHEHEHEHEHEHE',
  'HDDateline DaytimeHD', 'HGTEHCHG', 'H@PA', 'H@The StoryFox', 'H@', 'H@H@H@H@', 'HCHCHCHCHCHCHCHC',
];
const REAL = [
  '>> / CLEARLY DIFFERENT.', 'COVERED?  / >> YOU HAVE YO', 'ACCIDENT INSURANCE. BU', 'REALLY GREAT. THEY  / COME',
  'A SKIRT OR DRESS UNDERNEATH, TO', 'Which I did / very much.', 'I did. Yeah.', 'could find no connection /     and no evidence',
  'After speaking / with the FBI, they', 'It‘s that time of year when', 'with a mother-in-law suite.', 'to come up',
  'Meanwhile, back at the house,', 'Hilary has updates / for Dana', 'CAN’T PUT A /', 'O  /  SUPPRESS DISSENT',
  'I don’t know. / I don’t know.', 't know what / could’ve d', 'Were they off-islanders?', '. / Can we go now?',
  'FACTORS, / AS WELL AS P', 'NG PUSHED OUT A', 'SENTIMENT, UNCERTAINTY', 'THE / POTENTIAL STOCK R',
  'I need to navigate this /        new city.', 'We have a big stack /    of obstacles.', 'Hold on, just hold /  on for a second.',
  'I’m 10-83, give me some units.', 'STRENGTH AND MISSISSIPPI', 'HA HA HA HA',
];

test('caption judge: every sampled junk text is junk', () => {
  for (const t of JUNK) assert.equal(judgeCaptionText(t), 'junk', t);
});

test('caption judge: every sampled real caption is ok', () => {
  for (const t of REAL) assert.equal(judgeCaptionText(t), 'ok', t);
});

test('caption judge: too little text is unknown', () => {
  for (const t of ['', 'C', 'CO', 'CN', 'CNN', 'HE', 'CNNCN']) assert.equal(judgeCaptionText(t), 'unknown', t);
});

test('caption judge: a glued run of letters is never real on its own (CNN International, 2026-10-12)', () => {
  for (const t of ['CNNCPA', 'CNNCPAS', 'CNNCPASN']) assert.equal(judgeCaptionText(t), 'unknown', t);
  assert.equal(judgeCaptionText('CNNCPASNNCNN'), 'junk');
  assert.equal(judgeCaptionText('COVERED?'), 'ok');  // one word, but a finished one
});

test('caption check: three different real lines confirm the captions', () => {
  const c = new CaptionCheck(8);
  assert.equal(c.observe('CO'), 'none');
  assert.equal(c.observe('COVERED?'), 'none');
  assert.equal(c.observe('COVERED?'), 'none');           // the same line again does not count
  assert.equal(c.observe('COVERED? / >> YOU HAVE'), 'none');
  assert.equal(c.observe('COVERED? / >> YOU HAVE YOUR'), 'ok');
  assert.equal(c.state, 'ok');
  assert.equal(c.observe('HEHEHEHEHE'), 'none');         // never second-guesses after that
});

test('caption check: junk before confirmation still restarts', () => {
  const c = new CaptionCheck(8);
  for (const t of ['CN', 'CNNC', 'CNNCPA', 'CNNCPAS', 'CNNCPASN']) assert.equal(c.observe(t), 'none', t);
  assert.equal(c.observe('CNNCPASNNCNN'), 'retry');
});

test('caption check: junk retries, then ok', () => {
  const c = new CaptionCheck(8);
  assert.equal(c.observe('HEHEHEHE'), 'retry');
  assert.equal(c.observe('HEHEHEHE'), 'none');     // the old text lingering after the restart is ignored
  assert.equal(c.observe('Which I did'), 'none');
  assert.equal(c.observe('Which I did / very'), 'none');
  assert.equal(c.observe('Which I did / very much.'), 'ok');
  assert.equal(c.retries, 1);
});

test('caption check: gives up after the retry budget', () => {
  const c = new CaptionCheck(8);
  for (let i = 0; i < 8; i++) { assert.equal(c.observe('H@'), 'retry'); c.observe(''); }
  assert.equal(c.observe('H@'), 'unreadable');
  assert.equal(c.state, 'unreadable');
});

test('loadResetOptions also shows subtitles again', () => {
  assert.deepEqual(loadResetOptions(), [['sid', 'no'], ['sub-delay', '0'], ['sub-visibility', 'yes']]);
});
