import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdSingleInstance } from './single-instance.js';

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: (ms: number) => { t += ms; } };
}

test('the first copy on a profile runs, asking for the lock once', () => {
  let asks = 0;
  const run = holdSingleInstance({ argv: ['app'], requestLock: () => { asks++; return true; }, ...fakeClock() });
  assert.equal(run, true);
  assert.equal(asks, 1);
});

test('a second copy on the same profile gives up after the wait (the first one is focused instead)', () => {
  const clock = fakeClock();
  let asks = 0;
  const run = holdSingleInstance({ argv: ['app'], requestLock: () => { asks++; return false; }, waitMs: 10_000, stepMs: 250, ...clock });
  assert.equal(run, false);
  assert.ok(clock.now() >= 10_000, 'waited the whole time');
  assert.ok(asks > 1, 'kept asking');
});

test('a copy started while the old one is still quitting (the Linux updater, a restart) runs once the lock frees', () => {
  const clock = fakeClock();
  const run = holdSingleInstance({ argv: ['app'], requestLock: () => clock.now() >= 1_500, waitMs: 10_000, stepMs: 250, ...clock });
  assert.equal(run, true);
  assert.ok(clock.now() < 10_000);
});

test('dev runs never take the lock', () => {
  let asks = 0;
  const run = holdSingleInstance({ argv: ['electron', '.', '--dev'], requestLock: () => { asks++; return false; }, ...fakeClock() });
  assert.equal(run, true);
  assert.equal(asks, 0);
});
