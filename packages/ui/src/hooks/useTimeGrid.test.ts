import { describe, it, expect } from 'vitest';
import { msUntilNextMinute } from './useTimeGrid';

describe('guide minute tick', () => {
  it('waits until just past the next minute, so the guide changes when shows do', () => {
    const at = (h: number, m: number, s: number, ms = 0) => new Date(2026, 9, 17, h, m, s, ms).getTime();
    expect(at(21, 59, 59) + msUntilNextMinute(at(21, 59, 59))).toBeGreaterThanOrEqual(at(22, 0, 0));
    expect(at(21, 59, 59) + msUntilNextMinute(at(21, 59, 59))).toBeLessThan(at(22, 0, 1));
    expect(at(21, 58, 0, 1) + msUntilNextMinute(at(21, 58, 0, 1))).toBeGreaterThanOrEqual(at(21, 59, 0));
    expect(at(21, 58, 0, 1) + msUntilNextMinute(at(21, 58, 0, 1))).toBeLessThan(at(21, 59, 1));
  });
});
