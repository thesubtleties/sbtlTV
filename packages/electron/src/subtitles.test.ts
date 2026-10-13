import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import {
  normalizeSubtitleSettings, parseSubtitleTracks, subtitleStyleOptions,
  loadResetOptions, SUBTITLE_BASE_OPTIONS, TrackReadSchedule, subtitleFontsDir, judgeCaptionText, CaptionCheck, preferredCaptionLanguage, detectCaptionLanguage,
} from './subtitles.js';

test('settings default to off, medium, outline, auto language', () => {
  for (const value of [undefined, null, 'x', 42, {}]) {
    assert.deepEqual(normalizeSubtitleSettings(value), { liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' });
  }
});

test('settings keep valid values and drop invalid ones', () => {
  assert.deepEqual(
    normalizeSubtitleSettings({ liveDefault: true, vodDefault: 'yes', size: 'large', style: 'neon', language: 'es' }),
    { liveDefault: true, vodDefault: false, size: 'large', style: 'outline', language: 'es' },
  );
  assert.equal(normalizeSubtitleSettings({ language: 'de' }).language, 'auto');
});

test('caption language: auto follows the system language when it is one we can tell apart', () => {
  assert.equal(preferredCaptionLanguage('auto', 'en-US'), 'en');
  assert.equal(preferredCaptionLanguage('auto', 'es-MX'), 'es');
  assert.equal(preferredCaptionLanguage('auto', 'fr-CA'), 'fr');
  assert.equal(preferredCaptionLanguage('auto', 'de-DE'), null);   // no preference: any real captions
  assert.equal(preferredCaptionLanguage('es', 'en-US'), 'es');
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
  const opts = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'medium', style: 'outline', language: 'auto' }, 'fira'));
  assert.equal(opts.get('sub-font'), 'Fira Sans');
  assert.equal(opts.get('sub-font-size'), '46');
  assert.equal(opts.get('sub-border-style'), 'outline-and-shadow');
  assert.equal(opts.get('sub-border-size'), '2.5');
  assert.equal(opts.get('sub-shadow-offset'), '0');
  assert.equal(opts.get('sub-pos'), '92');
});

test('style options: large box in mono, small shadow in system font', () => {
  const box = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'large', style: 'box', language: 'auto' }, 'mono'));
  assert.equal(box.get('sub-font'), 'JetBrains Mono');
  assert.equal(box.get('sub-font-size'), '56');
  assert.equal(box.get('sub-border-style'), 'opaque-box');
  const shadow = new Map(subtitleStyleOptions({ liveDefault: false, vodDefault: false, size: 'small', style: 'shadow', language: 'auto' }, 'system'));
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
  // path.join: Windows CI joins with backslashes
  assert.equal(subtitleFontsDir({ isPackaged: true, resourcesPath: '/opt/sbtlTV/resources', dirname: '/x/dist' }), path.join('/opt/sbtlTV/resources', 'sub-fonts'));
  assert.equal(subtitleFontsDir({ isPackaged: false, resourcesPath: '/r', dirname: '/repo/packages/electron/dist' }), path.join('/repo/packages/electron', 'assets', 'sub-fonts'));
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

// Real caption lines, 2026-10-12 language sample (field 1 / field 2 decoded separately).
const ENGLISH = [
  '- Performing the title track / from his new album Signs, / once again, Luke Bryan.',
  "Until I found out / I'm better ever / since you're gone / I don't wanna go on and on",
  "But I'm not / It's half past / cold beer o'clock / Might take a sip",
  "That's what I'll be hitting / Baby, you're calls / Are all that I'll / be missing, baby",
  'After speaking / with the FBI, they / could find no connection / and no evidence',
];
const SPANISH = [
  '- Luke Bryan vuelve / a interpretar / la canción que da título / a su nuevo álbum, *Signs*.',
  'que descubrí que estoy / mejor desde que te fuiste. / No quiero dar más / vueltas al tema.',
  'Debería estar triste, / pero no lo estoy. / Son las dos y media, / la hora de la cerveza fría.',
  'son lo único / que echaré de menos, cariño. / La soltería es / una droga de las buenas.',
  'Mantente conectado y reduce tu / factura móvil a la mitad con / Xfinity Mobile.',
  'A ESTA HORA EN DIRECTO USA. / >> ELLA VIENE DE SOMALIA. YA NO / TIENEN GOBIERNO, NO TIENEN / POLICÍA, NO TIENEN NADA.',
];
const FRENCH = [
  'Il pénètre en profondeur pour / lutter contre les odeurs tenaces / tout en diffusant / un parfum agréable.',
  "un maximum de témoignages. / Alors, qu'est-ce que / vous en dites? / Holmes? Vos impressions?",
];

