import { afterEach, describe, expect, it, vi } from 'vitest';
import { clockRange, dayLabel, daysFrom, durationLabel, startsIn, timeLeft } from './airTime';

const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();

// clockRange depends on the locale's time format: give it fixed strings, so each shape is pinned whatever CI runs in
const withClock = (fmt: (d: Date) => string) =>
  vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (this: Date) { return fmt(this); });
afterEach(() => vi.restoreAllMocks());
const twelve = (sep: string) => (d: Date) => {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${sep}${h < 12 ? 'AM' : 'PM'}`;
};

describe("a show's times", () => {
  it('say a shared AM/PM once (a plain space, or the narrow no-break space Chromium uses)', () => {
    for (const sep of [' ', ' ']) {
      withClock(twelve(sep));
      expect(clockRange(at(20, 23, 5), at(20, 23, 35))).toBe(`11:05 – 11:35${sep}PM`);
      expect(clockRange(at(20, 23, 35), at(21, 0, 5))).toBe(`11:35${sep}PM – 12:05${sep}AM`);
      vi.restoreAllMocks();
    }
  });
  it('keep both times whole with nothing to share: 24-hour, a marker first (Korean), or a show 12h+ long', () => {
    withClock((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
    expect(clockRange(at(20, 21, 0), at(20, 22, 30))).toBe('21:00 – 22:30');
    vi.restoreAllMocks();
    withClock((d) => `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`);
    expect(clockRange(at(20, 23, 5), at(20, 23, 35))).toBe('오후 11:05 – 오후 11:35');
    vi.restoreAllMocks();
    withClock(twelve(' '));
    expect(clockRange(at(20, 9, 0), at(21, 9, 0))).toBe('9:00 AM – 9:00 AM');
  });
});

describe('lengths, time left and until', () => {
  it('lengths: whole hours alone, otherwise hours and minutes', () => {
    expect(durationLabel(at(20, 20, 0), at(20, 22, 0))).toBe('2h');
    expect(durationLabel(at(20, 20, 0), at(20, 21, 30))).toBe('1h 30m');
    expect(durationLabel(at(20, 20, 0), at(20, 20, 30))).toBe('30m');
  });
  it('time left and until never say 0m', () => {
    expect(timeLeft(at(20, 21, 0), at(20, 20, 15))).toBe('45m left');
    expect(timeLeft(at(20, 21, 0), at(20, 20, 59) + 50_000)).toBe('1m left');
    expect(startsIn(at(20, 21, 5), at(20, 20, 0))).toBe('in 1h 5m');
    expect(startsIn(at(20, 20, 0), at(20, 20, 0) - 10_000)).toBe('in 1m');
  });
  it('days by the local calendar', () => {
    expect(daysFrom(at(21, 0, 30), at(20, 23, 50))).toBe(1);
    expect(dayLabel(at(20, 8, 0), at(20, 23, 0))).toBe('Today');
    expect(dayLabel(at(21, 20, 0), at(20, 20, 0))).toBe('Tomorrow');
  });
});
