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
