import { describe, it, expect } from 'vitest';
import { FramePacer } from './framePacer';

const REFRESH = 1000 / 60;

/**
 * Drive a pacer with arrival times (ms) on a 60Hz refresh and return the
 * times frames were presented plus the pacer.
 */
function simulate(arrivals: number[], options = {}) {
  const pacer = new FramePacer<number>(options);
  const presented: { frame: number; at: number }[] = [];
  const lastArrival = arrivals[arrivals.length - 1];
  const end = lastArrival + 1000;
  // Underruns while frames are still arriving; the queue emptying after the
  // last frame is the end of the stream, not a stall.
  const underrunTimes: number[] = [];
  let next = 0;
  for (let now = 0; now <= end; now += REFRESH) {
    while (next < arrivals.length && arrivals[next] <= now) {
      pacer.push(next, arrivals[next]);
      next++;
    }
    const before = pacer.underruns;
    const frame = pacer.tick(now, REFRESH);
    if (pacer.underruns > before && now <= lastArrival) underrunTimes.push(Math.round(now));
    if (frame !== null) presented.push({ frame, at: now });
  }
  return { pacer, presented, underrunTimes };
}

function steady(count: number, interval = 40, start = 0): number[] {
  return Array.from({ length: count }, (_, i) => start + i * interval);
}

describe('FramePacer', () => {
  it('waits for targetDepth frames before presenting', () => {
    const pacer = new FramePacer<number>();
    pacer.push(0, 0);
    pacer.push(1, 40);
    pacer.push(2, 80);
    expect(pacer.tick(90, REFRESH)).toBeNull();
    pacer.push(3, 120);
    expect(pacer.tick(130, REFRESH)).toBe(0);
  });

  it('presents a steady stream in order, without underruns or skips', () => {
    const { pacer, presented, underrunTimes } = simulate(steady(250));
    expect(presented.map((p) => p.frame)).toEqual(Array.from({ length: 250 }, (_, i) => i));
    expect(underrunTimes).toEqual([]);
    expect(pacer.skipped).toBe(0);
    const intervals = presented.slice(10).map((p, i, list) => (i === 0 ? 40 : p.at - list[i - 1].at));
    // 25 fps on a 60Hz display: each frame shows for 2 or 3 refreshes.
    for (const gap of intervals.slice(1)) expect(gap).toBeGreaterThan(REFRESH * 1.5);
    for (const gap of intervals.slice(1)) expect(gap).toBeLessThan(REFRESH * 3.5);
  });

  it('absorbs late frames like the tester log (arrivals up to 145ms apart) without an underrun', () => {
    // Steady 40ms arrivals, but every ~2s one frame is late by 30-105ms and the
    // next follows right behind it (the total stays on schedule).
    const arrivals = steady(500);
    const lateness = [30, 45, 60, 80, 105, 70, 40, 95];
    for (let i = 0; i < lateness.length; i++) {
      const at = 40 + i * 55;
      arrivals[at] += lateness[i];
      arrivals[at + 1] = Math.max(arrivals[at + 1], arrivals[at] + 1);
    }
    const { pacer, presented, underrunTimes } = simulate(arrivals);
    expect(underrunTimes).toEqual([]);
    expect(pacer.skipped).toBe(0);
    expect(presented).toHaveLength(500);
    const gaps = presented.slice(5).map((p, i, list) => (i === 0 ? 40 : p.at - list[i - 1].at));
    expect(Math.max(...gaps)).toBeLessThan(REFRESH * 3.5);
  });

  it('adds about (targetDepth - 1) frames of delay once settled', () => {
    const arrivals = steady(250);
    const { presented } = simulate(arrivals);
    const settled = presented.slice(100, 200).map((p) => p.at - arrivals[p.frame]);
    const average = settled.reduce((sum, value) => sum + value, 0) / settled.length;
    expect(average).toBeGreaterThan(100);
    expect(average).toBeLessThan(150);
  });

  it('drains a burst instead of keeping the extra delay', () => {
    // A 400ms stall, then the backlog arrives at once.
    const arrivals = steady(300);
    for (let i = 100; i < 110; i++) arrivals[i] = arrivals[110] - (110 - i);
    const { presented } = simulate(arrivals);
    const delayAfter = presented.filter((p) => p.frame > 250).map((p) => p.at - arrivals[p.frame]);
    const average = delayAfter.reduce((sum, value) => sum + value, 0) / delayAfter.length;
    expect(average).toBeLessThan(150);
  });

  it('re-primes after an underrun and skips beyond maxDepth', () => {
    const pacer = new FramePacer<number>({ targetDepth: 2, maxDepth: 3 });
    pacer.push(0, 0);
    pacer.push(1, 40);
    expect(pacer.tick(40, REFRESH)).toBe(0);
    expect(pacer.tick(80, REFRESH)).toBe(1);
    expect(pacer.tick(120, REFRESH)).toBeNull();
    expect(pacer.underruns).toBe(1);
    expect(pacer.push(2, 500)).toEqual([]);
    expect(pacer.tick(510, REFRESH)).toBeNull();
    pacer.push(3, 501);
    pacer.push(4, 502);
    expect(pacer.push(5, 503)).toEqual([2]);
    expect(pacer.skipped).toBe(1);
    expect(pacer.reset()).toEqual([3, 4, 5]);
    expect(pacer.depth).toBe(0);
  });

  it('starts a 60 fps stream at its own rate, without skipping frames', () => {
    const { pacer, underrunTimes } = simulate(steady(180, 1000 / 60));
    expect(pacer.intervalMs).toBeGreaterThan(15);
    expect(pacer.intervalMs).toBeLessThan(18.5);
    expect(pacer.skipped).toBe(0);
    expect(underrunTimes).toEqual([]);
  });

  it('measures each stream afresh after reset', () => {
    const pacer = new FramePacer<number>();
    for (let i = 0; i < 60; i++) pacer.push(i, i * (1000 / 60));
    pacer.reset();
    expect(pacer.intervalMs).toBe(40);
    for (let i = 0; i < 4; i++) pacer.push(i, 1000 + i * 40);
    expect(pacer.intervalMs).toBeCloseTo(40, 5);
  });

  it('shows a lone frame (a seek while paused) once it has waited longer than a full queue', () => {
    const pacer = new FramePacer<number>();
    pacer.push(7, 1000);
    expect(pacer.tick(1050, REFRESH)).toBeNull(); // still priming
    expect(pacer.tick(1000 + 4 * 40 + 1, REFRESH)).toBe(7);
  });
});
