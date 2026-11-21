import { describe, expect, it } from 'vitest';
import { onNow } from './onNow';

const at = (h: number, m: number) => new Date(2026, 10, 20, h, m);
const show = { title: 'Shark Tank', start: at(20, 0), end: at(21, 0) };

describe('what a guide row shows under its channel name', () => {
  it('the show on now, how far along, and the minutes left', () => {
    expect(onNow(show, at(20, 15))).toEqual({ title: 'Shark Tank', pct: 25, minutesLeft: 45 });
    expect(onNow(show, at(20, 0))).toEqual({ title: 'Shark Tank', pct: 0, minutesLeft: 60 });
  });
  it('stored dates as strings work the same', () => {
    expect(onNow({ title: 'x', start: at(20, 0).toISOString(), end: at(21, 0).toISOString() }, at(20, 30))?.pct).toBe(50);
  });
  it('nothing when no show, before it starts, from its end on, or with no length', () => {
    expect(onNow(null, at(20, 15))).toBeNull();
    expect(onNow(undefined, at(20, 15))).toBeNull();
    expect(onNow(show, at(19, 59))).toBeNull();
    expect(onNow(show, at(21, 0))).toBeNull();
    expect(onNow({ title: 'x', start: at(20, 0), end: at(20, 0) }, at(20, 0))).toBeNull();
  });
});

import { clockRange } from './airTime';
describe('a show\'s times', () => {
  it('say a shared AM/PM once, and both when they differ', () => {
    const r = clockRange(new Date(2026, 10, 20, 23, 5).getTime(), new Date(2026, 10, 20, 23, 35).getTime());
    const across = clockRange(new Date(2026, 10, 20, 23, 35).getTime(), new Date(2026, 10, 21, 0, 5).getTime());
    // In a 12-hour locale: "11:05 – 11:35 PM" and "11:35 PM – 12:05 AM"; in a 24-hour one there's nothing to share
    const suffixes = r.match(/[AP]M/g)?.length ?? 0;
    expect(suffixes).toBeLessThanOrEqual(1);
    expect(across.match(/[AP]M/g)?.length ?? 0).not.toBe(1);
  });
});
