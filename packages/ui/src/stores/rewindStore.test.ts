import { describe, it, expect, beforeEach } from 'vitest';
import { useRewindStore } from './rewindStore';

describe('rewind store', () => {
  beforeEach(() => { useRewindStore.getState().apply(null, 0); useRewindStore.setState({ expectedGeneration: null }); });
  it('anchors once per load and re-anchors on a new one', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 10, bytesPerSecond: 1 }, 1_000);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 11, bytesPerSecond: 1 }, 2_000);
    expect(useRewindStore.getState().anchor).toEqual({ streamT: 10, wallMs: 1_000 });
    s.apply({ generation: 2, rangeStart: 0, liveEdge: 3, bytesPerSecond: 1 }, 5_000);
    expect(useRewindStore.getState().anchor).toEqual({ streamT: 3, wallMs: 5_000 });
  });
  it('tracks the live lag until the first seek, with a 3 s floor', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 20, bytesPerSecond: 1 }, 1_000, 0);      // not playing yet
    expect(useRewindStore.getState().lagS).toBe(3);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 30, bytesPerSecond: 1 }, 2_000, 18);
    expect(useRewindStore.getState().lagS).toBe(12);
    s.noteSeek();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 31, bytesPerSecond: 1 }, 3_000, 5);       // user rewound
    expect(useRewindStore.getState().lagS).toBe(12);
    s.apply({ generation: 2, rangeStart: 0, liveEdge: 4, bytesPerSecond: 1 }, 4_000, 3);        // new load
    expect(useRewindStore.getState().lagS).toBe(3);
  });
  it('a pause before any seek does not move the live point', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 30, bytesPerSecond: 1 }, 1_000, 18, true);
    expect(useRewindStore.getState().lagS).toBe(12);
    s.notePause();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 330, bytesPerSecond: 1 }, 301_000, 18, false);  // 5 min paused
    expect(useRewindStore.getState().lagS).toBe(12);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 331, bytesPerSecond: 1 }, 302_000, 19, true);   // resumed
    expect(useRewindStore.getState().lagS).toBe(12);
  });
  it('a stall (not playing) is not measured', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 30, bytesPerSecond: 1 }, 1_000, 18, true);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 40, bytesPerSecond: 1 }, 11_000, 18, false);
    expect(useRewindStore.getState().lagS).toBe(12);
  });
  it('stops measuring after 30 s of playing', () => {
    const s = useRewindStore.getState();
    for (let i = 0; i <= 30; i++) s.apply({ generation: 1, rangeStart: 0, liveEdge: 30 + i, bytesPerSecond: 1 }, 1_000 + i * 1000, 18 + i, true);
    expect(useRewindStore.getState().lagS).toBe(12);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 100, bytesPerSecond: 1 }, 32_000, 60, true);    // later drift
    expect(useRewindStore.getState().lagS).toBe(12);
  });
  it('ignores updates from a load that is no longer current', () => {
    const s = useRewindStore.getState();
    s.beginLoad(2);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 30, bytesPerSecond: 1 }, 1_000, 18, true);
    expect(useRewindStore.getState().state).toBeNull();
    s.apply({ generation: 2, rangeStart: 0, liveEdge: 5, bytesPerSecond: 1 }, 1_000, 2, true);
    expect(useRewindStore.getState().state?.generation).toBe(2);
  });
  it('re-anchors when the stream clock jumps (encoder restart)', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 100, bytesPerSecond: 1 }, 1_000, 90, true);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 5_000, bytesPerSecond: 1 }, 2_000, 4_990, true); // +4900 s in 1 s
    expect(useRewindStore.getState().anchor).toEqual({ streamT: 5_000, wallMs: 2_000 });
  });
  it('a burst in the reported edge does not move the clock anchor', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 100, bytesPerSecond: 1 }, 0, 90, true);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 104, bytesPerSecond: 1 }, 1_000, 91, true);   // +3 s burst
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 102, bytesPerSecond: 1 }, 2_000, 92, true);   // back in step
    expect(useRewindStore.getState().anchor).toEqual({ streamT: 100, wallMs: 0 });
  });
  it('a drift that persists for 3 reports re-anchors', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 100, bytesPerSecond: 1 }, 0, 90, true);
    for (let i = 1; i <= 3; i++) s.apply({ generation: 1, rangeStart: 0, liveEdge: 100 + i + 6, bytesPerSecond: 1 }, i * 1000, 90 + i, true);
    expect(useRewindStore.getState().anchor).toEqual({ streamT: 109, wallMs: 3_000 });
  });
  it('at live until the user pauses or seeks back; seeking up to live is live again', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 30, bytesPerSecond: 1 }, 1_000, 18, true);
    expect(useRewindStore.getState().atLive).toBe(true);
    s.noteSeek(10);                                   // back 8 s
    expect(useRewindStore.getState().atLive).toBe(false);
    s.noteSeek(18);                                   // the live point (edge 30 - lag 12)
    expect(useRewindStore.getState().atLive).toBe(true);
    s.notePause();
    expect(useRewindStore.getState().atLive).toBe(false);
    s.apply({ generation: 2, rangeStart: 0, liveEdge: 5, bytesPerSecond: 1 }, 9_000, 2, true);  // new load
    expect(useRewindStore.getState().atLive).toBe(true);
  });
  it('smooths the channel rate across reports', () => {
    const s = useRewindStore.getState();
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 100, bytesPerSecond: 500_000 }, 0, 90, true);
    expect(useRewindStore.getState().rateBps).toBe(500_000);
    s.apply({ generation: 1, rangeStart: 0, liveEdge: 101, bytesPerSecond: 600_000 }, 1_000, 91, true);
    expect(useRewindStore.getState().rateBps).toBe(510_000);              // 10 % of the new reading
  });
  it('null clears', () => {
    useRewindStore.getState().apply({ generation: 1, rangeStart: 0, liveEdge: 10, bytesPerSecond: 1 }, 1_000);
    useRewindStore.getState().apply(null, 2_000);
    expect(useRewindStore.getState().state).toBeNull();
  });
});
