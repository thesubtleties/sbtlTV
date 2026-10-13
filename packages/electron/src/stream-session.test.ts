import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamSession } from './stream-session.js';

test('stream session: each load gets the next generation and its own resume point', () => {
  const s = new StreamSession();
  const a = s.begin({ url: 'http://a', startPosition: 125.7, live: false }, 0, false);
  assert.deepEqual(a, { generation: 1, resumeAt: 125 });
  assert.deepEqual(s.media, { url: 'http://a', startPosition: 125, live: false });
  const b = s.begin({ url: 'http://b', live: true }, 0, true);
  assert.deepEqual(b, { generation: 2, resumeAt: 0 });
  assert.equal(s.takeResume(3600), null);  // a's resume point does not land on b
});

test('stream session: the resume point is handed out once, after the duration is known', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', startPosition: 300, live: false }, 0, false);
  assert.equal(s.takeResume(0), null);
  assert.equal(s.takeResume(5400), 300);
  assert.equal(s.takeResume(5400), null);
});

test('stream session: a load clears the user pause; a recovery keeps the watchdog, a new load replaces it', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', live: true }, 0, false);
  const first = s.watchdog;
  s.userPaused = true;
  s.begin({ url: 'http://a', live: true, recovery: true }, 0, true);
  assert.equal(s.userPaused, false);
  assert.equal(s.watchdog, first);
  s.begin({ url: 'http://b', live: true }, 0, true);
  assert.notEqual(s.watchdog, first);
});

test('stream session: end forgets the stream; invalidate also retires its generation', () => {
  const s = new StreamSession();
  s.begin({ url: 'http://a', startPosition: 60, live: false }, 0, false);
  s.end();
  assert.equal(s.media, null);
  assert.equal(s.watchdog, null);
  assert.equal(s.takeResume(100), null);
  assert.ok(s.isCurrent(1));
  s.end({ invalidate: true });
  assert.ok(!s.isCurrent(1));
});
