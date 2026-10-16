import { describe, it, expect } from 'vitest';
import { anchorFor, wallAt, rewindBar, pillText, estimateText, presetsUnderCap, stepCustomGb, liveTarget, shouldShowRewindTip, clampToReach, liveEdgeAt } from './rewindModel';

const GIB = 1024 ** 3;
const MIN = 60_000;
// Show 8:00-9:00; tuned in at 8:20; now 8:35 (stream t: 0 at 8:20, live edge 900 s).
const t0 = Date.UTC(2026, 9, 15, 20, 0);
const state = { generation: 1, rangeStart: 0, liveEdge: 900, bytesPerSecond: 625_000 };
const anchor = anchorFor(state, t0 + 35 * MIN);

describe('clock anchor', () => {
  it('maps the live edge to now and earlier stream times to earlier clock times', () => {
    expect(wallAt(anchor, 900)).toBe(t0 + 35 * MIN);
    expect(wallAt(anchor, 0)).toBe(t0 + 20 * MIN);
  });
});

describe('rewind bar', () => {
  it('tuned in late: dotted before 8:20, tint to live, playhead 4 min behind', () => {
    const bar = rewindBar({ state, anchor, position: 660, program: { startMs: t0, endMs: t0 + 60 * MIN } });
    expect(bar.gonePct).toBeCloseTo(33.33, 1);
    expect(bar.tintFrom).toBeCloseTo(33.33, 1);
    expect(bar.tintTo).toBeCloseTo(58.33, 1);
    expect(bar.edgePct).toBeCloseTo(58.33, 1);
    expect(bar.headPct).toBeCloseTo(51.67, 1);
    expect(bar.reachesEarlierShow).toBe(false);
    expect(bar.spansBuffer).toBe(false);
  });
  it('buffer reaching into the previous show: no dotted part, marker on', () => {
    const early = { ...state, rangeStart: 0, liveEdge: 3000 };   // 8:35 live, range from 7:45
    const a = anchorFor(early, t0 + 35 * MIN);
    const bar = rewindBar({ state: early, anchor: a, position: 3000, program: { startMs: t0, endMs: t0 + 60 * MIN } });
    expect(bar.gonePct).toBe(0);
    expect(bar.reachesEarlierShow).toBe(true);
  });
  it('no guide data: the bar spans the buffer itself', () => {
    const bar = rewindBar({ state, anchor, position: 450, program: null });
    expect(bar.spansBuffer).toBe(true);
    expect(bar.gonePct).toBe(0);
    expect(bar.tintFrom).toBe(0);
    expect(bar.edgePct).toBe(100);
    expect(bar.headPct).toBeCloseTo(50, 1);
  });
});

describe('pill', () => {
  it('is LIVE within 3 s of the edge, else shows the distance', () => {
    expect(pillText(state, 899)).toEqual({ live: true, text: 'LIVE' });
    expect(pillText(state, 900 - 252)).toEqual({ live: false, text: '−4:12 · LIVE' });
    expect(pillText({ ...state, liveEdge: 5000 }, 5000 - 3725)).toEqual({ live: false, text: '−1:02:05 · LIVE' });
  });
});

describe('size text and choices', () => {
  it('estimates in whole minutes at 5 and 20 Mbps, for the half of the size that is stream data', () => {
    expect(estimateText(512 * 1024 ** 2)).toBe('About 7 min of an HD channel, or 1 min of 4K.');
    expect(estimateText(3.5 * GIB)).toBe('About 50 min of an HD channel, or 12 min of 4K.');
    expect(estimateText(2 * GIB, 400_000)).toBe('About 44 min on this channel.');
  });
  it('hides presets above the cap', () => {
    expect(presetsUnderCap(2 * GIB).map((p) => p.id)).toEqual(['512', '2048']);
    expect(presetsUnderCap(16 * GIB).map((p) => p.id)).toEqual(['512', '2048', '8192']);
  });
  it('custom: 0.5 GB steps, at least 0.5, at most the cap', () => {
    expect(stepCustomGb(3.7, 16 * GIB)).toBe(3.5);
    expect(stepCustomGb(0.1, 16 * GIB)).toBe(0.5);
    expect(stepCustomGb(40, 16 * GIB)).toBe(16);
  });
});

describe('live lag (mpv plays a cushion behind the newest data)', () => {
  it('pill: LIVE when within 3 s of edge minus lag', () => {
    expect(pillText(state, 900 - 12, 11)).toEqual({ live: true, text: 'LIVE' });
    expect(pillText(state, 900 - 11 - 30, 11)).toEqual({ live: false, text: '−0:30 · LIVE' });
  });
  it('the live target keeps the cushion and never goes before the range', () => {
    expect(liveTarget(state, 11)).toBe(889);
    expect(liveTarget({ ...state, liveEdge: 5 }, 11)).toBe(0);
  });
  it('the bar ends the reachable stretch at the live point', () => {
    const bar = rewindBar({ state, anchor, position: 889, program: { startMs: t0, endMs: t0 + 60 * MIN }, lagS: 60 });
    expect(bar.edgePct).toBeCloseTo(56.67, 1);   // 8:34
    expect(bar.tintTo).toBeCloseTo(56.67, 1);
  });
});

describe('one-time rewind tip', () => {
  const base = { pausingLive: true, rewindBytes: 0, tipShown: false };
  it('shows on the first pause of live TV with rewind off', () => {
    expect(shouldShowRewindTip(base)).toBe(true);
  });
  it('never when shown before, rewind is on, or it is not live being paused', () => {
    expect(shouldShowRewindTip({ ...base, tipShown: true })).toBe(false);
    expect(shouldShowRewindTip({ ...base, rewindBytes: 512 * 1024 ** 2 })).toBe(false);
    expect(shouldShowRewindTip({ ...base, pausingLive: false })).toBe(false);
  });
});

describe('dragging the playhead', () => {
  const bar = { tintFrom: 30, tintTo: 60 } as Parameters<typeof clampToReach>[1];
  it('stays inside the reachable stretch', () => {
    expect(clampToReach(10, bar)).toBe(30);
    expect(clampToReach(45, bar)).toBe(45);
    expect(clampToReach(90, bar)).toBe(60);
  });
});

describe('live edge between reports', () => {
  const a = { streamT: 100, wallMs: 0 };
  it('advances with the clock, so the distance behind stays steady', () => {
    expect(liveEdgeAt({ ...state, liveEdge: 100 }, a, 500)).toBeCloseTo(100.5);
    expect(liveEdgeAt({ ...state, liveEdge: 101.3 }, a, 1000)).toBeCloseTo(101);   // a burst arrived early: still the clock
  });
  it('never strays more than 5 s from what mpv reports', () => {
    expect(liveEdgeAt({ ...state, liveEdge: 100 }, a, 10_000)).toBe(105);          // stream stalled: don't run ahead
    expect(liveEdgeAt({ ...state, liveEdge: 120 }, a, 10_000)).toBe(115);          // stream clock faster than the wall
  });
});

describe('pill at live', () => {
  it('says LIVE while at live, whatever the measured distance', () => {
    expect(pillText(state, 900 - 20, 12, true)).toEqual({ live: true, text: 'LIVE' });
  });
  it('counts once behind, and is LIVE again within 2 s of the live point', () => {
    expect(pillText(state, 900 - 12 - 30, 12, false)).toEqual({ live: false, text: '−0:30 · LIVE' });
    expect(pillText(state, 900 - 12 - 1.5, 12, false)).toEqual({ live: true, text: 'LIVE' });
  });
});
