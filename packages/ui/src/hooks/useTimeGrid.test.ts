import { describe, it, expect, vi, afterEach } from 'vitest';
import { minuteOf, msUntilNextMinute, startMinuteTicker, stepBack } from './useTimeGrid';

const at = (h: number, m: number, s: number, ms = 0) => new Date(2026, 9, 17, h, m, s, ms).getTime();

describe('guide minute tick', () => {
  afterEach(() => vi.useRealTimers());

  it('waits until just past the next minute, so the guide changes when shows do', () => {
    expect(at(21, 59, 59) + msUntilNextMinute(at(21, 59, 59))).toBeGreaterThanOrEqual(at(22, 0, 0));
    expect(at(21, 59, 59) + msUntilNextMinute(at(21, 59, 59))).toBeLessThan(at(22, 0, 0, 200));
    expect(at(21, 58, 0, 1) + msUntilNextMinute(at(21, 58, 0, 1))).toBeGreaterThanOrEqual(at(21, 59, 0));
    expect(at(21, 58, 0, 1) + msUntilNextMinute(at(21, 58, 0, 1))).toBeLessThan(at(21, 59, 0, 200));
    // Exactly on the minute waits for the next one, never 0 ms
    expect(msUntilNextMinute(at(22, 0, 0))).toBe(60_050);
  });

  it('ticks just after each minute until stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(21, 59, 30));
    const onTick = vi.fn();
    const stop = startMinuteTicker(onTick);

    vi.advanceTimersByTime(29_999);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(180_000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("the guide's now is the whole minute, as the now-playing bar uses", () => {
    expect(minuteOf(at(21, 59, 59, 999))).toBe(at(21, 59, 0));
    expect(minuteOf(at(22, 0, 0, 50))).toBe(at(22, 0, 0));
  });

  it('the first step back from now snaps to its hour, then goes an hour at a time', () => {
    expect(stepBack(new Date(at(21, 42, 0))).getTime()).toBe(at(21, 0, 0));
    expect(stepBack(new Date(at(21, 0, 0))).getTime()).toBe(at(20, 0, 0));
  });
});
