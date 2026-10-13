import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StallWatchdog, STREAM_RECONNECT_OPTIONS } from './stream-health.js';

// One tick per second, like main's timer.
function run(w: StallWatchdog, ticks: Array<{ t: number; pos: number; paused?: boolean; duration?: number }>) {
  return ticks.map(({ t, pos, paused = false, duration = 0 }) => w.observe({ now: t * 1000, position: pos, userPaused: paused, duration }));
}

test('ffmpeg reconnects cut HTTP streams, live included', () => {
  assert.equal(STREAM_RECONNECT_OPTIONS, 'reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=4');
});

test('a playing stream is left alone', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, Array.from({ length: 40 }, (_, i) => ({ t: i, pos: i })));
  assert.ok(actions.every((a) => a === 'none'));
});

test('a live stream stuck for 15s is reloaded', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, [{ t: 0, pos: 5 }, ...Array.from({ length: 16 }, (_, i) => ({ t: i + 1, pos: 5 }))]);
  assert.equal(actions.indexOf('reload'), 15);
  assert.equal(actions.filter((a) => a === 'reload').length, 1);
});

test('the user pausing is not a stall', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, Array.from({ length: 60 }, (_, i) => ({ t: i, pos: 5, paused: true })));
  assert.ok(actions.every((a) => a === 'none'));
});

test('a movie at its end is not a stall', () => {
  const w = new StallWatchdog({ live: false });
  const actions = run(w, Array.from({ length: 30 }, (_, i) => ({ t: i, pos: 5999, duration: 6000 })));
  assert.ok(actions.every((a) => a === 'none'));
});

test('after three reloads that do not help it gives up once', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, Array.from({ length: 80 }, (_, i) => ({ t: i, pos: 5 })));
  assert.equal(actions.filter((a) => a === 'reload').length, 3);
  assert.equal(actions.filter((a) => a === 'give-up').length, 1);
  assert.equal(actions.at(-1), 'none');
});

test('a reload that brings playback back for a while restores the budget', () => {
  const w = new StallWatchdog({ live: true });
  let t = 0;
  const stall = () => run(w, Array.from({ length: 16 }, () => ({ t: t++, pos: 5 })));
  const play = (secs: number) => run(w, Array.from({ length: secs }, (_, i) => ({ t: t++, pos: 100 + t + i })));
  for (let i = 0; i < 5; i++) { stall(); play(40); }
  assert.equal(w.reloads, 0);
});
