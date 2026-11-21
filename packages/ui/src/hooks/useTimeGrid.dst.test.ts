// The hour repeated when clocks go back: the guide's edge must stay within the half hour now is in
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/New_York';
import { describe, it, expect } from 'vitest';
import { floorToHalfHour, stepBack } from './useTimeGrid';
import { jumpAnchor } from '../utils/guideSearchLogic';

const iso = (s: string) => new Date(s);

describe('half hours when clocks go back (America/New_York, 1 Nov 2026)', () => {
  it('the second 1:10 and 1:45 floor to their own half hour, not one an hour earlier', () => {
    expect(floorToHalfHour(iso('2026-11-01T06:10:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(floorToHalfHour(iso('2026-11-01T06:45:00Z')).toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(floorToHalfHour(iso('2026-11-01T05:45:00Z')).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it('never more than 30 minutes behind, all through the night', () => {
    for (let t = Date.parse('2026-11-01T03:00:00Z'); t < Date.parse('2026-11-01T10:00:00Z'); t += 7 * 60_000) {
      const back = t - floorToHalfHour(new Date(t)).getTime();
      expect(back).toBeGreaterThanOrEqual(0);
      expect(back).toBeLessThan(30 * 60_000);
    }
  });
  it('a step back from the second 1:30 goes to the second 1:00; a search jump uses the same edge', () => {
    expect(stepBack(iso('2026-11-01T06:30:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(jumpAnchor(Date.parse('2026-11-01T06:45:00Z')).toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });
});
