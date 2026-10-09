import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { StatusThrottle } from './status-throttle.js';

interface Status { playing: boolean; position: number }

function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sent: Status[] = [];
  const throttle = new StatusThrottle<Status>(
    (status) => sent.push(status),
    (previous, next) => previous.playing !== next.playing,
    100,
  );
  return { sent, throttle };
}

test('position ticks are capped but the last one is always delivered', () => {
  const { sent, throttle } = setup();
  try {
    throttle.push({ playing: true, position: 1.00 });
    mock.timers.tick(40);
    throttle.push({ playing: true, position: 1.04 });
    mock.timers.tick(40);
    throttle.push({ playing: true, position: 1.08 });
    assert.deepEqual(sent.map((status) => status.position), [1.00]);
    mock.timers.tick(20); // interval ends: the latest held-back tick goes out
    assert.deepEqual(sent.map((status) => status.position), [1.00, 1.08]);
  } finally {
    mock.timers.reset();
  }
});

test('a discrete change goes out immediately and cancels the held-back tick', () => {
  const { sent, throttle } = setup();
  try {
    throttle.push({ playing: true, position: 5 });
    mock.timers.tick(30);
    throttle.push({ playing: true, position: 5.03 });
    throttle.push({ playing: false, position: 5.04 }); // pause right after a tick
    assert.deepEqual(sent, [{ playing: true, position: 5 }, { playing: false, position: 5.04 }]);
    mock.timers.tick(200);
    assert.equal(sent.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a seek while paused is delivered even when it lands inside the interval', () => {
  const { sent, throttle } = setup();
  try {
    throttle.push({ playing: false, position: 10 });
    mock.timers.tick(50);
    throttle.push({ playing: false, position: 70 }); // the only update mpv sends for this seek
    mock.timers.tick(50);
    assert.deepEqual(sent.at(-1), { playing: false, position: 70 });
  } finally {
    mock.timers.reset();
  }
});

test('reset cancels a pending send', () => {
  const { sent, throttle } = setup();
  try {
    throttle.push({ playing: true, position: 1 });
    throttle.push({ playing: true, position: 1.04 });
    throttle.reset();
    mock.timers.tick(500);
    assert.equal(sent.length, 1);
  } finally {
    mock.timers.reset();
  }
});
