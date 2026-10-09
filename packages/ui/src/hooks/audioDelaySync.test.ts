import { describe, expect, it } from 'vitest';
import { createAudioDelayState, isCleanWindow, nextAudioDelay } from './audioDelaySync';

describe('nextAudioDelay', () => {
  it('sets the first delay from the first full window, at any frame rate', () => {
    const state = createAudioDelayState();
    expect(nextAudioDelay(state, 70, 10)).toBeNull(); // too few frames yet
    expect(nextAudioDelay(state, 72, 110)).toBe(72); // 60 fps stream: ~70ms, not a 25 fps guess
    expect(state.reported).toBe(72);
  });

  it('ignores small wobble around the reported delay', () => {
    const state = createAudioDelayState();
    nextAudioDelay(state, 128, 50);
    for (const delay of [115, 146, 130, 140, 118]) expect(nextAudioDelay(state, delay, 50)).toBeNull();
    expect(state.reported).toBe(128);
  });

  it('ignores a single outlier window (a stall)', () => {
    const state = createAudioDelayState();
    nextAudioDelay(state, 81, 100);
    expect(nextAudioDelay(state, 250, 100)).toBeNull();
    expect(nextAudioDelay(state, 85, 100)).toBeNull();
    expect(state.reported).toBe(81);
    expect(state.candidate).toBeNull();
  });

  it('moves to the average of two agreeing windows on a sustained change', () => {
    const state = createAudioDelayState();
    nextAudioDelay(state, 70, 100);
    expect(nextAudioDelay(state, 130, 100)).toBeNull();
    expect(nextAudioDelay(state, 140, 100)).toBe(135);
    expect(state.reported).toBe(135);
  });

  it('does not confirm a change with a window off in the other direction', () => {
    const state = createAudioDelayState();
    nextAudioDelay(state, 100, 100);
    expect(nextAudioDelay(state, 160, 100)).toBeNull();
    expect(nextAudioDelay(state, 40, 100)).toBeNull();
    expect(state.reported).toBe(100);
    expect(state.candidate).toBe(40);
  });
});

describe('isCleanWindow', () => {
  it('accepts steady 25 and 60 fps windows on a 60 Hz display', () => {
    expect(isCleanWindow({ underruns: 0, skipped: 0, maxShownMs: 66.7, intervalMs: 40 })).toBe(true);
    expect(isCleanWindow({ underruns: 0, skipped: 0, maxShownMs: 23, intervalMs: 16.7 })).toBe(true);
  });

  it('rejects startup bursts, pauses, seeks and stalls', () => {
    expect(isCleanWindow({ underruns: 0, skipped: 5, maxShownMs: 46, intervalMs: 41.7 })).toBe(false); // burst
    expect(isCleanWindow({ underruns: 1, skipped: 0, maxShownMs: 46, intervalMs: 41.7 })).toBe(false); // pause
    expect(isCleanWindow({ underruns: 0, skipped: 0, maxShownMs: 4395, intervalMs: 41.7 })).toBe(false); // resume
  });
});
