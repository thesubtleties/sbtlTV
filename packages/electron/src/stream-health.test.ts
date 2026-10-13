import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StallWatchdog, STREAM_RECONNECT_OPTIONS, STREAM_BASE_OPTIONS, LoadStatusGate } from './stream-health.js';

// One tick per second, like main's timer.
// playing: mpv's own pause is off; eof: mpv stopped at the end of what it could read (keep-open).
interface Tick { t: number; pos: number; paused?: boolean; duration?: number; playing?: boolean; eof?: boolean }
function run(w: StallWatchdog, ticks: Tick[]) {
  return ticks.map(({ t, pos, paused = false, duration = 0, playing = !paused, eof = false }) =>
    w.observe({ now: t * 1000, position: pos, userPaused: paused, duration, playing, eof }));
}
const span = (from: number, count: number, tick: (t: number) => Omit<Tick, 't'>): Tick[] =>
  Array.from({ length: count }, (_, i) => ({ t: from + i, ...tick(from + i) }));
const reloadsIn = (actions: string[]) => actions.filter((a) => a === 'reload').length;

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

test('both players get reconnect and no youtube-dl hook', () => {
  assert.deepEqual(STREAM_BASE_OPTIONS, [['stream-lavf-o', STREAM_RECONNECT_OPTIONS], ['ytdl', 'no']]);
});

test('recovering: from the first reload until playback moves again, never after giving up', () => {
  const w = new StallWatchdog({ live: true });
  let t = 0;
  const tick = (pos: number) => w.observe({ now: (t++) * 1000, position: pos, userPaused: false, duration: 0, playing: true, eof: false });
  for (let i = 0; i < 16; i++) tick(5);
  assert.equal(w.recovering, true);          // reloaded once, still stuck
  tick(6); tick(7);
  assert.equal(w.recovering, false);         // moving again
  for (let i = 0; i < 70; i++) tick(7);
  assert.equal(w.recovering, false);         // gave up: the final message may show
});


test('after a load, the old file\'s numbers are held back until it unloads', () => {
  const g = new LoadStatusGate();
  g.begin(0, true);  // something was playing
  // CNN keeps reporting for half a second after Obsession's loadfile (2026-10-12 trace)
  assert.deepEqual(g.pass({ position: 19.7, duration: 32.7 }, 2), { position: 0, duration: 0 });
  assert.deepEqual(g.pass({ position: 20.1, duration: 35.4 }, 357), { position: 0, duration: 0 });
  assert.deepEqual(g.pass({ position: 0, duration: 35.4 }, 456), { position: 0, duration: 0 });
  assert.deepEqual(g.pass({ position: 0, duration: 0 }, 551), { position: 0, duration: 0 });   // unloaded
  assert.deepEqual(g.pass({ position: 0, duration: 6533.2 }, 3757), { position: 0, duration: 6533.2 });
  assert.deepEqual(g.pass({ position: 300, duration: 6533.2 }, 3860), { position: 300, duration: 6533.2 });
});

test('nothing was playing: the first numbers are the new file\'s', () => {
  const g = new LoadStatusGate();
  g.begin(0, false);
  assert.deepEqual(g.pass({ position: 0, duration: 6533.2 }, 10), { position: 0, duration: 6533.2 });
});

test('if the unload is never seen, numbers flow again after 3s', () => {
  const g = new LoadStatusGate();
  g.begin(0, true);
  assert.deepEqual(g.pass({ position: 5, duration: 40 }, 2999), { position: 0, duration: 0 });
  assert.deepEqual(g.pass({ position: 5, duration: 40 }, 3001), { position: 5, duration: 40 });
});

test('a movie whose real end comes before its duration is not a stall (mpv stops there, keep-open)', () => {
  const w = new StallWatchdog({ live: false });
  const actions = run(w, [...span(0, 5, (t) => ({ pos: 5930 + t, duration: 6000 })), ...span(5, 60, () => ({ pos: 5935, duration: 6000, playing: false, eof: true }))]);
  assert.equal(reloadsIn(actions), 0);
});

test('a movie that stops at the end of what could be read, far from its end, is reloaded', () => {
  const w = new StallWatchdog({ live: false });
  const actions = run(w, [...span(0, 5, (t) => ({ pos: 1000 + t, duration: 6000 })), ...span(5, 20, () => ({ pos: 1005, duration: 6000, playing: false, eof: true }))]);
  assert.equal(reloadsIn(actions), 1);
});

test('a live stream that ended (provider cut that could not reconnect) is reloaded', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, [...span(0, 5, (t) => ({ pos: t })), ...span(5, 20, () => ({ pos: 5, playing: false, eof: true }))]);
  assert.equal(reloadsIn(actions), 1);
});

test('mpv paused by something other than the app (system suspend, the compatibility window) is not a stall', () => {
  const w = new StallWatchdog({ live: true });
  const actions = run(w, [
    ...span(0, 5, (t) => ({ pos: t })),
    ...span(5, 120, () => ({ pos: 5, playing: false })),       // paused for two minutes
    ...span(125, 10, () => ({ pos: 5 })),                       // playing again, not moving yet: 15s from here
  ]);
  assert.equal(reloadsIn(actions), 0);
});

test('a movie that takes a while to open gets 45s before it is reloaded', () => {
  const slow = new StallWatchdog({ live: false });
  assert.equal(reloadsIn(run(slow, [...span(0, 40, () => ({ pos: 0 })), ...span(40, 30, (t) => ({ pos: t - 40, duration: 6000 }))])), 0);
  const dead = new StallWatchdog({ live: false });
  const actions = run(dead, span(0, 50, () => ({ pos: 0 })));
  assert.equal(actions.indexOf('reload'), 45);
});

test('after a reload, the held-back 0 and the resume seek are not playback coming back', () => {
  const w = new StallWatchdog({ live: false });
  const actions = run(w, [...span(0, 5, (t) => ({ pos: 1229 + t, duration: 6000 })), ...span(5, 16, () => ({ pos: 1234, duration: 6000 }))]);
  assert.equal(reloadsIn(actions), 1);
  assert.equal(w.recovering, true);
  run(w, [...span(21, 3, () => ({ pos: 0, duration: 0 })), ...span(24, 5, () => ({ pos: 1234, duration: 6000 }))]);
  assert.equal(w.recovering, true);
  run(w, span(29, 3, (t) => ({ pos: 1234 + (t - 28), duration: 6000 })));
  assert.equal(w.recovering, false);
});
