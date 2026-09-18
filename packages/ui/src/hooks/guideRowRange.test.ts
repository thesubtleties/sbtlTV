import { describe, it, expect } from 'vitest';
import { padRowRange, rowRangeCovers } from './guideRowRange';

describe('padRowRange', () => {
  it('widens a rendered range by the pad on both sides', () => {
    expect(padRowRange({ start: 100, end: 120 }, 10000, 30)).toEqual({ start: 70, end: 150 });
  });

  it('clamps the padded range to the list bounds', () => {
    expect(padRowRange({ start: 5, end: 20 }, 40, 30)).toEqual({ start: 0, end: 39 });
  });

  it('clamps a stale range that starts past the end of a shorter list', () => {
    // Scrolled 900 rows deep, then the list is replaced by a 10-row category.
    expect(padRowRange({ start: 900, end: 920 }, 10, 30)).toEqual({ start: 0, end: 9 });
  });

  it('never returns a range whose start is after its end', () => {
    expect(padRowRange({ start: 200, end: 220 }, 100, 5)).toEqual({ start: 94, end: 99 });
  });

  it('returns null for an empty list', () => {
    expect(padRowRange({ start: 0, end: 0 }, 0, 30)).toBeNull();
  });
});

describe('rowRangeCovers', () => {
  it('is true when the inner range sits inside the outer range', () => {
    expect(rowRangeCovers({ start: 70, end: 150 }, { start: 100, end: 120 })).toBe(true);
  });

  it('is true when the ranges share an edge', () => {
    expect(rowRangeCovers({ start: 70, end: 150 }, { start: 70, end: 150 })).toBe(true);
  });

  it('is false when the inner range runs past the end of the outer range', () => {
    expect(rowRangeCovers({ start: 70, end: 150 }, { start: 140, end: 160 })).toBe(false);
  });

  it('is false when the inner range starts before the outer range', () => {
    expect(rowRangeCovers({ start: 70, end: 150 }, { start: 60, end: 80 })).toBe(false);
  });

  it('is false when nothing is loaded yet', () => {
    expect(rowRangeCovers(null, { start: 0, end: 20 })).toBe(false);
  });
});
