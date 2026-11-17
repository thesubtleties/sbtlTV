// packages/core/src/sync-records.test.ts
import { describe, expect, it } from 'vitest';
import { isNewer, mergeRecords, pruneTombstones, recordKey, recordPart, validateRecord, type SyncRecord } from './sync-records';

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

describe('validateRecord: each field is checked (lens 7)', () => {
  const pe = (o: Record<string, unknown> = {}) => ({ k: 'pe', series: 1399, s: 1, e: 3, name: 'GoT', pos: 10, dur: 100, done: false, at: 1, ...o });
  it('accepts season 0 (specials) and episode 0', () => {
    expect(validateRecord(pe({ s: 0, e: 0 }))).toMatchObject({ s: 0, e: 0 });
  });
  it('rejects a bad episode number, a TMDB id of 0, a time of 0, a negative position and a missing done', () => {
    expect(validateRecord(pe({ e: -1 }))).toBeNull();
    expect(validateRecord(pe({ e: 1.5 }))).toBeNull();
    expect(validateRecord(pe({ series: 0 }))).toBeNull();
    expect(validateRecord({ ...pm(1, 2), tmdb: 0 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), at: 0 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), at: -5 })).toBeNull();
    expect(validateRecord({ ...pm(1, 2), pos: -1 })).toBeNull();
    const { done: _d, ...noDone } = pm(1, 2) as unknown as Record<string, unknown>;
    expect(validateRecord(noDone)).toBeNull();
  });
  it('rejects an unknown watchlist type, a removed flag that is not true, and a removed setting', () => {
    expect(validateRecord({ ...wl(1), type: 'tv' })).toBeNull();
    expect(validateRecord({ ...wl(1), removed: 'yes' })).toBeNull();
    expect(validateRecord({ ...wl(1), removed: false })).toBeNull();
    expect(validateRecord({ k: 'set', key: 'theme', value: 'dark', at: 1, removed: true })).toBeNull();
  });
});

describe('recordPart', () => {
  it('names the part each kind belongs to', () => {
    expect(recordPart(wl(1))).toBe('watchlist');
    expect(recordPart(pm(1, 1))).toBe('progress');
    expect(recordPart({ k: 'pe', series: 1, s: 1, e: 1, name: 'x', pos: 1, dur: 2, done: false, at: 1 })).toBe('progress');
    expect(recordPart({ k: 'set', key: 'theme', value: 'dark', at: 1 })).toBe('settings');
  });
});

describe('pruneTombstones window', () => {
  it('keeps a removal for 90 days', () => {
    const day = 86_400_000;
    const m = new Map<string, SyncRecord>([['young', wl(11 * day, true)], ['old', wl(9 * day, true)]]);
    expect([...pruneTombstones(m, 100 * day).keys()]).toEqual(['young']);
  });
});

describe('fav records', () => {
  const fav = { k: 'fav', host: 'provider.example', ch: '1234', guide: 'CNN.us', name: 'CNN HD', at: 1_700_000_000_000 };
  it('validates, keys by host and channel id, and belongs to Favorites', () => {
    const r = validateRecord(fav)!;
    expect(r).toEqual(fav);
    expect(recordKey(r)).toBe('fav:provider.example:1234');
    expect(recordPart(r)).toBe('favorites');
  });
  it('a removal needs no guide id; extra fields are dropped', () => {
    expect(validateRecord({ k: 'fav', host: 'file', ch: 'abc', name: 'X', at: 5, removed: true, url: 'http://x' })).toEqual({ k: 'fav', host: 'file', ch: 'abc', name: 'X', at: 5, removed: true });
  });
  it('rejects bad hosts and ids (no logins, schemes or paths)', () => {
    for (const host of ['', 'http://a.b', 'user:pw@a.b', 'a.b/path', 'A'.repeat(300)]) expect(validateRecord({ ...fav, host })).toBeNull();
    for (const ch of ['', 'x'.repeat(200)]) expect(validateRecord({ ...fav, ch })).toBeNull();
    expect(validateRecord({ ...fav, guide: 'g'.repeat(300) })).toBeNull();
  });
  it('an unknown kind is ignored, not an error (older builds meeting newer records)', () => {
    expect(validateRecord({ k: 'zz', at: 5 })).toBeNull();
  });
});
