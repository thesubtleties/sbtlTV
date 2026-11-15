import { describe, it, expect } from 'vitest';
import { pickMoreLikeThis, shouldAskSimilar } from './moreLikeThis';

const t = (tmdb_id: number, category_ids: string[] = ['c1'], name = `t${tmdb_id}`) => ({ tmdb_id, category_ids, name });

describe('More like this', () => {
  it("keeps TMDB's order, only titles the library has, never the title itself", () => {
    const lib = [t(5), t(3), t(9), t(1), t(7), t(42)];
    const out = pickMoreLikeThis([42, 9, 8, 3, 1, 5, 7], lib, new Set(), 42);
    expect(out.map((x) => x.tmdb_id)).toEqual([9, 3, 1, 5, 7]);
  });

  it('one copy per title (the first, which the caller sets to the preferred source)', () => {
    const lib = [t(1, ['c1'], 'preferred'), t(1, ['c2'], 'other'), t(2), t(3), t(4)];
    const out = pickMoreLikeThis([1, 2, 3, 4], lib, new Set(), undefined);
    expect(out[0].name).toBe('preferred');
    expect(out).toHaveLength(4);
  });

  it('a title in any adult category is left out, even with a clean copy elsewhere', () => {
    const lib = [t(1, ['xxx']), t(1, ['c1']), t(2), t(3), t(4), t(5)];
    const out = pickMoreLikeThis([1, 2, 3, 4, 5], lib, new Set(['xxx']), undefined);
    expect(out.map((x) => x.tmdb_id)).toEqual([2, 3, 4, 5]);
  });

  it('fewer than 4 matches, or categories not loaded yet: no row', () => {
    const lib = [t(1), t(2), t(3)];
    expect(pickMoreLikeThis([1, 2, 3], lib, new Set(), undefined)).toEqual([]);
    expect(pickMoreLikeThis([1, 2, 3, 4], [...lib, t(4)], null, undefined)).toEqual([]);
  });

  it('at most 20, repeats (recommendations then similar) counted once', () => {
    const lib = Array.from({ length: 30 }, (_, i) => t(i + 1));
    const ids = [...lib.map((x) => x.tmdb_id), 1, 2, 3];
    expect(pickMoreLikeThis(ids, lib, new Set(), undefined)).toHaveLength(20);
  });
});

describe('asking TMDB for similar titles too', () => {
  const lib = Array.from({ length: 10 }, (_, i) => t(i + 1));
  const base = { similarAsked: false, library: lib, adultCategoryIds: new Set<string>(), selfTmdbId: 99 };

  it('only when the row would have fewer than 6', () => {
    expect(shouldAskSimilar({ ...base, recs: { ids: [1, 2, 3, 4, 5, 6], failed: false } })).toBe(false);
    expect(shouldAskSimilar({ ...base, recs: { ids: [1, 2, 3, 4, 5, 77], failed: false } })).toBe(true);
    expect(shouldAskSimilar({ ...base, recs: { ids: [], failed: false } })).toBe(true); // TMDB had none
  });

  it('counts by the row\'s rules: adult titles and the title itself do not count', () => {
    const adultLib = [...lib, t(20, ['xxx']), t(21, ['xxx'])];
    const ids = [1, 2, 3, 4, 20, 21, 99];
    expect(shouldAskSimilar({ ...base, library: adultLib, adultCategoryIds: new Set(['xxx']), recs: { ids, failed: false } })).toBe(true);
  });

  it('waits for recommendations, the library answer for them, and the categories; never twice; not after a failure', () => {
    const recs = { ids: [1], failed: false };
    expect(shouldAskSimilar({ ...base, recs: null })).toBe(false);
    expect(shouldAskSimilar({ ...base, recs, library: null })).toBe(false);
    expect(shouldAskSimilar({ ...base, recs, adultCategoryIds: null })).toBe(false);
    expect(shouldAskSimilar({ ...base, recs, similarAsked: true })).toBe(false);
    expect(shouldAskSimilar({ ...base, recs: { ids: [], failed: true } })).toBe(false); // bad key or rate limit: one failing call, not two
  });
});
