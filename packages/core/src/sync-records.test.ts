// packages/core/src/sync-records.test.ts
import { describe, expect, it } from 'vitest';
import { isNewer, mergeRecords, pruneTombstones, recordKey, validateRecord, type SyncRecord } from './sync-records';

const wl = (at: number, removed?: true): SyncRecord => ({ k: 'wl', type: 'movie', tmdb: 603, name: 'The Matrix', at, ...(removed && { removed }) });
const pm = (at: number, pos: number): SyncRecord => ({ k: 'pm', tmdb: 603, name: 'The Matrix', pos, dur: 8160, done: false, at });

describe('recordKey', () => {
  it('keys by kind and TMDB identity', () => {
    expect(recordKey(wl(1))).toBe('wl:movie:603');
    expect(recordKey(pm(1, 10))).toBe('pm:603');
    expect(recordKey({ k: 'pe', series: 1399, s: 1, e: 3, name: 'x', pos: 1, dur: 2, done: false, at: 1 })).toBe('pe:1399:1:3');
    expect(recordKey({ k: 'set', key: 'theme', value: 'dark', at: 1 })).toBe('set:theme');
  });
});

describe('mergeRecords', () => {
  it('newest wins per key, across computers', () => {
    const m = mergeRecords([[pm(100, 50)], [pm(200, 900)], [pm(150, 10)]]);
    expect(m.get('pm:603')).toMatchObject({ pos: 900, at: 200 });
  });
  it('a later removal beats an earlier add, and a later re-add beats the removal', () => {
    expect(mergeRecords([[wl(100)], [wl(200, true)]]).get('wl:movie:603')).toMatchObject({ removed: true });
    expect(mergeRecords([[wl(300)], [wl(200, true)]]).get('wl:movie:603')).not.toHaveProperty('removed');
  });
  it('a tie resolves the same way on every computer (removal first, then larger content)', () => {
    const a = mergeRecords([[wl(100)], [wl(100, true)]]).get('wl:movie:603');
    const b = mergeRecords([[wl(100, true)], [wl(100)]]).get('wl:movie:603');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ removed: true });
    const p1 = mergeRecords([[pm(5, 1)], [pm(5, 2)]]).get('pm:603');
    const p2 = mergeRecords([[pm(5, 2)], [pm(5, 1)]]).get('pm:603');
    expect(p1).toEqual(p2);
  });
  it('settings merge per key', () => {
    const m = mergeRecords([
      [{ k: 'set', key: 'theme', value: 'light', at: 1 }, { k: 'set', key: 'subtitles', value: { size: 'large' }, at: 9 }],
      [{ k: 'set', key: 'theme', value: 'dark', at: 5 }],
    ]);
    expect(m.get('set:theme')).toMatchObject({ value: 'dark' });
    expect(m.get('set:subtitles')).toMatchObject({ value: { size: 'large' } });
  });
});

describe('isNewer', () => {
  it('compares by at, then the tie rule', () => {
    expect(isNewer(pm(2, 1), pm(1, 1))).toBe(true);
    expect(isNewer(pm(1, 1), pm(2, 1))).toBe(false);
    expect(isNewer(pm(1, 1), undefined)).toBe(true);
  });
});

describe('validateRecord', () => {
  it('accepts well-formed records and drops extra fields', () => {
    expect(validateRecord({ ...pm(1, 2), sub_delay: 3 })).toEqual(pm(1, 2));
  });
  it('rejects anything malformed, unknown kinds and unsynced settings', () => {
    expect(validateRecord(null)).toBeNull();
    expect(validateRecord({ k: 'fav', tmdb: 1, at: 1 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), tmdb: -1 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), tmdb: 1.5 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), pos: Number.NaN })).toBeNull();
    expect(validateRecord({ ...wl(1), name: 'x'.repeat(501) })).toBeNull();
    expect(validateRecord({ k: 'set', key: 'allowLanSources', value: true, at: 1 })).toBeNull();
    expect(validateRecord({ k: 'set', key: 'theme', value: 'x'.repeat(20_000), at: 1 })).toBeNull();
  });
});

describe('pruneTombstones', () => {
  it('drops removals older than the window, keeps live records of any age', () => {
    const day = 86_400_000;
    const m = new Map<string, SyncRecord>([['a', wl(0, true)], ['b', pm(0, 1)], ['c', { k: 'wl', type: 'movie', tmdb: 7, name: 'x', at: 95 * day, removed: true }]]);
    const out = pruneTombstones(m, 100 * day);
    expect([...out.keys()]).toEqual(['b', 'c']);
  });
});