test('caption language: real English, Spanish and French lines', () => {
  for (const t of ENGLISH) assert.equal(detectCaptionLanguage(t), 'en', t);
  for (const t of SPANISH) assert.equal(detectCaptionLanguage(t), 'es', t);
  for (const t of FRENCH) assert.equal(detectCaptionLanguage(t), 'fr', t);
});

test('caption language: too little to tell is unknown', () => {
  for (const t of ['OK', '>> YES', 'Holmes?', '♪ ♪', 'Xfinity Mobile.']) assert.equal(detectCaptionLanguage(t), 'unknown', t);
});

test('caption judge: a station name looping is junk (KUSA Denver field 2)', () => {
  assert.equal(judgeCaptionText('9NEWSKUSA9NEWSKUSA9NEWSKUSA9NEWS'), 'junk');
  assert.equal(judgeCaptionText('COUSCOUS AND BERIBERI'), 'ok');
});

test('caption check: the other language is skipped while the wanted one may come up', () => {
  const c = new CaptionCheck(8, 'en');
  for (const t of ['- Luke Bryan vuelve', '- Luke Bryan vuelve / a interpretar']) assert.equal(c.observe(t), 'none');
  assert.equal(c.observe('- Luke Bryan vuelve / a interpretar / la canción que da título'), 'retry');   // Spanish confirmed: flip again
  for (const t of ['- Performing the title', '- Performing the title track / from his']) assert.equal(c.observe(t), 'none');
  assert.equal(c.observe('- Performing the title track / from his new album Signs, once again'), 'ok');
});

test('caption check: if only the other language ever comes up, it is shown', () => {
  const c = new CaptionCheck(2, 'en');
  const spanish = (n: number) => [`Debería estar triste ${n},`, `Debería estar triste ${n}, / pero no lo estoy.`, `Debería estar triste ${n}, / pero no lo estoy. / Son las dos y media,`];
  for (let attempt = 0; attempt < 2; attempt++) {
    const lines = spanish(attempt);
    for (const t of lines.slice(0, 2)) c.observe(t);
    assert.equal(c.observe(lines[2]), 'retry');
    c.observe('');
  }
  const last = spanish(9);
  for (const t of last.slice(0, 2)) c.observe(t);
  assert.equal(c.observe(last[2]), 'other-language');
  assert.equal(c.state, 'other-language');
  assert.equal(c.language, 'es');
});

test('caption check: no preference takes any real captions', () => {
  const c = new CaptionCheck(8, null);
  for (const t of ['Debería estar triste,', 'Debería estar triste, / pero no']) assert.equal(c.observe(t), 'none');
  assert.equal(c.observe('Debería estar triste, / pero no lo estoy.'), 'ok');
});

test('caption check: short lines that do not say the language are read on until they do (WNBC, 2026-10-12)', () => {
  const c = new CaptionCheck(8, 'es');
  const lines = [
    'DTERM CONVENTION,', 'DTERM CONVENTION, PRESIDENT TR', 'PRESIDENT TRUMP SAID',
    'I DON’T KNOW WHY.', 'I DON’T KNOW WHY. ANYBODY KNOW WHY?', 'ANYBODY KNOW WHY? AND THE ANSWER IS',
  ];
  const actions = lines.map((t) => c.observe(t));
  assert.ok(!actions.includes('ok'), JSON.stringify(actions));    // never accepted as Spanish
  assert.ok(actions.includes('retry'), JSON.stringify(actions));  // English found: flip for Spanish
});

test('caption check: still unclear after 8 lines, the captions are let through', () => {
  const c = new CaptionCheck(8, 'es');
  const actions = ['OKAY OKAY', 'YEAH YEAH', 'NOPE NOPE', 'WOW WOW WOW', 'HEY HEY HEY', 'BOOM BOOM', 'ZAP ZAP ZAP', 'BAM BAM BAM'].map((t) => c.observe(t));
  assert.deepEqual(actions.slice(0, 7), ['none', 'none', 'none', 'none', 'none', 'none', 'none']);
  assert.equal(actions.at(-1), 'ok');
});
