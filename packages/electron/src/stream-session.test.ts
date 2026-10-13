import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamSession, parseCompatibilityHandoff } from './stream-session.js';

const NONE = { position: 0, duration: 0 };
const PLAYING = { position: 20, duration: 35 };

test('stream session: each load gets the next generation and its own resume point', () => {
  const s = new StreamSession();
  const a = s.begin({ url: 'http://a', startPosition: 125.7, live: false, reason: 'play' }, 0, NONE);
  assert.deepEqual(a, { generation: 1, resumeAt: 125 });
  assert.deepEqual(s.media, { url: 'http://a', startPosition: 125, live: false });
  const b = s.begin({ url: 'http://b', live: true, reason: 'play' }, 0, PLAYING);
  assert.deepEqual(b, { generation: 2, resumeAt: 0 });
  assert.equal(s.takeResume(3600), null);  // a's resume point does not land on b
});

test('stream session: the resume point is handed out once, after the duration is known', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', startPosition: 300, live: false, reason: 'play' }, 0, NONE);
  assert.equal(s.takeResume(0), null);
  assert.equal(s.takeResume(5400), 300);
  assert.equal(s.takeResume(5400), null);
});

test('stream session: a load clears the user pause; a recovery keeps the watchdog, a new load replaces it', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', live: true, reason: 'play' }, 0, NONE);
  const first = s.watchdog;
  s.userPaused = true;
  s.begin({ url: 'http://a', live: true, reason: 'reload' }, 0, PLAYING);
  assert.equal(s.userPaused, false);
  assert.equal(s.watchdog, first);
  s.begin({ url: 'http://b', live: true, reason: 'play' }, 0, PLAYING);
  assert.notEqual(s.watchdog, first);
});

test('stream session: end forgets the stream; invalidate also retires its generation', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', startPosition: 60, live: false, reason: 'play' }, 0, NONE);
  s.end();
  assert.equal(s.media, null);
  assert.equal(s.watchdog, null);
  assert.equal(s.takeResume(100), null);
  assert.ok(s.isCurrent(1));
  s.end({ invalidate: true });
  assert.ok(!s.isCurrent(1));
});

test('stream session: a movie reloads where it is, or where it was resuming if it never got there', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://m', startPosition: 1800, live: false, reason: 'play' }, 0, NONE);
  assert.deepEqual(s.reloadRequest(0), { url: 'http://m', startPosition: 1800, live: false, reason: 'reload' });
  assert.deepEqual(s.reloadRequest(2400.5), { url: 'http://m', startPosition: 2400.5, live: false, reason: 'reload' });
  s.begin({ url: 'http://live', live: true, reason: 'play' }, 0, PLAYING);
  assert.deepEqual(s.reloadRequest(37), { url: 'http://live', startPosition: undefined, live: true, reason: 'reload' });
  s.end();
  assert.equal(s.reloadRequest(10), null);
});

test('stream session: the compatibility handoff keeps whether it was live', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://live', live: true, reason: 'play' }, 0, NONE);
  assert.deepEqual(s.handoff(0), { url: 'http://live', position: 0, live: true });
  s.begin({ url: 'http://m', startPosition: 600, live: false, reason: 'play' }, 0, PLAYING);
  assert.deepEqual(s.handoff(0), { url: 'http://m', position: 600, live: false });
  assert.deepEqual(s.handoff(700), { url: 'http://m', position: 700, live: false });
});

test('compatibility handoff: read back with its live flag; one saved before it had one is a movie', () => {
  assert.deepEqual(parseCompatibilityHandoff({ url: 'http://live', position: 0, live: true }), { url: 'http://live', position: 0, live: true });
  assert.deepEqual(parseCompatibilityHandoff({ url: 'http://m', position: 12 }), { url: 'http://m', position: 12, live: false });
  assert.deepEqual(parseCompatibilityHandoff({ url: 'http://m', position: -3 }), { url: 'http://m', position: 0, live: false });
  for (const bad of [null, 'x', {}, { url: 5, position: 1 }, { url: 'http://m' }]) assert.equal(parseCompatibilityHandoff(bad), null);
});

test('stream session: after a load that never opened, the new file\'s numbers are not held back', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://dead', live: true, reason: 'play' }, 0, NONE);
  s.begin({ url: 'http://m', startPosition: 300, live: false, reason: 'play' }, 1000, NONE);
  assert.deepEqual(s.gate.pass({ position: 0, duration: 5400 }, 1200), { position: 0, duration: 5400 });
});

test('stream session: after a file that was playing, its numbers are held back until it unloads', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://m', live: false, reason: 'play' }, 0, PLAYING);
  assert.deepEqual(s.gate.pass(PLAYING, 100), NONE);
});
