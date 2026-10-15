import { describe, it, expect, beforeEach } from 'vitest';
import { useRewindStore } from './rewindStore';

describe('rewind store', () => {
  beforeEach(() => useRewindStore.getState().apply(null, 0));
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
  it('null clears', () => {
    useRewindStore.getState().apply({ generation: 1, rangeStart: 0, liveEdge: 10, bytesPerSecond: 1 }, 1_000);
    useRewindStore.getState().apply(null, 2_000);
    expect(useRewindStore.getState().state).toBeNull();
  });
});
