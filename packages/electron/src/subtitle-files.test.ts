import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSubtitle, sniffFormat, parseCues, isSoundCue, timingCheck, solveSync } from './subtitle-files.js';

const SRT = '1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> there.\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\n[MUSIC]\r\n\r\n3\r\n01:30:00,000 --> 01:30:03,000\r\n- Bye.\r\n- Bye!\r\n';
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500 align:start\nHello there.\n\n00:01.000 --> 00:02.000\nShort form.\n';
const ASS = '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Hello{\\i0}, there.\\NSecond line\nComment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,not shown\n';

test('decode: UTF-8 with BOM, UTF-16LE BOM, CP-1252 fallback', () => {
  assert.equal(decodeSubtitle(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])), 'Hi');
  assert.equal(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])), 'Hi');
  assert.equal(decodeSubtitle(new Uint8Array([0x43, 0x61, 0x66, 0xe9])), 'Café');
});

test('sniff by content, not name; HTML, zip and empty are rejected', () => {
  assert.equal(sniffFormat(SRT), 'srt');
  assert.equal(sniffFormat(VTT), 'vtt');
  assert.equal(sniffFormat(ASS), 'ass');
  assert.equal(sniffFormat('﻿' + SRT), 'srt');
  assert.equal(sniffFormat('<!DOCTYPE html><html>Error</html>'), null);
  assert.equal(sniffFormat('{"status":false,"error":"subtitle_not_found"}'), null);
  assert.equal(sniffFormat(''), null);
  assert.equal(sniffFormat('PK\u0003\u0004binary'), null);
});

test('parse SRT: tags stripped, CRLF handled, multi-line kept', () => {
  const cues = parseCues(SRT, 'srt');
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 1, end: 2.5, text: 'Hello there.' });
  assert.equal(cues[2].text, '- Bye.\n- Bye!');
});

test('parse VTT with settings and short timestamps', () => {
  const cues = parseCues(VTT, 'vtt');
  assert.deepEqual(cues.map((c) => c.start), [1, 1]);
  assert.equal(cues[0].text, 'Hello there.');
});

test('parse ASS: Dialogue only, override tags and \\N handled', () => {
  const cues = parseCues(ASS, 'ass');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 2.5);
  assert.equal(cues[0].text, 'Hello, there.\nSecond line');
});

test('sound cues', () => {
  for (const t of ['[MUSIC]', '(laughs)', '♪ la la la ♪', '♪♪', 'JOHN:', '[door slams]\n(sighs)', '']) assert.equal(isSoundCue(t), true, t);
  for (const t of ['Hello.', '[whispering] Get down!', 'JOHN: Get down!']) assert.equal(isSoundCue(t), false, t);
});

test('timing: 25 fps subtitle on a 23.976 fps video is too long by 25/23.976', () => {
  const D = 6000;
  const cues = [{ start: 10, end: 12, text: 'a' }, { start: D * (25 / 23.976) - 30, end: D * (25 / 23.976) - 28, text: 'b' }];
  const t = timingCheck(cues, D);
  assert.ok(t.speed !== null && Math.abs(t.speed - 23.976 / 25) < 1e-6);
  assert.deepEqual(t.fps, { from: 25, to: 23.976 });
  assert.equal(t.cutMismatch, false);
});

test('timing: normal file (credits after last line) is left alone', () => {
  const t = timingCheck([{ start: 5, end: 6, text: 'a' }, { start: 5600, end: 5603, text: 'b' }], 6000);
  assert.deepEqual(t, { speed: null, fps: null, cutMismatch: false });
});

test('timing: far past the end or far too short = different cut', () => {
  assert.equal(timingCheck([{ start: 5, end: 6, text: 'a' }, { start: 7000, end: 7002, text: 'b' }], 6000).cutMismatch, true);
  assert.equal(timingCheck([{ start: 5, end: 6, text: 'a' }, { start: 3000, end: 3002, text: 'b' }], 6000).cutMismatch, true);
  assert.equal(timingCheck([], 6000).cutMismatch, false);
  assert.equal(timingCheck([{ start: 5, end: 6, text: 'a' }], 0).cutMismatch, false);
});

test('sync: one point sets the delay at the current speed', () => {
  assert.deepEqual(solveSync([{ cueStart: 100, at: 103.5 }], 1), { delay: 3.5, speed: 1 });
  const r = solveSync([{ cueStart: 100, at: 99 }], 0.95904);
  assert.equal(r.speed, 0.95904);
  assert.ok(Math.abs(r.delay - (99 - 95.904)) < 1e-9);
});

test('sync: two points far apart solve speed and delay', () => {
  const r = solveSync([{ cueStart: 100, at: 100 * 0.95904 + 2 }, { cueStart: 3000, at: 3000 * 0.95904 + 2 }], 1);
  assert.ok(Math.abs(r.speed - 0.95904) < 1e-6);
  assert.ok(Math.abs(r.delay - 2) < 1e-6);
});

test('sync: two points too close, or an absurd speed, only set the delay', () => {
  assert.deepEqual(solveSync([{ cueStart: 100, at: 101 }, { cueStart: 130, at: 140 }], 1), { delay: 10, speed: 1 });
  assert.deepEqual(solveSync([{ cueStart: 100, at: 100 }, { cueStart: 1000, at: 2000 }], 1), { delay: 1000, speed: 1 });
});

// Review (PR #146, finding 1): a non-UTF-8 file is decoded with the code page
// of its language, not always Windows-1252. The language goes in as a second
// argument (cast so this compiles before the signature changes).

test('decode: CP-1251 Russian file is read as Cyrillic when the language is ru', () => {
  // "Привет" in Windows-1251
  const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  assert.equal(decodeSubtitle(bytes, 'ru'), 'Привет');
});

test('decode: CP-1256 Arabic file is read as Arabic when the language is ar', () => {
  // "سلام" in Windows-1256
  const bytes = new Uint8Array([0xd3, 0xe1, 0xc7, 0xe3]);
  assert.equal(decodeSubtitle(bytes, 'ar'), 'سلام');
});

test('decode: Western languages keep the CP-1252 fallback', () => {
  assert.equal(decodeSubtitle(new Uint8Array([0x43, 0x61, 0x66, 0xe9]), 'fr'), 'Café');
});
